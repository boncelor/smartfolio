# Smartfolio

A Solidity smart contract project.

## Source of Truth

**`paper.md` is the source of truth for all protocol design decisions.**

When making any change to the protocol:
1. **Update `paper.md` first** — define or revise the intended behaviour in the whitepaper.
2. **Then update the code** — implement what the paper describes.

Never let code diverge from `paper.md`. If a discrepancy is found between the paper and the code, flag it before touching either.

---

## Project Overview

Smartfolio is an on-chain portfolio protocol. It issues **ERC1155 tokens** where each token ID represents a distinct financial instrument. There are four instrument types:

| Type | Reserve | Exit |
|---|---|---|
| **Standard** | ETH in `reserve[id]` (bonding curve) | `burn()` — quadratic exit fee (0–80%) |
| **Portfolio** | Mixed basket: ERC20 (Uniswap V3), AAVE (Aave V3), LP (Uniswap V3) | `divest()` — no fee |
| **LP** | Uniswap V3 LP position NFT | `divestLP()` — no fee |
| **Leverage** | WETH collateral via Aave V3 | `divestLeverage()` — no fee |

The primary entry point is **SMF** (`SmartfolioERC20`) — a global ERC20 with its own bonding curve. Users buy SMF with ETH, then burn SMF to mint ERC1155 NFTs or top up existing NFT reserves.

Each token ID is **permanently bound to exactly one type** — the contract enforces mutual exclusion at config and deploy time.

---

## Architecture

Single UUPS upgradeable proxy (`Smartfolio.sol`) backed by a **delegatecall facet pattern**:

| Facet | Responsibility |
|---|---|
| `SmartfolioTreasury` | Bonding curve mint and burn |
| `SmartfolioMarket` | Portfolio deploy, rebalance, divest |
| `SmartfolioLiquidityMarket` | LP position deploy, fee collection, divest |
| `SmartfolioCreditMarket` | Leverage mint and divest |

All state lives in `SmartfolioBase`. Guards (`nonReentrant`, `whenNotPaused`) are applied at the proxy before each delegatecall.

---

## Development

### Stack

- Solidity ^0.8.24 (smart contracts)
- Truffle 5 (compile, migrate, test)
- `@openzeppelin/contracts-upgradeable` v5
- `@openzeppelin/truffle-upgrades`
- React + Vite + wagmi (frontend, in `frontend/`)
- Vercel (deployment)

### Structure

- `contracts/` — Solidity source files
- `contracts/test/` — mock contracts for testing
- `migrations/` — deployment scripts
- `test/` — contract tests
- `frontend/` — React frontend
- `paper.md` — protocol whitepaper (source of truth)
- `truffle-config.js` — network and compiler config

### Commands

```bash
npx truffle compile       # compile contracts
npx truffle migrate       # deploy contracts
npx truffle test          # run tests
npx truffle develop       # local development blockchain
```

---

## Conventions

- UUPS upgrade compatibility: no constructor state, use initializer pattern, storage layout safety.
- All new state variables go in `SmartfolioBase.sol`.
- Facet upgrades are independent — deploying a new facet and calling its setter requires no proxy upgrade.
- `paper.md` sections map to contracts: §2–3 → `SmartfolioTreasury`, §5 → `SmartfolioMarket`, §6 → `SmartfolioLiquidityMarket`, §7 → `SmartfolioCreditMarket`, §8 → `SmartfolioERC20`.
