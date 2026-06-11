# Smartfolio Internal Audit Report

**Date:** 2026-06-11
**Commit:** `145c9ca`
**Scope:** All Solidity contracts in `contracts/`
**Auditor:** Internal review (Claude Code)

---

## Scope

| Contract | Status | Notes |
|----------|--------|-------|
| `SmartfolioBase.sol` | Reviewed | Shared storage + internal logic |
| `Smartfolio.sol` | Reviewed | UUPS proxy, admin setters, view layer |
| `SmartfolioTreasury.sol` | Reviewed | Bonding curve mint/burn facet |
| `SmartfolioERC20.sol` | Reviewed | SMF bonding curve ERC20 |
| `SmartfolioMarket.sol` | Reviewed | Portfolio deploy/divest facet |
| `SmartfolioCreditMarket.sol` | Reviewed | Leverage facet |
| `SmartfolioLiquidityMarket.sol` | Reviewed | Uniswap V3 LP facet |
| `SmartfolioToken.sol` | Reviewed | ERC20 wrapper |
| `SmartfolioTokenFactory.sol` | Reviewed | Wrapper factory |
| `MockV3Aggregator.sol` | Skipped | Test-only mock |

---

## Summary

| Severity | Count |
|----------|-------|
| Critical | 2 (both fixed) |
| High | 3 (1 fixed, 2 false positives closed) |
| Medium | 4 (all fixed) |
| Low | 1 (2 false positives closed) |
| Info | 2 |

---

## Critical

### C-1 — ~~Delegatecall Reentrancy Guard Hardcodes Storage Slot 0~~ ✓ Fixed

**File:** `Smartfolio.sol:79`

The `_delegateTo` assembly block manually resets the reentrancy guard by writing `1` directly to storage slot 0:

```solidity
sstore(0, 1) // Reset _reentrancyStatus to _NOT_ENTERED
```

This works today because `_reentrancyStatus` is the first declared variable in `SmartfolioBase` and lands at slot 0. However:

- OZ upgradeable base contracts use EIP-7201 namespaced storage. If any OZ base contract is updated to prepend state before the custom slots, or if a new base contract is added to the inheritance chain, slot 0 will shift and `sstore(0, 1)` will silently corrupt an unrelated variable.
- The assumption is undocumented, making it easy to break during a future upgrade.

**Recommendation:** Replace the custom reentrancy guard with `ReentrancyGuardUpgradeable` from OpenZeppelin, which uses EIP-7201 namespaced storage and is upgrade-safe. Add a test that asserts `_reentrancyStatus` is at slot 0 as a stopgap until the migration is done.

---

### C-2 — ~~Multi-ID Leverage Positions Share a Single Aave Account~~ ✓ Fixed

**File:** `SmartfolioCreditMarket.sol`, `SmartfolioBase.sol:308-309`

Aave tracks collateral and debt per address. The Smartfolio proxy has a **single** Aave account shared across all leverage token IDs. The contract keeps per-ID accounting (`aaveCollateral[id]`, `aaveDebt[id]`) but calls `getUserAccountData(address(this))` to read health factor and LTV — which returns the aggregate across all IDs.

Consequences:
- `checkLtv(id)` and `getHealthFactor(id)` return the aggregate position, not the per-ID position. This is misleading but tolerable if only one leverage ID is ever active.
- If two leverage IDs are active simultaneously, borrowing on one affects the health factor seen by the other. The `LtvCapExceeded` check in `leverUp` can be bypassed: add collateral to ID 1 (lowers aggregate LTV), then borrow on ID 2 up to the newly available headroom.
- `emergencyDeleverage` reads `aaveCollateral[id]` and `emergencyHealthFloor[id]` per-ID but the health factor it checks is aggregate — the trigger may fire for the wrong ID or not fire when needed.

**Recommendation:** Either enforce a single active leverage ID at any time (simplest fix — add a `activeLeverageId` state variable and validate it), or redesign to use per-ID Aave sub-accounts (complex, likely out of scope). Document the single-ID assumption clearly if the simple fix is chosen.

---

## High

### H-1 — ~~Chainlink Staleness Not Enforced in View Functions~~ ✓ Fixed

**File:** `Smartfolio.sol:496-501`, `Smartfolio.sol:543-549`

`priceMaxAge` and its staleness check are applied only in `SmartfolioCreditMarket.emergencyDeleverage()`. The view functions `getLeverageInfo()` and `simulateLeverUp()` read the Chainlink feed but skip the staleness check entirely:

```solidity
try AggregatorV3Interface(feed).latestRoundData() returns (
    uint80, int256 answer, uint256, uint256, uint80
) {
    if (answer > 0) info.ethPriceUsd = uint256(answer);
} catch {}
```

The `updatedAt` timestamp is discarded. Stale prices silently propagate to the frontend and any off-chain keeper logic that calls these views.

**Recommendation:** Extract a `_getEthPrice(address feed)` helper that validates staleness (already done in `SmartfolioERC20`) and use it in both view functions. Initialize `priceMaxAge` to `3600` in `Smartfolio.initialize()` rather than defaulting to 0.

---

### H-2 — ~~Last Burner Rounding Dust in `burn()`~~ ✓ Fixed

**File:** `SmartfolioBase.sol:424-436`, `SmartfolioTreasury.sol:55-80`

The gross refund is calculated as:

```solidity
gross = (amount * reserve[id]) / supply;
```

When multiple users burn in sequence, integer division accumulates rounding losses. The last user to burn (when `supply == amount`) receives exactly `reserve[id]` due to the division, so no dust is lost in that final call. However, this is only true for the final burner of a given ID. If several users burn partial amounts, each rounding loss stays in `reserve[id]` permanently — there is no sweep mechanism.

In practice this is small (sub-wei per burn), but over thousands of burns on a high-supply token it compounds. More critically, `reserve[id]` never reaches zero unless a single holder burns the entire supply in one transaction, which means `portfolioActive` and `lpActive` guards based on `reserve[id] == 0` should not be assumed.

**Recommendation:** No urgent code change needed, but document the rounding behaviour. Consider adding a `sweepDust(id)` owner function that sends the remaining `reserve[id]` to treasury when `totalSupply[id] == 0`.

---

### H-3 — ~~Chainlink Feed Decimal Assumption in `SmartfolioERC20`~~ ✓ Fixed

**File:** `SmartfolioERC20.sol:218`, `SmartfolioERC20.sol:285`

The NFT floor price and SMF-for-ETH calculations assume the Chainlink feed has exactly 8 decimals:

```solidity
uint256 ethNeeded = (NFT_FLOOR_USD * 1e8) / ethPrice;
```

The ETH/USD feed is indeed 8 decimals, but this is not validated on-chain. If the owner ever sets a different feed (e.g., an ETH/EUR feed with different decimals), the calculation silently produces wrong prices.

**Recommendation:** Call `feed.decimals()` during `setEthUsdFeed()` and revert if it is not 8, or store the decimals and adjust the formula dynamically.

---

## Medium

### M-1 — ~~`setTreasury` Accepts the Zero Address~~ ✓ Fixed

**File:** `Smartfolio.sol:217-220`

```solidity
function setTreasury(address _treasury) external onlyOwner {
    treasury = _treasury; // no zero-address guard
}
```

If called with `address(0)`, the burn fee is silently dropped: `reserve[id]` is reduced by `net + fee` but only `net` is sent out, with the `fee` portion being burned. The ETH is not recoverable.

**Recommendation:** Add `if (_treasury == address(0)) revert ZeroAddress();`.

---

### M-2 — ~~No Cap on Tier and Portfolio Asset Array Lengths~~ ✓ Fixed

**File:** `Smartfolio.sol:198-208` (setTiers), `Smartfolio.sol:274-301` (setPortfolioConfig)

Both setters accept unbounded arrays. `_mintCost` and `deploy`/`divest` loop over these arrays. A malicious or mistaken owner configuration with hundreds of entries could cause out-of-gas reverts for users attempting to mint or exit.

**Recommendation:** Add `require(tiers.length <= 20)` and `require(assets.length <= 10)` (or similar reasonable caps).

---

### M-3 — ~~Zero-Amount Swap Output Not Checked After Rebalance~~ ✓ Fixed

**File:** `SmartfolioMarket.sol` (rebalance loop)

Swap functions return the actual `amountOut`, which is added to `portfolioHoldings[id][token]`. If `amountOutMin` is set to 0 by the keeper (permitted), a swap could complete with zero output, silently crediting 0 tokens to holdings while debiting WETH from the reserve.

**Recommendation:** Add a post-swap check: `if (amountOut == 0) revert AmountZero();`.

---

### M-4 — ~~Facet Addresses Can Be Hot-Swapped Without Migration Guard~~ ✓ Fixed

**File:** `Smartfolio.sol:354-376`

