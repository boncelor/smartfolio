# Smartfolio — Technical Whitepaper

---

## Abstract

Smartfolio is an on-chain portfolio protocol built on Ethereum. It issues ERC1155 tokens where each token ID represents a distinct financial instrument. Four instrument types are supported: Standard bonding-curve tokens, Portfolio tokens whose reserves are deployed into a mixed basket of ERC20 assets (Uniswap V3 swaps), Aave V3 collateral deposits, and/or Uniswap V3 LP positions in any combination, LP tokens whose reserves are provided as concentrated liquidity into a single Uniswap V3 pool, and Leverage tokens whose reserves are held as WETH collateral on Aave V3. All instruments are optionally wrappable into standard ERC20 tokens to unlock DeFi composability.

The protocol is deployed as a single UUPS upgradeable proxy backed by a delegatecall facet architecture, keeping each contract under the EVM's 24 KB bytecode limit while sharing a single storage and ETH context.

---

## 1. Architecture

Smartfolio uses a **delegatecall facet pattern**. A single ERC1967 proxy holds all ETH and storage. The main contract (`Smartfolio.sol`) applies security guards and routes mutating calls via `delegatecall` to four specialised facets:

| Facet | Responsibility |
|---|---|
| `SmartfolioTreasury` | Bonding curve mint and burn |
| `SmartfolioMarket` | Uniswap V3 portfolio deploy, rebalance, divest |
| `SmartfolioLiquidityMarket` | Uniswap V3 LP position deploy, fee collection, divest |
| `SmartfolioCreditMarket` | Aave V3 leverage mint and divest |

Guards (`nonReentrant`, `whenNotPaused`) are applied at the proxy entry point before each delegatecall. Because `delegatecall` with assembly `return` bypasses Solidity modifier teardown, the reentrancy guard slot is explicitly reset in assembly before returning.

Upgrading a single facet requires only deploying a new contract and calling the corresponding setter — no proxy upgrade needed.

---

## 2. Minting

### 2.1 Step-Tier Pricing

Pricing is governed by a single global tier array. A tier defines a threshold and a price per token in ETH. The final tier is open-ended.

```
Tier 0:  globalTotalSupply  0 –      99   →  0.001 ETH / token
Tier 1:  globalTotalSupply  100 –   999   →  0.01  ETH / token
Tier 2:  globalTotalSupply  1,000 – 9,999 →  0.1   ETH / token
Tier 3:  globalTotalSupply  10,000+       →  1.0   ETH / token
```

Tier position is determined by `globalTotalSupply` — the current live token supply across **all** token IDs. This has two important implications:

- **Shared price curve** — minting any token ID advances the price for every other token ID. All instruments compete for the same tier thresholds.
- **Burns lower the price** — because `globalTotalSupply` decreases when tokens are burned, a large burn can drop the tier position back to a cheaper level. This is by design: the price reflects actual circulating supply, not a one-way ratchet.

The mint cost function correctly handles orders that cross multiple tier boundaries in a single transaction.

### 2.2 Mint Flow

1. User calls `mint(account, id, amount)` with ETH attached.
2. The contract computes the exact cost by iterating tiers from the current `globalTotalSupply` position.
3. `msg.value` must be at least the computed cost; any excess is refunded.
4. `totalMinted[id]`, `totalSupply[id]`, `globalTotalMinted`, and `globalTotalSupply` increment by `amount`.
5. The cost (not `msg.value`) is added to `reserve[id]` — the ETH backing for this token.
6. ERC1155 tokens are minted to `account`.

### 2.3 Batch Minting

`mintBatch` mints across multiple token IDs in a single transaction. State is updated sequentially within a single loop: `totalMinted` and `totalSupply` are incremented after each ID, so duplicate IDs within the same batch correctly consume tier capacity in order.

---

## 3. Burning

### 3.1 Pro-Rata ETH Return

Burning returns a proportional share of that token ID's ETH reserve:

```
gross = (amount / totalSupply[id]) × reserve[id]
```

