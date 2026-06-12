# Smartfolio — Technical Whitepaper

---

## Abstract

Smartfolio is an on-chain portfolio protocol built on Ethereum. It issues ERC1155 tokens representing two instrument types:

- **Standard tokens** — ETH held in a per-ID reserve, redeemable via a bonding-curve burn with a quadratic exit fee.
- **Portfolio tokens** — the primary instrument. Each Portfolio NFT holds a configurable basket of on-chain strategies: SMF (mandatory), ERC20 token positions, Uniswap V3 LP positions, and Aave V3 collateral deposits. Holders exit via `divest()` with no fee.

The fundamental user flow is:

```
ETH → buySMF() → SMF → mintNFT() → Portfolio NFT
                                          ↓ deploy()
                              SMF slice (mandatory ≥ 20%)
                            + ERC20 / LP / AAVE slices (tier-gated)
```

Users buy **SMF** (`SmartfolioERC20`) with ETH via a step-tier bonding curve. Burning SMF mints a Portfolio NFT — the ETH backing of the burned SMF becomes the NFT's reserve. The keeper then deploys that reserve into the configured basket. Every portfolio must allocate at least 20% to SMF, ensuring SMF always has structural demand from every deploy. Additional weight is distributed across ERC20 swaps (Uniswap V3), concentrated liquidity positions (Uniswap V3), and Aave V3 collateral — each unlocked by a higher SMF allocation tier.

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

### 3.4 Rounding Dust

Integer division in the pro-rata formula accumulates sub-wei residuals across many partial burns:

```
gross = (amount × reserve[id]) / totalSupply[id]
```

Each division rounds down, leaving a fractional wei in `reserve[id]`. Over the lifetime of a high-volume token ID this dust is negligible in absolute terms but means `reserve[id]` never naturally reaches exactly zero — even after every holder has exited.

When the last token of an ID is burned `totalSupply[id]` reaches zero and the remaining dust is permanently trapped unless explicitly removed. The `sweepDust(id)` owner function reclaims it:

- Reverts unless `totalSupply[id] == 0` — cannot sweep while any supply remains.
- Sends the full remaining `reserve[id]` to the registered treasury, or to the owner if no treasury is set.
- Emits `DustSwept(id, recipient, amount)` for auditability.

In practice, accumulated dust across thousands of burns on a single token ID is expected to be on the order of a few hundred wei — well below any meaningful economic threshold. `sweepDust` is a housekeeping tool, not an emergency mechanism.

### 3.5 Burn Restrictions

`burn()` is blocked when:
- `portfolioActive[id]` is true — holders must use `divest()`.
- `lpActive[id]` is true — holders must use `divestLP()`.

Leverage tokens are not explicitly blocked by `burn()`. However, leverage tokens hold no ETH in `reserve[id]` — their backing is in Aave — so burning a leverage token returns 0 ETH. Holders must use `divestLeverage()` to recover their Aave collateral.

---

## 4. Portfolio Investment

### 4.1 Concept

The Portfolio NFT is the protocol's primary instrument. Its reserve is not held as idle ETH — it is deployed into a configurable basket of on-chain strategies, with SMF as the mandatory base layer.

**Funding flow:**

```
ETH → buySMF() → SMF → mintNFT() → reserve[id] (ETH)
                                         ↓ deploy()
                              SMF slice (mandatory, min 20%)
                            + ERC20 slices  (Uniswap V3 swaps)
                            + LP slices     (Uniswap V3 positions)
                            + AAVE slices   (Aave V3 collateral)
```

When the keeper deploys, the reserve ETH is allocated across the configured slices. The simplest valid portfolio is **100% SMF** — the entire reserve is used to buy SMF via the bonding curve. Adding other asset types distributes weight away from SMF while keeping the protocol's minimum SMF floor intact.

Each asset slice specifies an `AssetType`:

| `AssetType` | Strategy | Underlying |
|---|---|---|
| `SMF` | Buy SMF via bonding curve | SMF ERC20 held by proxy |
| `ERC20` | Uniswap V3 token swap | ERC20 held by proxy |
| `LP` | Uniswap V3 LP position | Position NFT held by proxy |
| `AAVE` | Aave V3 collateral deposit | aWETH held by Aave (shared proxy account) |
| `STAKING` | (reserved — not yet supported, reverts) | — |

