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
    ///      cleanup (`_reentrancyStatus = _NOT_ENTERED`). We reset slot 0 (the
    ///      reentrancy status) to _NOT_ENTERED (1) inside the assembly before
    ///      returning, so subsequent calls are not blocked.
    function _delegateTo(address facet) internal {
        if (facet == address(0)) revert FacetNotSet();
        assembly {
            calldatacopy(0, 0, calldatasize())
            let result := delegatecall(gas(), facet, 0, calldatasize(), 0, 0)
            returndatacopy(0, 0, returndatasize())
            switch result
            case 0 { revert(0, returndatasize()) }
            default {
                // Reset reentrancy guard (slot 0) to _NOT_ENTERED (1) before
                // returning. The assembly `return` bypasses the modifier teardown.
                sstore(0, 1)
                return(0, returndatasize())
            }
        }
    }

    // -------------------------------------------------------------------------
    // Mutating entry points — guarded here, logic in facets
    // -------------------------------------------------------------------------

    function mint(address account, uint256 id, uint256 amount, bytes memory data)
        public payable nonReentrant whenNotPaused
    {
        _delegateTo(treasuryFacet);
    }

    function mintBatch(address to, uint256[] memory ids, uint256[] memory amounts, bytes memory data)
        public payable nonReentrant whenNotPaused
    {
        _delegateTo(treasuryFacet);
    }

    function burn(uint256 id, uint256 amount)
        external nonReentrant whenNotPaused
    {
        _delegateTo(treasuryFacet);
    }

    function mintLeverage(uint256 id, uint256 amount, bytes memory data)
        external payable nonReentrant whenNotPaused
    {
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

    function deploy(uint256 id, uint256[] calldata amountsOutMinimum)
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

    function setTiers(uint256 id, TierConfig[] calldata tiers) external onlyOwner {
        if (tiers.length == 0) revert NoTiersProvided();
        if (tiers[0].pricePerToken == 0) revert PriceMustBePositive();
        for (uint256 i = 1; i < tiers.length; i++) {
            if (i < tiers.length - 1 && tiers[i].threshold <= tiers[i - 1].threshold)
                revert TiersNotOrdered();
            if (tiers[i].pricePerToken == 0) revert PriceMustBePositive();
        }
        _setTiersStorage(id, tiers);
        emit TiersSet(id, tiers);
    }

    function setMaxSupply(uint256 id, uint256 cap) external onlyOwner {
        maxSupply[id] = cap;
        emit MaxSupplySet(id, cap);
    }

    function setMaxBurnFeeRate(uint256 rate) external onlyOwner {
        if (rate > MAX_BURN_FEE_CAP) revert ExceedsHardCap();
        maxBurnFeeRate = rate;
        emit MaxBurnFeeRateSet(rate);
    }

    function setTreasury(address _treasury) external onlyOwner {
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

    function setPortfolioConfig(uint256 id, PortfolioAsset[] calldata assets) external onlyOwner {
        if (assets.length == 0) revert NoAssetsProvided();
        if (portfolioActive[id]) revert PortfolioActive();
        uint256 totalWeight;
        for (uint256 i = 0; i < assets.length; i++) {
            if (assets[i].token == address(0)) revert ZeroAddress();
            if (assets[i].weightBps == 0) revert ZeroWeight();
            if (assets[i].poolFee != 500 && assets[i].poolFee != 3000 && assets[i].poolFee != 10000)
                revert InvalidPoolFee();
            totalWeight += assets[i].weightBps;
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
        leverageConfig[id] = config;
        isLeverageToken[id] = true;
        emit LeverageConfigSet(id, config.aavePool, config.stableToken, config.targetLtvBps, config.maxLtvBps);
    }

    // -------------------------------------------------------------------------
    // Admin — facet upgrades
    // -------------------------------------------------------------------------

    function setTreasuryFacet(address facet) external onlyOwner {
        if (facet == address(0)) revert ZeroAddress();
        treasuryFacet = facet;
        emit TreasuryFacetSet(facet);
    }

    function setMarketFacet(address facet) external onlyOwner {
        if (facet == address(0)) revert ZeroAddress();
        marketFacet = facet;
        emit MarketFacetSet(facet);
    }

    function setCreditMarketFacet(address facet) external onlyOwner {
        if (facet == address(0)) revert ZeroAddress();
        creditMarketFacet = facet;
        emit CreditMarketFacetSet(facet);
    }

    // -------------------------------------------------------------------------
    // View layer
    // -------------------------------------------------------------------------

    function mintCost(uint256 id, uint256 amount) public view returns (uint256) {
        return _mintCost(id, amount);
    }

    function getTiers(uint256 id) external view returns (TierConfig[] memory) {
        return _getTiers(id);
    }

    function burnFeeRate(uint256 id, uint256 amount) public view returns (uint256) {
        return _burnFeeRate(id, amount);
    }

    function burnRefund(uint256 id, uint256 amount)
        public view returns (uint256 gross, uint256 fee, uint256 net)
    {
        return _burnRefund(id, amount);
    }

    function simulateMint(uint256 id, uint256 amount) external view returns (uint256) {
        return _mintCost(id, amount);
    }

    function simulateBurn(uint256 id, uint256 amount)
        external view returns (BurnSimulation memory sim)
    {
        (sim.gross, sim.fee, sim.net) = _burnRefund(id, amount);
        sim.feeRate = _burnFeeRate(id, amount);
    }

    function tokenInfo(uint256 id) external view returns (TokenInfo memory info) {
        uint256 supply = totalSupply[id];
        uint256 minted = totalMinted[id];
        info.circulatingSupply = supply;
        info.totalMinted = minted;
        info.maxSupply = maxSupply[id];
        info.reserve = reserve[id];
        info.backingPerToken = supply > 0 ? (reserve[id] * WAD) / supply : 0;
        TierConfig[] storage tiers = _getTiers(id);
        if (tiers.length > 0) {
            uint256 lastTier = tiers.length - 1;
            for (uint256 i = 0; i < tiers.length; i++) {
                if (i == lastTier || minted < tiers[i].threshold) {
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
        info.collateralWeth = aaveCollateral[id];
        info.debtStable = aaveDebt[id];
        if (aaveCollateral[id] > 0) {
            LeverageConfig storage cfg = leverageConfig[id];
            (uint256 totalCollateralBase, uint256 totalDebtBase, , , , uint256 healthFactor)
                = IAavePool(cfg.aavePool).getUserAccountData(address(this));
            info.healthFactor = healthFactor;
            if (totalCollateralBase > 0) {
                info.ltvBps = (totalDebtBase * 10_000) / totalCollateralBase;
            }
        }
    }

    // -------------------------------------------------------------------------
    // UUPS
    // -------------------------------------------------------------------------

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}
}
