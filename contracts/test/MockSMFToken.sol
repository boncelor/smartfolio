// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @dev Minimal mock SMF bonding curve token for portfolio deploy/divest tests.
///      Fixed 1:1 ETH↔SMF rate (1 SMF = 1 wei) for predictable test assertions.
contract MockSMFToken {
    mapping(address => uint256) private _balances;

    /// @notice Buy SMF tokens for ETH at a 1:1 rate (1 wei ETH → 1 wei SMF).
    ///         `minAmount` is the minimum SMF to receive (slippage guard); at 1:1 it equals msg.value.
    function buySMF(uint256 minAmount) external payable {
        uint256 smfOut = msg.value; // 1 wei ETH ↔ 1 wei SMF
        require(smfOut >= minAmount, "MockSMFToken: slippage");
        _balances[msg.sender] += smfOut;
    }

    /// @notice Sell `amount` SMF tokens for ETH (1:1 rate).
    function sellSMF(uint256 amount, uint256 minEthOut) external {
        require(_balances[msg.sender] >= amount, "MockSMFToken: insufficient balance");
        require(amount >= minEthOut, "MockSMFToken: slippage");
        _balances[msg.sender] -= amount;
        (bool ok, ) = msg.sender.call{value: amount}("");
        require(ok, "MockSMFToken: ETH transfer failed");
    }

    function balanceOf(address account) external view returns (uint256) {
        return _balances[account];
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(_balances[msg.sender] >= amount, "MockSMFToken: insufficient balance");
        _balances[msg.sender] -= amount;
        _balances[to] += amount;
        return true;
    }

    function approve(address, uint256) external pure returns (bool) { return true; }

    /// @dev Test helper: forward a mintFunded call to a Smartfolio proxy (msg.sender = this contract = smfContract).
    function mintFundedOnBehalf(address smartfolio, address to, uint256 id, uint256 amount) external payable {
        (bool ok, ) = smartfolio.call{value: msg.value}(
            abi.encodeWithSignature("mintFunded(address,uint256,uint256)", to, id, amount)
        );
        require(ok, "MockSMFToken: mintFunded failed");
    }

    /// @dev Fund the mock with ETH so it can pay out on sellSMF.
    receive() external payable {}
}
