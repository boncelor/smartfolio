// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@uniswap/v3-periphery/contracts/interfaces/ISwapRouter.sol";

interface IWETH9 {
    function deposit() external payable;
    function withdraw(uint256 amount) external;
    function approve(address spender, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}


abstract contract SmartfolioBase {

    // -------------------------------------------------------------------------
    // Custom errors
    // -------------------------------------------------------------------------

    error ReentrantCall();
    error AmountZero();
    error InsufficientETH();
    error InsufficientBalance();
    error ETHTransferFailed();
    error LengthMismatch();
    error ZeroAddress();
    error NoTiersProvided();
    error PriceMustBePositive();
    error TiersNotOrdered();
    error TiersNotConfigured();
    error ExceedsHardCap();
    error NoSupply();
    error AmountExceedsSupply();
    error NoAssetsProvided();
    error ZeroWeight();
    error InvalidPoolFee();
    error WeightsMustSum10000();
    error RouterNotSet();
    error WETHNotSet();
    error NoPortfolioConfig();
    error AlreadyDeployed();
    error NoReserveToDeploy();
    error SlippageExceeds10Pct();
    error NotKeeper();
    error NoInstructions();
    error InsufficientHoldings();
    error PortfolioActive();
    error PortfolioNotActive();
    error UseDivest();
    error InsufficientETHOut();
    error FacetNotSet();
    error NoPosManagerSet();
    error ZeroDefaultAavePool();
    error NoAaveSlice();
    error CallerNotSMFContract();
    error SMFTiersNotConfigured();
    error InsufficientSMF();
    error TierLimitExceeded();
    error AssetLimitExceeded();
    error ZeroSwapOutput();
    error SupplyNotZero();
    error NoDust();
    error SMFMinWeightNotMet();
    error TierRequiresMoreSMF();
    error StakingNotSupported();
    error SMFContractNotSet();
    error NotAuthorized();

    // -------------------------------------------------------------------------
    // Events
    // -------------------------------------------------------------------------

    event Minted(address indexed account, uint256 indexed id, uint256 amount, uint256 ethPaid);
    event Burned(address indexed account, uint256 indexed id, uint256 amount, uint256 ethRefunded, uint256 feePaid);
    event TiersSet(TierConfig[] tiers);
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
    event TreasuryFacetSet(address facet);
    event MarketFacetSet(address facet);
    event PosManagerSet(address posManager);
    event DefaultAavePoolSet(address pool);
    event PortfolioAaveDeployed(uint256 indexed id, uint256 wethDeposited);
    event PortfolioAaveDivested(uint256 indexed id, uint256 wethWithdrawn);
    event PortfolioLPDeployed(uint256 indexed id, uint256 posTokenId, uint128 liquidity);
    event PortfolioLPDivested(uint256 indexed id, uint256 wethReceived);
    event SMFContractSet(address smfContract);
    event MintFunded(address indexed account, uint256 indexed id, uint256 amount, uint256 ethReceived);
    event ReserveAdded(uint256 indexed id, uint256 ethAdded);
    event FeeSent(address indexed treasury, uint256 amount);
    event DustSwept(uint256 indexed id, address indexed recipient, uint256 amount);

    // -------------------------------------------------------------------------
    // Types
    // -------------------------------------------------------------------------

    enum AssetType { ERC20, AAVE, LP, SMF, STAKING }

    struct TierConfig {
        uint128 threshold;
        uint128 pricePerToken;
    }

    struct TokenInfo {
        uint256 circulatingSupply;
        uint256 totalMinted;

        uint256 reserve;
        uint256 backingPerToken;
        uint256 currentTierIndex;
        uint256 currentPrice;
    }

    struct BurnSimulation {
        uint256 gross;
        uint256 fee;
        uint256 net;
        uint256 feeRate;
    }

    struct PortfolioAsset {
        AssetType assetType;
        address   token;         // ERC20: token address; LP: tokenB; AAVE: unused
        uint16    weightBps;
        uint24    poolFee;       // ERC20: swap pool fee; LP: LP pool fee tier
        uint24    swapFee;       // LP only: fee tier for WETH↔tokenB swap via swapRouter
        int24     tickLower;     // LP only
        int24     tickUpper;     // LP only
        bytes     swapPath;      // ERC20 only: multi-hop buy path
        bytes     sellSwapPath;  // ERC20 only: multi-hop sell path
    }

    struct RebalanceInstruction {
        address token;
        bool isSell;
        uint256 amountIn;
        uint256 amountOutMin;
        uint24 poolFee;
        bytes swapPath;
    }

    // -------------------------------------------------------------------------
    // Constants
    // -------------------------------------------------------------------------

    uint256 internal constant WAD = 1e18;
    uint256 internal constant MAX_BURN_FEE_CAP = 0.8e18;

    /// @dev Minimum SMF allocation (in bps) required for each feature tier.
    uint16 internal constant SMF_BASE_TIER_BPS     = 2000; // 20% — base: ETH, SMF, ERC20
    uint16 internal constant SMF_LP_TIER_BPS       = 4000; // 40% — unlocks LP positions
    uint16 internal constant SMF_LEVERAGE_TIER_BPS = 6000; // 60% — unlocks leverage (Aave) positions

    // -------------------------------------------------------------------------
    // Storage gap — slot 0
    // -------------------------------------------------------------------------

    /// @dev Previously `_reentrancyStatus` for a custom slot-0 reentrancy guard.
    ///      Kept as a private gap to preserve the storage layout. Must never be
    ///      reused or removed.
    uint256 private __reentrancyGuardGap;

    // -------------------------------------------------------------------------
    // Reentrancy guard (EIP-7201 namespaced — same slot as OZ ReentrancyGuard)
    // -------------------------------------------------------------------------

    // keccak256(abi.encode(uint256(keccak256("openzeppelin.storage.ReentrancyGuard")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant _REENTRANCY_GUARD_SLOT =
        0x9b779b17422d0df92223018b32b4d1fa46e071723d6817e2486d003becc55f00;

    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED     = 2;

    modifier nonReentrant() {
        bytes32 _slot = _REENTRANCY_GUARD_SLOT;
        uint256 _status;
        assembly { _status := sload(_slot) }
        if (_status == _ENTERED) revert ReentrantCall();
        assembly { sstore(_slot, _ENTERED) }
        _;
        assembly { sstore(_slot, _NOT_ENTERED) }
    }

    /// @dev Returns the EIP-7201 storage slot for the reentrancy guard.
    ///      Used by Smartfolio._delegateTo to reset the guard after assembly return.
    function _reentrancyGuardStorageSlot() internal pure returns (bytes32) {
        return _REENTRANCY_GUARD_SLOT;
    }

    // -------------------------------------------------------------------------
    // State — bonding curve
    // -------------------------------------------------------------------------

    TierConfig[] private _tiers;
    mapping(uint256 => uint256) public totalMinted;
    mapping(uint256 => uint256) public totalSupply;
    mapping(uint256 => uint256) public reserve;
    uint256 public globalTotalMinted;
    uint256 public globalTotalSupply;

    uint256 public maxBurnFeeRate;
    address public treasury;

    // -------------------------------------------------------------------------
    // State — portfolio
    // -------------------------------------------------------------------------

    mapping(uint256 => PortfolioAsset[]) internal _portfolioConfig;
    mapping(uint256 => bool) public portfolioActive;
    mapping(uint256 => mapping(address => uint256)) public portfolioHoldings;
    mapping(uint256 => uint256) public deployedEth;
    address public keeper;
    ISwapRouter public swapRouter;
    IWETH9 public weth;
    uint16 public slippageToleranceBps;

    // -------------------------------------------------------------------------
    // State — portfolio Aave slice (shared Aave account, B2 model)
    // -------------------------------------------------------------------------

    /// @dev Single Aave pool used by all portfolio Aave slices. Same pool as leverage tokens.
    address public defaultAavePool;

    /// @dev Per-ID WETH deposited into Aave by the portfolio (accounting only; health factor is aggregate).
    mapping(uint256 => uint256) public portfolioAaveWeth;

    // -------------------------------------------------------------------------
    // State — portfolio LP slice
    // -------------------------------------------------------------------------

    mapping(uint256 => uint256) public portfolioLpPositionId;
    mapping(uint256 => uint128) public portfolioLpLiquidity;
    mapping(uint256 => bool)    public portfolioLpWethIsToken0;

    // -------------------------------------------------------------------------
    // State — position manager (used by portfolio LP slice)
    // -------------------------------------------------------------------------

    address public positionManager;

    // -------------------------------------------------------------------------
    // State — facet addresses
    // -------------------------------------------------------------------------

    address public treasuryFacet;
    address public marketFacet;

    // -------------------------------------------------------------------------
    // State — SMF ERC20 integration
    // -------------------------------------------------------------------------

    address public smfContract;

    /// @dev Auto-incremented ID assigned to each new NFT minted via mintFundedNew.
    uint256 public nextTokenId;

    // -------------------------------------------------------------------------
    // State — SMF portfolio holdings
    // -------------------------------------------------------------------------

    /// @dev Amount of SMF tokens held as a portfolio asset for each token ID.
    ///      Tracked separately from portfolioHoldings because SMF is bought/sold
    ///      via the bonding curve, not Uniswap.
    mapping(uint256 => uint256) public portfolioSMFHoldings;

    /// @dev The SMF contract address that minted each NFT's SMF holdings.
    ///      Used to return the correct SMF tokens on withdrawSMF.
    mapping(uint256 => address) public smfContractForNFT;

    // -------------------------------------------------------------------------
    // Modifiers
    // -------------------------------------------------------------------------

    modifier onlyKeeper() {
        if (msg.sender != keeper) revert NotKeeper();
        _;
    }

    // -------------------------------------------------------------------------
    // Internal storage accessors (private state exposed to inheritors)
    // -------------------------------------------------------------------------

    function _getTiers() internal view returns (TierConfig[] storage) {
        return _tiers;
    }

    function _setTiersStorage(TierConfig[] calldata tiers) internal {
        delete _tiers;
        for (uint256 i = 0; i < tiers.length; i++) {
            _tiers.push(tiers[i]);
        }
    }

    function _getPortfolioConfig(uint256 id) internal view returns (PortfolioAsset[] storage) {
        return _portfolioConfig[id];
    }

    function _setPortfolioConfigStorage(uint256 id, PortfolioAsset[] calldata assets) internal {
        delete _portfolioConfig[id];
        for (uint256 i = 0; i < assets.length; i++) {
            _portfolioConfig[id].push(assets[i]);
        }
    }

    // -------------------------------------------------------------------------
    // Internal view helpers (used by Smartfolio views and facets)
    // -------------------------------------------------------------------------

    /// @dev Sum the weightBps of all SMF-type assets in a portfolio config.
    function _smfWeightBps(PortfolioAsset[] storage assets) internal view returns (uint256 smfBps) {
        for (uint256 i = 0; i < assets.length; i++) {
            if (assets[i].assetType == AssetType.SMF) {
                smfBps += assets[i].weightBps;
            }
        }
    }

    function _mintCost(uint256 amount) internal view returns (uint256 cost) {
        TierConfig[] storage tiers = _tiers;
        if (tiers.length == 0) revert TiersNotConfigured();
        if (amount == 0) revert AmountZero();

        uint256 supply = globalTotalSupply;
        uint256 remaining = amount;
        uint256 lastTier = tiers.length - 1;

        for (uint256 i = 0; i < tiers.length && remaining > 0; i++) {
            uint256 price = tiers[i].pricePerToken;
            if (i < lastTier) {
                uint256 tierCap = tiers[i].threshold;
                if (supply >= tierCap) continue;
                uint256 available = tierCap - supply;
                uint256 minted = remaining < available ? remaining : available;
                cost += minted * price;
                supply += minted;
                remaining -= minted;
            } else {
                cost += remaining * price;
                remaining = 0;
            }
        }
    }

    function _burnFeeRate(uint256 amount) internal view returns (uint256) {
        uint256 supply = globalTotalSupply;
        if (supply == 0) revert NoSupply();
        if (amount > supply) revert AmountExceedsSupply();
        uint256 proportion = (amount * WAD) / supply;
        uint256 proportionSquared = (proportion * proportion) / WAD;
        return (proportionSquared * maxBurnFeeRate) / WAD;
    }

    function _burnRefund(uint256 id, uint256 amount)
        internal view
        returns (uint256 gross, uint256 fee, uint256 net)
    {
        uint256 supply = totalSupply[id];
        if (supply == 0) revert NoSupply();
        if (amount == 0) revert AmountZero();
        if (amount > supply) revert AmountExceedsSupply();
        gross = (amount * reserve[id]) / supply;
        uint256 rate = _burnFeeRate(amount);
        fee = (gross * rate) / WAD;
        net = gross - fee;
    }
}
