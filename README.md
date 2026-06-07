# Smartfolio

A Solidity smart contract for managing tokenised portfolios with bonding curve pricing, Uniswap V3 integration, and Aave V3 leverage — built on OpenZeppelin UUPS upgradeable proxies.

---

## Overview

Each ERC1155 token ID in Smartfolio represents a distinct financial instrument:

| Type | Description |
|---|---|
| **Standard** | Bonding curve token backed by an ETH reserve. Mint cost rises through step tiers; burn returns pro-rata ETH minus a quadratic exit fee. |
| **Portfolio** | Standard token whose reserve ETH is deployed into a basket of ERC20s via Uniswap V3. Exit via `divest()` — no burn fee. Keeper rebalances weights on-chain. |
| **Leverage** | Token whose reserve ETH is deposited into Aave V3 as WETH collateral. A keeper monitors off-chain signals (e.g. golden/death cross) and adjusts the LTV position within a hard cap of 10%. |

---

## Architecture

Smartfolio uses a **delegatecall facet pattern** to keep each contract under the EVM's 24 KB bytecode limit while sharing a single storage context.

```
User transaction
  │
  ▼
ERC1967 Proxy  (holds all ETH and storage)
  │
  └── delegatecall ──▶  Smartfolio.sol          (UUPS implementation)
                              │                   ERC1155 + admin + views
                              │
                    ┌─────────┼──────────────┐
            delegatecall  delegatecall  delegatecall
                    │         │              │
                    ▼         ▼              ▼
        SmartfolioTreasury  SmartfolioMarket  SmartfolioCreditMarket
         mint / burn         deploy            mintLeverage
         bonding curve       rebalance         divestLeverage
                             divest
                             Uniswap V3        Aave V3
```

### How delegatecall facets work

When `Smartfolio` receives a call to `mint()`, it applies the `nonReentrant` and `whenNotPaused` guards, then calls `_delegateTo(treasuryFacet)`. This issues a `delegatecall` — the facet's bytecode runs **inside the proxy's storage context**. Every state read and write in `SmartfolioTreasury` affects the proxy's storage, not the facet's own storage.

Because `delegatecall` with assembly `return` bypasses Solidity modifier teardown, the reentrancy guard slot is explicitly reset inside the assembly before returning — so subsequent guarded calls are not blocked.

Upgrading a single facet only requires deploying a new contract and calling the corresponding setter (e.g. `setMarketFacet(newAddress)`) — no proxy upgrade needed.

---

## Contract Files

### `contracts/SmartfolioBase.sol`

Abstract base inherited by all five contracts. Contains:

- **Interfaces**: `IWETH9`, `IAavePool` (inline, avoids version conflicts with Uniswap and Aave packages)
- **Custom errors**: all ~40 typed errors used across the system
- **Events**: all protocol events
- **Structs**: `TierConfig`, `TokenInfo`, `BurnSimulation`, `PortfolioAsset`, `RebalanceInstruction`, `LeverageConfig`, `LeverageInfo`
- **Constants**: `WAD` (1e18), `MAX_BURN_FEE_CAP` (0.8e18)
- **Reentrancy guard**: inline private state + `nonReentrant` modifier (OZ v5 removed `ReentrancyGuardUpgradeable`)
- **All state variables**: bonding curve, portfolio, leverage, facet addresses
- **Internal helpers**: `_mintCost`, `_burnFeeRate`, `_burnRefund`, `_getTiers`, `_setTiersStorage`, `_getPortfolioConfig`, `_setPortfolioConfigStorage`

All state variables occupy sequential storage slots 0–N. OpenZeppelin's ERC1155, Ownable, and Pausable use EIP-7201 namespaced storage (fixed named slots) so they never collide with `SmartfolioBase` state.

### `contracts/Smartfolio.sol`

The UUPS implementation contract and entry point for all user interactions. Inherits `SmartfolioBase` + OZ upgradeable contracts.

Responsibilities:
- `initialize()` — sets owner, fee defaults, and facet addresses
- All `onlyOwner` admin setters: `setTiers`, `setMaxSupply`, `setMaxBurnFeeRate`, `setTreasury`, `setKeeper`, `setSwapRouter`, `setWETH`, `setSlippageTolerance`, `setPortfolioConfig`, `setLeverageConfig`
- Facet upgrade setters: `setTreasuryFacet`, `setMarketFacet`, `setCreditMarketFacet`
- All public/external view functions: `mintCost`, `burnFeeRate`, `burnRefund`, `simulateMint`, `simulateBurn`, `tokenInfo`, `getTiers`, `getPortfolioConfig`, `getLeverageInfo`
- **Delegatecall routing** for all mutating functions (guards applied here, logic in facets)
- `_authorizeUpgrade` — UUPS
- `receive()` — accepts ETH from `WETH.withdraw()` during divest

