// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts-upgradeable/token/ERC1155/ERC1155Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@uniswap/v3-periphery/contracts/interfaces/ISwapRouter.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @dev Minimal WETH9 interface — deposit wraps ETH, withdraw unwraps to ETH.
interface IWETH9 {
    function deposit() external payable;
    function withdraw(uint256 amount) external;
    function approve(address spender, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

contract Smartfolio is
    Initializable,
    ERC1155Upgradeable,
    OwnableUpgradeable,
    UUPSUpgradeable,
    PausableUpgradeable
{
    // -------------------------------------------------------------------------
    // Reentrancy guard (inline — OZ v5 removed ReentrancyGuardUpgradeable)
    // -------------------------------------------------------------------------

    uint256 private _reentrancyStatus;
    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED = 2;

    modifier nonReentrant() {
        require(_reentrancyStatus != _ENTERED, "Smartfolio: reentrant call");
        _reentrancyStatus = _ENTERED;
        _;
        _reentrancyStatus = _NOT_ENTERED;
    }

    // -------------------------------------------------------------------------
    // Constants
    // -------------------------------------------------------------------------

    /// @dev 1e18 represents 100% in WAD fixed-point math.
    uint256 private constant WAD = 1e18;

    /// @dev Hard cap: burn fee can never exceed 80% regardless of owner config.
    uint256 private constant MAX_BURN_FEE_CAP = 0.8e18;

    // -------------------------------------------------------------------------
    // Types
    // -------------------------------------------------------------------------

    struct TierConfig {
        uint128 threshold;     // total supply at which this tier ends (exclusive)
        uint128 pricePerToken; // price in wei per token while in this tier
    }

    struct TokenInfo {
        uint256 circulatingSupply; // tokens currently in circulation
        uint256 totalMinted;       // cumulative tokens ever minted
        uint256 maxSupply;         // 0 = uncapped
        uint256 reserve;           // ETH backing this token ID
        uint256 backingPerToken;   // reserve / circulatingSupply (0 if supply is 0)
        uint256 currentTierIndex;  // index of the tier the next mint falls in
        uint256 currentPrice;      // price per token for the next mint
    }

    struct BurnSimulation {
        uint256 gross;    // ETH before fee
        uint256 fee;      // exit fee
        uint256 net;      // ETH received by caller
        uint256 feeRate;  // fee rate in WAD
    }

    /// @dev One asset in a portfolio basket.
    struct PortfolioAsset {
        address token;       // ERC20 token address
        uint16 weightBps;    // allocation weight in basis points (1 = 0.01%)
        uint24 poolFee;      // Uniswap V3 pool fee tier (500 / 3000 / 10000)
        bytes swapPath;      // buy  path: empty = single-hop WETH→token via poolFee
        bytes sellSwapPath;  // sell path: empty = single-hop token→WETH via poolFee
    }

    /// @dev One swap instruction passed to rebalance() by the keeper.
    struct RebalanceInstruction {
        address token;        // ERC20 to sell or buy
        bool isSell;          // true = sell token→WETH, false = buy WETH→token
        uint256 amountIn;     // exact amount in (token units for sell, WETH for buy)
        uint256 amountOutMin; // minimum output (slippage guard)
        uint24 poolFee;       // Uniswap V3 fee tier for single-hop
        bytes swapPath;       // encoded multi-hop path; empty = single-hop
    }

    // -------------------------------------------------------------------------
    // State
    // -------------------------------------------------------------------------

    /// @dev Per-token-ID step tiers, ordered by ascending threshold.
    mapping(uint256 => TierConfig[]) private _tiers;

    /// @dev Total tokens minted per token ID (never decremented on burn).
    mapping(uint256 => uint256) public totalMinted;

    /// @dev Current circulating supply per token ID (decremented on burn).
    mapping(uint256 => uint256) public totalSupply;

    /// @dev ETH reserve backing each token ID.
    mapping(uint256 => uint256) public reserve;

    /// @dev Maximum supply cap per token ID. 0 means uncapped.
    mapping(uint256 => uint256) public maxSupply;

    /// @dev Maximum burn fee rate in WAD (default 50%).
    uint256 public maxBurnFeeRate;

    /// @dev Treasury address. If non-zero, burn fees are sent here instead of
    ///      staying in the reserve.
    address public treasury;

    // ---- Portfolio state ----

    /// @dev Portfolio basket configuration per token ID.
    mapping(uint256 => PortfolioAsset[]) private _portfolioConfig;

    /// @dev Whether a token ID's portfolio has been deployed (ETH → ERC20s).
    mapping(uint256 => bool) public portfolioActive;

    /// @dev ERC20 token balance held by this contract per token ID per asset address.
    mapping(uint256 => mapping(address => uint256)) public portfolioHoldings;

    /// @dev ETH amount that was converted into ERC20s for a token ID.
    mapping(uint256 => uint256) public deployedEth;

    /// @dev Keeper address — authorised to call deploy() and rebalance().
    address public keeper;

    /// @dev Uniswap V3 SwapRouter.
    ISwapRouter public swapRouter;

    /// @dev WETH9 contract used to wrap/unwrap ETH for Uniswap.
    IWETH9 public weth;

    /// @dev Maximum acceptable slippage in basis points (default 50 = 0.5%).
    uint16 public slippageToleranceBps;

    // -------------------------------------------------------------------------
    // Events
    // -------------------------------------------------------------------------

    event Minted(address indexed account, uint256 indexed id, uint256 amount, uint256 ethPaid);
    event Burned(address indexed account, uint256 indexed id, uint256 amount, uint256 ethRefunded, uint256 feePaid);
    event TiersSet(uint256 indexed id, TierConfig[] tiers);
    event MaxSupplySet(uint256 indexed id, uint256 cap);
    event MaxBurnFeeRateSet(uint256 rate);
    event TreasurySet(address treasury);
    event PortfolioConfigSet(uint256 indexed id, PortfolioAsset[] assets);
    event KeeperSet(address keeper);
    event SwapRouterSet(address swapRouter);
    event WETHSet(address weth);
    event SlippageToleranceSet(uint16 bps);
    event Deployed(uint256 indexed id, uint256 ethDeployed);
    event Rebalanced(uint256 indexed id);
    event Divested(address indexed account, uint256 indexed id, uint256 amount, uint256 ethReceived);

    // -------------------------------------------------------------------------
    // Constructor / Initializer
    // -------------------------------------------------------------------------

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address initialOwner) public initializer {
        __ERC1155_init("");
        __Ownable_init(initialOwner);
        __Pausable_init();
        _reentrancyStatus = _NOT_ENTERED;
        maxBurnFeeRate = 0.5e18; // 50% default
        slippageToleranceBps = 50; // 0.5% default
    }

    // -------------------------------------------------------------------------
    // Admin
    // -------------------------------------------------------------------------

    function setURI(string memory newUri) public onlyOwner {
        _setURI(newUri);
    }

    /// @notice Pause all minting and burning.
    function pause() external onlyOwner {
        _pause();
    }

    /// @notice Resume minting and burning.
    function unpause() external onlyOwner {
        _unpause();
    }

    /**
     * @notice Configure the step tiers for a token ID.
     * @dev    Tiers must be ordered by ascending threshold. The last tier acts
     *         as the open-ended top tier (its threshold is ignored).
     *         At least one tier is required.
     */
    function setTiers(uint256 id, TierConfig[] calldata tiers) external onlyOwner {
        require(tiers.length > 0, "Smartfolio: no tiers provided");
        require(tiers[0].pricePerToken > 0, "Smartfolio: price must be > 0");

        for (uint256 i = 1; i < tiers.length; i++) {
            // The last tier is open-ended — its threshold is not used, skip ordering check.
            if (i < tiers.length - 1) {
                require(
                    tiers[i].threshold > tiers[i - 1].threshold,
                    "Smartfolio: tiers must be ordered ascending"
                );
            }
            require(tiers[i].pricePerToken > 0, "Smartfolio: price must be > 0");
        }

        delete _tiers[id];
        for (uint256 i = 0; i < tiers.length; i++) {
            _tiers[id].push(tiers[i]);
        }

        emit TiersSet(id, tiers);
    }

    /**
     * @notice Set a maximum circulating supply cap for a token ID.
     *         Use 0 to remove the cap.
     */
    function setMaxSupply(uint256 id, uint256 cap) external onlyOwner {
        maxSupply[id] = cap;
        emit MaxSupplySet(id, cap);
    }

    /**
     * @notice Set the maximum burn fee rate (WAD, e.g. 0.5e18 = 50%).
     *         The actual fee for any burn is `rate² × maxBurnFeeRate` where
     *         `rate = burnAmount / totalSupply`.
     */
    function setMaxBurnFeeRate(uint256 rate) external onlyOwner {
        require(rate <= MAX_BURN_FEE_CAP, "Smartfolio: exceeds hard cap");
        maxBurnFeeRate = rate;
        emit MaxBurnFeeRateSet(rate);
    }

    /**
     * @notice Set a treasury address to receive burn fees.
     *         Set to address(0) to keep fees in the reserve (default behaviour).
     */
    function setTreasury(address _treasury) external onlyOwner {
        treasury = _treasury;
        emit TreasurySet(_treasury);
    }

    // -------------------------------------------------------------------------
    // Portfolio admin
    // -------------------------------------------------------------------------

    modifier onlyKeeper() {
        require(msg.sender == keeper, "Smartfolio: caller is not keeper");
        _;
    }

    /**
     * @notice Set the authorised keeper address.
     */
    function setKeeper(address _keeper) external onlyOwner {
        require(_keeper != address(0), "Smartfolio: zero address");
        keeper = _keeper;
        emit KeeperSet(_keeper);
    }

    /**
     * @notice Set the Uniswap V3 SwapRouter address.
     */
    function setSwapRouter(address _swapRouter) external onlyOwner {
        require(_swapRouter != address(0), "Smartfolio: zero address");
        swapRouter = ISwapRouter(_swapRouter);
        emit SwapRouterSet(_swapRouter);
    }

    /**
     * @notice Set the WETH9 contract address.
     */
    function setWETH(address _weth) external onlyOwner {
        require(_weth != address(0), "Smartfolio: zero address");
        weth = IWETH9(_weth);
        emit WETHSet(_weth);
    }

    /**
     * @notice Set the maximum slippage tolerance for Uniswap swaps.
     * @param bps Basis points (e.g. 50 = 0.5%). Hard-capped at 1000 (10%).
     */
    function setSlippageTolerance(uint16 bps) external onlyOwner {
        require(bps <= 1000, "Smartfolio: slippage exceeds 10%");
        slippageToleranceBps = bps;
        emit SlippageToleranceSet(bps);
    }

    /**
     * @notice Configure the ERC20 portfolio basket for a token ID.
     * @dev    - Weights must sum to exactly 10 000 bps (100%).
     *         - Cannot be changed while the portfolio is active (deployed).
     *           Call requires the portfolio to be inactive so the keeper can
     *           re-deploy after a config change.
     *         - Each asset must have a non-zero token address and pool fee.
     *         - A swapPath of length 0 means single-hop: WETH → token via poolFee.
     *           A non-empty swapPath is used as-is for multi-hop exact-input swaps.
     * @param id     Token ID to configure.
     * @param assets Array of PortfolioAsset structs.
     */
    function setPortfolioConfig(uint256 id, PortfolioAsset[] calldata assets) external onlyOwner {
        require(assets.length > 0, "Smartfolio: no assets provided");
        require(!portfolioActive[id], "Smartfolio: portfolio is active");

        uint256 totalWeight;
        for (uint256 i = 0; i < assets.length; i++) {
            require(assets[i].token != address(0), "Smartfolio: zero token address");
            require(assets[i].weightBps > 0, "Smartfolio: zero weight");
            require(
                assets[i].poolFee == 500 || assets[i].poolFee == 3000 || assets[i].poolFee == 10000,
                "Smartfolio: invalid pool fee"
            );
            totalWeight += assets[i].weightBps;
        }
        require(totalWeight == 10_000, "Smartfolio: weights must sum to 10000");

        delete _portfolioConfig[id];
        for (uint256 i = 0; i < assets.length; i++) {
            _portfolioConfig[id].push(assets[i]);
        }

        emit PortfolioConfigSet(id, assets);
    }

    /**
     * @notice Returns the portfolio basket configuration for a token ID.
     */
    function getPortfolioConfig(uint256 id) external view returns (PortfolioAsset[] memory) {
        return _portfolioConfig[id];
    }

    // -------------------------------------------------------------------------
    // Mint pricing
    // -------------------------------------------------------------------------

    /**
     * @notice Returns the total ETH cost to mint `amount` tokens of `id`,
     *         accounting for tier boundary crossings.
     */
    function mintCost(uint256 id, uint256 amount) public view returns (uint256 cost) {
        TierConfig[] storage tiers = _tiers[id];
        require(tiers.length > 0, "Smartfolio: tiers not configured for id");
        require(amount > 0, "Smartfolio: amount must be > 0");

        uint256 supply = totalMinted[id];
        uint256 remaining = amount;
        uint256 lastTier = tiers.length - 1;

        for (uint256 i = 0; i < tiers.length && remaining > 0; i++) {
            uint256 price = tiers[i].pricePerToken;

            if (i < lastTier) {
                uint256 tierCap = tiers[i].threshold;
                if (supply >= tierCap) continue;

                uint256 availableInTier = tierCap - supply;
                uint256 mintedInTier = remaining < availableInTier ? remaining : availableInTier;

                cost += mintedInTier * price;
                supply += mintedInTier;
                remaining -= mintedInTier;
            } else {
                cost += remaining * price;
                remaining = 0;
            }
        }
    }

    function getTiers(uint256 id) external view returns (TierConfig[] memory) {
        return _tiers[id];
    }

    // -------------------------------------------------------------------------
    // Burn pricing
    // -------------------------------------------------------------------------

    /**
     * @notice Returns the fee rate (WAD) applied when burning `amount` tokens of `id`.
     * @dev    feeRate = (amount / totalSupply)² × maxBurnFeeRate
     *         Quadratic scaling: small burns pay almost nothing; large exits
     *         pay proportionally much more, protecting remaining holders.
     */
    function burnFeeRate(uint256 id, uint256 amount) public view returns (uint256) {
        uint256 supply = totalSupply[id];
        require(supply > 0, "Smartfolio: no supply");
        require(amount <= supply, "Smartfolio: amount exceeds supply");

        uint256 proportion = (amount * WAD) / supply;
        uint256 proportionSquared = (proportion * proportion) / WAD;
        return (proportionSquared * maxBurnFeeRate) / WAD;
    }

    /**
     * @notice Preview the refund breakdown for burning `amount` tokens of `id`.
     * @return gross   ETH before fee (pro-rata share of reserve).
     * @return fee     ETH charged as exit fee.
     * @return net     ETH sent to the caller.
     */
    function burnRefund(uint256 id, uint256 amount)
        public
        view
        returns (uint256 gross, uint256 fee, uint256 net)
    {
        uint256 supply = totalSupply[id];
        require(supply > 0, "Smartfolio: no supply");
        require(amount > 0, "Smartfolio: amount must be > 0");
        require(amount <= supply, "Smartfolio: amount exceeds supply");

        gross = (amount * reserve[id]) / supply;
        uint256 rate = burnFeeRate(id, amount);
        fee = (gross * rate) / WAD;
        net = gross - fee;
    }

    // -------------------------------------------------------------------------
    // Minting
    // -------------------------------------------------------------------------

    /**
     * @notice Mint `amount` tokens of `id` to `account`. Excess ETH is refunded.
     */
    function mint(
        address account,
        uint256 id,
        uint256 amount,
        bytes memory data
    ) public payable nonReentrant whenNotPaused {
        uint256 cap = maxSupply[id];
        require(
            cap == 0 || totalSupply[id] + amount <= cap,
            "Smartfolio: exceeds max supply"
        );

        uint256 cost = mintCost(id, amount);
        require(msg.value >= cost, "Smartfolio: insufficient ETH");

        totalMinted[id] += amount;
        totalSupply[id] += amount;
        reserve[id] += cost;

        _mint(account, id, amount, data);
        emit Minted(account, id, amount, cost);

        uint256 excess = msg.value - cost;
        if (excess > 0) {
            (bool ok, ) = msg.sender.call{value: excess}("");
            require(ok, "Smartfolio: ETH refund failed");
        }
    }

    /**
     * @notice Mint multiple token IDs in one transaction.
     *         msg.value must cover the sum of all mintCost(ids[i], amounts[i]).
     */
    function mintBatch(
        address to,
        uint256[] memory ids,
        uint256[] memory amounts,
        bytes memory data
    ) public payable nonReentrant whenNotPaused {
        require(ids.length == amounts.length, "Smartfolio: length mismatch");

        uint256 totalCost;
        for (uint256 i = 0; i < ids.length; i++) {
            uint256 cap = maxSupply[ids[i]];
            require(
                cap == 0 || totalSupply[ids[i]] + amounts[i] <= cap,
                "Smartfolio: exceeds max supply"
            );
            totalCost += mintCost(ids[i], amounts[i]);
        }
        require(msg.value >= totalCost, "Smartfolio: insufficient ETH");

        for (uint256 i = 0; i < ids.length; i++) {
            uint256 cost = mintCost(ids[i], amounts[i]);
            totalMinted[ids[i]] += amounts[i];
            totalSupply[ids[i]] += amounts[i];
            reserve[ids[i]] += cost;
        }

        _mintBatch(to, ids, amounts, data);

        uint256 excess = msg.value - totalCost;
        if (excess > 0) {
            (bool ok, ) = msg.sender.call{value: excess}("");
            require(ok, "Smartfolio: ETH refund failed");
        }
    }

    // -------------------------------------------------------------------------
    // Burning
    // -------------------------------------------------------------------------

    /**
     * @notice Burn `amount` tokens of `id` and receive ETH from the reserve.
     * @dev    A proportional exit fee is applied.
     *         - If treasury is set: fee is forwarded to the treasury address.
     *         - If treasury is address(0): fee stays in the reserve, increasing
     *           the backing value for remaining holders.
     *         Fee formula: feeRate = (burnAmount / totalSupply)² × maxBurnFeeRate
     */
    function burn(uint256 id, uint256 amount) external nonReentrant whenNotPaused {
        require(!portfolioActive[id], "Smartfolio: use divest() when portfolio is active");
        require(amount > 0, "Smartfolio: amount must be > 0");
        require(balanceOf(msg.sender, id) >= amount, "Smartfolio: insufficient balance");

        (,uint256 fee, uint256 net) = burnRefund(id, amount);

        // Checks-effects-interactions: update state before any external calls
        totalSupply[id] -= amount;
        if (treasury != address(0)) {
            // Fee leaves the reserve and goes to treasury
            reserve[id] -= (net + fee);
        } else {
            // Fee stays in reserve
            reserve[id] -= net;
        }

        _burn(msg.sender, id, amount);
        emit Burned(msg.sender, id, amount, net, fee);

        (bool ok, ) = msg.sender.call{value: net}("");
        require(ok, "Smartfolio: ETH transfer failed");

        if (treasury != address(0) && fee > 0) {
            (bool feeOk, ) = treasury.call{value: fee}("");
            require(feeOk, "Smartfolio: fee transfer failed");
        }
    }

    // -------------------------------------------------------------------------
    // Portfolio operations (keeper)
    // -------------------------------------------------------------------------

    /**
     * @notice Deploy a token ID's ETH reserve into its configured ERC20 basket.
     * @dev    Wraps the full reserve to WETH, then swaps to each asset according
     *         to weightBps.  The last asset receives any remainder to avoid dust.
     *         Sets portfolioActive[id] = true; burn() will revert until divest().
     * @param id                Token ID to deploy.
     * @param amountsOutMinimum Minimum ERC20 received per asset (slippage guard).
     *                          Length must equal portfolioConfig length.
     */
    function deploy(uint256 id, uint256[] calldata amountsOutMinimum)
        external
        onlyKeeper
        nonReentrant
    {
        require(address(swapRouter) != address(0), "Smartfolio: router not set");
        require(address(weth) != address(0), "Smartfolio: WETH not set");

        PortfolioAsset[] storage assets = _portfolioConfig[id];
        require(assets.length > 0, "Smartfolio: no portfolio config");
        require(!portfolioActive[id], "Smartfolio: already deployed");
        require(reserve[id] > 0, "Smartfolio: no reserve to deploy");
        require(amountsOutMinimum.length == assets.length, "Smartfolio: length mismatch");

        uint256 ethToSwap = reserve[id];

        // Effects before external calls
        reserve[id] = 0;
        deployedEth[id] = ethToSwap;
        portfolioActive[id] = true;

        // Wrap ETH → WETH
        weth.deposit{value: ethToSwap}();

        // Swap WETH → each portfolio asset; last asset gets any rounding remainder
        uint256 wethRemaining = ethToSwap;
        for (uint256 i = 0; i < assets.length; i++) {
            uint256 amountIn = (i == assets.length - 1)
                ? wethRemaining
                : (ethToSwap * assets[i].weightBps) / 10_000;

            wethRemaining -= amountIn;

            uint256 amountOut = _swapWETHForToken(
                assets[i].token,
                amountIn,
                amountsOutMinimum[i],
                assets[i].poolFee,
                assets[i].swapPath
            );
            portfolioHoldings[id][assets[i].token] += amountOut;
        }

        emit Deployed(id, ethToSwap);
    }

    /**
     * @notice Rebalance a deployed portfolio back towards its target weights.
     * @dev    The keeper computes off-chain which assets are over/under weight and
     *         supplies a list of swap instructions.  Sells (token→WETH) should come
     *         before buys (WETH→token) so WETH is available for purchases.
     *         Any WETH left after all instructions stays in the contract as dust.
     * @param id           Token ID whose portfolio to rebalance.
     * @param instructions Ordered list of swap instructions from the keeper.
     */
    function rebalance(uint256 id, RebalanceInstruction[] calldata instructions)
        external
        onlyKeeper
        nonReentrant
    {
        require(portfolioActive[id], "Smartfolio: portfolio not active");
        require(instructions.length > 0, "Smartfolio: no instructions");

        for (uint256 i = 0; i < instructions.length; i++) {
            RebalanceInstruction calldata inst = instructions[i];

            if (inst.isSell) {
                // Sell token → WETH
                require(
                    portfolioHoldings[id][inst.token] >= inst.amountIn,
                    "Smartfolio: insufficient holdings"
                );
                portfolioHoldings[id][inst.token] -= inst.amountIn;
                _swapTokenForWETH(
                    inst.token,
                    inst.amountIn,
                    inst.amountOutMin,
                    inst.poolFee,
                    inst.swapPath
                );
            } else {
                // Buy WETH → token
                uint256 amountOut = _swapWETHForToken(
                    inst.token,
                    inst.amountIn,
                    inst.amountOutMin,
                    inst.poolFee,
                    inst.swapPath
                );
                portfolioHoldings[id][inst.token] += amountOut;
            }
        }

        emit Rebalanced(id);
    }

    // -------------------------------------------------------------------------
    // Divest — fee-free exit through portfolio
    // -------------------------------------------------------------------------

    /**
     * @notice Burn `amount` ERC1155 tokens and receive ETH by selling the
     *         pro-rata ERC20 holdings back to WETH via Uniswap V3.
     * @dev    No bonding curve exit fee is charged.
     *         - Only callable when portfolioActive[id] is true.
     *           Use burn() when the portfolio has not been deployed yet.
     *         - State is updated before swaps (CEI); nonReentrant guards the rest.
     *         - If totalSupply reaches 0, portfolioActive resets so the owner
     *           can reconfigure and redeploy.
     * @param id        Token ID to exit.
     * @param amount    Number of ERC1155 tokens to burn.
     * @param minEthOut Minimum ETH the caller accepts (overall slippage guard).
     */
    function divest(
        uint256 id,
        uint256 amount,
        uint256 minEthOut
    ) external nonReentrant whenNotPaused {
        require(portfolioActive[id], "Smartfolio: portfolio not active");
        require(amount > 0, "Smartfolio: amount must be > 0");
        require(balanceOf(msg.sender, id) >= amount, "Smartfolio: insufficient balance");

        uint256 supply = totalSupply[id];
        PortfolioAsset[] storage assets = _portfolioConfig[id];

        // --- Effects (before external calls) ---

        // Pro-rata share of any undeployed reserve (normally 0 when active)
        uint256 ethFromReserve = (reserve[id] * amount) / supply;
        reserve[id] -= ethFromReserve;

        // Pro-rata ERC20 amounts to sell
        uint256[] memory tokenAmounts = new uint256[](assets.length);
        for (uint256 i = 0; i < assets.length; i++) {
            tokenAmounts[i] = (portfolioHoldings[id][assets[i].token] * amount) / supply;
            portfolioHoldings[id][assets[i].token] -= tokenAmounts[i];
        }

        deployedEth[id] -= (deployedEth[id] * amount) / supply;
        totalSupply[id] -= amount;

        // Auto-reset so owner can reconfigure after the last token is divested
        if (totalSupply[id] == 0) {
            portfolioActive[id] = false;
        }

        _burn(msg.sender, id, amount);

        // --- Interactions ---

        // Sell each ERC20 → WETH
        uint256 wethReceived;
        for (uint256 i = 0; i < assets.length; i++) {
            if (tokenAmounts[i] == 0) continue;
            wethReceived += _swapTokenForWETH(
                assets[i].token,
                tokenAmounts[i],
                0,                      // per-swap minimum skipped; total checked below
                assets[i].poolFee,
                assets[i].sellSwapPath
            );
        }

        // Unwrap WETH → ETH (triggers receive())
        if (wethReceived > 0) {
            weth.withdraw(wethReceived);
        }

        uint256 totalEth = wethReceived + ethFromReserve;
        require(totalEth >= minEthOut, "Smartfolio: insufficient ETH out");

        emit Divested(msg.sender, id, amount, totalEth);

        (bool ok, ) = msg.sender.call{value: totalEth}("");
        require(ok, "Smartfolio: ETH transfer failed");
    }

    /// @dev Accept ETH sent by WETH.withdraw() during divest.
    receive() external payable {}

    // -------------------------------------------------------------------------
    // Internal swap helpers
    // -------------------------------------------------------------------------

    /// @dev Approves the swap router and executes a WETH → ERC20 swap.
    function _swapWETHForToken(
        address token,
        uint256 amountIn,
        uint256 amountOutMin,
        uint24 poolFee,
        bytes memory swapPath
    ) internal returns (uint256 amountOut) {
        weth.approve(address(swapRouter), amountIn);

        if (swapPath.length == 0) {
            amountOut = swapRouter.exactInputSingle(
                ISwapRouter.ExactInputSingleParams({
                    tokenIn:           address(weth),
                    tokenOut:          token,
                    fee:               poolFee,
                    recipient:         address(this),
                    deadline:          block.timestamp,
                    amountIn:          amountIn,
                    amountOutMinimum:  amountOutMin,
                    sqrtPriceLimitX96: 0
                })
            );
        } else {
            amountOut = swapRouter.exactInput(
                ISwapRouter.ExactInputParams({
                    path:             swapPath,
                    recipient:        address(this),
                    deadline:         block.timestamp,
                    amountIn:         amountIn,
                    amountOutMinimum: amountOutMin
                })
            );
        }
    }

    /// @dev Approves the swap router and executes an ERC20 → WETH swap.
    function _swapTokenForWETH(
        address token,
        uint256 amountIn,
        uint256 amountOutMin,
        uint24 poolFee,
        bytes memory swapPath
    ) internal returns (uint256 amountOut) {
        IERC20(token).approve(address(swapRouter), amountIn);

        if (swapPath.length == 0) {
            amountOut = swapRouter.exactInputSingle(
                ISwapRouter.ExactInputSingleParams({
                    tokenIn:           token,
                    tokenOut:          address(weth),
                    fee:               poolFee,
                    recipient:         address(this),
                    deadline:          block.timestamp,
                    amountIn:          amountIn,
                    amountOutMinimum:  amountOutMin,
                    sqrtPriceLimitX96: 0
                })
            );
        } else {
            amountOut = swapRouter.exactInput(
                ISwapRouter.ExactInputParams({
                    path:             swapPath,
                    recipient:        address(this),
                    deadline:         block.timestamp,
                    amountIn:         amountIn,
                    amountOutMinimum: amountOutMin
                })
            );
        }
    }

    // -------------------------------------------------------------------------
    // View layer
    // -------------------------------------------------------------------------

    /**
     * @notice Returns a full snapshot of a token ID's state.
     * @param id Token ID to query.
     */
    function tokenInfo(uint256 id) external view returns (TokenInfo memory info) {
        uint256 supply = totalSupply[id];
        uint256 minted = totalMinted[id];

        info.circulatingSupply = supply;
        info.totalMinted       = minted;
        info.maxSupply         = maxSupply[id];
        info.reserve           = reserve[id];
        info.backingPerToken   = supply > 0 ? (reserve[id] * WAD) / supply : 0;

        TierConfig[] storage tiers = _tiers[id];
        if (tiers.length > 0) {
            uint256 lastTier = tiers.length - 1;
            for (uint256 i = 0; i < tiers.length; i++) {
                if (i == lastTier || minted < tiers[i].threshold) {
                    info.currentTierIndex = i;
                    info.currentPrice     = tiers[i].pricePerToken;
                    break;
                }
            }
        }
    }

    /**
     * @notice Returns the ETH cost to mint `amount` tokens of `id`.
     *         Identical to mintCost — exposed under a simulation-oriented name
     *         for frontend use.
     */
    function simulateMint(uint256 id, uint256 amount) external view returns (uint256 cost) {
        return mintCost(id, amount);
    }

    /**
     * @notice Returns a full breakdown of what a burn of `amount` tokens of `id`
     *         would yield: gross ETH, exit fee, and net ETH received.
     */
    function simulateBurn(uint256 id, uint256 amount)
        external
        view
        returns (BurnSimulation memory sim)
    {
        (sim.gross, sim.fee, sim.net) = burnRefund(id, amount);
        sim.feeRate = burnFeeRate(id, amount);
    }

    // -------------------------------------------------------------------------
    // UUPS
    // -------------------------------------------------------------------------

    function _authorizeUpgrade(address newImplementation)
        internal
        override
        onlyOwner
    {}
}