### 4.2 SMF Tier Gates

Every portfolio must carry a minimum SMF allocation. Higher SMF weight unlocks additional strategy types:

| SMF weight in basket | Tier | Strategies unlocked |
|---|---|---|
| < 20% | — | Reverts — config rejected |
| ≥ 20% | 1 (Base) | SMF + ERC20 swaps |
| ≥ 40% | 2 (LP) | + Uniswap V3 LP positions |
| ≥ 60% | 3 (Leverage) | + Aave V3 collateral deposits |

This gate structure ensures SMF always has structural demand from every portfolio deploy — the more diversified a portfolio, the more SMF it must hold as its foundation.

### 4.3 Configuration

The owner defines a basket with per-asset weights (in basis points, summing to 10,000) and type-specific parameters:

```
setPortfolioConfig(id, [
  { assetType: SMF,  token: smfAddress, weightBps: 2000, ... },
  { assetType: ERC20, token: WBTC,     weightBps: 5000, poolFee: 3000, ... },
  { assetType: LP,    token: USDC,     weightBps: 3000, poolFee: 500,
    swapFee: 500, tickLower: -887220, tickUpper: 887220, ... },
])
```

- **SMF slices** require `token` set to the SMF contract address. Only one SMF slice is allowed per portfolio.
- **ERC20 slices** require `token` (target ERC20) and `poolFee` (Uniswap pool fee tier). Optional `swapPath`/`sellSwapPath` override single-hop with multi-hop routes.
- **AAVE slices** carry no additional parameters — WETH is deposited directly into Aave.
- **LP slices** require `token` (paired token), `poolFee` (LP pool fee tier), `swapFee` (router fee for the WETH→token swap), and `tickLower`/`tickUpper` (price range).

Weights across all slice types must sum to exactly 10,000 bps.

### 4.4 Lifecycle

```
0. User:   buySMF()                                          — ETH → SMF (bonding curve)
1. Owner:  setPortfolioConfig(id, assets)                    — define basket
2. Owner:  setDefaultAavePool(pool)                          — required if any AAVE slice
3. User:   mintNFT(maxSmfBurn)                               — burn SMF → ETH → reserve[id]
4. Keeper: deploy(id, erc20MinAmounts, smfMinAmount, lpSwapMin, lp0Min, lp1Min)
                                                             — reserve ETH → basket
5. Keeper: rebalance(id, instructions)                       — ERC20 slices only
6. User:   divest(id, amount, minEthOut)                     — pro-rata basket → ETH
```

After `deploy()`, `portfolioActive[id]` is set to `true` and `reserve[id]` is zeroed. The six-parameter signature separates slippage guards by slice type: `erc20MinAmounts` is an array covering ERC20 slices in order; `smfMinAmount` is the minimum SMF expected from the bonding curve buy; the three LP parameters guard the V3 position mint.

### 4.5 Deploying

The keeper calls `deploy(id, erc20MinAmounts, smfMinAmount, lpSwapAmountOutMin, lpAmount0Min, lpAmount1Min)`:

1. The entire `reserve[id]` is wrapped to WETH.
2. Assets are processed in order. The last asset receives all remaining WETH (no rounding dust).
3. Per-slice dispatch:
   - **ERC20**: swaps the allocated WETH to `token` via Uniswap V3 using `erc20MinAmounts[i]`.
   - **AAVE**: deposits allocated WETH into Aave V3 via the shared proxy account (`defaultAavePool`). `portfolioAaveWeth[id]` records the deposited amount for per-ID accounting.
   - **SMF**: unwraps WETH to ETH, then calls `buySMF{value: amountIn}(smfMinAmount)` on the SMF contract. The acquired SMF is held by the proxy and tracked in `portfolioSMFHoldings[id]`.
   - **LP**: swaps half the allocated WETH to `token` via the swap router (`lpSwapAmountOutMin`), then mints a Uniswap V3 position (`lpAmount0Min`, `lpAmount1Min`). The position NFT is held by the proxy. Any token amounts unused by the position manager (current price ratio mismatch) are unwrapped back to ETH and added to `reserve[id]` as leftover.
4. `portfolioActive[id]` is set to `true`.

