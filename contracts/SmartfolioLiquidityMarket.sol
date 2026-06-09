// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts-upgradeable/token/ERC1155/ERC1155Upgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./SmartfolioBase.sol";

/**
 * @dev Minimal interface for the Uniswap V3 NonfungiblePositionManager.
 */
interface INonfungiblePositionManager {
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

    function mint(MintParams calldata params) external payable returns (
        uint256 tokenId,
        uint128 liquidity,
        uint256 amount0,
        uint256 amount1
    );

    struct DecreaseLiquidityParams {
        uint256 tokenId;
        uint128 liquidity;
        uint256 amount0Min;
        uint256 amount1Min;
        uint256 deadline;
    }

    function decreaseLiquidity(DecreaseLiquidityParams calldata params) external payable returns (
        uint256 amount0,
        uint256 amount1
    );

    struct CollectParams {
        uint256 tokenId;
        address recipient;
        uint128 amount0Max;
        uint128 amount1Max;
    }

    function collect(CollectParams calldata params) external payable returns (
        uint256 amount0,
        uint256 amount1
    );
}

/**
 * @title SmartfolioLiquidityMarket
 * @dev Facet for Uniswap V3 liquidity-pool investment:
 *      — deployLP   : wraps token's ETH reserve, acquires tokenB, mints LP position
 *      — collectFees: harvests accumulated trading fees back into the token's reserve
 *      — divestLP   : burns ERC1155 tokens and returns proportional ETH to the holder
 *
 *      Called via delegatecall from Smartfolio, so all state reads/writes target
 *      the proxy's storage.
 */
