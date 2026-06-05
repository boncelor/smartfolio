// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts-upgradeable/token/ERC1155/ERC1155Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";

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

    // -------------------------------------------------------------------------
    // Events
    // -------------------------------------------------------------------------

    event Minted(address indexed account, uint256 indexed id, uint256 amount, uint256 ethPaid);
    event Burned(address indexed account, uint256 indexed id, uint256 amount, uint256 ethRefunded, uint256 feePaid);
    event TiersSet(uint256 indexed id, TierConfig[] tiers);
    event MaxSupplySet(uint256 indexed id, uint256 cap);
    event MaxBurnFeeRateSet(uint256 rate);
    event TreasurySet(address treasury);

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