`setTreasuryFacet`, `setMarketFacet`, etc. take immediate effect. A facet upgrade while a delegatecall is in-flight (in the same block, different transaction) will use the new facet logic against state written by the old facet. There is no version check and no pause-before-upgrade enforcement.

**Recommendation:** Require `pause()` before any facet swap, and `unpause()` after. This is a process control recommendation — no code change strictly required if the deployment process enforces it.

---

## Low

### L-1 — ~~`simulateLeverUp` Reads `liquidationThreshold` But Does Not Use It~~

**Status: False positive — closed.**

`liquidationThreshold` is used correctly in the health factor formula. No action needed.

---

### L-2 — `burn()` Does Not Emit a Separate Event for Treasury Fee Transfer

**File:** `SmartfolioTreasury.sol:74-80`

The `Burned` event is emitted before the ETH transfers. If the treasury transfer fails and reverts, the event was never actually committed (reverts unwind the whole transaction), so this is not a correctness issue. However, there is no dedicated event for fee routing, making it harder to track treasury income off-chain.

**Recommendation:** Emit a `FeeSent(address treasury, uint256 amount)` event after the treasury transfer succeeds.

---

### L-3 — ~~`SmartfolioTokenFactory` Has No Ownership Transfer Path~~

**Status: False positive — closed.**

`SmartfolioTokenFactory` inherits OZ's `Ownable` which already exposes `transferOwnership` and `renounceOwnership`. No action needed.

---

## Info

### I-1 — Single-ID Leverage Assumption Should Be Documented

The multi-ID Aave issue (C-2) is manageable if the protocol enforces only one active leverage ID at a time. This constraint should be documented explicitly in the contract NatDoc and in any user-facing docs. If the plan is to support multiple leverage IDs in the future, a redesign is needed before launch.

---

### I-2 — `MockV3Aggregator` Has No Access Control

**File:** `MockV3Aggregator.sol`

`setAnswer()` and `setUpdatedAt()` are publicly callable by anyone. Acceptable for tests; must never be deployed to mainnet. Recommend adding a compile-time guard (`// @dev TEST ONLY — never deploy`) or moving it to a `test/mocks/` directory.

---

## Out of Scope / Won't Fix

| Item | Reason |
|------|--------|
| ETH "trapped" in SmartfolioERC20 | The contract's ETH balance IS the bonding curve reserve backing SMF tokens. It is not stuck — it backs user claims via `sellSMF`. A withdrawal function would be a rug vector. |
| Portfolio + leverage type collision | Already guarded at the setter level (`isLeverageToken[id]` checks in `setPortfolioConfig` and vice versa). |
| Hardcoded Aave interest rate mode 2 | Intentional design choice (variable rate only). |
| Rounding in per-instruction rebalance slippage | Keeper-controlled operation with explicit per-instruction `amountOutMin`. |

---

## Contracts Status

| Contract | Completeness | Risk Level | Notes |
|----------|-------------|------------|-------|
| `SmartfolioERC20.sol` | ~90% | Medium | Solid bonding curve; H-3 feed decimal check missing |
| `SmartfolioTreasury.sol` | ~90% | Low | Simple and correct; dust accumulation is cosmetic |
| `SmartfolioToken.sol` | ~95% | Low | Clean ERC20 wrapper |
| `SmartfolioTokenFactory.sol` | ~95% | Low | Minimal; verify ownership transfer |
| `Smartfolio.sol` | ~80% | Medium | C-1 slot 0 issue; H-1 staleness in views |
| `SmartfolioBase.sol` | ~80% | Medium | C-1 origin; storage layout is critical |
| `SmartfolioMarket.sol` | ~70% | Medium | M-3 zero-output check missing; otherwise functional |
| `SmartfolioCreditMarket.sol` | ~60% | High | C-2 multi-ID Aave aggregation is the key risk |
| `SmartfolioLiquidityMarket.sol` | ~65% | Medium | Functional but not fully stress-tested |

---

## Recommended Fix Priority

1. **C-1** — Migrate reentrancy guard to `ReentrancyGuardUpgradeable` before any mainnet upgrade
2. **C-2** — Enforce single active leverage ID or document the constraint prominently
3. **H-1** — Add staleness check to `getLeverageInfo` and `simulateLeverUp`
4. **M-1** — Add zero-address guard to `setTreasury`
5. **H-3** — Validate Chainlink feed decimals on setup
6. **M-2** — Cap tier and asset array lengths
7. **M-3** — Check swap output is non-zero in rebalance
