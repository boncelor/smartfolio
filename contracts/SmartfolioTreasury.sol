// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts-upgradeable/token/ERC1155/ERC1155Upgradeable.sol";
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

    function burn(uint256 id, uint256 amount) external {
        if (portfolioActive[id]) revert UseDivest();
        if (lpActive[id])        revert UseDivest();
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
