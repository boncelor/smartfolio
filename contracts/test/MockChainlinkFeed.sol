// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @dev Mock Chainlink V3 aggregator for testing.
 *      Returns a configurable ETH/USD price (8 decimals, e.g. 3000e8 = $3000).
 *      updatedAt is set to block.timestamp at construction and can be overridden.
 */
contract MockChainlinkFeed {
    int256 public price;
    uint256 public updatedAt;

    constructor(int256 _price) {
        price     = _price;
        updatedAt = block.timestamp;
    }

    function setPrice(int256 _price) external {
        price     = _price;
        updatedAt = block.timestamp;
    }

    /// @dev Set updatedAt to a past timestamp to simulate a stale feed.
    function setUpdatedAt(uint256 _updatedAt) external {
        updatedAt = _updatedAt;
    }

    function decimals() external pure returns (uint8) {
        return 8;
    }

    function latestRoundData() external view returns (
        uint80 roundId,
        int256 answer,
        uint256 startedAt,
        uint256 updatedAt_,
        uint80 answeredInRound
    ) {
        roundId         = 1;
        answer          = price;
        startedAt       = updatedAt;
        updatedAt_      = updatedAt;
        answeredInRound = 1;
    }
}