### 4.6 LP Slice Operations

When a portfolio has an LP slice, two additional keeper operations are available:

**Deploy LP slice** — `deploy()` handles the LP slice as part of the overall basket deploy. For the LP portion:
1. The allocated WETH is partially swapped to `tokenB` via the swap router (`lpSwapAmountOutMin`).
2. The remaining WETH and acquired `tokenB` are provided to `NonfungiblePositionManager.mint()` within the configured tick range. The position NFT is held by the proxy.
3. Any tokens unused by the position manager (price ratio mismatch) are unwrapped back to ETH and added to `reserve[id]` as undeployed leftover.

`tickLower` and `tickUpper` define the price range for the position. Full-range positions (`-887220` to `887220`) behave like Uniswap V2 and are simpler to manage; concentrated ranges earn higher fees but require active management.

**Fee collection** — the keeper calls `collectFees(id)` periodically:
1. `NonfungiblePositionManager.collect()` retrieves all accrued `tokensOwed`.
2. Any `tokenB` fees are swapped to WETH via the swap router.
3. Total WETH is unwrapped to ETH and added to `reserve[id]`, increasing the backing per token for all holders.

### 4.7 AAVE Slice — Collateral and Future Leverage

The AAVE slice is the protocol's collateral layer, designed in two phases:

**Phase 1 (current): Collateral deposit**

When the keeper deploys a portfolio with an AAVE slice, the allocated WETH is deposited into Aave V3 as collateral via the shared proxy account. `portfolioAaveWeth[id]` records the deposited amount for pro-rata withdrawal on divest. No borrowing occurs — the health factor is effectively infinite for collateral-only positions.

On divest, `portfolioAaveWeth[id] × amount / supply` WETH is withdrawn from Aave and returned to the holder as ETH.

**Phase 2 (planned): Keeper-driven borrowing**

A future upgrade will allow the keeper to borrow stablecoins against the AAVE collateral and deploy that capital further — effectively running a leveraged position as one slice of the portfolio. The borrow/repay loop, LTV caps, and emergency deleverage will be implemented at the slice level, keeping the portfolio as the single instrument type.

### 4.8 Shared Aave Account

All AAVE slices across all portfolio IDs share a single Aave account at the proxy address. This means:

- There is **one aggregate health factor** for the entire proxy's Aave position.
- `portfolioAaveWeth[id]` tracks per-ID deposited WETH for proportional withdrawal, but does not isolate health risk.
- In a portfolio with collateral-only AAVE slices (Phase 1) and no borrowed debt, the health factor is effectively infinite — these positions cannot be liquidated.
- Once Phase 2 borrowing is introduced, debt from one portfolio's AAVE slice will affect the aggregate health factor seen by all other portfolios on the same proxy. This must be managed carefully.

### 4.9 Divest

A holder calls `divest(id, amount, minEthOut)`. The contract dispatches per slice type using a pre-computed `supply` snapshot (before the burn reduces it):

- **SMF**: sells `portfolioSMFHoldings[id] × amount / supply` SMF back to ETH via `sellSMF()` on the bonding curve.
- **ERC20**: sells `holdings × amount / supply` of each token back to WETH via Uniswap.
- **AAVE**: withdraws `portfolioAaveWeth[id] × amount / supply` WETH from Aave.
- **LP**: removes `lpLiquidity × amount / supply` liquidity from the V3 position. The last holder receives all remaining liquidity to avoid dust. Collected tokenB is swapped to WETH.

All WETH is unwrapped and combined with the proportional share of `reserve[id]` (undeployed leftovers and collected fees). The total ETH is sent to the caller. Reverts if below `minEthOut`.

No burn fee applies. When all tokens have been divested, `portfolioActive[id]` resets and the owner may reconfigure the basket.

### 4.10 Rebalancing

The keeper submits `RebalanceInstruction[]` — a set of sell/buy pairs computed off-chain against the ERC20 slice holdings. The contract executes each swap against Uniswap V3. Slippage tolerance is enforced globally via `slippageToleranceBps`. AAVE and LP slices are not rebalanced — their positions change only via `deploy` and `divest`.

---

## 5. SMF — Global ERC20 Token

### 5.1 Concept

