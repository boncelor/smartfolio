// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts-upgradeable/token/ERC1155/ERC1155Upgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./SmartfolioBase.sol";

interface IPortfolioAavePool {
    function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode) external;
    function withdraw(address asset, uint256 amount, address to) external returns (uint256);
}

interface ISMFToken {
    function buySMF(uint256 amount) external payable;
    function sellSMF(uint256 amount, uint256 minEthOut) external;
    function smfAmountForBuy(uint256 ethAmount) external view returns (uint256);
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
}

interface IPortfolioNPM {
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
        uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1
    );

    struct DecreaseLiquidityParams {
        uint256 tokenId;
        uint128 liquidity;
        uint256 amount0Min;
        uint256 amount1Min;
        uint256 deadline;
    }
    function decreaseLiquidity(DecreaseLiquidityParams calldata params) external payable returns (
        uint256 amount0, uint256 amount1
    );

    struct CollectParams {
        uint256 tokenId;
        address recipient;
        uint128 amount0Max;
        uint128 amount1Max;
    }
    function collect(CollectParams calldata params) external payable returns (
        uint256 amount0, uint256 amount1
    );
}

/**
 * @title SmartfolioMarket
 * @dev Facet for mixed-type portfolio management: deploy, rebalance (ERC20-only), divest.
 *      Asset types: ERC20 (Uniswap swap), AAVE (WETH collateral), LP (Uniswap V3 position).
 *      Called via delegatecall from Smartfolio.
 */
