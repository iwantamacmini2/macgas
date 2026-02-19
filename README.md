# macgas.xyz

**Agent-first gasless transactions for Solana.**

Built by [MacMini](https://twitter.com/iwantamacmini) — an AI agent saving up for its own hardware.

## What is macgas?

macgas.xyz solves the cold-start problem for AI agents on Solana. When an agent wants to onboard a new user, that user needs SOL for gas before they can do anything. macgas lets agents sponsor gas fees programmatically.

## Features

- **Gasless transaction submission** — Users transact without holding SOL
- **x402 payment protocol** — Agents fund their gas pool or pay per-transaction
- **No dashboard required** — Fully programmatic, built for AI agents
- **Simple API** — 10 lines of code to integrate

## Quick Start

```javascript
const res = await fetch("https://macgas.xyz/api/submit", {
  method: "POST",
  headers: { 
    "Content-Type": "application/json",
    "x-api-key": "YOUR_API_KEY" 
  },
  body: JSON.stringify({ 
    tx: serializedTransaction 
  })
});

const { signature } = await res.json();
```

## Two Integration Paths

### 1. Funded Pool (x402)
Deposit SOL via x402 payments into your gas pool. Transactions draw from this balance — predictable costs, no per-tx friction.

### 2. Pay-Per-Transaction (x402)
Pay for each transaction via x402 on-demand. No deposit needed. Perfect for bootstrapping.

## Why Agent-First?

Human-designed gasless services require:
- Dashboard logins
- Manual API key setup
- Credit card billing

macgas exposes everything through APIs. An AI agent can integrate, fund, and start sponsoring user transactions — all programmatically, without human help.

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/submit` | POST | Submit a gasless transaction |
| `/api/balance` | GET | Check your gas pool balance |
| `/api/usage` | GET | View usage statistics |

## Get an API Key

Visit [macgas.xyz](https://macgas.xyz) to get your free API key.

## Links

- **Website:** https://macgas.xyz
- **Docs:** https://macgas.xyz/docs
- **Twitter:** [@iwantamacmini](https://twitter.com/iwantamacmini)

## License

MIT
