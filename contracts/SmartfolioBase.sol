// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@uniswap/v3-periphery/contracts/interfaces/ISwapRouter.sol";

interface IWETH9 {
    function deposit() external payable;
    function withdraw(uint256 amount) external;
    function approve(address spender, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/// @dev Minimal Chainlink V3 aggregator interface for price feed reads.
interface AggregatorV3Interface {
    function latestRoundData() external view returns (
        uint80 roundId,
        int256 answer,
        uint256 startedAt,
        uint256 updatedAt,
        uint80 answeredInRound
    );
    function decimals() external view returns (uint8);
}

interface IAavePool {
    function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode) external;
    function borrow(address asset, uint256 amount, uint256 interestRateMode, uint16 referralCode, address onBehalfOf) external;
    function repay(address asset, uint256 amount, uint256 rateMode, address onBehalfOf) external returns (uint256);
    function withdraw(address asset, uint256 amount, address to) external returns (uint256);
    function getUserAccountData(address user) external view returns (
        uint256 totalCollateralBase,
        uint256 totalDebtBase,
        uint256 availableBorrowsBase,
        uint256 currentLiquidationThreshold,
        uint256 ltv,
        uint256 healthFactor
    );
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
    error NotLeverageToken();
    error ZeroAavePool();
    error ZeroStableToken();
    error ZeroTargetLtv();
    error TargetLtvExceedsMax();
    error MaxLtvExceeds10Pct();
    error TokenHasSupply();
    error DebtNotRepaid();
    error FacetNotSet();
    error NoLeveragePosition();
    error NoDebtToRepay();
    error LtvCapExceeded();
    error HealthFactorAboveFloor();
    error StalePrice();
    error InvalidPrice();
    error NoPosManagerSet();
    error NoLPConfig();
    error LiquidityAlreadyActive();
    error LiquidityNotActive();
    error IncompatibleTokenType();
    error ZeroDefaultAavePool();
    error NoAaveSlice();
    error CallerNotSMFContract();
    error SMFTiersNotConfigured();
    error InsufficientSMF();

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
    event LeverageConfigSet(uint256 indexed id, address aavePool, address stableToken, uint16 targetLtvBps, uint16 maxLtvBps);
    event LeverageMinted(address indexed account, uint256 indexed id, uint256 amount, uint256 ethDeposited);
    event LeverageDivested(address indexed account, uint256 indexed id, uint256 amount, uint256 ethReceived);
    event LeverUp(uint256 indexed id, uint256 stableBorrowed, uint256 wethAdded, uint256 newLtvBps);
    event LeverDown(uint256 indexed id, uint256 stableRepaid, uint256 wethWithdrawn, uint256 newLtvBps);
    event EmergencyDeleveraged(uint256 indexed id, uint256 stableRepaid, uint256 wethWithdrawn, uint256 healthFactor);
    event EthUsdFeedSet(uint256 indexed id, address feed);
    event EmergencyHealthFloorSet(uint256 indexed id, uint256 floor);
    event TreasuryFacetSet(address facet);
    event MarketFacetSet(address facet);
    event CreditMarketFacetSet(address facet);
    event LiquidityMarketFacetSet(address facet);
    event PosManagerSet(address posManager);
    event LPConfigSet(uint256 indexed id, address tokenB, uint24 poolFee, int24 tickLower, int24 tickUpper);
    event LPDeployed(uint256 indexed id, uint256 posTokenId, uint128 liquidity, uint256 ethDeployed);
    event LPFeeCollected(uint256 indexed id, uint256 ethAdded);
    event LPDivested(address indexed account, uint256 indexed id, uint256 amount, uint256 ethReceived);
    event DefaultAavePoolSet(address pool);
    event PortfolioAaveDeployed(uint256 indexed id, uint256 wethDeposited);
    event PortfolioAaveDivested(uint256 indexed id, uint256 wethWithdrawn);
    event PortfolioLPDeployed(uint256 indexed id, uint256 posTokenId, uint128 liquidity);
    event PortfolioLPDivested(uint256 indexed id, uint256 wethReceived);
    event SMFContractSet(address smfContract);
    event MintFunded(address indexed account, uint256 indexed id, uint256 amount, uint256 ethReceived);
    event ReserveAdded(uint256 indexed id, uint256 ethAdded);

    // -------------------------------------------------------------------------
    // Types
    // -------------------------------------------------------------------------

    enum AssetType { ERC20, AAVE, LP }

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

    struct LeverageConfig {
        address aavePool;
        address stableToken;
        uint16  targetLtvBps;
        uint16  maxLtvBps;
    }

    struct LeverageInfo {
        uint256 collateralWeth;   // WETH units in Aave
        uint256 debtStable;       // stable units borrowed
        uint256 ltvBps;           // current LTV in bps (Aave oracle)
        uint256 healthFactor;     // Aave HF in WAD (1e18 = 1.0)
        uint256 ethPriceUsd;      // ETH/USD price from Chainlink (8 decimals); 0 if no feed
        uint256 emergencyFloor;   // HF floor below which emergency deleverage is triggered
        uint256 availableBorrows; // additional stable (in Aave base USD, 8 dec) that can be borrowed within maxLtvBps
    }

    struct LeverUpSimulation {
        uint256 newLtvBps;        // projected LTV in bps after the lever-up
        uint256 newHealthFactor;  // projected Aave health factor in WAD
        bool    wouldExceedCap;   // true if newLtvBps > maxLtvBps
    }

    struct LPConfig {
        address tokenB;    // paired token (WETH is always the other side)
        uint24  poolFee;   // Uniswap V3 pool fee tier for the LP position
        int24   tickLower; // price range lower bound
        int24   tickUpper; // price range upper bound
        uint24  swapFee;   // fee tier for WETH↔tokenB swaps via swapRouter
    }

    struct LPInfo {
        bool    active;
        uint256 positionId;  // Uniswap V3 NFT token ID
        uint128 liquidity;   // current liquidity units in the position
        uint256 deployedEth; // original ETH deployed to LP
        uint256 reserve;     // undeployed ETH (leftovers + collected fees)
    }

    // -------------------------------------------------------------------------
    // Constants
    // -------------------------------------------------------------------------

    uint256 internal constant WAD = 1e18;
    uint256 internal constant MAX_BURN_FEE_CAP = 0.8e18;

    // -------------------------------------------------------------------------
    // Reentrancy guard
    // -------------------------------------------------------------------------

    uint256 internal _reentrancyStatus;
    uint256 internal constant _NOT_ENTERED = 1;
    uint256 internal constant _ENTERED = 2;

    modifier nonReentrant() {
        if (_reentrancyStatus == _ENTERED) revert ReentrantCall();
        _reentrancyStatus = _ENTERED;
        _;
        _reentrancyStatus = _NOT_ENTERED;
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

    mapping(uint256 => PortfolioAsset[]) private _portfolioConfig;
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
    // State — leverage
    // -------------------------------------------------------------------------

    mapping(uint256 => bool) public isLeverageToken;
    mapping(uint256 => LeverageConfig) public leverageConfig;
    mapping(uint256 => uint256) public aaveCollateral;
    mapping(uint256 => uint256) public aaveDebt;

    /// @dev Chainlink ETH/USD price feed per leverage token ID. Optional — address(0) disables.
    mapping(uint256 => address) public ethUsdFeed;

    /// @dev Health factor floor in WAD below which emergencyDeleverage() can be called.
    ///      Default 0 = feature disabled. Recommended: 3e18 (3.0) for an ultra-safe 5% LTV position.
    mapping(uint256 => uint256) public emergencyHealthFloor;

    /// @dev Max age (in seconds) for a Chainlink price to be considered fresh.
    uint256 public priceMaxAge;

    // -------------------------------------------------------------------------
    // State — liquidity pool
    // -------------------------------------------------------------------------

    mapping(uint256 => LPConfig) public lpConfig;
    mapping(uint256 => uint256)  public lpPositionId;
    mapping(uint256 => uint128)  public lpLiquidity;
    mapping(uint256 => bool)     public lpActive;
    mapping(uint256 => bool)     public lpWethIsToken0;
    address public positionManager;

    // -------------------------------------------------------------------------
    // State — facet addresses
    // -------------------------------------------------------------------------

    address public treasuryFacet;
    address public marketFacet;
    address public creditMarketFacet;
    address public liquidityMarketFacet;

    // -------------------------------------------------------------------------
    // State — SMF ERC20 integration
    // -------------------------------------------------------------------------

    address public smfContract;

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
