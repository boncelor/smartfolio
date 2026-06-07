// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts-upgradeable/token/ERC1155/ERC1155Upgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./SmartfolioBase.sol";

/**
 * @title SmartfolioMarket
 * @dev Facet for Uniswap V3 portfolio management: deploy, rebalance, divest.
 *      Called via delegatecall from Smartfolio.
 */
contract SmartfolioMarket is SmartfolioBase, ERC1155Upgradeable {

    function deploy(uint256 id, uint256[] calldata amountsOutMinimum) external {
        if (address(swapRouter) == address(0)) revert RouterNotSet();
        if (address(weth) == address(0)) revert WETHNotSet();

        PortfolioAsset[] storage assets = _getPortfolioConfig(id);
        if (assets.length == 0) revert NoPortfolioConfig();
        if (portfolioActive[id]) revert AlreadyDeployed();
        if (reserve[id] == 0) revert NoReserveToDeploy();
        if (amountsOutMinimum.length != assets.length) revert LengthMismatch();

        uint256 ethToSwap = reserve[id];
        reserve[id] = 0;
        deployedEth[id] = ethToSwap;
        portfolioActive[id] = true;

        weth.deposit{value: ethToSwap}();

        uint256 wethRemaining = ethToSwap;
        for (uint256 i = 0; i < assets.length; i++) {
            uint256 amountIn = (i == assets.length - 1)
                ? wethRemaining
                : (ethToSwap * assets[i].weightBps) / 10_000;
            wethRemaining -= amountIn;
            uint256 amountOut = _swapWETHForToken(
                assets[i].token, amountIn, amountsOutMinimum[i],
                assets[i].poolFee, assets[i].swapPath
            );
            portfolioHoldings[id][assets[i].token] += amountOut;
        }

        emit Deployed(id, ethToSwap);
    }

    function rebalance(uint256 id, RebalanceInstruction[] calldata instructions) external {
        if (!portfolioActive[id]) revert PortfolioNotActive();
        if (instructions.length == 0) revert NoInstructions();

        for (uint256 i = 0; i < instructions.length; i++) {
            RebalanceInstruction calldata inst = instructions[i];
            if (inst.isSell) {
                if (portfolioHoldings[id][inst.token] < inst.amountIn) revert InsufficientHoldings();
                portfolioHoldings[id][inst.token] -= inst.amountIn;
                _swapTokenForWETH(inst.token, inst.amountIn, inst.amountOutMin, inst.poolFee, inst.swapPath);
            } else {
                uint256 amountOut = _swapWETHForToken(
                    inst.token, inst.amountIn, inst.amountOutMin, inst.poolFee, inst.swapPath
                );
                portfolioHoldings[id][inst.token] += amountOut;
            }
        }

        emit Rebalanced(id);
    }

    function divest(uint256 id, uint256 amount, uint256 minEthOut) external {
        if (!portfolioActive[id]) revert PortfolioNotActive();
        if (amount == 0) revert AmountZero();
        if (balanceOf(msg.sender, id) < amount) revert InsufficientBalance();

        uint256 supply = totalSupply[id];
        PortfolioAsset[] storage assets = _getPortfolioConfig(id);

        uint256 ethFromReserve = (reserve[id] * amount) / supply;
        reserve[id] -= ethFromReserve;

        uint256[] memory tokenAmounts = new uint256[](assets.length);
        for (uint256 i = 0; i < assets.length; i++) {
            tokenAmounts[i] = (portfolioHoldings[id][assets[i].token] * amount) / supply;
            portfolioHoldings[id][assets[i].token] -= tokenAmounts[i];
        }

        deployedEth[id] -= (deployedEth[id] * amount) / supply;
        totalSupply[id] -= amount;
        if (totalSupply[id] == 0) portfolioActive[id] = false;

        _burn(msg.sender, id, amount);

        uint256 wethReceived;
        for (uint256 i = 0; i < assets.length; i++) {
            if (tokenAmounts[i] == 0) continue;
            wethReceived += _swapTokenForWETH(
                assets[i].token, tokenAmounts[i], 0,
                assets[i].poolFee, assets[i].sellSwapPath
            );
        }

        if (wethReceived > 0) weth.withdraw(wethReceived);

        uint256 totalEth = wethReceived + ethFromReserve;
        if (totalEth < minEthOut) revert InsufficientETHOut();

        emit Divested(msg.sender, id, amount, totalEth);

        (bool ok, ) = msg.sender.call{value: totalEth}("");
        if (!ok) revert ETHTransferFailed();
    }

    function _swapWETHForToken(
        address token, uint256 amountIn, uint256 amountOutMin,
        uint24 poolFee, bytes memory swapPath
    ) internal returns (uint256 amountOut) {
        weth.approve(address(swapRouter), amountIn);
        if (swapPath.length == 0) {
            amountOut = swapRouter.exactInputSingle(
                ISwapRouter.ExactInputSingleParams({
                    tokenIn: address(weth), tokenOut: token, fee: poolFee,
                    recipient: address(this), deadline: block.timestamp,
                    amountIn: amountIn, amountOutMinimum: amountOutMin, sqrtPriceLimitX96: 0
                })
            );
        } else {
            amountOut = swapRouter.exactInput(
                ISwapRouter.ExactInputParams({
                    path: swapPath, recipient: address(this), deadline: block.timestamp,
                    amountIn: amountIn, amountOutMinimum: amountOutMin
                })
            );
        }
    }

    function _swapTokenForWETH(
        address token, uint256 amountIn, uint256 amountOutMin,
        uint24 poolFee, bytes memory swapPath
    ) internal returns (uint256 amountOut) {
        IERC20(token).approve(address(swapRouter), amountIn);
        if (swapPath.length == 0) {
            amountOut = swapRouter.exactInputSingle(
                ISwapRouter.ExactInputSingleParams({
                    tokenIn: token, tokenOut: address(weth), fee: poolFee,
                    recipient: address(this), deadline: block.timestamp,
                    amountIn: amountIn, amountOutMinimum: amountOutMin, sqrtPriceLimitX96: 0
                })
            );
        } else {
            amountOut = swapRouter.exactInput(
                ISwapRouter.ExactInputParams({
                    path: swapPath, recipient: address(this), deadline: block.timestamp,
                    amountIn: amountIn, amountOutMinimum: amountOutMin
                })
            );
        }
    }
}
