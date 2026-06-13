// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts-upgradeable/token/ERC1155/ERC1155Upgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./SmartfolioBase.sol";

/**
 * @title SmartfolioTreasury
 * @dev Facet for bonding curve minting and burning. Called via delegatecall from
 *      Smartfolio. Runs in the proxy's storage context — all state reads/writes
 *      affect the proxy, not this contract's own storage.
 *
 *      Guards (nonReentrant, whenNotPaused) are applied by the Smartfolio entry
 *      points before delegatecalling here.
 */
contract SmartfolioTreasury is SmartfolioBase, ERC1155Upgradeable {

    /**
     * @dev Auto-assigns the next token ID and mints exactly 1 token to `to`.
     *      Called by the SMF contract for oracle-priced NFT minting.
     *      Returns the newly assigned token ID via return data (forwarded by _delegateTo).
     */
    function mintFundedNew(address to) external payable returns (uint256 id) {
        if (msg.value == 0) revert InsufficientETH();
        id = ++nextTokenId;
        totalMinted[id] += 1;
        totalSupply[id] += 1;
        reserve[id] += msg.value;
        globalTotalMinted += 1;
        globalTotalSupply += 1;
        _mint(to, id, 1, "");
        emit MintFunded(to, id, 1, msg.value);
    }

    function mintFunded(address to, uint256 id, uint256 amount) external payable {
        if (msg.value == 0) revert InsufficientETH();
        if (amount == 0) revert AmountZero();

        totalMinted[id] += amount;
        totalSupply[id] += amount;
        reserve[id] += msg.value;
        globalTotalMinted += amount;
        globalTotalSupply += amount;

        _mint(to, id, amount, "");
        emit MintFunded(to, id, amount, msg.value);
    }

    function addReserve(uint256 id) external payable {
        if (msg.value == 0) revert InsufficientETH();
        reserve[id] += msg.value;
        emit ReserveAdded(id, msg.value);
    }

    /**
     * @dev Mint 1 ERC1155 to `to` and credit SMF holdings. SMF is pulled from
     *      the caller (smfContract) which has already received it from the user.
     */
    function mintWithSMF(address to, uint256 smfAmount) external returns (uint256 id) {
        if (smfAmount == 0) revert AmountZero();
        id = ++nextTokenId;
        totalMinted[id] += 1;
        totalSupply[id] += 1;
        globalTotalMinted += 1;
        globalTotalSupply += 1;
        portfolioSMFHoldings[id] += smfAmount;
        IERC20(smfContract).transferFrom(msg.sender, address(this), smfAmount);
        _mint(to, id, 1, "");

        // Default portfolio config: 100% SMF
        _portfolioConfig[id].push(PortfolioAsset({
            assetType: AssetType.SMF,
            token: smfContract,
            weightBps: 10000,
            poolFee: 0,
            swapFee: 0,
            tickLower: 0,
            tickUpper: 0,
            swapPath: "",
            sellSwapPath: ""
        }));

        emit MintFunded(to, id, 1, 0);
    }

    /**
     * @dev Credit SMF to an existing NFT's portfolio holdings.
     *      SMF is pulled from the caller (smfContract).
     */
    function receiveSMF(uint256 id, uint256 smfAmount) external {
        if (smfAmount == 0) revert AmountZero();
        portfolioSMFHoldings[id] += smfAmount;
        IERC20(smfContract).transferFrom(msg.sender, address(this), smfAmount);
        emit ReserveAdded(id, 0);
    }

    /// @notice Sweep sub-wei rounding dust left in reserve[id] after all tokens have
    ///         been burned. Sends to treasury if configured, otherwise to the caller
    ///         (which is always the proxy owner, enforced by the entry point).
    function sweepDust(uint256 id) external {
        if (totalSupply[id] != 0) revert SupplyNotZero();
        uint256 dust = reserve[id];
        if (dust == 0) revert NoDust();
        reserve[id] = 0;
        address recipient = treasury != address(0) ? treasury : msg.sender;
        emit DustSwept(id, recipient, dust);
        (bool ok, ) = recipient.call{value: dust}("");
        if (!ok) revert ETHTransferFailed();
    }

    /**
     * @notice Pre-deployment exit. Burns the caller's 1 ERC1155 token and returns
     *         the full SMF holdings (and any ETH reserve) to the caller.
     *         Only callable before the keeper deploys the portfolio.
     */
    function withdrawSMF(uint256 id) external {
        if (portfolioActive[id]) revert UseDivest();
        if (balanceOf(msg.sender, id) == 0) revert InsufficientBalance();

        uint256 smfAmt = portfolioSMFHoldings[id];
        uint256 ethAmt = reserve[id];

        totalSupply[id] -= 1;
        globalTotalSupply -= 1;
        if (smfAmt > 0) portfolioSMFHoldings[id] = 0;
        if (ethAmt > 0) reserve[id] = 0;

        _burn(msg.sender, id, 1);

        if (smfAmt > 0) {
            IERC20(smfContract).transfer(msg.sender, smfAmt);
        }
        if (ethAmt > 0) {
            (bool ok, ) = msg.sender.call{value: ethAmt}("");
            if (!ok) revert ETHTransferFailed();
        }

        emit Burned(msg.sender, id, 1, ethAmt, 0);
    }

    function burn(uint256 id, uint256 amount) external {
        if (portfolioActive[id]) revert UseDivest();
        if (amount == 0) revert AmountZero();
        if (balanceOf(msg.sender, id) < amount) revert InsufficientBalance();

        (, uint256 fee, uint256 net) = _burnRefund(id, amount);

        totalSupply[id] -= amount;
        globalTotalSupply -= amount;
        if (treasury != address(0)) {
            reserve[id] -= (net + fee);
        } else {
            reserve[id] -= net;
        }

        _burn(msg.sender, id, amount);
        emit Burned(msg.sender, id, amount, net, fee);

        (bool ok, ) = msg.sender.call{value: net}("");
        if (!ok) revert ETHTransferFailed();

        if (treasury != address(0) && fee > 0) {
            (bool feeOk, ) = treasury.call{value: fee}("");
            if (!feeOk) revert ETHTransferFailed();
            emit FeeSent(treasury, fee);
        }
    }
}
