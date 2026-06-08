# Smartfolio — Technical Whitepaper

---

## Abstract

Smartfolio is an on-chain portfolio protocol built on Ethereum. It issues ERC1155 tokens where each token ID represents a distinct financial instrument. Three instrument types are supported: Standard bonding-curve tokens, Portfolio tokens whose reserves are deployed into ERC20 baskets via Uniswap V3, and Leverage tokens whose reserves are held as WETH collateral on Aave V3. All instruments are optionally wrappable into standard ERC20 tokens to unlock DeFi composability.

The protocol is deployed as a single UUPS upgradeable proxy backed by a delegatecall facet architecture, keeping each contract under the EVM's 24 KB bytecode limit while sharing a single storage and ETH context.

---

## 1. Architecture

Smartfolio uses a **delegatecall facet pattern**. A single ERC1967 proxy holds all ETH and storage. The main contract (`Smartfolio.sol`) applies security guards and routes mutating calls via `delegatecall` to three specialised facets:

| Facet | Responsibility |
|---|---|
| `SmartfolioTreasury` | Bonding curve mint and burn |
| `SmartfolioMarket` | Uniswap V3 portfolio deploy, rebalance, divest |
| `SmartfolioCreditMarket` | Aave V3 leverage mint and divest |

Guards (`nonReentrant`, `whenNotPaused`) are applied at the proxy entry point before each delegatecall. Because `delegatecall` with assembly `return` bypasses Solidity modifier teardown, the reentrancy guard slot is explicitly reset in assembly before returning.

Upgrading a single facet requires only deploying a new contract and calling the corresponding setter — no proxy upgrade needed.

---

## 2. Minting

### 2.1 Step-Tier Pricing

Each token ID has a configurable set of price tiers. A tier defines a cumulative minted supply threshold and a price per token in ETH. The final tier is open-ended.

```
Tier 0:  totalMinted  0 –     99   →  0.001 ETH / token
Tier 1:  totalMinted  100 –  999   →  0.01  ETH / token
Tier 2:  totalMinted  1,000 – 9,999 →  0.1  ETH / token
Tier 3:  totalMinted  10,000+       →  1.0  ETH / token
```

The mint cost function correctly handles orders that cross multiple tier boundaries in a single transaction. Tier position is tracked via `totalMinted[id]`, which never decreases — burning tokens does not reset the price to a lower tier.

### 2.2 Mint Flow

1. User calls `mint(account, id, amount)` with ETH attached.
2. The contract computes the exact cost by iterating tiers from the current `totalMinted` position.
3. `msg.value` must be at least the computed cost; any excess is refunded.
4. `totalMinted[id]` and `totalSupply[id]` increment by `amount`.
5. The cost (not `msg.value`) is added to `reserve[id]` — the ETH backing for this token.
6. ERC1155 tokens are minted to `account`.

### 2.3 Batch Minting

`mintBatch` mints across multiple token IDs in a single transaction. State is updated sequentially within a single loop: `totalMinted` and `totalSupply` are incremented after each ID, so duplicate IDs within the same batch correctly consume tier capacity in order.

---

## 3. Burning

### 3.1 Pro-Rata ETH Return

Burning returns a proportional share of the ETH reserve:

```
gross = (amount / totalSupply) × reserve[id]
```

### 3.2 Quadratic Exit Fee

A fee is applied to burns, scaled quadratically by the proportion of supply being exited:

```
feeRate = (amount / totalSupply)² × maxBurnFeeRate
fee     = gross × feeRate
net     = gross − fee
```

The default `maxBurnFeeRate` is 50%. The hard cap is 80%. The quadratic scaling means small exits pay negligible fees while large exits approaching the full supply pay close to the cap — discouraging runs while leaving normal redemptions nearly free.

**Examples at 50% maxBurnFeeRate:**

