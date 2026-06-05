// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@uniswap/v3-periphery/contracts/interfaces/ISwapRouter.sol";

/**
 * @dev Mock Uniswap V3 SwapRouter for testing.
 *
 *  Exchange rate: 1:1 (amountOut = amountIn).
 *  Pre-fund this contract with the ERC20 tokens and WETH it will hand out.
 *
 *  Implements exactInputSingle and exactInput from ISwapRouter.
 */
contract MockSwapRouter {
    /// @dev Single-hop swap: pull tokenIn, push tokenOut at 1:1.
    function exactInputSingle(ISwapRouter.ExactInputSingleParams calldata params)
        external
        returns (uint256 amountOut)
    {
        IERC20(params.tokenIn).transferFrom(msg.sender, address(this), params.amountIn);
        amountOut = params.amountIn; // 1:1 rate
        require(amountOut >= params.amountOutMinimum, "MockSwapRouter: slippage");
        IERC20(params.tokenOut).transfer(params.recipient, amountOut);
    }

    /**
     * @dev Multi-hop swap: decodes tokenIn from the first 20 bytes of path,
     *      tokenOut from the last 20 bytes, and swaps 1:1.
     *
     *  Uniswap V3 path encoding: token0 (20) | fee (3) | token1 (20) | ...
     */
    function exactInput(ISwapRouter.ExactInputParams calldata params)
        external
        returns (uint256 amountOut)
    {
        bytes memory path = params.path;
        address tokenIn;
        address tokenOut;
        assembly {
            // First 20 bytes of path data
            tokenIn  := shr(96, mload(add(path, 32)))
            // Last 20 bytes of path data
            tokenOut := shr(96, mload(add(add(path, 32), sub(mload(path), 20))))
        }
        IERC20(tokenIn).transferFrom(msg.sender, address(this), params.amountIn);
        amountOut = params.amountIn; // 1:1 rate
        require(amountOut >= params.amountOutMinimum, "MockSwapRouter: slippage");
        IERC20(tokenOut).transfer(params.recipient, amountOut);
    }
}
