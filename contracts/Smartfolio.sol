// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts-upgradeable/token/ERC1155/ERC1155Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "./SmartfolioBase.sol";

/**
 * @title Smartfolio
 * @dev UUPS upgradeable ERC1155 proxy. Delegates mutating operations to three
 *      facet contracts (SmartfolioTreasury, SmartfolioMarket, SmartfolioCreditMarket)
 *      via delegatecall, so they execute in this proxy's storage context.
 *
 *      The slim proxy holds:
 *        - ERC1155 token accounting (OZ EIP-7201 namespaced storage)
 *        - All admin setters (onlyOwner)
 *        - All public view/pure functions
 *        - Delegatecall routing for mutating entry points
 */
contract Smartfolio is
    SmartfolioBase,
    Initializable,
    ERC1155Upgradeable,
    OwnableUpgradeable,
    UUPSUpgradeable,
    PausableUpgradeable
{
    // -------------------------------------------------------------------------
    // Constructor / Initializer
    // -------------------------------------------------------------------------

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address initialOwner,
        address _treasuryFacet,
        address _marketFacet,
        address _creditMarketFacet
    ) public initializer {
        __ERC1155_init("");
        __Ownable_init(initialOwner);
        __Pausable_init();
        maxBurnFeeRate = 0.5e18;
        slippageToleranceBps = 50;
        priceMaxAge = 3600;
        // Initialise OZ ReentrancyGuard namespaced slot to NOT_ENTERED (1).
        // The OZ constructor handles this for non-upgradeable deployments; we
        // must do it explicitly here because the proxy bypasses constructors.
        bytes32 slot = _reentrancyGuardStorageSlot();
        assembly { sstore(slot, 1) }
        treasuryFacet = _treasuryFacet;
        marketFacet = _marketFacet;
        creditMarketFacet = _creditMarketFacet;
    }

    // -------------------------------------------------------------------------
    // Delegatecall router
    // -------------------------------------------------------------------------

    /// @dev Forward the current call to `facet` via delegatecall. Reverts with
    ///      the facet's revert data on failure; returns with its return data on
    ///      success. Uses assembly for efficient calldata forwarding.
    ///
    ///      IMPORTANT: The assembly `return` bypasses the nonReentrant modifier's
    ///      cleanup (_nonReentrantAfter). We explicitly reset the OZ
    ///      ReentrancyGuard EIP-7201 namespaced slot to NOT_ENTERED (1) inside
    ///      the assembly before returning, so subsequent calls are not blocked.
    function _delegateTo(address facet) internal {
        if (facet == address(0)) revert FacetNotSet();
        bytes32 guardSlot = _reentrancyGuardStorageSlot();
        assembly {
            calldatacopy(0, 0, calldatasize())
            let result := delegatecall(gas(), facet, 0, calldatasize(), 0, 0)
            returndatacopy(0, 0, returndatasize())
            switch result
            case 0 { revert(0, returndatasize()) }
            default {
                // Reset OZ ReentrancyGuard namespaced slot to NOT_ENTERED (1)
                // before returning. The assembly `return` bypasses the modifier
                // teardown (_nonReentrantAfter), so we do it manually here.
                sstore(guardSlot, 1)
                return(0, returndatasize())
            }
        }
    }

    // -------------------------------------------------------------------------
    // Mutating entry points — guarded here, logic in facets
    // -------------------------------------------------------------------------

    function burn(uint256 id, uint256 amount)
        external nonReentrant whenNotPaused
    {
        _delegateTo(treasuryFacet);
    }

    function mintFundedNew(address to)
        external payable nonReentrant whenNotPaused returns (uint256)
    {
        if (msg.sender != smfContract) revert CallerNotSMFContract();
        _delegateTo(treasuryFacet);
    }

    function mintFunded(address to, uint256 id, uint256 amount)
        external payable nonReentrant whenNotPaused
    {
        if (msg.sender != smfContract) revert CallerNotSMFContract();
        _delegateTo(treasuryFacet);
    }

    function addReserve(uint256 id)
        external payable nonReentrant whenNotPaused
    {
        if (msg.sender != smfContract) revert CallerNotSMFContract();
        _delegateTo(treasuryFacet);
    }

    function mintLeverage(uint256 id, uint256 amount, bytes memory data)
        external payable nonReentrant whenNotPaused
    {
        // C-2: enforce single active leverage ID. If a different ID already has
        // collateral in Aave, block this mint to prevent cross-ID LTV manipulation.
        if (hasActiveLeverageId && activeLeverageId != id) revert LeverageIdConflict();
        if (!hasActiveLeverageId) {
            activeLeverageId = id;
            hasActiveLeverageId = true;
        }
        _delegateTo(creditMarketFacet);
    }

    function divestLeverage(uint256 id, uint256 amount, uint256 minEthOut)
        external nonReentrant whenNotPaused
    {
        _delegateTo(creditMarketFacet);
    }

    function leverUp(uint256 id, uint256 stableToBorrow, uint256 minWethOut, uint24 poolFee, bytes calldata swapPath)
        external onlyKeeper nonReentrant
    {
        _delegateTo(creditMarketFacet);
    }

    function leverDown(uint256 id, uint256 wethToWithdraw, uint256 minStableOut, uint24 poolFee, bytes calldata swapPath)
        external onlyKeeper nonReentrant
    {
        _delegateTo(creditMarketFacet);
    }

    /// @notice Emergency deleverage — keeper or owner callable when HF < floor.
    function emergencyDeleverage(uint256 id, uint256 minStableOut, uint24 poolFee, bytes calldata swapPath)
        external nonReentrant
    {
        if (msg.sender != keeper && msg.sender != owner()) revert NotKeeper();
        _delegateTo(creditMarketFacet);
    }

    function deploy(uint256 id, uint256[] calldata erc20MinAmounts, uint256 lpSwapAmountOutMin, uint256 lpAmount0Min, uint256 lpAmount1Min)
        external onlyKeeper nonReentrant
    {
        _delegateTo(marketFacet);
    }

    function rebalance(uint256 id, RebalanceInstruction[] calldata instructions)
        external onlyKeeper nonReentrant
    {
        _delegateTo(marketFacet);
    }

    function divest(uint256 id, uint256 amount, uint256 minEthOut)
        external nonReentrant whenNotPaused
    {
        _delegateTo(marketFacet);
    }

    function deployLP(uint256 id, uint256 wethForSwap, uint256 swapAmountOutMin, uint256 amount0Min, uint256 amount1Min)
        external onlyKeeper nonReentrant
    {
        _delegateTo(liquidityMarketFacet);
    }

    function collectFees(uint256 id)
        external onlyKeeper nonReentrant
    {
        _delegateTo(liquidityMarketFacet);
    }

    function divestLP(uint256 id, uint256 amount, uint256 minEthOut)
        external nonReentrant whenNotPaused
    {
        _delegateTo(liquidityMarketFacet);
    }

    /// @dev Accept ETH sent by WETH.withdraw() during divest / divestLeverage.
    receive() external payable {}

    // -------------------------------------------------------------------------
    // Admin — bonding curve
    // -------------------------------------------------------------------------

    function setURI(string memory newUri) public onlyOwner {
        _setURI(newUri);
    }

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    function setTiers(TierConfig[] calldata tiers) external onlyOwner {
        if (tiers.length == 0) revert NoTiersProvided();
        if (tiers.length > 20) revert TierLimitExceeded();
        if (tiers[0].pricePerToken == 0) revert PriceMustBePositive();
        for (uint256 i = 1; i < tiers.length; i++) {
            if (i < tiers.length - 1 && tiers[i].threshold <= tiers[i - 1].threshold)
                revert TiersNotOrdered();
            if (tiers[i].pricePerToken == 0) revert PriceMustBePositive();
        }
        _setTiersStorage(tiers);
        emit TiersSet(tiers);
    }


    /// @notice Sweep rounding dust from a fully-burned token ID to the treasury
    ///         (or the owner if no treasury is set). Reverts if any supply remains.
    function sweepDust(uint256 id) external onlyOwner {
        _delegateTo(treasuryFacet);
    }

    function setMaxBurnFeeRate(uint256 rate) external onlyOwner {
        if (rate > MAX_BURN_FEE_CAP) revert ExceedsHardCap();
        maxBurnFeeRate = rate;
        emit MaxBurnFeeRateSet(rate);
    }

    function setTreasury(address _treasury) external onlyOwner {
        if (_treasury == address(0)) revert ZeroAddress();
        treasury = _treasury;
        emit TreasurySet(_treasury);
    }

    // -------------------------------------------------------------------------
    // Admin — portfolio
    // -------------------------------------------------------------------------

    function setKeeper(address _keeper) external onlyOwner {
        if (_keeper == address(0)) revert ZeroAddress();
        keeper = _keeper;
        emit KeeperSet(_keeper);
    }

    function setSwapRouter(address _swapRouter) external onlyOwner {
        if (_swapRouter == address(0)) revert ZeroAddress();
        swapRouter = ISwapRouter(_swapRouter);
        emit SwapRouterSet(_swapRouter);
    }

    function setWETH(address _weth) external onlyOwner {
        if (_weth == address(0)) revert ZeroAddress();
        weth = IWETH9(_weth);
        emit WETHSet(_weth);
    }

    function setSlippageTolerance(uint16 bps) external onlyOwner {
        if (bps > 1000) revert SlippageExceeds10Pct();
        slippageToleranceBps = bps;
        emit SlippageToleranceSet(bps);
    }

    function setPositionManager(address _posManager) external onlyOwner {
        if (_posManager == address(0)) revert ZeroAddress();
        positionManager = _posManager;
        emit PosManagerSet(_posManager);
    }

    function setDefaultAavePool(address pool) external onlyOwner {
        if (pool == address(0)) revert ZeroDefaultAavePool();
        defaultAavePool = pool;
        emit DefaultAavePoolSet(pool);
    }

    function setLPConfig(uint256 id, LPConfig calldata config) external onlyOwner {
        if (config.tokenB == address(0)) revert ZeroAddress();
        if (config.poolFee != 500 && config.poolFee != 3000 && config.poolFee != 10000) revert InvalidPoolFee();
        if (config.swapFee != 500 && config.swapFee != 3000 && config.swapFee != 10000) revert InvalidPoolFee();
        if (config.tickLower >= config.tickUpper) revert NoLPConfig();
        if (lpActive[id]) revert LiquidityAlreadyActive();
        if (portfolioActive[id]) revert PortfolioActive();
        if (isLeverageToken[id]) revert IncompatibleTokenType();
        lpConfig[id] = config;
        emit LPConfigSet(id, config.tokenB, config.poolFee, config.tickLower, config.tickUpper);
    }

    function setPortfolioConfig(uint256 id, PortfolioAsset[] calldata assets) external onlyOwner {
        if (assets.length == 0) revert NoAssetsProvided();
        if (assets.length > 10) revert AssetLimitExceeded();
        if (portfolioActive[id]) revert PortfolioActive();
        if (lpActive[id]) revert LiquidityAlreadyActive();
        if (isLeverageToken[id]) revert IncompatibleTokenType();
        uint256 totalWeight;
        for (uint256 i = 0; i < assets.length; i++) {
            if (assets[i].weightBps == 0) revert ZeroWeight();
            totalWeight += assets[i].weightBps;
            AssetType t = assets[i].assetType;
            if (t == AssetType.ERC20) {
                if (assets[i].token == address(0)) revert ZeroAddress();
                if (assets[i].poolFee != 500 && assets[i].poolFee != 3000 && assets[i].poolFee != 10000)
                    revert InvalidPoolFee();
            } else if (t == AssetType.LP) {
                if (assets[i].token == address(0)) revert ZeroAddress();
                if (assets[i].poolFee != 500 && assets[i].poolFee != 3000 && assets[i].poolFee != 10000)
                    revert InvalidPoolFee();
                if (assets[i].swapFee != 500 && assets[i].swapFee != 3000 && assets[i].swapFee != 10000)
                    revert InvalidPoolFee();
                if (assets[i].tickLower >= assets[i].tickUpper) revert NoLPConfig();
            }
            // AAVE: no additional fields to validate here (pool set globally via setDefaultAavePool)
        }
        if (totalWeight != 10_000) revert WeightsMustSum10000();
        _setPortfolioConfigStorage(id, assets);
        emit PortfolioConfigSet(id, assets);
    }

    // -------------------------------------------------------------------------
    // Admin — leverage
    // -------------------------------------------------------------------------

    function setLeverageConfig(uint256 id, LeverageConfig calldata config) external onlyOwner {
        if (config.aavePool == address(0)) revert ZeroAavePool();
        if (config.stableToken == address(0)) revert ZeroStableToken();
        if (config.targetLtvBps == 0) revert ZeroTargetLtv();
        if (config.targetLtvBps > config.maxLtvBps) revert TargetLtvExceedsMax();
        if (config.maxLtvBps > 1000) revert MaxLtvExceeds10Pct();
        if (totalSupply[id] != 0) revert TokenHasSupply();
        if (portfolioActive[id]) revert PortfolioActive();
        if (lpActive[id]) revert LiquidityAlreadyActive();
        leverageConfig[id] = config;
        isLeverageToken[id] = true;
        emit LeverageConfigSet(id, config.aavePool, config.stableToken, config.targetLtvBps, config.maxLtvBps);
    }

    /**
     * @notice Set the Chainlink ETH/USD price feed for a leverage token.
     *         Set to address(0) to disable the price check in emergencyDeleverage.
     */
    function setEthUsdFeed(uint256 id, address feed) external onlyOwner {
        if (!isLeverageToken[id]) revert NotLeverageToken();
        ethUsdFeed[id] = feed;
        emit EthUsdFeedSet(id, feed);
    }

    /**
     * @notice Set the Aave health factor floor (WAD) below which emergencyDeleverage
     *         can be triggered. Set to 0 to disable the emergency safety valve.
     *         Recommended: 3e18 (HF = 3.0) for a 5% LTV position — extremely conservative.
     */
    function setEmergencyHealthFloor(uint256 id, uint256 floor) external onlyOwner {
        if (!isLeverageToken[id]) revert NotLeverageToken();
        emergencyHealthFloor[id] = floor;
        emit EmergencyHealthFloorSet(id, floor);
    }

    /**
     * @notice Set the maximum Chainlink price age in seconds before it is considered stale.
     *         Defaults to 3600 (1 hour) if not set.
     */
    function setPriceMaxAge(uint256 maxAge) external onlyOwner {
        priceMaxAge = maxAge;
    }

    /**
     * @notice Clear the active leverage ID lock once a position is fully closed.
     *         Callable by anyone; reverts if the position still carries Aave
     *         collateral or debt, ensuring the lock cannot be released prematurely.
     *
     * @param id  The leverage token ID whose lock should be released.
     */
    function clearActiveLeverageId(uint256 id) external {
        if (!hasActiveLeverageId || activeLeverageId != id) revert NoLeveragePosition();
        if (aaveCollateral[id] != 0 || aaveDebt[id] != 0) revert DebtNotRepaid();
        hasActiveLeverageId = false;
        activeLeverageId = 0;
    }

    // -------------------------------------------------------------------------
    // Admin — facet upgrades
    // -------------------------------------------------------------------------

    function setTreasuryFacet(address facet) external onlyOwner whenPaused {
        if (facet == address(0)) revert ZeroAddress();
        treasuryFacet = facet;
        emit TreasuryFacetSet(facet);
    }

    function setMarketFacet(address facet) external onlyOwner whenPaused {
        if (facet == address(0)) revert ZeroAddress();
        marketFacet = facet;
        emit MarketFacetSet(facet);
    }

    function setCreditMarketFacet(address facet) external onlyOwner whenPaused {
        if (facet == address(0)) revert ZeroAddress();
        creditMarketFacet = facet;
        emit CreditMarketFacetSet(facet);
    }

    function setLiquidityMarketFacet(address facet) external onlyOwner whenPaused {
        if (facet == address(0)) revert ZeroAddress();
        liquidityMarketFacet = facet;
        emit LiquidityMarketFacetSet(facet);
    }

    function setSMFContract(address _smfContract) external onlyOwner {
        if (_smfContract == address(0)) revert ZeroAddress();
        smfContract = _smfContract;
        emit SMFContractSet(_smfContract);
    }

    // -------------------------------------------------------------------------
    // View layer
    // -------------------------------------------------------------------------

    function mintCost(uint256 amount) public view returns (uint256) {
        return _mintCost(amount);
    }

    function getTiers() external view returns (TierConfig[] memory) {
        return _getTiers();
    }

    function burnFeeRate(uint256 amount) public view returns (uint256) {
        return _burnFeeRate(amount);
    }

    function burnRefund(uint256 id, uint256 amount)
        public view returns (uint256 gross, uint256 fee, uint256 net)
    {
        return _burnRefund(id, amount);
    }

    function simulateMint(uint256 amount) external view returns (uint256) {
        return _mintCost(amount);
    }

    function simulateBurn(uint256 id, uint256 amount)
        external view returns (BurnSimulation memory sim)
    {
        (sim.gross, sim.fee, sim.net) = _burnRefund(id, amount);
        sim.feeRate = _burnFeeRate(amount); // global fee rate — not per-ID
    }

    function tokenInfo(uint256 id) external view returns (TokenInfo memory info) {
        uint256 supply = totalSupply[id];
        uint256 minted = totalMinted[id];
        info.circulatingSupply = supply;
        info.totalMinted = minted;

        info.reserve = reserve[id];
        info.backingPerToken = supply > 0 ? (reserve[id] * WAD) / supply : 0;
        TierConfig[] storage tiers = _getTiers();
        if (tiers.length > 0) {
            uint256 lastTier = tiers.length - 1;
            uint256 globalSupply = globalTotalSupply;
            for (uint256 i = 0; i < tiers.length; i++) {
                if (i == lastTier || globalSupply < tiers[i].threshold) {
                    info.currentTierIndex = i;
                    info.currentPrice = tiers[i].pricePerToken;
                    break;
                }
            }
        }
    }

    function getPortfolioConfig(uint256 id) external view returns (PortfolioAsset[] memory) {
        return _getPortfolioConfig(id);
    }

    /**
     * @notice Returns the current contract-level LTV in basis points from Aave's oracle.
     * @dev    Reads the aggregate position of the Smartfolio proxy across all leverage IDs.
     *         Returns 0 if there is no collateral yet.
     */
    /**
     * @notice Returns the Aave health factor for the Smartfolio proxy in WAD (1e18 = 1.0).
     *         Returns type(uint256).max when there is no debt (no liquidation risk).
     */
    function getHealthFactor(uint256 id) external view returns (uint256 healthFactor) {
        if (!isLeverageToken[id]) revert NotLeverageToken();
        if (aaveCollateral[id] == 0) return type(uint256).max;
        LeverageConfig storage cfg = leverageConfig[id];
        ( , , , , , healthFactor) = IAavePool(cfg.aavePool).getUserAccountData(address(this));
    }

    function checkLtv(uint256 id) external view returns (uint256 ltvBps) {
        if (!isLeverageToken[id]) revert NotLeverageToken();
        if (aaveCollateral[id] == 0) return 0;
        LeverageConfig storage cfg = leverageConfig[id];
        (uint256 totalCollateralBase, uint256 totalDebtBase, , , , ) =
            IAavePool(cfg.aavePool).getUserAccountData(address(this));
        if (totalCollateralBase == 0) return 0;
        return (totalDebtBase * 10_000) / totalCollateralBase;
    }

    function getLeverageInfo(uint256 id) external view returns (LeverageInfo memory info) {
        if (!isLeverageToken[id]) revert NotLeverageToken();
        info.collateralWeth  = aaveCollateral[id];
        info.debtStable      = aaveDebt[id];
        info.emergencyFloor  = emergencyHealthFloor[id];

        if (aaveCollateral[id] > 0) {
            LeverageConfig storage cfg = leverageConfig[id];
            (
                uint256 totalCollateralBase,
                uint256 totalDebtBase,
                uint256 availableBorrowsBase,
                ,
                ,
                uint256 healthFactor
            ) = IAavePool(cfg.aavePool).getUserAccountData(address(this));
            info.healthFactor    = healthFactor;
            info.availableBorrows = availableBorrowsBase;
            if (totalCollateralBase > 0) {
                info.ltvBps = (totalDebtBase * 10_000) / totalCollateralBase;
            }
        } else {
            info.healthFactor = type(uint256).max;
        }

        // Chainlink price — returns 0 if feed not set, stale, or call fails
        info.ethPriceUsd = _safeChainlinkPrice(ethUsdFeed[id]);
    }

    /**
     * @notice Simulate the effect of calling leverUp with `stableAmount` stable tokens.
     * @dev    Uses Aave's current position data and an optional Chainlink feed to estimate
     *         the resulting LTV and health factor without executing any state changes.
     *
     *         Stable amount is assumed to have 6 decimals (USDC/USDT). When a Chainlink
     *         ETH/USD feed is configured the simulation converts stable → WETH at that
     *         price for the collateral delta; otherwise it falls back to treating both
     *         amounts as equal in Aave base units (rough approximation).
     *
     * @param id           Leverage token ID.
     * @param stableAmount Amount of stableToken to hypothetically borrow (6-decimal units).
     * @return sim         Projected LTV, health factor, and whether the cap would be exceeded.
     */
    function simulateLeverUp(uint256 id, uint256 stableAmount)
        external view returns (LeverUpSimulation memory sim)
    {
        if (!isLeverageToken[id]) revert NotLeverageToken();
        if (aaveCollateral[id] == 0) revert NoLeveragePosition();

        LeverageConfig storage cfg = leverageConfig[id];

        (
            uint256 totalCollateralBase,
            uint256 totalDebtBase,
            ,
            uint256 liquidationThreshold,
            ,
        ) = IAavePool(cfg.aavePool).getUserAccountData(address(this));

        // Convert stableAmount (6 dec) to Aave base units (8 dec USD): multiply by 100.
        // We assume 1 stable unit = $1 (e.g. USDC). Collateral delta equals the same USD value.
        uint256 stableBase = stableAmount * 100;
        uint256 wethBase   = stableBase; // $X stable → $X WETH at market rate

        // Refine wethBase using Chainlink if available and fresh
        if (_safeChainlinkPrice(ethUsdFeed[id]) > 0) {
            // ETH/USD with 8 decimals. Both stableBase and wethBase are already in
            // 8-dec USD, so no further conversion needed — dollar values cancel:
            // $X stable buys $X WETH.
            wethBase = stableBase;
        }

        uint256 newCollateralBase = totalCollateralBase + wethBase;
        uint256 newDebtBase       = totalDebtBase + stableBase;

        sim.newLtvBps = newCollateralBase > 0
            ? (newDebtBase * 10_000) / newCollateralBase
            : 0;

        sim.newHealthFactor = newDebtBase > 0
            ? (newCollateralBase * liquidationThreshold * WAD) / (newDebtBase * 10_000)
            : type(uint256).max;

        sim.wouldExceedCap = sim.newLtvBps > cfg.maxLtvBps;
    }

    function getLPInfo(uint256 id) external view returns (LPInfo memory info) {
        info.active      = lpActive[id];
        info.positionId  = lpPositionId[id];
        info.liquidity   = lpLiquidity[id];
        info.deployedEth = deployedEth[id];
        info.reserve     = reserve[id];
    }

    function getPortfolioLPInfo(uint256 id) external view returns (
        uint256 positionId,
        uint128 liquidity,
        uint256 aaveWeth
    ) {
        positionId = portfolioLpPositionId[id];
        liquidity  = portfolioLpLiquidity[id];
        aaveWeth   = portfolioAaveWeth[id];
    }

    // -------------------------------------------------------------------------
    // UUPS
    // -------------------------------------------------------------------------

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}
}