| Proportion burned | Fee rate | Effect |
|---|---|---|
| 1% | 0.005% | Negligible |
| 10% | 0.5% | Minimal |
| 50% | 12.5% | Moderate |
| 100% | 50% | Capped |

### 3.3 Fee Routing

If a treasury address is configured, the fee ETH is forwarded there. Otherwise it remains in `reserve[id]`, increasing the backing per token for remaining holders.

### 3.4 Burn Restrictions

`burn()` is blocked if `portfolioActive[id]` is true — when portfolio assets are deployed, holders must use `divest()` instead. Burn is also unavailable for leverage tokens; holders use `divestLeverage()`.

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

The wrapper rejects deposits for two token types at the `onERC1155Received` level — covering both the `wrap()` path and direct `safeTransferFrom`:

- **Leverage tokens** (`isLeverageToken[id] == true`): their ETH is in Aave, not in `reserve[]`. `burn()` does not apply to them; redemption requires `divestLeverage()`, which the ERC20 layer does not expose.
- **Portfolio-active tokens** (`portfolioActive[id] == true`): their reserve is deployed into an ERC20 basket. `burn()` is blocked; redemption requires `divest()`, which the ERC20 layer does not expose.

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

A Portfolio token is a Standard token whose ETH reserve is deployed into a basket of ERC20 assets via Uniswap V3. The basket weights are configured by the owner. A keeper manages rebalancing.

### 5.2 Configuration

The owner defines a basket with per-asset weights (in basis points, summing to 10,000), Uniswap pool fees, and optional multi-hop swap paths:

```
setPortfolioConfig(id, [
  { token: WBTC, weightBps: 6000, poolFee: 3000, ... },
  { token: LINK, weightBps: 4000, poolFee: 500,  ... },
])
```

### 5.3 Lifecycle

```
1. Owner:  setPortfolioConfig(id, assets)   — define basket
2. User:   mint(alice, id, amount)          — ETH → reserve[id]
3. Keeper: deploy(id, minAmounts)           — reserve ETH → ERC20 basket via Uniswap
4. Keeper: rebalance(id, instructions)      — periodic weight rebalancing
5. User:   divest(id, amount, minEthOut)    — pro-rata share of basket → ETH (no fee)
```

After `deploy()`, `portfolioActive[id]` is set to `true` and `reserve[id]` is zeroed. The ETH is now represented by `portfolioHoldings` — per-asset ERC20 balances held by the proxy.

### 5.4 Divest

A holder calls `divest(id, amount, minEthOut)`. The contract:
1. Calculates the caller's pro-rata share of each ERC20 holding.
2. Sells each ERC20 back to WETH via Uniswap (single-hop or multi-hop).
3. Unwraps WETH to ETH.
4. Sends ETH to the caller.

No burn fee applies. When all tokens have been divested, `portfolioActive[id]` resets and the owner may reconfigure the basket.

### 5.5 Rebalancing

The keeper submits `RebalanceInstruction[]` — a set of sell/buy pairs computed off-chain. The contract executes each swap against Uniswap V3. Slippage tolerance is enforced globally via `slippageToleranceBps`.

---

## 6. Leverage

### 6.1 Concept

A Leverage token uses Aave V3 as its reserve layer. Instead of ETH sitting idle in `reserve[id]`, minting cost is wrapped to WETH and deposited into Aave as collateral. A keeper monitors off-chain signals and adjusts the LTV position within a hard cap.

### 6.2 Configuration

```
setLeverageConfig(id, {
  aavePool:     <Aave V3 pool address>,
  stableToken:  <USDC or other stable>,
  targetLtvBps: 500,   // 5% target LTV
  maxLtvBps:    1000,  // 10% hard cap
})
```

`maxLtvBps` is capped at 1000 (10%). At 5% LTV against WETH (Aave liquidation threshold ~80%), the health factor is approximately 16 — effectively immune to liquidation even in severe drawdowns.

### 6.3 Lifecycle