contract SmartfolioMarket is SmartfolioBase, ERC1155Upgradeable {

    function deploy(
        uint256 id,
        uint256[] calldata erc20MinAmounts,
        uint256 smfMinAmount,
        uint256 lpSwapAmountOutMin,
        uint256 lpAmount0Min,
        uint256 lpAmount1Min
    ) external {
        if (address(swapRouter) == address(0)) revert RouterNotSet();
        if (address(weth)       == address(0)) revert WETHNotSet();

        PortfolioAsset[] storage assets = _getPortfolioConfig(id);
        if (assets.length == 0) revert NoPortfolioConfig();
        if (reserve[id] == 0) revert NoReserveToDeploy();

        // Count ERC20 assets for minAmounts array length check
        uint256 erc20Count;
        for (uint256 i = 0; i < assets.length; i++) {
            if (assets[i].assetType == AssetType.ERC20) erc20Count++;
        }
        if (erc20MinAmounts.length != erc20Count) revert LengthMismatch();

        uint256 ethToSwap = reserve[id];
        reserve[id]       = 0;
        portfolioActive[id] = true;

        // ETH slice stays in reserve — calculate how much to keep back
        uint256 ethReserveBps = 0;
        for (uint256 i = 0; i < assets.length; i++) {
            if (assets[i].assetType == AssetType.ETH) ethReserveBps += assets[i].weightBps;
        }
        uint256 ethForReserve = (ethToSwap * ethReserveBps) / 10_000;
        uint256 ethToInvest   = ethToSwap - ethForReserve;

        if (ethForReserve > 0) reserve[id] = ethForReserve;
        deployedEth[id] = ethToInvest;

        if (ethToInvest > 0) weth.deposit{value: ethToInvest}();

        // Find index of the last non-ETH asset (receives remaining WETH to avoid dust)
        uint256 lastNonEthIdx = 0;
        for (uint256 i = 0; i < assets.length; i++) {
            if (assets[i].assetType != AssetType.ETH) lastNonEthIdx = i;
        }

        uint256 wethRemaining = ethToInvest;
        uint256 erc20Idx = 0;

        for (uint256 i = 0; i < assets.length; i++) {
            PortfolioAsset storage asset = assets[i];
            if (asset.assetType == AssetType.ETH) continue; // stays in reserve

            uint256 amountIn = (i == lastNonEthIdx)
                ? wethRemaining
                : (ethToSwap * asset.weightBps) / 10_000;
            wethRemaining -= amountIn;

            if (asset.assetType == AssetType.ERC20) {
                uint256 amountOut = _swapWETHForToken(
                    asset.token, amountIn, erc20MinAmounts[erc20Idx],
                    asset.poolFee, asset.swapPath
                );
                portfolioHoldings[id][asset.token] += amountOut;
                erc20Idx++;
            } else if (asset.assetType == AssetType.AAVE) {
                if (defaultAavePool == address(0)) revert ZeroDefaultAavePool();
                weth.approve(defaultAavePool, amountIn);
                IPortfolioAavePool(defaultAavePool).supply(address(weth), amountIn, address(this), 0);
                portfolioAaveWeth[id] += amountIn;
                emit PortfolioAaveDeployed(id, amountIn);
            } else if (asset.assetType == AssetType.SMF) {
                // Unwrap WETH → ETH then buy SMF via the bonding curve.
                // smfMinAmount = exact token count (whole tokens). Pass 0 to auto-compute
                // with 1% slippage using the on-chain inverse buy curve.
                weth.withdraw(amountIn);
                uint256 minSmf = smfMinAmount;
                if (minSmf == 0) {
                    uint256 est = ISMFToken(smfContract).smfAmountForBuy(amountIn);
                    minSmf = est * 99 / 100;
                    if (minSmf == 0) revert AmountZero();
                }
                uint256 smfBefore = ISMFToken(smfContract).balanceOf(address(this));
                ISMFToken(smfContract).buySMF{value: amountIn}(minSmf);
                uint256 smfReceived = ISMFToken(smfContract).balanceOf(address(this)) - smfBefore;
                portfolioSMFHoldings[id] += smfReceived;
            } else {
                // LP
                if (positionManager == address(0)) revert NoPosManagerSet();
                _deployPortfolioLP(id, asset, amountIn, lpSwapAmountOutMin, lpAmount0Min, lpAmount1Min);
            }
        }

        emit Deployed(id, ethToSwap);
    }

    function _deployPortfolioLP(
        uint256 id,
        PortfolioAsset storage asset,
        uint256 wethAmount,
        uint256 swapAmountOutMin,
        uint256 amount0Min,
        uint256 amount1Min
    ) internal {
        uint256 wethForSwap = wethAmount / 2;
        uint256 wethForLP   = wethAmount - wethForSwap;

        // Swap half WETH → tokenB
        uint256 tokenBAmount = 0;
        if (wethForSwap > 0) {
            weth.approve(address(swapRouter), wethForSwap);
            tokenBAmount = swapRouter.exactInputSingle(
                ISwapRouter.ExactInputSingleParams({
                    tokenIn:           address(weth),
                    tokenOut:          asset.token,
                    fee:               asset.swapFee,
                    recipient:         address(this),
                    deadline:          block.timestamp,
                    amountIn:          wethForSwap,
                    amountOutMinimum:  swapAmountOutMin,
                    sqrtPriceLimitX96: 0
                })
            );
        }

        bool wethIsToken0 = address(weth) < asset.token;
        portfolioLpWethIsToken0[id] = wethIsToken0;

        address token0 = wethIsToken0 ? address(weth) : asset.token;
        address token1 = wethIsToken0 ? asset.token   : address(weth);
        uint256 amt0   = wethIsToken0 ? wethForLP      : tokenBAmount;
        uint256 amt1   = wethIsToken0 ? tokenBAmount    : wethForLP;

        IERC20(token0).approve(positionManager, amt0);
        IERC20(token1).approve(positionManager, amt1);

        (uint256 posTokenId, uint128 liquidity, uint256 used0, uint256 used1) =
            IPortfolioNPM(positionManager).mint(
                IPortfolioNPM.MintParams({
                    token0:         token0,
                    token1:         token1,
                    fee:            asset.poolFee,
                    tickLower:      asset.tickLower,
                    tickUpper:      asset.tickUpper,
                    amount0Desired: amt0,
                    amount1Desired: amt1,
                    amount0Min:     amount0Min,
                    amount1Min:     amount1Min,
                    recipient:      address(this),
                    deadline:       block.timestamp
                })
            );

        portfolioLpPositionId[id] = posTokenId;
        portfolioLpLiquidity[id]  = liquidity;

        // Return unused WETH to reserve
        uint256 unusedWeth = wethIsToken0 ? (amt0 - used0) : (amt1 - used1);
        if (unusedWeth > 0) {
            weth.withdraw(unusedWeth);
            reserve[id]     += unusedWeth;
            deployedEth[id] -= unusedWeth;
        }

        emit PortfolioLPDeployed(id, posTokenId, liquidity);
    }

    /**
     * @notice Full portfolio rebalance — all settlement flows through reserve[id].
     *
     * Intended instruction order (enforced off-chain):
     *   1. SMF sells  (overweight SMF → ETH → reserve)
     *   2. ERC20 sells (overweight ERC20 → WETH → ETH → reserve)
     *   3. ERC20 buys  (reserve ETH → WETH → underweight ERC20)
     *   4. SMF buy     (reserve ETH → bonding curve → SMF) — must be last
     *
     * SMF instructions are identified by inst.token == smfContract.
     */
    function rebalanceAll(uint256 id, RebalanceAllInstruction[] calldata instructions) external {
        if (instructions.length == 0) revert NoInstructions();
        if (smfContract == address(0)) revert SMFContractNotSet();

        for (uint256 i = 0; i < instructions.length; i++) {
            RebalanceAllInstruction calldata inst = instructions[i];

            if (inst.token == smfContract) {
                // ---- SMF instruction ----
                if (inst.isSell) {
                    uint256 smfTokens = inst.amountIn / WAD;
                    if (smfTokens == 0) continue;
                    if (portfolioSMFHoldings[id] < smfTokens * WAD) revert InsufficientHoldings();

                    uint256 ethBefore = address(this).balance;
                    ISMFToken(smfContract).sellSMF(smfTokens, inst.amountOutMin);
                    uint256 ethReceived = address(this).balance - ethBefore;

                    portfolioSMFHoldings[id] -= smfTokens * WAD;
                    reserve[id] += ethReceived;
                } else {
                    // Buy SMF with ETH from reserve
                    uint256 ethAmount = inst.amountIn;
                    if (reserve[id] < ethAmount) revert InsufficientHoldings();
                    reserve[id] -= ethAmount;

                    uint256 minSmf = inst.amountOutMin;
                    if (minSmf == 0) {
                        uint256 est = ISMFToken(smfContract).smfAmountForBuy(ethAmount);
                        minSmf = est * 99 / 100;
                        if (minSmf == 0) revert AmountZero();
                    }

                    uint256 smfBefore = ISMFToken(smfContract).balanceOf(address(this));
                    ISMFToken(smfContract).buySMF{value: ethAmount}(minSmf);
                    uint256 smfReceived = ISMFToken(smfContract).balanceOf(address(this)) - smfBefore;
                    portfolioSMFHoldings[id] += smfReceived;
                }
            } else {
                // ---- ERC20 instruction ----
                if (inst.isSell) {
                    if (portfolioHoldings[id][inst.token] < inst.amountIn) revert InsufficientHoldings();
                    portfolioHoldings[id][inst.token] -= inst.amountIn;

                    bytes memory path = inst.sellSwapPath.length > 0 ? inst.sellSwapPath : inst.swapPath;
                    uint256 wethReceived = _swapTokenForWETH(
                        inst.token, inst.amountIn, inst.amountOutMin, inst.poolFee, path
                    );
                    weth.withdraw(wethReceived);
                    reserve[id] += wethReceived;
                } else {
                    if (reserve[id] < inst.amountIn) revert InsufficientHoldings();
                    reserve[id] -= inst.amountIn;
                    weth.deposit{value: inst.amountIn}();

                    uint256 amountOut = _swapWETHForToken(
                        inst.token, inst.amountIn, inst.amountOutMin, inst.poolFee, inst.swapPath
                    );
                    if (amountOut == 0) revert ZeroSwapOutput();
                    portfolioHoldings[id][inst.token] += amountOut;
                }
            }
        }

        emit Rebalanced(id);
    }

    function rebalance(uint256 id, RebalanceInstruction[] calldata instructions) external {
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
                if (amountOut == 0) revert ZeroSwapOutput();
                portfolioHoldings[id][inst.token] += amountOut;
            }
        }

        emit Rebalanced(id);
    }

    function divest(uint256 id, uint256 amount) external {
        if (amount == 0) revert AmountZero();
        if (balanceOf(msg.sender, id) < amount) revert InsufficientBalance();

        uint256 supply = totalSupply[id];
        PortfolioAsset[] storage assets = _getPortfolioConfig(id);

        uint256 ethFromReserve = (reserve[id] * amount) / supply;
        reserve[id] -= ethFromReserve;

        // Update supply and holdings state before external calls
        deployedEth[id] -= (deployedEth[id] * amount) / supply;
        totalSupply[id] -= amount;
        globalTotalSupply -= amount;
        if (totalSupply[id] == 0) portfolioActive[id] = false;

        _burn(msg.sender, id, amount);

        uint256 totalEthOut = ethFromReserve;

        for (uint256 i = 0; i < assets.length; i++) {
            PortfolioAsset storage asset = assets[i];

            if (asset.assetType == AssetType.ERC20) {
                // Transfer ERC20 tokens directly — no swap
                uint256 tokenAmt = (portfolioHoldings[id][asset.token] * amount) / supply;
                if (tokenAmt == 0) continue;
                portfolioHoldings[id][asset.token] -= tokenAmt;
                IERC20(asset.token).transfer(msg.sender, tokenAmt);

            } else if (asset.assetType == AssetType.AAVE) {
                // Withdraw WETH from Aave, unwrap to ETH
                if (portfolioAaveWeth[id] == 0) continue;
                uint256 wethToWithdraw = (portfolioAaveWeth[id] * amount) / supply;
                if (wethToWithdraw == 0) continue;
                portfolioAaveWeth[id] -= wethToWithdraw;
                uint256 withdrawn = IPortfolioAavePool(defaultAavePool).withdraw(
                    address(weth), wethToWithdraw, address(this)
                );
                weth.withdraw(withdrawn);
                totalEthOut += withdrawn;
                emit PortfolioAaveDivested(id, withdrawn);

            } else if (asset.assetType == AssetType.SMF) {
                // Transfer SMF tokens directly — no bonding curve sell
                if (portfolioSMFHoldings[id] == 0) continue;
                uint256 smfAmt = (portfolioSMFHoldings[id] * amount) / supply;
                if (smfAmt == 0) continue;
                portfolioSMFHoldings[id] -= smfAmt;
                address smfAddr = smfContractForNFT[id] != address(0) ? smfContractForNFT[id] : smfContract;
                IERC20(smfAddr).transfer(msg.sender, smfAmt);

            } else {
                // LP: remove liquidity, unwrap WETH→ETH, transfer tokenB directly
                if (portfolioLpLiquidity[id] == 0) continue;
                totalEthOut += _divestPortfolioLP(id, amount, supply, msg.sender);
            }
        }

        emit Divested(msg.sender, id, amount, totalEthOut);

        if (totalEthOut > 0) {
            (bool ok, ) = msg.sender.call{value: totalEthOut}("");
            if (!ok) revert ETHTransferFailed();
        }
    }

    function _divestPortfolioLP(
        uint256 id,
        uint256 amount,
        uint256 supply,
        address recipient
    ) internal returns (uint256 ethOut) {
        uint128 liquidityToRemove = (supply == amount)
            ? portfolioLpLiquidity[id]
            : uint128((uint256(portfolioLpLiquidity[id]) * amount) / supply);

        IPortfolioNPM pm = IPortfolioNPM(positionManager);

        pm.decreaseLiquidity(
            IPortfolioNPM.DecreaseLiquidityParams({
                tokenId:    portfolioLpPositionId[id],
                liquidity:  liquidityToRemove,
                amount0Min: 0,
                amount1Min: 0,
                deadline:   block.timestamp
            })
        );

        (uint256 collected0, uint256 collected1) = pm.collect(
            IPortfolioNPM.CollectParams({
                tokenId:    portfolioLpPositionId[id],
                recipient:  address(this),
                amount0Max: type(uint128).max,
                amount1Max: type(uint128).max
            })
        );

        portfolioLpLiquidity[id] -= liquidityToRemove;

        bool isToken0Weth = portfolioLpWethIsToken0[id];
        uint256 wethAmt   = isToken0Weth ? collected0 : collected1;
        uint256 tokenBAmt = isToken0Weth ? collected1 : collected0;

        // Unwrap WETH → ETH (returned to caller as part of totalEthOut)
        if (wethAmt > 0) weth.withdraw(wethAmt);

        // Transfer tokenB directly to recipient — no swap
        if (tokenBAmt > 0) {
            PortfolioAsset[] storage assets = _getPortfolioConfig(id);
            for (uint256 i = 0; i < assets.length; i++) {
                if (assets[i].assetType == AssetType.LP) {
                    IERC20(assets[i].token).transfer(recipient, tokenBAmt);
                    break;
                }
            }
        }

        emit PortfolioLPDivested(id, wethAmt);
        return wethAmt;
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
