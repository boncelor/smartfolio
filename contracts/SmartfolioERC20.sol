// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface ISmartfolio {
    function mintCost(uint256 amount) external view returns (uint256);
    function mintFunded(address to, uint256 id, uint256 amount) external payable;
    function addReserve(uint256 id) external payable;
}

/**
 * @title SmartfolioERC20
 * @notice Global ERC20 token (SMF) — the primary entry point for the Smartfolio protocol.
 *
 *         Flow:
 *           1. User buys SMF with ETH via buySMF() — bonding curve pricing.
 *           2. User burns SMF to mint a Smartfolio ERC1155 NFT via mintNFT().
 *              The ETH backing of the burned SMF flows into the NFT's reserve.
 *              A flat conversion fee (default 1%) is charged and sent to treasury.
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
    error ExceedsFeeCap();
    error SlippageExceeded();
    error InsufficientSMFBalance();
    error SmartfolioNotSet();

    // -------------------------------------------------------------------------
    // Events
    // -------------------------------------------------------------------------

    event TiersSet(TierConfig[] tiers);
    event ConversionFeeBpsSet(uint256 bps);
    event TreasurySet(address treasury);
    event SmartfolioSet(address smartfolio);
    event SMFMinted(address indexed account, uint256 amount, uint256 ethPaid);
    event SMFBurned(address indexed account, uint256 amount, uint256 ethOut);
    event NFTMinted(address indexed account, uint256 indexed id, uint256 nftAmount, uint256 smfBurned, uint256 conversionFee);
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

    uint256 public constant MAX_CONVERSION_FEE_BPS = 500; // 5% hard cap

    // -------------------------------------------------------------------------
    // State
    // -------------------------------------------------------------------------

    TierConfig[] private _tiers;
    uint256 public smfTotalSupply;   // SMF in circulation (drives bonding curve)
    uint256 public smfTotalMinted;   // cumulative SMF ever minted

    uint256 public conversionFeeBps; // fee on mintNFT (default 100 = 1%)
    address public smartfolio;       // Smartfolio proxy
    address public treasury;         // receives conversion fees

    // -------------------------------------------------------------------------
    // Constructor
    // -------------------------------------------------------------------------

    constructor(address _smartfolio, address initialOwner)
        ERC20("Smartfolio", "SMF")
        Ownable(initialOwner)
    {
        if (_smartfolio != address(0)) smartfolio = _smartfolio;
        conversionFeeBps = 100; // default 1%
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

    function setConversionFeeBps(uint256 bps) external onlyOwner {
        if (bps > MAX_CONVERSION_FEE_BPS) revert ExceedsFeeCap();
        conversionFeeBps = bps;
        emit ConversionFeeBpsSet(bps);
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
     * @notice Burn SMF to mint `nftAmount` ERC1155 tokens of `id`.
     *         The ETH backing of burned SMF flows into the NFT's reserve.
     *         A conversion fee (conversionFeeBps) is deducted and sent to treasury.
     * @param id           Smartfolio ERC1155 token ID to mint.
     * @param nftAmount    Number of ERC1155 tokens to mint.
     * @param maxSmfBurn   Slippage guard — reverts if SMF to burn exceeds this.
     */
    function mintNFT(uint256 id, uint256 nftAmount, uint256 maxSmfBurn) external nonReentrant {
        if (smartfolio == address(0)) revert SmartfolioNotSet();
        if (nftAmount == 0) revert AmountZero();

        uint256 ethNeeded = ISmartfolio(smartfolio).mintCost(nftAmount);
        uint256 conversionFee = (ethNeeded * conversionFeeBps) / 10_000;
        uint256 totalEth = ethNeeded + conversionFee;

        uint256 smfToBurn = _smfAmountForEth(totalEth);
        if (smfToBurn > maxSmfBurn) revert SlippageExceeded();
        if (balanceOf(msg.sender) < smfToBurn) revert InsufficientSMFBalance();

        smfTotalSupply -= smfToBurn;
        _burn(msg.sender, smfToBurn);

        if (conversionFee > 0 && treasury != address(0)) {
            (bool feeOk, ) = treasury.call{value: conversionFee}("");
            if (!feeOk) revert ETHTransferFailed();
        }

        ISmartfolio(smartfolio).mintFunded{value: ethNeeded}(msg.sender, id, nftAmount);

        emit NFTMinted(msg.sender, id, nftAmount, smfToBurn, conversionFee);
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
     * @notice Simulate the SMF cost to mint `nftAmount` ERC1155 tokens of `id`.
     * @return smfRequired  Total SMF to burn (covers NFT cost + fee).
     * @return feePaid      ETH value of the conversion fee.
     */
    function smfForNFT(uint256 id, uint256 nftAmount)
        external view
        returns (uint256 smfRequired, uint256 feePaid)
    {
        if (smartfolio == address(0)) revert SmartfolioNotSet();
        uint256 ethNeeded = ISmartfolio(smartfolio).mintCost(nftAmount);
        feePaid = (ethNeeded * conversionFeeBps) / 10_000;
        smfRequired = _smfAmountForEth(ethNeeded + feePaid);
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
