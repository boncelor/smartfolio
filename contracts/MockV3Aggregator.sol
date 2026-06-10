// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @dev Minimal mock Chainlink AggregatorV3 for testing.
contract MockV3Aggregator {
    int256 private _answer;
    uint256 private _updatedAt;

    constructor(int256 initialAnswer) {
        _answer = initialAnswer;
        _updatedAt = block.timestamp;
    }

    function setAnswer(int256 answer) external {
        _answer = answer;
        _updatedAt = block.timestamp;
    }

    function setUpdatedAt(uint256 updatedAt) external {
        _updatedAt = updatedAt;
    }

    function latestRoundData()
        external view
        returns (uint80, int256 answer, uint256, uint256 updatedAt, uint80)
    {
        return (1, _answer, block.timestamp, _updatedAt, 1);
    }
}