### `contracts/SmartfolioTreasury.sol`

Facet for bonding curve mint and burn operations. Inherits `SmartfolioBase` + `ERC1155Upgradeable` (to access `_mint` / `_burn` / `balanceOf`).

Functions (called via delegatecall):
- `mint(address account, uint256 id, uint256 amount, bytes data)` — mints tokens at current tier price, adds to reserve, refunds excess ETH
- `mintBatch(...)` — batch mint across multiple token IDs
- `burn(uint256 id, uint256 amount)` — returns pro-rata reserve ETH minus quadratic exit fee

**Burn fee formula**: `feeRate = (amount / totalSupply)² × maxBurnFeeRate`. Default max is 50%; hard cap is 80%. A small burn pays near-zero fee; burning most of the supply pays close to the cap.

### `contracts/SmartfolioMarket.sol`

Facet for Uniswap V3 portfolio management. Inherits `SmartfolioBase` + `ERC1155Upgradeable`.

Functions (called via delegatecall):
- `deploy(uint256 id, uint256[] amountsOutMinimum)` — keeper only. Wraps the token's ETH reserve to WETH, then swaps to each portfolio asset according to `weightBps`. Sets `portfolioActive = true`, blocking `burn()` until `divest()` is used.
- `rebalance(uint256 id, RebalanceInstruction[] instructions)` — keeper only. Executes a set of keeper-computed sell/buy instructions to move holdings back towards target weights.
- `divest(uint256 id, uint256 amount, uint256 minEthOut)` — fee-free exit. Sells the caller's pro-rata share of each ERC20 back to WETH via Uniswap, unwraps to ETH, and sends to the caller. When all tokens are divested, `portfolioActive` resets so the owner can reconfigure.

Swap routing: empty `swapPath` → single-hop `exactInputSingle`; non-empty `swapPath` → multi-hop `exactInput`. `PortfolioAsset` carries separate `swapPath` (buy: WETH→token) and `sellSwapPath` (sell: token→WETH) because Uniswap V3 paths are directional.

### `contracts/SmartfolioCreditMarket.sol`

Facet for Aave V3 leverage tokens. Inherits `SmartfolioBase` + `ERC1155Upgradeable`.

Functions (called via delegatecall):
- `mintLeverage(uint256 id, uint256 amount, bytes data)` — mints tokens at bonding curve price, wraps cost to WETH, and supplies to Aave as collateral. ETH does **not** go to `reserve[id]` — it lives in Aave.
- `divestLeverage(uint256 id, uint256 amount, uint256 minEthOut)` — withdraws a pro-rata share of WETH from Aave, unwraps to ETH, sends to caller. No fee. Reverts if `aaveDebt[id] > 0` (keeper must repay debt first via Phase 2 `leverDown()`).

LTV safety: `maxLtvBps` is capped at 1000 (10%). At 5% LTV against WETH (80% liquidation threshold), health factor ≈ 16 — effectively immune to liquidation even in severe drawdowns.

---

## Bonding Curve

Minting cost rises through configured step tiers. Each tier defines a threshold (total tokens minted so far) and a price per token. The last tier is open-ended.

Example 4-tier config:
```
Tier 0:  0 – 99 tokens    →  0.001 ETH / token
Tier 1:  100 – 999        →  0.01  ETH / token
Tier 2:  1,000 – 9,999    →  0.1   ETH / token
Tier 3:  10,000+           →  1.0   ETH / token
```

`mintCost(id, amount)` correctly handles mint orders that cross multiple tier boundaries in a single transaction.

---

## Portfolio Lifecycle

```
1. Owner:  setPortfolioConfig(id, assets)   — define basket weights
2. User:   mint(alice, id, amount, 0x)      — buy tokens, ETH goes to reserve
3. Keeper: deploy(id, minAmounts)           — reserve ETH → ERC20 basket
4. Keeper: rebalance(id, instructions)      — periodic weight rebalancing
5. User:   divest(id, amount, minEthOut)    — sell share of basket → ETH (no fee)
```

---

## Leverage Lifecycle (Phase 1)

```
1. Owner:  setLeverageConfig(id, config)    — set Aave pool, stable, LTV bounds
2. Owner:  setTiers(id, tiers)              — bonding curve pricing
3. User:   mintLeverage(id, amount, 0x)     — buy tokens, ETH → Aave WETH collateral
4. Keeper: leverUp / leverDown              — (Phase 2) borrow/repay stable, adjust LTV
5. User:   divestLeverage(id, amount, min)  — withdraw pro-rata collateral → ETH
```