The ETH refund is always calculated per-ID — you receive your proportional share of that specific instrument's reserve, regardless of what other IDs exist.

### 3.2 Quadratic Exit Fee

The fee rate is calculated against the **global** supply:

```
feeRate = (amount / globalTotalSupply)² × maxBurnFeeRate
fee     = gross × feeRate
net     = gross − fee
```

The default `maxBurnFeeRate` is 50%. The hard cap is 80%.

Using `globalTotalSupply` rather than the per-ID supply means a burn that is small relative to the total circulating pool pays a proportionally lower fee. The fee reflects your impact on the protocol as a whole, not just on a single token ID.

**Examples at 50% maxBurnFeeRate (burning 10 tokens, globalTotalSupply = 100):**

| Proportion of global supply burned | Fee rate | Effect |
|---|---|---|
| 1% | 0.005% | Negligible |
| 10% | 0.5% | Minimal |
| 50% | 12.5% | Moderate |
| 100% | 50% | Capped |

### 3.3 Fee Routing

If a treasury address is configured, the fee ETH is forwarded there. Otherwise it remains in `reserve[id]`, increasing the backing per token for remaining holders.

### 3.4 Burn Restrictions

`burn()` is blocked when:
- `portfolioActive[id]` is true — holders must use `divest()`.
- `lpActive[id]` is true — holders must use `divestLP()`.
- `isLeverageToken[id]` is true — holders must use `divestLeverage()`.

---

## 4. ERC20 Wrapping

### 4.1 Motivation

ERC1155 tokens have limited native support in DeFi — most DEXes, lending protocols, and wallets are built for ERC20. Smartfolio provides a factory to deploy thin ERC20 wrappers that represent ERC1155 tokens 1:1, enabling composability without changing the core protocol.

### 4.2 Architecture

`SmartfolioTokenFactory` is an owner-controlled factory that deploys one `SmartfolioToken` (ERC20) per token ID. Each wrapper is bound to a specific `(proxy address, token ID)` pair and is immutable after deployment.

```
factory.deploy(id, "Smartfolio Fund 1", "SF1")
    └─ deploys SmartfolioToken(proxy, id, name, symbol)
    └─ records wrappers[id] = address
```

One wrapper per token ID is enforced — the factory reverts on duplicate deployment.

### 4.3 Wrapping

A user wraps by approving the wrapper as an ERC1155 operator, then calling `wrap(amount)`. Alternatively, they can call `safeTransferFrom` directly on the ERC1155 contract targeting the wrapper address — both paths produce the same result.

```
sf.setApprovalForAll(wrapperAddress, true)
wrapper.wrap(amount)
    └─ sf.safeTransferFrom(user → wrapper, id, amount)
           └─ onERC1155Received → ERC20._mint(user, amount)
```

ERC20 tokens are minted 1:1 to the depositor. The ERC1155 tokens are held by the wrapper contract.

### 4.4 Unwrapping

```
wrapper.unwrap(amount)
    └─ ERC20._burn(user, amount)
    └─ sf.safeTransferFrom(wrapper → user, id, amount)
```

The user receives their ERC1155 tokens back. No additional approval is required.

### 4.5 Safety Guards

The wrapper rejects deposits for three token types at the `onERC1155Received` level — covering both the `wrap()` path and direct `safeTransferFrom`:

- **Leverage tokens** (`isLeverageToken[id] == true`): their ETH is in Aave, not in `reserve[]`. Redemption requires `divestLeverage()`.
- **Portfolio-active tokens** (`portfolioActive[id] == true`): their reserve is deployed into an ERC20 basket. Redemption requires `divest()`.
- **LP-active tokens** (`lpActive[id] == true`): their reserve is in a Uniswap V3 LP position. Redemption requires `divestLP()`.

Only Standard bonding-curve tokens — where `burn()` cleanly returns ETH from `reserve[]` — are wrappable.

### 4.6 Composability

Once wrapped, the ERC20 token is a standard fungible token and can be:
- Listed on any ERC20 DEX (Uniswap, Curve, etc.)
- Used as collateral on lending protocols
- Held in any ERC20-compatible wallet or vault
- Transferred freely peer-to-peer

