// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @dev WETH9 simulation: deposit wraps ETH 1:1, withdraw unwraps ETH 1:1.
contract MockWETH is ERC20 {
    constructor() ERC20("Wrapped Ether", "WETH") {}

    /// @dev Wrap ETH → WETH.
    function deposit() external payable {
        _mint(msg.sender, msg.value);
    }

    /// @dev Unwrap WETH → ETH.
    function withdraw(uint256 amount) external {
        _burn(msg.sender, amount);
        (bool ok, ) = msg.sender.call{value: amount}("");
        require(ok, "MockWETH: ETH transfer failed");
    }

    receive() external payable {
        _mint(msg.sender, msg.value);
    }
}