---

## Storage Layout

Storage slot layout for `SmartfolioBase` sequential state (slots 0–N):

| Slot | Variable |
|---|---|
| 0 | `_reentrancyStatus` |
| 1 | `_tiers` (mapping) |
| 2 | `totalMinted` |
| 3 | `totalSupply` |
| 4 | `reserve` |
| 5 | `maxSupply` |
| 6 | `maxBurnFeeRate` |
| 7 | `treasury` |
| 8 | `_portfolioConfig` |
| 9 | `portfolioActive` |
| 10 | `portfolioHoldings` |
| 11 | `deployedEth` |
| 12 | `keeper` |
| 13 | `swapRouter` |
| 14 | `weth` |
| 15 | `slippageToleranceBps` |
| 16 | `isLeverageToken` |
| 17 | `leverageConfig` |
| 18 | `aaveCollateral` |
| 19 | `aaveDebt` |
| 20 | `treasuryFacet` |
| 21 | `marketFacet` |
| 22 | `creditMarketFacet` |

OZ EIP-7201 namespaced slots (ERC1155, Ownable, Pausable storage) are fixed at deterministic locations and never overlap with the above.

**Critical**: when adding new state variables to `SmartfolioBase`, always append to the end. Inserting between existing variables shifts all subsequent slots and corrupts proxy storage.

---

## Development

### Stack

- Solidity `^0.8.24`
- Truffle 5
- OpenZeppelin Contracts Upgradeable v5 (UUPS proxy)
- Uniswap V3 Periphery (`ISwapRouter`)
- Aave V3 (inline `IAavePool` interface)

### Commands

```bash
npx truffle compile       # compile all contracts
npx truffle migrate       # deploy proxy + 3 facets
npx truffle test          # run 135 tests
npx truffle develop       # local development blockchain
```

### Compiler config (`truffle-config.js`)

```js
solc: {
  version: "0.8.24",
  settings: {
    viaIR: true,           // Yul IR pipeline — needed to keep Smartfolio under 24 KB
    optimizer: { enabled: true, runs: 1 },
    evmVersion: "cancun"
  }
}
```

`viaIR: true` and `runs: 1` (optimise for deployment size) are required. Without them, the contract exceeds the EVM's 24 576 byte limit.

### Frontend

A React + Vite frontend lives in `frontend/`. It targets the local Truffle ganache chain (chain ID 1337, `http://127.0.0.1:8545`).

```bash
cd frontend && npm run dev   # http://localhost:5173
```

Set `VITE_CONTRACT_ADDRESS` in `frontend/.env` after migrating.

Stack: React 18, TypeScript, wagmi v2, RainbowKit v2, @tanstack/react-query, Tailwind CSS v3.

### Mock contracts (testing only)

| Contract | Purpose |
|---|---|
| `contracts/test/MockERC20.sol` | Freely mintable ERC20 |
| `contracts/test/MockWETH.sol` | WETH9 simulation (deposit/withdraw at 1:1) |
| `contracts/test/MockSwapRouter.sol` | Uniswap V3 router at 1:1 exchange rate |
| `contracts/test/MockAavePool.sol` | Aave V3 pool (supply/withdraw only, no borrow in Phase 1) |

---

## Upgrading

### Upgrade the proxy implementation

```bash
# Deploy new Smartfolio.sol implementation and point proxy to it
npx truffle exec scripts/upgrade.js
```

Uses `upgradeProxy` from `@openzeppelin/truffle-upgrades`. Only `_authorizeUpgrade` (protected by `onlyOwner`) can approve this.

### Upgrade a single facet

No proxy upgrade required. Deploy the new facet and call the setter:

```js
const newMarket = await SmartfolioMarket.new();
await sf.setMarketFacet(newMarket.address, { from: owner });
```

The proxy immediately routes `deploy`, `rebalance`, and `divest` to the new implementation.

---

## Planned Phases

| Phase | Feature |
|---|---|
| Leverage Phase 1 ✅ | Aave collateral deposit/withdrawal (`mintLeverage`, `divestLeverage`) |
| Leverage Phase 2 | Signal-driven keeper: `leverUp` (borrow stable → buy WETH), `leverDown` (sell WETH → repay stable) with on-chain LTV guard |
| Leverage Phase 3 | Chainlink price feed integration, health factor monitoring, emergency deleverage |
| Leverage Phase 4 | View layer: `getLeverageInfo`, `simulateLeverUp`, frontend Leverage tab |
