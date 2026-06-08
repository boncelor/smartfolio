// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";
import "@openzeppelin/contracts/token/ERC1155/IERC1155Receiver.sol";
import "@openzeppelin/contracts/utils/introspection/ERC165.sol";

/// @dev Minimal interface to query token-type state on the Smartfolio proxy.
interface ISmartfolioGuard {
    function isLeverageToken(uint256 id) external view returns (bool);
    function portfolioActive(uint256 id) external view returns (bool);
}

/**
 * @title SmartfolioToken
 * @notice ERC20 wrapper for a single Smartfolio ERC1155 token ID.
 *
 * Wrapping:
 *   1. Approve this contract as an ERC1155 operator on the Smartfolio proxy.
 *   2. Call wrap(amount)  — or — call smartfolio.safeTransferFrom(..., wrapper, ...) directly.
 *      Either path triggers onERC1155Received, which mints ERC20 1:1 to the depositor.
 *
 * Unwrapping:
 *   Call unwrap(amount). Burns ERC20 and returns the ERC1155 tokens to the caller.
 *
 * Safety: leverage tokens and portfolio-active tokens are rejected on deposit.
 * These token types have non-standard redemption paths (divestLeverage / divest)
 * that the ERC20 layer does not support, making them unsafe to wrap.
 *
 * One wrapper contract per token ID. Batch transfers to this contract are rejected.
 */
contract SmartfolioToken is ERC20, ERC165, IERC1155Receiver {

    error WrongContract();
    error WrongTokenId();
    error BatchTransferNotSupported();
    error LeverageTokenNotWrappable();
    error PortfolioTokenNotWrappable();

    event Wrapped(address indexed account, uint256 amount);
    event Unwrapped(address indexed account, uint256 amount);

    IERC1155 public immutable smartfolio;
    uint256  public immutable tokenId;

    constructor(
        address _smartfolio,
        uint256 _tokenId,
        string memory _name,
        string memory _symbol
    ) ERC20(_name, _symbol) {
        smartfolio = IERC1155(_smartfolio);
        tokenId    = _tokenId;
    }

    // -------------------------------------------------------------------------
    // Wrap / Unwrap
    // -------------------------------------------------------------------------

    /// @notice Deposit `amount` ERC1155 tokens and receive ERC20 1:1.
    ///         Caller must have approved this contract on the Smartfolio ERC1155.
    function wrap(uint256 amount) external {
        // safeTransferFrom triggers onERC1155Received, which mints the ERC20.
        smartfolio.safeTransferFrom(msg.sender, address(this), tokenId, amount, "");
    }

    /// @notice Burn `amount` ERC20 and receive ERC1155 tokens back.
    function unwrap(uint256 amount) external {
        _burn(msg.sender, amount);
        smartfolio.safeTransferFrom(address(this), msg.sender, tokenId, amount, "");
        emit Unwrapped(msg.sender, amount);
    }

    // -------------------------------------------------------------------------
    // IERC1155Receiver
    // -------------------------------------------------------------------------

    /// @dev Called by the Smartfolio ERC1155 on safeTransferFrom to this contract.
    ///      Mints ERC20 to the original token owner (`from`).
    function onERC1155Received(
        address,
        address from,
        uint256 id,
        uint256 amount,
        bytes calldata
    ) external override returns (bytes4) {
        if (msg.sender != address(smartfolio)) revert WrongContract();
        if (id != tokenId)                     revert WrongTokenId();

        ISmartfolioGuard sf = ISmartfolioGuard(address(smartfolio));
        if (sf.isLeverageToken(id))  revert LeverageTokenNotWrappable();
        if (sf.portfolioActive(id))  revert PortfolioTokenNotWrappable();

        _mint(from, amount);
        emit Wrapped(from, amount);
        return IERC1155Receiver.onERC1155Received.selector;
    }

    /// @dev Batch transfers to this contract are not supported — each wrapper is single-ID.
    function onERC1155BatchReceived(
        address,
        address,
        uint256[] calldata,
        uint256[] calldata,
        bytes calldata
    ) external pure override returns (bytes4) {
        revert BatchTransferNotSupported();
    }

    // -------------------------------------------------------------------------
    // ERC165
    // -------------------------------------------------------------------------

    function supportsInterface(bytes4 interfaceId)
        public view override(ERC165, IERC165)
        returns (bool)
    {
        return
            interfaceId == type(IERC1155Receiver).interfaceId ||
            super.supportsInterface(interfaceId);
    }
}
