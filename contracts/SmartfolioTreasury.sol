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
        }
    }
}
