// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @dev Mock Aave V3 Pool for testing.
 *
 *  - supply(): pulls asset tokens from caller via transferFrom.
 *  - withdraw(): transfers asset tokens to `to`; returns amount withdrawn.
 *  - getUserAccountData(): returns no debt and max health factor.
 *
 *  Pre-fund this contract with any asset it needs to hand back on withdraw.
 *  Since supply() moves tokens here from the contract, no pre-funding is needed
 *  for the basic mint → divest round-trip.
 */
contract MockAavePool {
    /// @dev Accept collateral from the caller.
    function supply(address asset, uint256 amount, address, uint16) external {
        IERC20(asset).transferFrom(msg.sender, address(this), amount);
    }

    /// @dev Borrow not implemented in Phase 1.
    function borrow(address, uint256, uint256, uint16, address) external pure {
        revert("MockAavePool: borrow not implemented");
    }

    /// @dev Repay not implemented in Phase 1.
    function repay(address, uint256, uint256, address) external pure returns (uint256) {
        revert("MockAavePool: repay not implemented");
    }

    /// @dev Return collateral to `to`.
    function withdraw(address asset, uint256 amount, address to) external returns (uint256) {
        IERC20(asset).transfer(to, amount);
        return amount;
    }

    /// @dev Returns no debt and the maximum health factor (no liquidation risk).
    function getUserAccountData(address) external pure returns (
        uint256 totalCollateralBase,
        uint256 totalDebtBase,
        uint256 availableBorrowsBase,
        uint256 currentLiquidationThreshold,
        uint256 ltv,
        uint256 healthFactor
    ) {
        totalCollateralBase        = 0;
        totalDebtBase              = 0;
        availableBorrowsBase       = 0;
        currentLiquidationThreshold = 8000; // 80% — standard Aave WETH value
        ltv                        = 0;
        healthFactor               = type(uint256).max; // no debt → infinite HF
    }
}
