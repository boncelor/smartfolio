// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@uniswap/v3-periphery/contracts/interfaces/ISwapRouter.sol";

interface IWETH9 {
    function deposit() external payable;
    function withdraw(uint256 amount) external;
    function approve(address spender, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
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
    error ExceedsMaxSupply();
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
    event LeverageConfigSet(uint256 indexed id, address aavePool, address stableToken, uint16 targetLtvBps, uint16 maxLtvBps);
    event LeverageMinted(address indexed account, uint256 indexed id, uint256 amount, uint256 ethDeposited);
    event LeverageDivested(address indexed account, uint256 indexed id, uint256 amount, uint256 ethReceived);
    event LeverUp(uint256 indexed id, uint256 stableBorrowed, uint256 wethAdded, uint256 newLtvBps);
    event LeverDown(uint256 indexed id, uint256 stableRepaid, uint256 wethWithdrawn, uint256 newLtvBps);
    event TreasuryFacetSet(address facet);
    event MarketFacetSet(address facet);
    event CreditMarketFacetSet(address facet);

    // -------------------------------------------------------------------------
    // Types
    // -------------------------------------------------------------------------

    struct TierConfig {
        uint128 threshold;
        uint128 pricePerToken;
    }

    struct TokenInfo {
        uint256 circulatingSupply;
        uint256 totalMinted;
        uint256 maxSupply;
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
        address token;
        uint16 weightBps;
        uint24 poolFee;
        bytes swapPath;
        bytes sellSwapPath;
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
        uint256 collateralWeth;
        uint256 debtStable;
        uint256 ltvBps;
        uint256 healthFactor;
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

    mapping(uint256 => TierConfig[]) private _tiers;
    mapping(uint256 => uint256) public totalMinted;
    mapping(uint256 => uint256) public totalSupply;
    mapping(uint256 => uint256) public reserve;
    mapping(uint256 => uint256) public maxSupply;
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
    // State — leverage
    // -------------------------------------------------------------------------

    mapping(uint256 => bool) public isLeverageToken;
    mapping(uint256 => LeverageConfig) public leverageConfig;
    mapping(uint256 => uint256) public aaveCollateral;
    mapping(uint256 => uint256) public aaveDebt;

    // -------------------------------------------------------------------------
    // State — facet addresses
    // -------------------------------------------------------------------------

    address public treasuryFacet;
    address public marketFacet;
    address public creditMarketFacet;

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

    function _getTiers(uint256 id) internal view returns (TierConfig[] storage) {
        return _tiers[id];
    }

    function _setTiersStorage(uint256 id, TierConfig[] calldata tiers) internal {
        delete _tiers[id];
        for (uint256 i = 0; i < tiers.length; i++) {
            _tiers[id].push(tiers[i]);
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

    function _mintCost(uint256 id, uint256 amount) internal view returns (uint256 cost) {
        TierConfig[] storage tiers = _tiers[id];
        if (tiers.length == 0) revert TiersNotConfigured();
        if (amount == 0) revert AmountZero();

        uint256 supply = totalMinted[id];
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

    function _burnFeeRate(uint256 id, uint256 amount) internal view returns (uint256) {
        uint256 supply = totalSupply[id];
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
        uint256 rate = _burnFeeRate(id, amount);
        fee = (gross * rate) / WAD;
        net = gross - fee;
    }
}
