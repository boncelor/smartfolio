// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./SmartfolioToken.sol";

/**
 * @title SmartfolioTokenFactory
 * @notice Deploys and tracks ERC20 wrappers for Smartfolio ERC1155 token IDs.
 *
 * Only the owner can deploy wrappers. One wrapper per token ID is enforced.
 * After deployment, the wrapper address is permanent — it cannot be replaced or removed.
 */
contract SmartfolioTokenFactory is Ownable {

    error WrapperAlreadyDeployed(uint256 id);
    error ZeroAddress();

    event WrapperDeployed(uint256 indexed id, address wrapper, string name, string symbol);

    /// @notice Smartfolio proxy address this factory is bound to.
    address public immutable smartfolio;

    /// @notice token ID → deployed ERC20 wrapper address (address(0) if none).
    mapping(uint256 => address) public wrappers;

    constructor(address _smartfolio, address _owner) Ownable(_owner) {
        if (_smartfolio == address(0)) revert ZeroAddress();
        smartfolio = _smartfolio;
    }

    // -------------------------------------------------------------------------
    // Deployment
    // -------------------------------------------------------------------------

    /// @notice Deploy an ERC20 wrapper for `id`. Reverts if one already exists.
    /// @param id     Smartfolio ERC1155 token ID to wrap.
    /// @param name   ERC20 token name  (e.g. "Smartfolio ETH Fund").
    /// @param symbol ERC20 token symbol (e.g. "sfETH").
    /// @return wrapper Address of the newly deployed SmartfolioToken contract.
    function deploy(
        uint256 id,
        string calldata name,
        string calldata symbol
    ) external onlyOwner returns (address wrapper) {
        if (wrappers[id] != address(0)) revert WrapperAlreadyDeployed(id);

        SmartfolioToken token = new SmartfolioToken(smartfolio, id, name, symbol);
        wrapper = address(token);
        wrappers[id] = wrapper;

        emit WrapperDeployed(id, wrapper, name, symbol);
    }
}