contract SmartfolioLiquidityMarket is SmartfolioBase, ERC1155Upgradeable {

    // -------------------------------------------------------------------------
    // Keeper — deploy LP position
    // -------------------------------------------------------------------------

    /**
     * @notice Deploy the token's ETH reserve into a Uniswap V3 liquidity pool.
     * @param id                 Smartfolio token ID.
     * @param wethForSwap        Amount of WETH (in wei) to swap for tokenB.
     * @param swapAmountOutMin   Minimum tokenB received from the WETH swap.
     * @param amount0Min         LP mint slippage guard for token0.
     * @param amount1Min         LP mint slippage guard for token1.
     */
    function deployLP(
        uint256 id,
        uint256 wethForSwap,
        uint256 swapAmountOutMin,
        uint256 amount0Min,
        uint256 amount1Min
    ) external {
        if (address(positionManager) == address(0)) revert NoPosManagerSet();
        if (address(weth)            == address(0)) revert WETHNotSet();
        if (address(swapRouter)      == address(0)) revert RouterNotSet();

        LPConfig storage cfg = lpConfig[id];
        if (cfg.tokenB == address(0))  revert NoLPConfig();
        if (lpActive[id])              revert LiquidityAlreadyActive();
        if (portfolioActive[id])       revert PortfolioActive();
        if (reserve[id] == 0)          revert NoReserveToDeploy();

        uint256 ethAmount = reserve[id];
        reserve[id]       = 0;
        deployedEth[id]   = ethAmount;
        lpActive[id]      = true;

        // Wrap all ETH → WETH
        weth.deposit{value: ethAmount}();

        // Swap wethForSwap → tokenB
        uint256 tokenBAmount = 0;
        if (wethForSwap > 0) {
            weth.approve(address(swapRouter), wethForSwap);
            tokenBAmount = swapRouter.exactInputSingle(
                ISwapRouter.ExactInputSingleParams({
                    tokenIn:           address(weth),
                    tokenOut:          cfg.tokenB,
                    fee:               cfg.swapFee,
                    recipient:         address(this),
                    deadline:          block.timestamp,
                    amountIn:          wethForSwap,
                    amountOutMinimum:  swapAmountOutMin,
                    sqrtPriceLimitX96: 0
                })
            );
        }

        uint256 wethForLP = ethAmount - wethForSwap;

        // Determine canonical Uniswap ordering (token0 < token1 by address)
        bool wethIsToken0 = address(weth) < cfg.tokenB;
        lpWethIsToken0[id] = wethIsToken0;

        address token0 = wethIsToken0 ? address(weth) : cfg.tokenB;
        address token1 = wethIsToken0 ? cfg.tokenB     : address(weth);
        uint256 amt0   = wethIsToken0 ? wethForLP       : tokenBAmount;
        uint256 amt1   = wethIsToken0 ? tokenBAmount     : wethForLP;

        // Approve and mint LP position
        IERC20(token0).approve(address(positionManager), amt0);
        IERC20(token1).approve(address(positionManager), amt1);

        (uint256 posTokenId, uint128 liquidity, uint256 used0, uint256 used1) =
            INonfungiblePositionManager(positionManager).mint(
                INonfungiblePositionManager.MintParams({
                    token0:          token0,
                    token1:          token1,
                    fee:             cfg.poolFee,
                    tickLower:       cfg.tickLower,
                    tickUpper:       cfg.tickUpper,
                    amount0Desired:  amt0,
                    amount1Desired:  amt1,
                    amount0Min:      amount0Min,
                    amount1Min:      amount1Min,
                    recipient:       address(this),
                    deadline:        block.timestamp
                })
            );

        lpPositionId[id] = posTokenId;
        lpLiquidity[id]  = liquidity;

        // Return any unused WETH back to reserve as ETH
        uint256 unusedWeth = wethIsToken0 ? (amt0 - used0) : (amt1 - used1);
        if (unusedWeth > 0) {
            weth.withdraw(unusedWeth);
            reserve[id]     += unusedWeth;
            deployedEth[id] -= unusedWeth;
        }

        emit LPDeployed(id, posTokenId, liquidity, deployedEth[id]);
    }

    // -------------------------------------------------------------------------
    // Keeper — collect fees
    // -------------------------------------------------------------------------

    /**
     * @notice Collect accrued Uniswap V3 trading fees and add them to the token's
     *         ETH reserve, increasing backing for all holders.
     * @param id  Smartfolio token ID.
     */
    function collectFees(uint256 id) external {
        if (!lpActive[id]) revert LiquidityNotActive();

        LPConfig storage cfg = lpConfig[id];

        (uint256 amount0, uint256 amount1) = INonfungiblePositionManager(positionManager).collect(
            INonfungiblePositionManager.CollectParams({
                tokenId:    lpPositionId[id],
                recipient:  address(this),
                amount0Max: type(uint128).max,
                amount1Max: type(uint128).max
            })
        );

        bool isToken0Weth = lpWethIsToken0[id];
        uint256 wethFees   = isToken0Weth ? amount0 : amount1;
        uint256 tokenBFees = isToken0Weth ? amount1 : amount0;

        // Swap tokenB fees → WETH
        if (tokenBFees > 0) {
            IERC20(cfg.tokenB).approve(address(swapRouter), tokenBFees);
            wethFees += swapRouter.exactInputSingle(
                ISwapRouter.ExactInputSingleParams({
                    tokenIn:           cfg.tokenB,
                    tokenOut:          address(weth),
                    fee:               cfg.swapFee,
                    recipient:         address(this),
                    deadline:          block.timestamp,
                    amountIn:          tokenBFees,
                    amountOutMinimum:  0,
                    sqrtPriceLimitX96: 0
                })
            );
        }

        // Unwrap WETH → ETH, add to reserve
        if (wethFees > 0) {
            weth.withdraw(wethFees);
            reserve[id] += wethFees;
        }

        emit LPFeeCollected(id, wethFees);
    }

    // -------------------------------------------------------------------------
    // User — exit LP position
    // -------------------------------------------------------------------------

    /**
     * @notice Burn ERC1155 tokens and receive proportional ETH from the LP position.
     * @param id         Smartfolio token ID.
     * @param amount     Number of ERC1155 tokens to burn.
     * @param minEthOut  Minimum ETH to receive (reverts on slippage).
     */
    function divestLP(uint256 id, uint256 amount, uint256 minEthOut) external {
        if (!lpActive[id])                        revert LiquidityNotActive();
        if (amount == 0)                          revert AmountZero();
        if (balanceOf(msg.sender, id) < amount)   revert InsufficientBalance();

        uint256 supply = totalSupply[id];
        LPConfig storage cfg = lpConfig[id];

        // Proportional liquidity to remove; last holder gets all remaining to avoid dust
        uint128 liquidityToRemove = supply == amount
            ? lpLiquidity[id]
            : uint128((uint256(lpLiquidity[id]) * amount) / supply);

        INonfungiblePositionManager pm = INonfungiblePositionManager(positionManager);

        // Decrease liquidity — this adds owed amounts to tokensOwed inside the position
        pm.decreaseLiquidity(
            INonfungiblePositionManager.DecreaseLiquidityParams({
                tokenId:    lpPositionId[id],
                liquidity:  liquidityToRemove,
                amount0Min: 0,
                amount1Min: 0,
                deadline:   block.timestamp
            })
        );

        // Collect owed tokens (principal from this decrease + any pending fees owed)
        (uint256 collected0, uint256 collected1) = pm.collect(
            INonfungiblePositionManager.CollectParams({
                tokenId:    lpPositionId[id],
                recipient:  address(this),
                amount0Max: type(uint128).max,
                amount1Max: type(uint128).max
            })
        );

        // Update state before external calls
        lpLiquidity[id]    -= liquidityToRemove;
        totalSupply[id]    -= amount;
        globalTotalSupply  -= amount;
        if (totalSupply[id] == 0) lpActive[id] = false;

        _burn(msg.sender, id, amount);

        // Identify WETH and tokenB amounts
        bool isToken0Weth = lpWethIsToken0[id];
        uint256 wethAmount   = isToken0Weth ? collected0 : collected1;
        uint256 tokenBAmount = isToken0Weth ? collected1 : collected0;

        // Swap tokenB → WETH
        if (tokenBAmount > 0) {
            IERC20(cfg.tokenB).approve(address(swapRouter), tokenBAmount);
            wethAmount += swapRouter.exactInputSingle(
                ISwapRouter.ExactInputSingleParams({
                    tokenIn:           cfg.tokenB,
                    tokenOut:          address(weth),
                    fee:               cfg.swapFee,
                    recipient:         address(this),
                    deadline:          block.timestamp,
                    amountIn:          tokenBAmount,
                    amountOutMinimum:  0,
                    sqrtPriceLimitX96: 0
                })
            );
        }

        // Proportional share of undeployed reserve (leftovers / collected fees)
        uint256 reserveShare = 0;
        if (reserve[id] > 0) {
            reserveShare = (reserve[id] * amount) / supply;
            reserve[id] -= reserveShare;
        }

        // Unwrap WETH → ETH
        if (wethAmount > 0) weth.withdraw(wethAmount);

        uint256 totalEth = wethAmount + reserveShare;
        if (totalEth < minEthOut) revert InsufficientETHOut();

        emit LPDivested(msg.sender, id, amount, totalEth);

        (bool ok, ) = msg.sender.call{value: totalEth}("");
        if (!ok) revert ETHTransferFailed();
    }
}
