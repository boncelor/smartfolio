// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface AggregatorV3Interface {
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
    error StalePrice();
    error InvalidPrice();

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
    // Constants
    // -------------------------------------------------------------------------

    /// @dev $10 USD floor per NFT mint (in USD with 18 decimals for precision).
    uint256 public constant NFT_FLOOR_USD = 10e18;

    // -------------------------------------------------------------------------
    // State
    // -------------------------------------------------------------------------

    TierConfig[] private _tiers;
    uint256 public smfTotalSupply;   // SMF in circulation (drives bonding curve)
    uint256 public smfTotalMinted;   // cumulative SMF ever minted

    address public smartfolio;       // Smartfolio proxy
    address public treasury;         // future use
    AggregatorV3Interface public ethUsdFeed;   // Chainlink ETH/USD feed
    uint256 public priceMaxAge = 30 minutes;   // staleness threshold

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

    function setSmartfolio(address _smartfolio) external onlyOwner {
        if (_smartfolio == address(0)) revert SmartfolioNotSet();
        smartfolio = _smartfolio;
        emit SmartfolioSet(_smartfolio);
    }

    function setEthUsdFeed(address feed) external onlyOwner {
        if (feed == address(0)) revert FeedNotSet();
        ethUsdFeed = AggregatorV3Interface(feed);
        emit EthUsdFeedSet(feed);
    }

    function setPriceMaxAge(uint256 maxAge) external onlyOwner {
        priceMaxAge = maxAge;
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

        uint256 ethOut = _ethForSmfAmount(amount);
        if (ethOut < minEthOut) revert SlippageExceeded();
        if (address(this).balance < ethOut) revert InsufficientETH();

        smfTotalSupply -= amount;
        _burn(msg.sender, amount);

        emit SMFBurned(msg.sender, amount, ethOut);

        (bool ok, ) = msg.sender.call{value: ethOut}("");
        if (!ok) revert ETHTransferFailed();
    }

    // -------------------------------------------------------------------------
    // User — burn SMF to mint NFT
    // -------------------------------------------------------------------------

    /**
     * @notice Burn SMF to mint 1 new ERC1155 NFT. The token ID is auto-assigned by
     *         the Smartfolio contract. The NFT floor price is $10 USD, converted to
     *         ETH via Chainlink oracle. The ETH backing flows into the new NFT's reserve.
     * @param maxSmfBurn  Slippage guard — reverts if SMF to burn exceeds this.
     * @return id         The newly assigned Smartfolio token ID.
     */
    function mintNFT(uint256 maxSmfBurn) external nonReentrant returns (uint256 id) {
        if (smartfolio == address(0)) revert SmartfolioNotSet();

        // $10 USD → ETH using Chainlink (8-decimal price feed)
        // ethNeeded = ($10 * 1e18) / (ethPrice / 1e8) = (10e18 * 1e8) / ethPrice
        uint256 ethPrice = _getEthPrice();
        uint256 ethNeeded = (NFT_FLOOR_USD * 1e8) / ethPrice;

        uint256 smfToBurn = _smfAmountForEth(ethNeeded);
        if (smfToBurn > maxSmfBurn) revert SlippageExceeded();
        if (balanceOf(msg.sender) < smfToBurn) revert InsufficientSMFBalance();

        smfTotalSupply -= smfToBurn;
        _burn(msg.sender, smfToBurn);

        id = ISmartfolio(smartfolio).mintFundedNew{value: ethNeeded}(msg.sender);

        emit NFTMinted(msg.sender, id, smfToBurn, ethNeeded);
    }

    // -------------------------------------------------------------------------
    // User — burn SMF to add reserve to existing NFT
    // -------------------------------------------------------------------------

    /**
     * @notice Burn SMF to increase the ETH reserve backing of an existing NFT (no fee).
     *         Increases the backing-per-token for all holders of `id` without minting new NFTs.
     * @param id          Smartfolio ERC1155 token ID to top up.
     * @param ethAmount   ETH value to add to reserve[id].
     * @param maxSmfBurn  Slippage guard — reverts if SMF to burn exceeds this.
     */
    function addToNFT(uint256 id, uint256 ethAmount, uint256 maxSmfBurn) external nonReentrant {
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
        return _ethForSmfAmount(amount);
    }

    /**
     * @notice Simulate the SMF cost to mint 1 new NFT.
     * @return smfRequired  SMF to burn.
     * @return ethNeeded    ETH value locked into the NFT reserve ($10 USD floor).
     */
    function smfForNFT()
        external view
        returns (uint256 smfRequired, uint256 ethNeeded)
    {
        if (smartfolio == address(0)) revert SmartfolioNotSet();
        uint256 ethPrice = _getEthPrice();
        ethNeeded = (NFT_FLOOR_USD * 1e8) / ethPrice;
        smfRequired = _smfAmountForEth(ethNeeded);
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
