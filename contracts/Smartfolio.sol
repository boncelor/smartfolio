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
 * @dev UUPS upgradeable ERC1155 proxy. Delegates mutating operations to two
 *      facet contracts (SmartfolioTreasury, SmartfolioMarket)
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
        address _marketFacet
    ) public initializer {
        __ERC1155_init("");
        __Ownable_init(initialOwner);
        __Pausable_init();
        maxBurnFeeRate = 0.5e18;
        slippageToleranceBps = 50;
        // Initialise OZ ReentrancyGuard namespaced slot to NOT_ENTERED (1).
        // The OZ constructor handles this for non-upgradeable deployments; we
        // must do it explicitly here because the proxy bypasses constructors.
        bytes32 slot = _reentrancyGuardStorageSlot();
        assembly { sstore(slot, 1) }
        treasuryFacet = _treasuryFacet;
        marketFacet = _marketFacet;
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

    function withdrawSMF(uint256 id)
        external nonReentrant whenNotPaused
    {
        _delegateTo(treasuryFacet);
    }

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

    /// @notice Mint 1 ERC1155 to `to` and credit SMF holdings. SMF pulled from caller.
    function mintWithSMF(address to, uint256 smfAmount)
        external nonReentrant whenNotPaused returns (uint256)
    {
        if (msg.sender != smfContract) revert CallerNotSMFContract();
        _delegateTo(treasuryFacet);
    }

    /// @notice Add SMF to an existing NFT's portfolio holdings. SMF pulled from caller.
    function receiveSMF(uint256 id, uint256 smfAmount)
        external nonReentrant whenNotPaused
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

    function deploy(uint256 id, uint256[] calldata erc20MinAmounts, uint256 smfMinAmount, uint256 lpSwapAmountOutMin, uint256 lpAmount0Min, uint256 lpAmount1Min)
        external onlyKeeper nonReentrant
    {
        _delegateTo(marketFacet);
    }

    function rebalance(uint256 id, RebalanceInstruction[] calldata instructions)
        external onlyKeeper nonReentrant
    {
        _delegateTo(marketFacet);
    }

    function divest(uint256 id, uint256 amount)
        external nonReentrant whenNotPaused
    {
        _delegateTo(marketFacet);
    }

    /// @dev Accept ETH sent by WETH.withdraw() during divest.
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

    function setPortfolioConfig(uint256 id, PortfolioAsset[] calldata assets) external onlyOwner {
        if (assets.length == 0) revert NoAssetsProvided();
        if (assets.length > 10) revert AssetLimitExceeded();
        if (portfolioActive[id]) revert PortfolioActive();
        uint256 totalWeight;
        uint256 smfCount;
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
                if (assets[i].tickLower >= assets[i].tickUpper) revert NoPortfolioConfig();
            } else if (t == AssetType.SMF) {
                if (smfContract == address(0)) revert SMFContractNotSet();
                if (assets[i].token != smfContract) revert ZeroAddress();
                smfCount++;
                if (smfCount > 1) revert NoAssetsProvided(); // only one SMF slice allowed
            } else if (t == AssetType.STAKING) {
                revert StakingNotSupported();
            }
            // AAVE: no additional fields to validate here (pool set globally via setDefaultAavePool)
        }
        if (totalWeight != 10_000) revert WeightsMustSum10000();

        // Compute total SMF weight and enforce minimum + tier gates
        uint256 smfBps;
        for (uint256 i = 0; i < assets.length; i++) {
            if (assets[i].assetType == AssetType.SMF) smfBps += assets[i].weightBps;
        }
        if (smfBps < SMF_BASE_TIER_BPS) revert SMFMinWeightNotMet();
        for (uint256 i = 0; i < assets.length; i++) {
            AssetType t = assets[i].assetType;
            if (t == AssetType.LP   && smfBps < SMF_LP_TIER_BPS)       revert TierRequiresMoreSMF();
            if (t == AssetType.AAVE && smfBps < SMF_LEVERAGE_TIER_BPS) revert TierRequiresMoreSMF();
        }

        _setPortfolioConfigStorage(id, assets);
        emit PortfolioConfigSet(id, assets);
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
     * @notice Returns the SMF allocation and feature tier for a portfolio token ID.
     * @return smfWeightBps  Total SMF weight in basis points (0 if no SMF asset configured).
     * @return tier          0 = none, 1 = base (≥20%), 2 = LP (≥40%), 3 = leverage (≥60%).
     */
    function getPortfolioTierInfo(uint256 id) external view returns (uint256 smfWeightBps, uint8 tier) {
        smfWeightBps = _smfWeightBps(_getPortfolioConfig(id));
        if      (smfWeightBps >= SMF_LEVERAGE_TIER_BPS) tier = 3;
        else if (smfWeightBps >= SMF_LP_TIER_BPS)       tier = 2;
        else if (smfWeightBps >= SMF_BASE_TIER_BPS)     tier = 1;
        else                                            tier = 0;
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
