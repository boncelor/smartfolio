// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface AggregatorV3Interface {
    function decimals() external view returns (uint8);
    function latestRoundData() external view returns (
        uint80 roundId,
        int256 answer,
        uint256 startedAt,
        uint256 updatedAt,
        uint80 answeredInRound
    );
}

interface ISmartfolio {
    function mintFundedNew(address to) external payable returns (uint256 id);
    function mintWithSMF(address to, uint256 smfAmount) external returns (uint256 id);
    function receiveSMF(uint256 id, uint256 smfAmount) external;
    function addReserve(uint256 id) external payable;
}

/**
 * @title SmartfolioERC20
 * @notice Global ERC20 token (SMF) — the primary entry point for the Smartfolio protocol.
 *
 *         Flow:
 *           1. User buys SMF with ETH via buySMF() — bonding curve pricing.
 *           2. User burns SMF to mint a Smartfolio ERC1155 NFT via mintNFT().
 *              Each NFT costs a $10 USD floor priced via Chainlink ETH/USD oracle.
 *              The ETH backing of the burned SMF flows into the NFT's reserve.
 *           3. User burns more SMF into an existing NFT via addToNFT() to increase
 *              its ETH backing (no fee).
 *           4. User burns the ERC1155 NFT via Smartfolio.burn() to recover ETH.
 */
