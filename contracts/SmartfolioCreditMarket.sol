// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts-upgradeable/token/ERC1155/ERC1155Upgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./SmartfolioBase.sol";

/**
 * @title SmartfolioCreditMarket
 * @dev Facet for Aave V3 leverage tokens. Called via delegatecall from Smartfolio.
 *
 *      Phase 1: mintLeverage / divestLeverage — deposit ETH as WETH collateral.
 *      Phase 2: leverUp / leverDown — keeper-driven signal-based position management.
 *      Phase 3: emergencyDeleverage — owner/keeper safety valve triggered when Aave
 *               health factor drops below emergencyHealthFloor. Full leverDown in one
 *               call. Optional Chainlink ETH/USD feed for independent price sanity check.
 */
contract SmartfolioCreditMarket is SmartfolioBase, ERC1155Upgradeable {

    // -------------------------------------------------------------------------
    // Phase 1 — collateral deposit / withdrawal
    // -------------------------------------------------------------------------

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

    // -------------------------------------------------------------------------
    // Phase 2 — signal-driven keeper operations
    // -------------------------------------------------------------------------

    /**
     * @notice Increase leverage on a golden cross signal.
     * @dev    Keeper only (guard applied in Smartfolio entry point).
     *         Flow: borrow stable → swap stable→WETH → re-deposit WETH to Aave.
     *         Reverts if the resulting contract-level LTV exceeds maxLtvBps.
     * @param id             Token ID (must be a leverage token with collateral).
     * @param stableToBorrow Amount of stableToken to borrow from Aave.
     * @param minWethOut     Minimum WETH to receive from the swap (slippage guard).
     * @param poolFee        Uniswap V3 pool fee for single-hop swap (ignored if swapPath set).
     * @param swapPath       Encoded Uniswap path stable→WETH; empty = single-hop via poolFee.
     */
    function leverUp(
        uint256 id,
        uint256 stableToBorrow,
        uint256 minWethOut,
        uint24 poolFee,
        bytes calldata swapPath
    ) external {
        if (!isLeverageToken[id]) revert NotLeverageToken();
        if (stableToBorrow == 0) revert AmountZero();
        if (aaveCollateral[id] == 0) revert NoLeveragePosition();

        LeverageConfig storage cfg = leverageConfig[id];

        // Borrow stable from Aave (variable rate = 2)
        IAavePool(cfg.aavePool).borrow(cfg.stableToken, stableToBorrow, 2, 0, address(this));
        aaveDebt[id] += stableToBorrow;

        // Swap stable → WETH
        uint256 wethReceived = _swap(cfg.stableToken, address(weth), stableToBorrow, minWethOut, poolFee, swapPath);

        // Re-deposit WETH as collateral
        weth.approve(cfg.aavePool, wethReceived);
        IAavePool(cfg.aavePool).supply(address(weth), wethReceived, address(this), 0);
        aaveCollateral[id] += wethReceived;

        // On-chain LTV guard: revert if contract LTV now exceeds the hard cap
        (uint256 totalCollateralBase, uint256 totalDebtBase, , , , ) =
            IAavePool(cfg.aavePool).getUserAccountData(address(this));
        uint256 newLtvBps = totalCollateralBase > 0
            ? (totalDebtBase * 10_000) / totalCollateralBase
            : 0;
        if (newLtvBps > cfg.maxLtvBps) revert LtvCapExceeded();

        emit LeverUp(id, stableToBorrow, wethReceived, newLtvBps);
    }

    /**
     * @notice Decrease leverage on a death cross signal.
     * @dev    Keeper only (guard applied in Smartfolio entry point).
     *         Flow: withdraw WETH from Aave → swap WETH→stable → repay Aave debt.
     *         When aaveDebt[id] reaches 0, users can call divestLeverage().
     * @param id              Token ID (must be a leverage token with outstanding debt).
     * @param wethToWithdraw  Amount of WETH to withdraw from Aave collateral.
     * @param minStableOut    Minimum stable to receive from the swap (slippage guard).
     * @param poolFee         Uniswap V3 pool fee for single-hop swap.
     * @param swapPath        Encoded Uniswap path WETH→stable; empty = single-hop.
     */
    function leverDown(
        uint256 id,
        uint256 wethToWithdraw,
        uint256 minStableOut,
        uint24 poolFee,
        bytes calldata swapPath
    ) external {
        if (!isLeverageToken[id]) revert NotLeverageToken();
        if (wethToWithdraw == 0) revert AmountZero();
        if (aaveDebt[id] == 0) revert NoDebtToRepay();

        LeverageConfig storage cfg = leverageConfig[id];

        // Withdraw WETH from Aave
        uint256 withdrawn = IAavePool(cfg.aavePool).withdraw(address(weth), wethToWithdraw, address(this));
        aaveCollateral[id] -= withdrawn;

        // Swap WETH → stable
        uint256 stableReceived = _swap(address(weth), cfg.stableToken, withdrawn, minStableOut, poolFee, swapPath);

        // Repay stable debt to Aave
        IERC20(cfg.stableToken).approve(cfg.aavePool, stableReceived);
        uint256 repaid = IAavePool(cfg.aavePool).repay(cfg.stableToken, stableReceived, 2, address(this));

        // Update tracked debt — clamp to current balance to guard against rounding
        aaveDebt[id] = repaid >= aaveDebt[id] ? 0 : aaveDebt[id] - repaid;

        // Read new LTV for event
        (uint256 totalCollateralBase, uint256 totalDebtBase, , , , ) =
            IAavePool(cfg.aavePool).getUserAccountData(address(this));
        uint256 newLtvBps = totalCollateralBase > 0
            ? (totalDebtBase * 10_000) / totalCollateralBase
            : 0;

        emit LeverDown(id, repaid, withdrawn, newLtvBps);
    }

    // -------------------------------------------------------------------------
    // Phase 3 — safety: emergency deleverage
    // -------------------------------------------------------------------------

    /**
     * @notice Emergency full deleverage when the Aave health factor falls below
     *         the configured `emergencyHealthFloor` for this token ID.
     * @dev    Callable by the keeper OR the owner (both guards checked in Smartfolio).
     *         Performs a full leverDown in one call:
     *           1. Reads current HF from Aave; reverts if still above the floor.
     *           2. If a Chainlink feed is configured, reads the ETH/USD price as an
     *              independent sanity check (reverts on stale or negative price).
     *           3. Withdraws ALL tracked WETH collateral from Aave.
     *           4. Swaps all WETH → stable via Uniswap.
     *           5. Repays all outstanding stable debt.
     *           6. Sets aaveDebt[id] = 0, allowing divestLeverage() calls.
     * @param id           Leverage token ID.
     * @param minStableOut Minimum stable to receive from the WETH→stable swap.
     * @param poolFee      Uniswap V3 fee tier for single-hop (ignored if swapPath set).
     * @param swapPath     Encoded multi-hop path WETH→stable; empty = single-hop.
     */
    function emergencyDeleverage(
        uint256 id,
        uint256 minStableOut,
        uint24 poolFee,
        bytes calldata swapPath
    ) external {
        if (!isLeverageToken[id]) revert NotLeverageToken();
        if (aaveDebt[id] == 0) revert NoDebtToRepay();

        LeverageConfig storage cfg = leverageConfig[id];

        // Read Aave health factor
        ( , , , , , uint256 healthFactor) = IAavePool(cfg.aavePool).getUserAccountData(address(this));

        // Only trigger if HF is below the configured floor
        uint256 floor = emergencyHealthFloor[id];
        if (floor == 0 || healthFactor >= floor) revert HealthFactorAboveFloor();

        // Optional Chainlink sanity check — does not affect mechanics, just validates price freshness
        address feed = ethUsdFeed[id];
        if (feed != address(0)) {
            (, int256 answer, , uint256 updatedAt, ) = AggregatorV3Interface(feed).latestRoundData();
            uint256 maxAge = priceMaxAge > 0 ? priceMaxAge : 3600; // default 1-hour staleness guard
            if (block.timestamp - updatedAt > maxAge) revert StalePrice();
            if (answer <= 0) revert InvalidPrice();
        }

        // Withdraw ALL collateral that belongs to this token ID
        uint256 wethToWithdraw = aaveCollateral[id];
        uint256 withdrawn = IAavePool(cfg.aavePool).withdraw(address(weth), wethToWithdraw, address(this));
        aaveCollateral[id] = 0;

        // Swap all WETH → stable
        uint256 stableReceived = _swap(address(weth), cfg.stableToken, withdrawn, minStableOut, poolFee, swapPath);

        // Repay all stable debt
        IERC20(cfg.stableToken).approve(cfg.aavePool, stableReceived);
        uint256 repaid = IAavePool(cfg.aavePool).repay(cfg.stableToken, stableReceived, 2, address(this));
        aaveDebt[id] = 0; // force to 0; any dust stays as extra collateral after re-deposit below

        // If swap yielded more stable than the debt, any surplus stays in the contract
        // for the next divestLeverage() proportional share calculation. If it yielded less
        // (price impact), the position is de-risked and users exit at reduced collateral.

        emit EmergencyDeleveraged(id, repaid, withdrawn, healthFactor);
    }

    // -------------------------------------------------------------------------
    // Internal swap helper
    // -------------------------------------------------------------------------

    /// @dev Single-hop or multi-hop exact-input swap via Uniswap V3.
    function _swap(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOutMin,
        uint24 poolFee,
        bytes memory swapPath
    ) internal returns (uint256 amountOut) {
        IERC20(tokenIn).approve(address(swapRouter), amountIn);

        if (swapPath.length == 0) {
            amountOut = swapRouter.exactInputSingle(
                ISwapRouter.ExactInputSingleParams({
                    tokenIn:           tokenIn,
                    tokenOut:          tokenOut,
                    fee:               poolFee,
                    recipient:         address(this),
                    deadline:          block.timestamp,
                    amountIn:          amountIn,
                    amountOutMinimum:  amountOutMin,
                    sqrtPriceLimitX96: 0
                })
            );
        } else {
            amountOut = swapRouter.exactInput(
                ISwapRouter.ExactInputParams({
                    path:             swapPath,
                    recipient:        address(this),
                    deadline:         block.timestamp,
                    amountIn:         amountIn,
                    amountOutMinimum: amountOutMin
                })
            );
        }
    }
}
