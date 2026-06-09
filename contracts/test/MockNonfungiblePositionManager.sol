// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @dev Mock Uniswap V3 NonfungiblePositionManager for testing.
 *
 * Simplified mechanics:
 *   - mint():              accepts both tokens, liquidity = amount0 + amount1
 *   - decreaseLiquidity(): proportionally moves tokens from held → tokensOwed
 *   - collect():           transfers tokensOwed to recipient
 *   - addFees():           test helper to inject simulated trading fees
 */
contract MockNonfungiblePositionManager {

    struct PositionData {
        address token0;
        address token1;
        uint128 liquidity;
        uint256 amount0Held;   // tokens held in position
        uint256 amount1Held;
        uint128 tokensOwed0;   // owed to owner (after decreaseLiquidity or addFees)
        uint128 tokensOwed1;
    }

    mapping(uint256 => PositionData) public positionData;
    uint256 private _nextId;

    struct MintParams {
        address token0;
        address token1;
        uint24  fee;
        int24   tickLower;
        int24   tickUpper;
        uint256 amount0Desired;
        uint256 amount1Desired;
        uint256 amount0Min;
        uint256 amount1Min;
        address recipient;
        uint256 deadline;
    }

    function mint(MintParams calldata p)
        external
        returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)
    {
        amount0 = p.amount0Desired;
        amount1 = p.amount1Desired;
        require(amount0 >= p.amount0Min && amount1 >= p.amount1Min, "MockNPM: slippage");

        IERC20(p.token0).transferFrom(msg.sender, address(this), amount0);
        IERC20(p.token1).transferFrom(msg.sender, address(this), amount1);

        liquidity = uint128(amount0 + amount1);
        tokenId   = ++_nextId;

        positionData[tokenId] = PositionData({
            token0:      p.token0,
            token1:      p.token1,
            liquidity:   liquidity,
            amount0Held: amount0,
            amount1Held: amount1,
            tokensOwed0: 0,
            tokensOwed1: 0
        });
    }

    struct DecreaseLiquidityParams {
        uint256 tokenId;
        uint128 liquidity;
        uint256 amount0Min;
        uint256 amount1Min;
        uint256 deadline;
    }

    function decreaseLiquidity(DecreaseLiquidityParams calldata p)
        external
        returns (uint256 amount0, uint256 amount1)
    {
        PositionData storage pos = positionData[p.tokenId];
        require(p.liquidity <= pos.liquidity, "MockNPM: too much");

        if (pos.liquidity == 0) return (0, 0);

        amount0 = (pos.amount0Held * p.liquidity) / pos.liquidity;
        amount1 = (pos.amount1Held * p.liquidity) / pos.liquidity;

        require(amount0 >= p.amount0Min && amount1 >= p.amount1Min, "MockNPM: slippage");

        pos.amount0Held -= amount0;
        pos.amount1Held -= amount1;
        pos.liquidity   -= p.liquidity;
        pos.tokensOwed0 += uint128(amount0);
        pos.tokensOwed1 += uint128(amount1);
    }

    struct CollectParams {
        uint256 tokenId;
        address recipient;
        uint128 amount0Max;
        uint128 amount1Max;
    }

    function collect(CollectParams calldata p)
        external
        returns (uint256 amount0, uint256 amount1)
    {
        PositionData storage pos = positionData[p.tokenId];
        address recipient = p.recipient == address(0) ? msg.sender : p.recipient;

        amount0 = pos.tokensOwed0 > p.amount0Max ? p.amount0Max : pos.tokensOwed0;
        amount1 = pos.tokensOwed1 > p.amount1Max ? p.amount1Max : pos.tokensOwed1;

        pos.tokensOwed0 -= uint128(amount0);
        pos.tokensOwed1 -= uint128(amount1);

        if (amount0 > 0) IERC20(pos.token0).transfer(recipient, amount0);
        if (amount1 > 0) IERC20(pos.token1).transfer(recipient, amount1);
    }

    /// @dev Test helper: inject simulated fee income into a position.
    ///      Caller must have pre-funded this contract with the fee tokens.
    function addFees(uint256 tokenId, uint128 fees0, uint128 fees1) external {
        positionData[tokenId].tokensOwed0 += fees0;
        positionData[tokenId].tokensOwed1 += fees1;
    }
}
