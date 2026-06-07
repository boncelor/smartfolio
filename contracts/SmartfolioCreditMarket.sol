// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts-upgradeable/token/ERC1155/ERC1155Upgradeable.sol";
import "./SmartfolioBase.sol";

/**
 * @title SmartfolioCreditMarket
 * @dev Facet for Aave V3 leverage tokens: mintLeverage and divestLeverage.
 *      Called via delegatecall from Smartfolio.
 */
contract SmartfolioCreditMarket is SmartfolioBase, ERC1155Upgradeable {

    function mintLeverage(
        uint256 id,
        uint256 amount,
        bytes memory data
    ) external payable {
        if (!isLeverageToken[id]) revert NotLeverageToken();
        if (amount == 0) revert AmountZero();

        uint256 cap = maxSupply[id];
        if (cap != 0 && totalSupply[id] + amount > cap) revert ExceedsMaxSupply();

        uint256 cost = _mintCost(id, amount);
        if (msg.value < cost) revert InsufficientETH();

        LeverageConfig storage cfg = leverageConfig[id];

        totalMinted[id] += amount;
        totalSupply[id] += amount;
        aaveCollateral[id] += cost;

        _mint(msg.sender, id, amount, data);
        emit LeverageMinted(msg.sender, id, amount, cost);

        weth.deposit{value: cost}();
        weth.approve(cfg.aavePool, cost);
        IAavePool(cfg.aavePool).supply(address(weth), cost, address(this), 0);

        uint256 excess = msg.value - cost;
        if (excess > 0) {
            (bool ok, ) = msg.sender.call{value: excess}("");
            if (!ok) revert ETHTransferFailed();
        }
    }

    function divestLeverage(
        uint256 id,
        uint256 amount,
        uint256 minEthOut
    ) external {
        if (!isLeverageToken[id]) revert NotLeverageToken();
        if (amount == 0) revert AmountZero();
        if (balanceOf(msg.sender, id) < amount) revert InsufficientBalance();
        if (aaveDebt[id] != 0) revert DebtNotRepaid();

        uint256 supply = totalSupply[id];
        uint256 wethToWithdraw = (aaveCollateral[id] * amount) / supply;

        aaveCollateral[id] -= wethToWithdraw;
        totalSupply[id] -= amount;
        _burn(msg.sender, id, amount);

        LeverageConfig storage cfg = leverageConfig[id];
        uint256 withdrawn = IAavePool(cfg.aavePool).withdraw(address(weth), wethToWithdraw, address(this));
        weth.withdraw(withdrawn);

        if (withdrawn < minEthOut) revert InsufficientETHOut();

        emit LeverageDivested(msg.sender, id, amount, withdrawn);

        (bool ok, ) = msg.sender.call{value: withdrawn}("");
        if (!ok) revert ETHTransferFailed();
    }
}