SMF (`SmartfolioERC20`) is a standalone ERC20 contract that acts as the primary liquidity layer for the protocol. Rather than paying ETH directly to mint ERC1155 NFTs, users first buy SMF with ETH via its own bonding curve. SMF can then be burned to:

1. **Mint a new ERC1155 NFT** — the ETH backing of burned SMF flows into `reserve[id]`, funding the NFT.
2. **Top up an existing NFT's reserve** — burn SMF to increase the backing per token for all holders of an ID without minting new tokens.

The NFT itself is redeemed as usual via `burn()`, returning ETH to the holder.

```
User ──ETH──▶ buySMF()      ──SMF──▶ User
User ──SMF──▶ mintNFT()     ──ETH──▶ Smartfolio.mintFundedNew()  ──ERC1155 (auto-ID)──▶ User
User ──SMF──▶ addToNFT()    ──ETH──▶ Smartfolio.addReserve()     (no ERC1155 minted)
User ──ERC1155──▶ burn()     ──ETH──▶ User
```

### 5.2 SMF Bonding Curve

SMF has its own independent step-tier bonding curve, configured separately from the ERC1155 curve via `setTiers()`. The curve is driven by `smfTotalSupply` — the current SMF in circulation — and is structurally identical to the ERC1155 curve:

```
Tier 0:  smfTotalSupply  0 –      99   →  price₀ per SMF
Tier 1:  smfTotalSupply  100 –   999   →  price₁ per SMF
...
```

When SMF is burned the inverse curve is traversed: starting from the highest occupied tier, tokens are redeemed at their original tier price until the required ETH is covered. This ensures the ETH released by a burn exactly equals the ETH that was paid in for those tokens.

### 5.3 Minting NFTs with SMF

A user calls `mintNFT()`:

1. `smfToBurn = _nftMintCost()` — dynamic cost, fully deterministic from on-chain state (no oracle).
2. Burns `smfToBurn` SMF from the caller; decrements `smfTotalSupply`; increments `nftCount` and `totalSmfLockedInNFTs`.
3. `ethNeeded = _ethForSmfAmount(smfToBurn)` — ETH equivalent of the burned SMF on the bonding curve.
4. Calls `Smartfolio.mintFundedNew{value: ethNeeded}(caller)` — auto-assigns a new token ID, mints 1 ERC1155, and adds `ethNeeded` to `reserve[id]`.
5. Returns the newly assigned `id`.

No slippage param is needed — the cost is a pure function of on-chain state and only changes discretely when a new NFT is minted, not continuously.

#### Dynamic Cost Formula

```
effective_n  = nftCount > nftGrace ? nftCount - nftGrace : 0
log_steps    = floor(log2(effective_n + 1))
ratio        = totalSmfLockedInNFTs × 1e18 / smfTotalMinted   (0 if smfTotalMinted = 0)
ratio_mult   = 1e18 + nftRatioScale × ratio / 1e18             (∈ [1×, 3×] at default scale)
smfToBurn    = nftCostMin + nftCostBase × log_steps × ratio_mult / 1e18
```

`log_steps` is computed via bit-length (`floor(log2(x+1))`): exact, zero-division-safe, no floating point.

**Configurable parameters (owner-settable):**

| Parameter | Default | Role |
|---|---|---|
| `nftGrace` | 10 | NFTs within this count all pay floor cost only |
| `nftCostMin` | 1 SMF | floor cost always applied (no free minting) |
| `nftCostBase` | 5 SMF | additional cost per log step |
| `nftRatioScale` | 2e18 | max multiplier from lock ratio (2× at ratio=1) |

**Growth profile (defaults, ratio=0):**

| NFT # | `effective_n` | `log_steps` | cost |
|---|---|---|---|
| 1–11 | 0 | 0 | 1 SMF |
| 12–13 | 1–2 | 1 | 6 SMF |
| 14–17 | 3–6 | 2 | 11 SMF |
| 18–25 | 7–14 | 3 | 16 SMF |
| 42–73 | 31–62 | 5 | 26 SMF |
| 1034+ | 1023+ | 10 | 51 SMF |

At `ratio = 0.5` (half of all ever-minted SMF locked in NFTs) the `ratio_mult` reaches 2×, doubling all costs above the floor.

#### Tracking State