Unwrapping at any time returns the underlying ERC1155, which retains its full burn rights.

---

## 5. Portfolio Investment

### 5.1 Concept

A Portfolio token is a Standard token whose ETH reserve is deployed into a mixed basket of sub-strategies. Each asset slice specifies an `AssetType` that determines how its ETH allocation is deployed:

| `AssetType` | Strategy | Underlying |
|---|---|---|
| `ERC20` | Uniswap V3 token swap | ERC20 held by proxy |
| `AAVE` | Aave V3 collateral deposit | aWETH held by Aave (shared proxy account) |
| `LP` | Uniswap V3 LP position | Position NFT held by proxy |

A single portfolio can combine all three types in one basket.

### 5.2 Configuration

The owner defines a basket with per-asset weights (in basis points, summing to 10,000) and type-specific parameters:

```
setPortfolioConfig(id, [
  { assetType: ERC20, token: WBTC,  weightBps: 5000, poolFee: 3000, ... },
  { assetType: AAVE,  token: 0,     weightBps: 2000, ... },
  { assetType: LP,    token: USDC,  weightBps: 3000, poolFee: 500,
    swapFee: 500, tickLower: -887220, tickUpper: 887220, ... },
])
```

- **ERC20 slices** require `token` (target ERC20) and `poolFee` (Uniswap pool fee tier). Optional `swapPath`/`sellSwapPath` override single-hop with multi-hop routes.
- **AAVE slices** carry no additional parameters — WETH is deposited directly into Aave.
- **LP slices** require `token` (paired token), `poolFee` (LP pool fee tier), `swapFee` (router fee for the WETH→token swap), and `tickLower`/`tickUpper` (price range).

Weights across all slice types must sum to exactly 10,000 bps.

### 5.3 Lifecycle

```
1. Owner:  setPortfolioConfig(id, assets)                    — define basket
2. Owner:  setDefaultAavePool(pool)                          — required if any AAVE slice
3. User:   mint(alice, id, amount)                           — ETH → reserve[id]
4. Keeper: deploy(id, erc20MinAmounts, lpSwapMin, lp0Min, lp1Min)
                                                             — reserve ETH → basket
5. Keeper: rebalance(id, instructions)                       — ERC20 slices only
6. User:   divest(id, amount, minEthOut)                     — pro-rata basket → ETH
```

After `deploy()`, `portfolioActive[id]` is set to `true` and `reserve[id]` is zeroed. The five-parameter signature separates slippage guards by slice type: `erc20MinAmounts` is an array covering ERC20 slices in order; the three LP parameters guard the V3 position mint.

### 5.4 Deploying

The keeper calls `deploy(id, erc20MinAmounts, lpSwapAmountOutMin, lpAmount0Min, lpAmount1Min)`:

1. The entire `reserve[id]` is wrapped to WETH.
2. Assets are processed in order. The last asset receives all remaining WETH (no rounding dust).
3. Per-slice dispatch:
   - **ERC20**: swaps the allocated WETH to `token` via Uniswap V3 using `erc20MinAmounts[i]`.
   - **AAVE**: deposits allocated WETH into Aave V3 via the shared proxy account (`defaultAavePool`). `portfolioAaveWeth[id]` records the deposited amount for per-ID accounting.
   - **LP**: swaps half the allocated WETH to `token` via the swap router (`lpSwapAmountOutMin`), then mints a Uniswap V3 position (`lpAmount0Min`, `lpAmount1Min`). The position NFT is held by the proxy. Any token amounts unused by the position manager (current price ratio mismatch) are unwrapped back to ETH and added to `reserve[id]` as leftover.
4. `portfolioActive[id]` is set to `true`.

### 5.5 Shared Aave Account (B2 Model)

All AAVE slices across all portfolio IDs, plus all standalone Leverage tokens, share a single Aave account at the proxy address. This means:

- There is **one aggregate health factor** for the entire proxy's Aave position.
- `portfolioAaveWeth[id]` tracks per-ID deposited WETH for proportional withdrawal, but does not isolate health risk.
- A sufficiently large borrow on one leverage token will affect the health factor seen by all other IDs.
- In a portfolio with no leverage tokens and no borrowed debt, the health factor is effectively infinite — AAVE slices in portfolios are collateral-only positions (no borrowing), so they cannot be liquidated in isolation.

See Section 8 for the associated security note.

### 5.6 Divest

A holder calls `divest(id, amount, minEthOut)`. The contract dispatches per slice type using a pre-computed `supply` snapshot (before the burn reduces it):

- **ERC20**: sells `holdings × amount / supply` of each token back to WETH via Uniswap.
- **AAVE**: withdraws `portfolioAaveWeth[id] × amount / supply` WETH from Aave.
- **LP**: removes `lpLiquidity × amount / supply` liquidity from the V3 position. The last holder receives all remaining liquidity to avoid dust. Collected tokenB is swapped to WETH.

All WETH is unwrapped and combined with the proportional share of `reserve[id]` (undeployed leftovers and collected fees). The total ETH is sent to the caller. Reverts if below `minEthOut`.

No burn fee applies. When all tokens have been divested, `portfolioActive[id]` resets and the owner may reconfigure the basket.

### 5.7 Rebalancing

The keeper submits `RebalanceInstruction[]` — a set of sell/buy pairs computed off-chain against the ERC20 slice holdings. The contract executes each swap against Uniswap V3. Slippage tolerance is enforced globally via `slippageToleranceBps`. AAVE and LP slices are not rebalanced — their positions change only via `deploy` and `divest`.

---

## 6. LP Investment

### 6.1 Concept

An LP token is a Standard token whose ETH reserve is deployed as concentrated liquidity into a Uniswap V3 pool via `NonfungiblePositionManager`. Rather than holding ERC20 assets directly, the protocol holds a Uniswap V3 position NFT. Holders receive a pro-rata share of the accrued trading fees in addition to their original principal.

### 6.2 Configuration

The owner configures the pool parameters before any minting begins:

```
setLPConfig(id, {
  tokenB:    <paired ERC20 token address>,
  poolFee:   3000,       // 0.3% fee tier
  tickLower: -887220,    // full-range lower bound
  tickUpper:  887220,    // full-range upper bound
  swapFee:   3000,       // fee tier for WETH↔tokenB swap via swap router
})
```

`tickLower` and `tickUpper` define the price range. Full-range positions (`-887220` to `887220`) behave like Uniswap V2 — simpler to manage but earning lower fees than concentrated positions.

### 6.3 Lifecycle

```
1. Owner:  setLPConfig(id, config)              — configure pool and price range
2. User:   mint(alice, id, amount)              — ETH → reserve[id]
3. Keeper: deployLP(id, wethForSwap, ...)       — reserve ETH → WETH + tokenB → LP position
4. Keeper: collectFees(id)                      — harvest trading fees → reserve[id]
5. User:   divestLP(id, amount, minEthOut)      — remove proportional liquidity → ETH
```

### 6.4 Deploying

The keeper calls `deployLP(id, wethForSwap, swapAmountOutMin, amount0Min, amount1Min)`:

1. The entire `reserve[id]` is wrapped to WETH and `reserve[id]` is set to zero.
2. `wethForSwap` WETH is swapped to `tokenB` via the swap router.
3. The remaining WETH and the acquired `tokenB` are approved to the `NonfungiblePositionManager`.
4. `NonfungiblePositionManager.mint()` is called with the configured tick range. The position NFT is held by the proxy.
5. Any unused token amounts returned by the position manager (due to the current pool ratio) are unwrapped back to ETH and added to `reserve[id]` as a small undeployed leftover.
6. `lpActive[id]` is set to `true`, `lpPositionId[id]` and `lpLiquidity[id]` are recorded.

### 6.5 Fee Collection

The keeper calls `collectFees(id)` periodically:

1. `NonfungiblePositionManager.collect()` retrieves all accrued `tokensOwed` for the position.
2. Any `tokenB` fees are swapped to WETH via the swap router.
3. Total WETH is unwrapped to ETH and added to `reserve[id]`.

This increases the ETH backing per token for all holders without requiring any user action.

### 6.6 Divest

A holder calls `divestLP(id, amount, minEthOut)`:

1. The proportional liquidity share is computed: `liquidity × amount / totalSupply[id]`. The last holder receives all remaining liquidity to avoid dust.
2. `NonfungiblePositionManager.decreaseLiquidity()` moves the principal tokens to `tokensOwed`.
3. `NonfungiblePositionManager.collect()` retrieves the owed tokens (principal + any pending fees).
4. Any `tokenB` received is swapped to WETH; all WETH is unwrapped to ETH.
5. The holder's proportional share of `reserve[id]` (undeployed ETH from leftovers and collected fees) is added to the payout.
6. The combined ETH is sent to the caller. Reverts if below `minEthOut`.
7. `totalSupply[id]` and `globalTotalSupply` decrease by `amount`. When `totalSupply[id]` reaches zero, `lpActive[id]` is reset.

No burn fee applies to LP divest.

---

## 7. Leverage

### 7.1 Concept

A Leverage token uses Aave V3 as its reserve layer. Instead of ETH sitting idle in `reserve[id]`, minting cost is wrapped to WETH and deposited into Aave as collateral. A keeper monitors off-chain signals and adjusts the LTV position within a hard cap.

### 7.2 Configuration

```
setLeverageConfig(id, {
  aavePool:     <Aave V3 pool address>,
  stableToken:  <USDC or other stable>,
  targetLtvBps: 500,   // 5% target LTV
  maxLtvBps:    1000,  // 10% hard cap
})
```

`maxLtvBps` is capped at 1000 (10%). At 5% LTV against WETH (Aave liquidation threshold ~80%), the health factor is approximately 16 — effectively immune to liquidation even in severe drawdowns.

### 7.3 Lifecycle

```
1. Owner:  setLeverageConfig(id, config)      — configure Aave pool and LTV bounds
2. User:   mintLeverage(id, amount)           — ETH → WETH → Aave collateral
3. Keeper: leverUp(id, stableToBorrow, ...)   — borrow stable → swap to WETH → add collateral
4. Keeper: leverDown(id, wethToWithdraw, ...) — withdraw WETH → sell to stable → repay debt
5. User:   divestLeverage(id, amount, min)    — withdraw pro-rata WETH → ETH
```

### 7.4 Minting

`mintLeverage` prices tokens using the same step-tier bonding curve as Standard tokens. The ETH cost is wrapped to WETH and deposited into Aave. It does not go to `reserve[id]` — the reserve is Aave itself. `aaveCollateral[id]` tracks the deposited WETH.

### 7.5 Keeper Operations

**leverUp**: The keeper signals a bullish position. It borrows `stableToBorrow` from Aave against the existing collateral, swaps the stable to WETH via Uniswap, and re-deposits the WETH as additional collateral. The resulting LTV must not exceed `maxLtvBps`.

**leverDown**: The keeper signals caution. It withdraws WETH from Aave, swaps to stable via Uniswap, and repays Aave debt. LTV decreases.

Both operations include on-chain LTV validation — the keeper's instruction is rejected if it would breach the hard cap.

### 7.6 Emergency Deleverage

If the Aave health factor falls below a configurable floor (`emergencyHealthFloor[id]`), any party (not just the keeper) can trigger `emergencyDeleverage`. This performs a full `leverDown` in a single transaction — withdrawing all available WETH, swapping to stable, and repaying all debt — regardless of the normal LTV target.

### 7.7 Chainlink Price Feed

An optional Chainlink ETH/USD feed can be registered per leverage token. When configured:
- `getLeverageInfo` returns the current ETH price alongside collateral and debt figures.
- Price staleness is validated against `priceMaxAge` — stale prices revert the query.
- `emergencyDeleverage` enforces the price freshness check before execution.