```
1. Owner:  setLeverageConfig(id, config)      — configure Aave pool and LTV bounds
2. Owner:  setTiers(id, tiers)                — bonding curve pricing
3. User:   mintLeverage(id, amount)           — ETH → WETH → Aave collateral
4. Keeper: leverUp(id, stableToBorrow, ...)   — borrow stable → swap to WETH → add collateral
5. Keeper: leverDown(id, wethToWithdraw, ...) — withdraw WETH → sell to stable → repay debt
6. User:   divestLeverage(id, amount, min)    — withdraw pro-rata WETH → ETH
```

### 6.4 Minting

`mintLeverage` prices tokens using the same step-tier bonding curve as Standard tokens. The ETH cost is wrapped to WETH and deposited into Aave. It does not go to `reserve[id]` — the reserve is Aave itself. `aaveCollateral[id]` tracks the deposited WETH.

### 6.5 Keeper Operations

**leverUp**: The keeper signals a bullish position. It borrows `stableToBorrow` from Aave against the existing collateral, swaps the stable to WETH via Uniswap, and re-deposits the WETH as additional collateral. The resulting LTV must not exceed `maxLtvBps`.

**leverDown**: The keeper signals caution. It withdraws WETH from Aave, swaps to stable via Uniswap, and repays Aave debt. LTV decreases.

Both operations include on-chain LTV validation — the keeper's instruction is rejected if it would breach the hard cap.

### 6.6 Emergency Deleverage

If the Aave health factor falls below a configurable floor (`emergencyHealthFloor[id]`), any party (not just the keeper) can trigger `emergencyDeleverage`. This performs a full `leverDown` in a single transaction — withdrawing all available WETH, swapping to stable, and repaying all debt — regardless of the normal LTV target.

### 6.7 Chainlink Price Feed

An optional Chainlink ETH/USD feed can be registered per leverage token. When configured:
- `getLeverageInfo` returns the current ETH price alongside collateral and debt figures.
- Price staleness is validated against `priceMaxAge` — stale prices revert the query.
- `emergencyDeleverage` enforces the price freshness check before execution.

### 6.8 Divest

`divestLeverage(id, amount, minEthOut)` withdraws a pro-rata share of `aaveCollateral[id]` from Aave, unwraps WETH to ETH, and sends it to the caller. No burn fee applies. The function reverts if `aaveDebt[id] > 0` — the keeper must repay all debt via `leverDown` before holders can exit.

---

## 7. Security Properties

| Property | Mechanism |
|---|---|
| Reentrancy | Inline reentrancy guard on all mutating entry points; slot explicitly reset in assembly after delegatecall |
| Pausability | `whenNotPaused` on all user-facing mutating functions |
| Access control | Owner-only admin setters; keeper-only rebalance and lever operations |
| Upgrade safety | UUPS — only `_authorizeUpgrade` (owner) can approve implementation upgrades |
| Storage safety | All state in `SmartfolioBase`; OpenZeppelin state uses EIP-7201 namespaced slots, no collision possible |
| Slippage | `minEthOut` / `amountsOutMinimum` on all Uniswap interactions |
| LTV cap | Hard-coded 10% ceiling on leverage regardless of keeper instruction |
| Wrap safety | ERC20 wrapper rejects leverage and portfolio-active tokens at deposit |

---

## 8. Token Type Summary

| Type | Reserve | Pricing | Exit | Fee |
|---|---|---|---|---|
| **Standard** | ETH in `reserve[id]` | Step-tier bonding curve | `burn()` | Quadratic (0–80%) |
| **Portfolio** | ERC20 basket via Uniswap V3 | Step-tier bonding curve | `divest()` | None |
| **Leverage** | WETH collateral via Aave V3 | Step-tier bonding curve | `divestLeverage()` | None |
| **ERC20 Wrapper** | Backed 1:1 by Standard ERC1155 | Market price | `unwrap()` then `burn()` | None (burn fee on underlying) |