Two accumulators are maintained on `SmartfolioERC20`:

- `nftCount` — total NFTs ever minted via `mintNFT()`. Drives the logarithmic component.
- `totalSmfLockedInNFTs` — cumulative SMF burned specifically for NFT minting. Drives the lock-ratio component.

### 5.4 Topping Up a Reserve

A user calls `addToNFT(id, ethAmount, maxSmfBurn)`:

1. `smfToBurn = _smfAmountForEth(ethAmount)` — inverse curve traversal.
2. Reverts if `smfToBurn > maxSmfBurn`.
3. Burns SMF, calls `Smartfolio.addReserve{value: ethAmount}(id)`.
4. `reserve[id]` increases by `ethAmount`; existing holders' backing per token increases immediately.

No conversion fee applies to reserve top-ups.

### 5.5 Restricted Smartfolio Entry Points

Two entry points on the Smartfolio proxy are callable only by the registered SMF contract (`smfContract`):

- `mintFundedNew(address to) payable returns (uint256 id)` — auto-assigns the next token ID, mints 1 ERC1155 to `to`, and adds `msg.value` to `reserve[id]`. No bonding curve price check.
- `addReserve(uint256 id) payable` — adds `msg.value` to `reserve[id]` without minting tokens.

Both revert with `CallerNotSMFContract` if called by any other address. The SMF contract is registered via `setSMFContract(address)` (owner-only).

### 5.6 Simulation Views

| Function | Returns |
|---|---|
| `smfMintCost(amount)` | ETH cost to buy `amount` SMF |
| `smfBurnValue(amount)` | ETH received from selling `amount` SMF |
| `smfForNFT()` | `(smfRequired, ethNeeded)` — simulate `mintNFT` cost from current on-chain state |
| `smfForReserve(ethAmount)` | `smfRequired` — simulate `addToNFT` cost |
| `getTiers()` | Current SMF tier configuration |

---

## 6. Security Properties

| Property | Mechanism |
|---|---|
| Reentrancy | Inline reentrancy guard on all mutating entry points; slot explicitly reset in assembly after delegatecall |
| Pausability | `whenNotPaused` on all user-facing mutating functions |
| Access control | Owner-only admin setters; keeper-only `deploy`, `rebalance`, and `collectFees` operations |
| Upgrade safety | UUPS — only `_authorizeUpgrade` (owner) can approve implementation upgrades |
| Storage safety | All state in `SmartfolioBase`; OpenZeppelin state uses EIP-7201 namespaced slots, no collision possible |
| Slippage | `minEthOut` / `amountsOutMinimum` on all Uniswap interactions; `smfMinAmount` on bonding curve buys |
| Instrument exclusion | Once `setPortfolioConfig` is called for a token ID, the token is a Portfolio instrument. `portfolioActive[id]` is set on deploy and cleared only when all holders have exited. A token cannot transition between Standard and Portfolio |
| Shared Aave account | All AAVE slices across all portfolio IDs share one proxy-level Aave account. Phase 1 (collateral-only) positions hold no debt and cannot be liquidated. Phase 2 borrowing (planned) will require careful aggregate health factor management across all portfolios on the proxy |
| SMF entry point | `mintFundedNew` and `addReserve` on Smartfolio are restricted to the registered SMF contract via `CallerNotSMFContract`. No external party can inject ETH into a reserve or mint tokens at arbitrary prices |

---

## 7. Instrument Types

Smartfolio issues two instrument types. Each token ID is bound to exactly one type, determined by whether `setPortfolioConfig` has been called. Once a portfolio is configured and deployed, `portfolioActive[id]` is set and the token cannot be reconfigured until all holders have divested.

| Type | Reserve | Entry | Exit | Fee |
|---|---|---|---|---|
| **Standard** | ETH in `reserve[id]` | `mint()` with ETH | `burn()` | Quadratic exit fee (0–80%) |
| **Portfolio** | SMF + ERC20 (Uniswap V3) + LP (Uniswap V3) + AAVE (Aave V3) | `mintNFT()` via SMF | `divest()` | None |
| **SMF** | ETH pool (independent bonding curve) | `buySMF()` with ETH | `sellSMF()` for ETH; or `mintNFT()` to convert into a Portfolio NFT | None |