### 7.8 Divest

`divestLeverage(id, amount, minEthOut)` withdraws a pro-rata share of `aaveCollateral[id]` from Aave, unwraps WETH to ETH, and sends it to the caller. No burn fee applies. The function reverts if `aaveDebt[id] > 0` — the keeper must repay all debt via `leverDown` before holders can exit.

---

## 8. Security Properties

| Property | Mechanism |
|---|---|
| Reentrancy | Inline reentrancy guard on all mutating entry points; slot explicitly reset in assembly after delegatecall |
| Pausability | `whenNotPaused` on all user-facing mutating functions |
| Access control | Owner-only admin setters; keeper-only rebalance, lever, deployLP, and collectFees operations |
| Upgrade safety | UUPS — only `_authorizeUpgrade` (owner) can approve implementation upgrades |
| Storage safety | All state in `SmartfolioBase`; OpenZeppelin state uses EIP-7201 namespaced slots, no collision possible |
| Slippage | `minEthOut` / `amountsOutMinimum` on all Uniswap interactions |
| LTV cap | Hard-coded 10% ceiling on leverage regardless of keeper instruction |
| Wrap safety | ERC20 wrapper rejects leverage, portfolio-active, and LP-active tokens at deposit |
| Mutual exclusion | Each token ID is strictly one type. All three config setters (`setPortfolioConfig`, `setLPConfig`, `setLeverageConfig`) and both deploy calls (`deploy`, `deployLP`) reject cross-type combinations at the earliest possible point |
| Shared Aave account | All AAVE slices and leverage tokens share one proxy-level Aave account. A leveraged position's debt contributes to the aggregate health factor. Portfolio AAVE slices alone hold no debt and cannot be liquidated; the risk materialises only when leverage tokens with outstanding debt coexist on the same proxy |

---

## 9. Token Type Mutual Exclusion

Each token ID is permanently bound to exactly one instrument type. The constraint is enforced at the config setter level and again at the deploy call, so misconfiguration is rejected before any ETH is committed.

| Attempted combination | Blocked by |
|---|---|
| `setPortfolioConfig` on a leverage token | `isLeverageToken[id]` → `IncompatibleTokenType` |
| `setPortfolioConfig` while LP active | `lpActive[id]` → `LiquidityAlreadyActive` |
| `setLPConfig` on a leverage token | `isLeverageToken[id]` → `IncompatibleTokenType` |
| `setLPConfig` while portfolio active | `portfolioActive[id]` → `PortfolioActive` |
| `setLeverageConfig` while portfolio active | `portfolioActive[id]` → `PortfolioActive` |
| `setLeverageConfig` while LP active | `lpActive[id]` → `LiquidityAlreadyActive` |
| `deploy` (portfolio) while LP active | `lpActive[id]` → `LiquidityAlreadyActive` |
| `deployLP` on a leverage token | `isLeverageToken[id]` → `IncompatibleTokenType` |

The only state transition that removes a type binding is a full exit: `divestLP` or `divest` with the last token burns resets `lpActive[id]` / `portfolioActive[id]`. `isLeverageToken[id]` is permanent and cannot be cleared once set.

---

## 10. Token Type Summary

| Type | Reserve | Pricing | Exit | Fee |
|---|---|---|---|---|
| **Standard** | ETH in `reserve[id]` | Step-tier bonding curve | `burn()` | Quadratic (0–80%) |
| **Portfolio** | Mixed: ERC20 (Uniswap V3), AAVE (Aave V3 collateral), LP (Uniswap V3 position) | Step-tier bonding curve | `divest()` | None |
| **LP** | Uniswap V3 LP position NFT | Step-tier bonding curve | `divestLP()` | None |
| **Leverage** | WETH collateral via Aave V3 | Step-tier bonding curve | `divestLeverage()` | None |
| **ERC20 Wrapper** | Backed 1:1 by Standard ERC1155 | Market price | `unwrap()` then `burn()` | None (burn fee on underlying) |
