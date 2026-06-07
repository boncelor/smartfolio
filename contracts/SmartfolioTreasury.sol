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

    function mint(
        address account,
        uint256 id,
        uint256 amount,
        bytes memory data
    ) external payable {
        uint256 cap = maxSupply[id];
        if (cap != 0 && totalSupply[id] + amount > cap) revert ExceedsMaxSupply();

        uint256 cost = _mintCost(id, amount);
        if (msg.value < cost) revert InsufficientETH();

        totalMinted[id] += amount;
        totalSupply[id] += amount;
        reserve[id] += cost;

        _mint(account, id, amount, data);
        emit Minted(account, id, amount, cost);

        uint256 excess = msg.value - cost;
        if (excess > 0) {
            (bool ok, ) = msg.sender.call{value: excess}("");
            if (!ok) revert ETHTransferFailed();
        }
    }

    function mintBatch(
        address to,
        uint256[] memory ids,
        uint256[] memory amounts,
        bytes memory data
    ) external payable {
        if (ids.length != amounts.length) revert LengthMismatch();

        uint256 totalCost;
        for (uint256 i = 0; i < ids.length; i++) {
            uint256 cap = maxSupply[ids[i]];
            if (cap != 0 && totalSupply[ids[i]] + amounts[i] > cap) revert ExceedsMaxSupply();
            totalCost += _mintCost(ids[i], amounts[i]);
        }
        if (msg.value < totalCost) revert InsufficientETH();

        for (uint256 i = 0; i < ids.length; i++) {
            uint256 cost = _mintCost(ids[i], amounts[i]);
            totalMinted[ids[i]] += amounts[i];
            totalSupply[ids[i]] += amounts[i];
            reserve[ids[i]] += cost;
        }

        _mintBatch(to, ids, amounts, data);

        uint256 excess = msg.value - totalCost;
        if (excess > 0) {
            (bool ok, ) = msg.sender.call{value: excess}("");
            if (!ok) revert ETHTransferFailed();
        }
    }

    function burn(uint256 id, uint256 amount) external {
        if (portfolioActive[id]) revert UseDivest();
        if (amount == 0) revert AmountZero();
        if (balanceOf(msg.sender, id) < amount) revert InsufficientBalance();

        (, uint256 fee, uint256 net) = _burnRefund(id, amount);

        totalSupply[id] -= amount;
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
