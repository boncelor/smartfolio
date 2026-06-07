// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @dev Stateful mock Aave V3 Pool for testing.
 *
 *  Tracks total WETH supplied and total stable borrowed across all callers
 *  (single-borrower assumption — only the Smartfolio contract interacts here).
 *  Uses 1:1 token-unit pricing for LTV calculations.
 *
 *  Pre-fund this contract with:
 *    - stableToken for Phase 2 borrow() calls
 *  MockSwapRouter should be pre-funded with:
 *    - WETH for leverUp (stable→WETH swap)
 *    - stable for leverDown (WETH→stable swap)
 */
contract MockAavePool {
    uint256 public totalSupplied; // WETH units deposited as collateral
    uint256 public totalBorrowed; // stable units outstanding

    /// @dev Accept collateral; pull from caller.
    function supply(address asset, uint256 amount, address, uint16) external {
        IERC20(asset).transferFrom(msg.sender, address(this), amount);
        totalSupplied += amount;
    }

    /// @dev Lend stable to caller (variable rate). Pool must hold enough stable.
    function borrow(address asset, uint256 amount, uint256, uint16, address) external {
        totalBorrowed += amount;
        IERC20(asset).transfer(msg.sender, amount);
    }

    /// @dev Repay stable debt. Pulls from caller; clamps to outstanding debt.
    function repay(address asset, uint256 amount, uint256, address) external returns (uint256 repaid) {
        repaid = amount > totalBorrowed ? totalBorrowed : amount;
        IERC20(asset).transferFrom(msg.sender, address(this), repaid);
        totalBorrowed -= repaid;
    }

    /// @dev Return collateral to `to`. Reverts via underflow if over-withdrawn.
    function withdraw(address asset, uint256 amount, address to) external returns (uint256) {
        totalSupplied -= amount; // SafeMath underflow reverts if > supplied
        IERC20(asset).transfer(to, amount);
        return amount;
    }

    /**
     * @dev Returns aggregate position data assuming 1:1 token-unit pricing.
     *
     *  healthFactor = totalSupplied × liquidationThreshold / totalBorrowed
     *               = totalSupplied × 0.8 / totalBorrowed   (in 1e18 units)
     *  If no debt: healthFactor = type(uint256).max.
     */
    function getUserAccountData(address) external view returns (
        uint256 totalCollateralBase,
        uint256 totalDebtBase,
        uint256 availableBorrowsBase,
        uint256 currentLiquidationThreshold,
        uint256 ltv,
        uint256 healthFactor
    ) {
        totalCollateralBase        = totalSupplied;
        totalDebtBase              = totalBorrowed;
        currentLiquidationThreshold = 8000;
        ltv                        = totalSupplied > 0
            ? (totalBorrowed * 10_000) / totalSupplied
            : 0;
        availableBorrowsBase       = totalSupplied > totalBorrowed
            ? totalSupplied - totalBorrowed
            : 0;
        healthFactor               = totalBorrowed == 0
            ? type(uint256).max
            : (totalSupplied * 8000 * 1e18) / (totalBorrowed * 10_000);
    }
}