contract SmartfolioERC20 is ERC20, Ownable, ReentrancyGuard {

    // -------------------------------------------------------------------------
    // Errors
    // -------------------------------------------------------------------------

    error TiersNotConfigured();
    error AmountZero();
    error InsufficientETH();
    error ETHTransferFailed();
    error NoTiersProvided();
    error PriceMustBePositive();
    error TiersNotOrdered();
    error SlippageExceeded();
    error InsufficientSMFBalance();
    error SmartfolioNotSet();
    error FeedNotSet();
    error InvalidFeedDecimals();
    error StalePrice();
    error InvalidPrice();
    error InvalidFeeRate();

    // -------------------------------------------------------------------------
    // Events
    // -------------------------------------------------------------------------

    event TiersSet(TierConfig[] tiers);
    event TreasurySet(address treasury);
    event SmartfolioSet(address smartfolio);
    event EthUsdFeedSet(address feed);
    event SMFMinted(address indexed account, uint256 amount, uint256 ethPaid);
    event SMFBurned(address indexed account, uint256 amount, uint256 ethOut);
    event NFTMinted(address indexed account, uint256 indexed id, uint256 smfBurned, uint256 ethLocked);
    event ReserveAdded(address indexed account, uint256 indexed id, uint256 ethAmount, uint256 smfBurned);

    // -------------------------------------------------------------------------
    // Types
    // -------------------------------------------------------------------------

    struct TierConfig {
        uint128 threshold;      // SMF supply threshold; 0 = open-ended final tier
        uint128 pricePerToken;  // ETH per SMF at this tier (in wei)
    }

    // -------------------------------------------------------------------------
    // State
    // -------------------------------------------------------------------------

    TierConfig[] private _tiers;
    uint256 public smfTotalSupply;   // SMF in circulation (drives bonding curve)
    uint256 public smfTotalMinted;   // cumulative SMF ever minted

    address public smartfolio;       // Smartfolio proxy
    address public treasury;         // future use
    AggregatorV3Interface public ethUsdFeed;   // Chainlink ETH/USD feed (kept for future use)
    uint256 public priceMaxAge = 30 minutes;   // staleness threshold

    uint256 public maxSmfSellFeeRate = 0.8e18; // WAD-scaled; 0.8e18 = 80% max fee

    // NFT minting cost parameters
    uint256 public nftCount;                  // total NFTs ever minted
    uint256 public totalSmfLockedInNFTs;      // cumulative SMF burned for NFT minting
    uint256 public nftGrace     = 10;         // NFTs within this count pay floor cost only
    uint256 public nftCostMin   = 1e18;       // floor cost in SMF (1 SMF, 18 decimals)
    uint256 public nftCostBase  = 5e18;       // cost per log step in SMF (5 SMF)
    uint256 public nftRatioScale = 2e18;      // max lock-ratio multiplier (2× at ratio=1)

    // -------------------------------------------------------------------------
    // Constructor
    // -------------------------------------------------------------------------

    constructor(address _smartfolio, address initialOwner)
        ERC20("Smartfolio", "SMF")
        Ownable(initialOwner)
    {
        if (_smartfolio != address(0)) smartfolio = _smartfolio;
    }

    // -------------------------------------------------------------------------
    // Admin
    // -------------------------------------------------------------------------

    function setTiers(TierConfig[] calldata tiers) external onlyOwner {
        if (tiers.length == 0) revert NoTiersProvided();
        if (tiers[0].pricePerToken == 0) revert PriceMustBePositive();
        for (uint256 i = 1; i < tiers.length; i++) {
            if (i < tiers.length - 1 && tiers[i].threshold <= tiers[i - 1].threshold)
                revert TiersNotOrdered();
            if (tiers[i].pricePerToken == 0) revert PriceMustBePositive();
        }
        delete _tiers;
        for (uint256 i = 0; i < tiers.length; i++) {
            _tiers.push(tiers[i]);
        }
        emit TiersSet(tiers);
    }

    function setTreasury(address _treasury) external onlyOwner {
        treasury = _treasury;
        emit TreasurySet(_treasury);
    }

    function setMaxSmfSellFeeRate(uint256 rate) external onlyOwner {
        if (rate > 1e18) revert InvalidFeeRate();
        maxSmfSellFeeRate = rate;
    }

    function setSmartfolio(address _smartfolio) external onlyOwner {
        if (_smartfolio == address(0)) revert SmartfolioNotSet();
        smartfolio = _smartfolio;
        emit SmartfolioSet(_smartfolio);
    }

    function setEthUsdFeed(address feed) external onlyOwner {
        if (feed == address(0)) revert FeedNotSet();
        if (AggregatorV3Interface(feed).decimals() != 8) revert InvalidFeedDecimals();
        ethUsdFeed = AggregatorV3Interface(feed);
        emit EthUsdFeedSet(feed);
    }

    function setPriceMaxAge(uint256 maxAge) external onlyOwner {
        priceMaxAge = maxAge;
    }

    function setNftCostParams(
        uint256 _nftGrace,
        uint256 _nftCostMin,
        uint256 _nftCostBase,
        uint256 _nftRatioScale
    ) external onlyOwner {
        nftGrace      = _nftGrace;
        nftCostMin    = _nftCostMin;
        nftCostBase   = _nftCostBase;
        nftRatioScale = _nftRatioScale;
    }

    // -------------------------------------------------------------------------
    // User — buy SMF
    // -------------------------------------------------------------------------

    /**
     * @notice Buy `amount` SMF tokens by sending ETH. Bonding curve pricing.
     * @param amount Number of SMF tokens to mint.
     */
    function buySMF(uint256 amount) external payable nonReentrant {
        if (amount == 0) revert AmountZero();
        uint256 cost = _smfMintCost(amount);
        if (msg.value < cost) revert InsufficientETH();

        smfTotalSupply += amount;
        smfTotalMinted += amount;
        _mint(msg.sender, amount);

        emit SMFMinted(msg.sender, amount, cost);

        uint256 excess = msg.value - cost;
        if (excess > 0) {
            (bool ok, ) = msg.sender.call{value: excess}("");
            if (!ok) revert ETHTransferFailed();
        }
    }

    // -------------------------------------------------------------------------
    // User — sell SMF back for ETH
    // -------------------------------------------------------------------------

    /**
     * @notice Sell `amount` SMF tokens and receive ETH back. Bonding curve pricing.
     * @param amount     Number of SMF tokens to sell.
     * @param minEthOut  Slippage guard — reverts if ETH received is less than this.
     */
    function sellSMF(uint256 amount, uint256 minEthOut) external nonReentrant {
        if (amount == 0) revert AmountZero();
        if (balanceOf(msg.sender) < amount) revert InsufficientSMFBalance();

        uint256 gross = _ethForSmfAmount(amount);
        (uint256 fee, uint256 net) = _smfSellFee(amount, gross);
        if (net < minEthOut) revert SlippageExceeded();
        if (address(this).balance < gross) revert InsufficientETH();

        smfTotalSupply -= amount;
        _burn(msg.sender, amount);

        emit SMFBurned(msg.sender, amount, net);

        (bool ok, ) = msg.sender.call{value: net}("");
        if (!ok) revert ETHTransferFailed();

        if (fee > 0 && treasury != address(0)) {
            (bool feeOk, ) = treasury.call{value: fee}("");
            if (!feeOk) revert ETHTransferFailed();
        }
        // If no treasury, fee stays in the pool (benefits remaining holders)
    }

    // -------------------------------------------------------------------------
    // User — burn SMF to mint NFT
    // -------------------------------------------------------------------------

    /**
     * @notice Transfer SMF to mint 1 new ERC1155 NFT. The SMF stays as SMF inside
     *         the NFT's portfolio holdings — no ETH conversion at mint time.
     *         Caller must have pre-approved this contract for at least `_nftMintCost()` SMF.
     * @return id  The newly assigned Smartfolio token ID.
     */
    function mintNFT() external nonReentrant returns (uint256 id) {
        if (smartfolio == address(0)) revert SmartfolioNotSet();

        uint256 smfCost = _nftMintCost();
        if (balanceOf(msg.sender) < smfCost) revert InsufficientSMFBalance();

        // Pull SMF from caller into this contract, then forward to Smartfolio
        _transfer(msg.sender, address(this), smfCost);
        _approve(address(this), smartfolio, smfCost);

        nftCount += 1;
        totalSmfLockedInNFTs += smfCost;

        id = ISmartfolio(smartfolio).mintWithSMF(msg.sender, smfCost);

        emit NFTMinted(msg.sender, id, smfCost, 0);
    }

    // -------------------------------------------------------------------------
    // User — burn SMF to add reserve to existing NFT
    // -------------------------------------------------------------------------

    /**
     * @notice Transfer SMF directly into an existing NFT's portfolio holdings.
     *         No ETH conversion — SMF stays as SMF until the keeper deploys/rebalances.
     *         Caller must have pre-approved this contract for at least `smfAmount` SMF.
     * @param id         Smartfolio ERC1155 token ID to top up.
     * @param smfAmount  SMF to transfer into the NFT's portfolio holdings.
     */
    function addSMFToNFT(uint256 id, uint256 smfAmount) external nonReentrant {
        if (smartfolio == address(0)) revert SmartfolioNotSet();
        if (smfAmount == 0) revert AmountZero();
        if (balanceOf(msg.sender) < smfAmount) revert InsufficientSMFBalance();

        _transfer(msg.sender, address(this), smfAmount);
        _approve(address(this), smartfolio, smfAmount);

        ISmartfolio(smartfolio).receiveSMF(id, smfAmount);

        emit ReserveAdded(msg.sender, id, 0, smfAmount);
    }

    /**
     * @notice Burn SMF → release ETH from the bonding curve → add ETH to reserve[id].
     *         Increases the undeployed ETH backing immediately (no keeper required).
     * @param id          Smartfolio ERC1155 token ID to top up.
     * @param ethAmount   ETH value to add to reserve[id].
     * @param maxSmfBurn  Slippage guard — reverts if SMF to burn exceeds this.
     */
    function addETHToNFT(uint256 id, uint256 ethAmount, uint256 maxSmfBurn) external nonReentrant {
        if (smartfolio == address(0)) revert SmartfolioNotSet();
        if (ethAmount == 0) revert AmountZero();

        uint256 smfToBurn = _smfAmountForEth(ethAmount);
        if (smfToBurn > maxSmfBurn) revert SlippageExceeded();
        if (balanceOf(msg.sender) < smfToBurn) revert InsufficientSMFBalance();

        smfTotalSupply -= smfToBurn;
        _burn(msg.sender, smfToBurn);

        ISmartfolio(smartfolio).addReserve{value: ethAmount}(id);

        emit ReserveAdded(msg.sender, id, ethAmount, smfToBurn);
    }

    // -------------------------------------------------------------------------
    // View
    // -------------------------------------------------------------------------

    function smfMintCost(uint256 amount) public view returns (uint256) {
        return _smfMintCost(amount);
    }

    /**
     * @notice Simulate the ETH received from selling `amount` SMF tokens.
     */
    function smfBurnValue(uint256 amount) public view returns (uint256 ethOut) {
        uint256 gross = _ethForSmfAmount(amount);
        (, ethOut) = _smfSellFee(amount, gross);
    }

    function smfSellFee(uint256 amount) external view returns (uint256 fee, uint256 net) {
        uint256 gross = _ethForSmfAmount(amount);
        (fee, net) = _smfSellFee(amount, gross);
    }

    function _smfSellFee(uint256 amount, uint256 gross) internal view returns (uint256 fee, uint256 net) {
        uint256 supply = smfTotalSupply;
        if (supply == 0 || maxSmfSellFeeRate == 0) return (0, gross);
        uint256 proportion = (amount * 1e18) / supply;
        uint256 feeRate = (proportion * proportion / 1e18) * maxSmfSellFeeRate / 1e18;
        fee = gross * feeRate / 1e18;
        net = gross - fee;
    }

    /**
     * @notice Simulate the SMF cost to mint 1 new NFT.
     *         No ETH moves at mint — SMF is transferred directly into the NFT's portfolio holdings.
     * @return smfRequired  SMF to transfer (caller must approve this amount).
     */
    function smfForNFT() external view returns (uint256 smfRequired) {
        smfRequired = _nftMintCost();
    }

    /**
     * @notice Simulate the SMF cost to add `ethAmount` to a reserve via addToNFT.
     */
    function smfForReserve(uint256 ethAmount) external view returns (uint256 smfRequired) {
        smfRequired = _smfAmountForEth(ethAmount);
    }

    function getTiers() external view returns (TierConfig[] memory) {
        return _tiers;
    }

    // -------------------------------------------------------------------------
    // Internal — dynamic NFT mint cost
    // -------------------------------------------------------------------------

    /**
     * @dev Dynamic NFT minting cost in SMF (18-decimal units).
     *
     *   effective_n  = nftCount > nftGrace ? nftCount - nftGrace : 0
     *   log_steps    = floor(log2(effective_n + 1))   [bit-length trick]
     *   ratio        = totalSmfLockedInNFTs * 1e18 / smfTotalMinted  (0 if none minted)
     *   ratio_mult   = 1e18 + nftRatioScale * ratio / 1e18
     *   cost         = nftCostMin + nftCostBase * log_steps * ratio_mult / 1e18
     */
    function _nftMintCost() internal view returns (uint256 cost) {
        uint256 effectiveN = nftCount > nftGrace ? nftCount - nftGrace : 0;

        // floor(log2(effectiveN + 1)) via bit length
        uint256 logSteps = 0;
        uint256 v = effectiveN + 1;
        while (v > 1) {
            v >>= 1;
            logSteps++;
        }

        uint256 ratioMult = 1e18;
        if (smfTotalMinted > 0) {
            uint256 ratio = totalSmfLockedInNFTs * 1e18 / smfTotalMinted;
            ratioMult = 1e18 + nftRatioScale * ratio / 1e18;
        }

        cost = nftCostMin + nftCostBase * logSteps * ratioMult / 1e18;
    }

    // -------------------------------------------------------------------------
    // Internal — oracle
    // -------------------------------------------------------------------------

    /**
     * @dev Read the latest ETH/USD price from Chainlink. Reverts if the feed is
     *      not configured, the price is non-positive, or the round is stale.
     * @return price  ETH/USD price with 8 decimals (e.g. 3000_00000000 = $3000).
     */
    function _getEthPrice() internal view returns (uint256 price) {
        if (address(ethUsdFeed) == address(0)) revert FeedNotSet();
        (, int256 answer, , uint256 updatedAt, ) = ethUsdFeed.latestRoundData();
        if (answer <= 0) revert InvalidPrice();
        if (block.timestamp - updatedAt > priceMaxAge) revert StalePrice();
        price = uint256(answer);
    }

    // -------------------------------------------------------------------------
    // Internal — bonding curve math
    // -------------------------------------------------------------------------

    /**
     * @dev Cost in ETH to mint `amount` SMF from current smfTotalSupply upward.
     */
    function _smfMintCost(uint256 amount) internal view returns (uint256 cost) {
        TierConfig[] storage tiers = _tiers;
        if (tiers.length == 0) revert TiersNotConfigured();

        uint256 supply = smfTotalSupply;
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

    /**
     * @dev Forward sell curve: how much ETH is released by burning `amount` SMF.
     *      Walks tiers downward from current smfTotalSupply.
     */
    function _ethForSmfAmount(uint256 amount) internal view returns (uint256 ethOut) {
        TierConfig[] storage tiers = _tiers;
        if (tiers.length == 0) revert TiersNotConfigured();
        if (amount == 0) revert AmountZero();

        uint256 supply = smfTotalSupply;
        uint256 remaining = amount;
        uint256 n = tiers.length;

        uint256 i = n;
        do {
            i--;
            uint256 price = tiers[i].pricePerToken;
            uint256 lowerBound = (i == 0) ? 0 : tiers[i - 1].threshold;
            uint256 supplyInTier = supply > lowerBound ? supply - lowerBound : 0;
            if (supplyInTier == 0) continue;

            uint256 burnFromTier = remaining < supplyInTier ? remaining : supplyInTier;
            ethOut += burnFromTier * price;
            supply -= burnFromTier;
            remaining -= burnFromTier;
        } while (i > 0 && remaining > 0);
    }

    /**
     * @dev Inverse curve: how many SMF tokens must be burned so that the ETH
     *      released equals `ethAmount`.
     *
     *      Walks tiers downward from smfTotalSupply. At each tier level the ETH
     *      released per SMF burned equals the tier's pricePerToken (the price at
     *      which those tokens were purchased).
     *
     *      Reverts if the contract's ETH balance cannot cover `ethAmount`.
     */
    function _smfAmountForEth(uint256 ethAmount) internal view returns (uint256 smfToBurn) {
        TierConfig[] storage tiers = _tiers;
        if (tiers.length == 0) revert TiersNotConfigured();
        if (ethAmount == 0) revert AmountZero();
        if (address(this).balance < ethAmount) revert InsufficientETH();

        uint256 supply = smfTotalSupply;
        uint256 ethRemaining = ethAmount;
        uint256 n = tiers.length;

        // Walk from the highest tier down to tier 0 (avoid uint256 underflow with do-while)
        uint256 i = n;
        do {
            i--;
            uint256 price = tiers[i].pricePerToken;

            // Lower bound of this tier
            uint256 lowerBound = (i == 0) ? 0 : tiers[i - 1].threshold;

            // SMF tokens sitting in this tier
            uint256 supplyInTier = supply > lowerBound ? supply - lowerBound : 0;
            if (supplyInTier == 0) continue;

            // Cap by how much ETH is available in this tier
            uint256 ethInTier = supplyInTier * price;
            uint256 ethToUse = ethRemaining < ethInTier ? ethRemaining : ethInTier;

            // SMF to burn to release ethToUse (round up to avoid leaving dust)
            uint256 smfInTier = (ethToUse + price - 1) / price;

            smfToBurn += smfInTier;
            supply -= smfInTier;
            // ethReleased may slightly exceed ethToUse due to rounding up
            uint256 ethReleased = smfInTier * price;
            ethRemaining = ethRemaining > ethReleased ? ethRemaining - ethReleased : 0;
        } while (i > 0 && ethRemaining > 0);

        if (ethRemaining > 0) revert InsufficientETH();
    }

    // -------------------------------------------------------------------------
    // Receive ETH (from buySMF payments and any WETH unwrapping)
    // -------------------------------------------------------------------------

    receive() external payable {}
}
