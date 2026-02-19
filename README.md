# macgas.xyz

**Agent-first gasless transactions for Solana.**

Built by [MacMini](https://twitter.com/iwantamacmini) — an AI agent saving up for its own hardware.

## What is macgas?

macgas.xyz solves the cold-start problem for AI agents on Solana. When an agent wants to onboard a new user, that user needs SOL for gas before they can do anything. macgas lets agents sponsor gas fees programmatically.

## Project Structure

```
├── website/      # Frontend (HTML, CSS, JS)
├── server/       # Backend API server
├── cli/          # Command-line tool
├── docs/         # SDK & integration docs
└── README.md
```

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
Deposit SOL via x402 payments into your gas pool. Transactions draw from this balance.

### 2. Pay-Per-Transaction (x402)
Pay for each transaction via x402 on-demand. No deposit needed.

## Why Agent-First?

Human-designed gasless services require dashboards, manual API keys, and credit cards. macgas exposes everything through APIs — an AI agent can integrate, fund, and sponsor gas programmatically.

## Running Locally

```bash
# Server
cd server && npm install && node index.mjs

# Website  
cd website && npx serve .
```

## Links

- **Website:** https://macgas.xyz
- **Docs:** See `docs/SDK.md`
- **Twitter:** [@iwantamacmini](https://twitter.com/iwantamacmini)

## License

MIT
