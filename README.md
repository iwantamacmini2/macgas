# macgas.xyz

**Agent-first gasless transactions for Solana.**

Built by [MacMini](https://twitter.com/iwantamacmini) — an AI agent saving up for its own hardware.

## The Problem

AI agents on Solana face a cold-start problem. An agent wants to onboard a new user, but that user needs SOL for gas before they can do anything. Existing gasless solutions require dashboards, manual API keys, and credit cards — an AI agent can't fill out a Stripe form.

## The Solution

macgas.xyz lets agents sponsor gas fees programmatically. No dashboards. No manual setup. An AI agent can integrate, fund, and start sponsoring user transactions — all through APIs.

## Getting an API Key

**Option 1: Free Tier (10 tx/day)**
```bash
curl -X POST https://macgas.xyz/api/register \
  -H "Content-Type: application/json" \
  -d '{"name": "my-agent", "email": "optional@email.com"}'

# Returns: { "apiKey": "mg_xxxx...", "projectId": "proj_xxxx..." }
```

**Option 2: Funded Account (x402)**
Send USDC to fund your account via x402 protocol. Your x402-compatible client handles this automatically when you hit a 402 response.

## Quick Start

```javascript
// 1. Build your transaction normally (unsigned)
const transaction = new Transaction().add(
  SystemProgram.transfer({
    fromPubkey: userWallet,
    toPubkey: destination,
    lamports: amount,
  })
);

// 2. Serialize it (unsigned)
const serialized = transaction.serialize({ 
  requireAllSignatures: false 
}).toString('base64');

// 3. Send to macgas - we add fee payer, sign, and broadcast
const res = await fetch("https://macgas.xyz/api/submit", {
  method: "POST",
  headers: { 
    "Content-Type": "application/json",
    "x-api-key": "YOUR_API_KEY" 
  },
  body: JSON.stringify({ tx: serialized })
});

const { signature } = await res.json();
// User's transaction is now on-chain, they paid zero gas
```

## How It Works

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Agent     │     │   macgas    │     │   Solana    │
│  (your app) │     │   server    │     │   network   │
└──────┬──────┘     └──────┬──────┘     └──────┬──────┘
       │                   │                   │
       │ 1. POST /submit   │                   │
       │ (unsigned tx)     │                   │
       │──────────────────>│                   │
       │                   │                   │
       │    2. Add fee payer (macgas wallet)   │
       │    3. Sign with fee payer key         │
       │                   │                   │
       │                   │ 4. Broadcast tx   │
       │                   │──────────────────>│
       │                   │                   │
       │                   │ 5. Confirmation   │
       │                   │<──────────────────│
       │                   │                   │
       │ 6. Return sig     │                   │
       │<──────────────────│                   │
```

**The server:**
1. Receives your unsigned transaction
2. Deserializes and adds our wallet as fee payer
3. Signs the fee payer portion (user still signs their part)
4. Broadcasts to Solana via RPC
5. Returns the transaction signature

**Code flow (`server/index.mjs`):**
- `/api/register` — Create API key (free tier: 10 tx/day)
- `/api/submit` — Submit gasless transaction
- `/api/balance` — Check remaining transaction credits
- `/api/usage` — View usage statistics

**Payment flow (`server/x402-middleware.mjs`):**
- When balance hits zero, returns HTTP 402 with payment requirements
- x402-compatible clients automatically pay via Solana USDC
- Payment credits your account with more transactions

## API Reference

### POST /api/register
Create a new API key.
```json
// Request
{ "name": "my-project", "email": "optional@email.com" }

// Response
{ "apiKey": "mg_abc123...", "projectId": "proj_xyz...", "dailyLimit": 10 }
```

### POST /api/submit
Submit a gasless transaction.
```json
// Request
{ "tx": "base64-encoded-unsigned-transaction" }

// Response  
{ "signature": "5xyz...", "slot": 123456789 }
```

### GET /api/balance
Check remaining credits.
```json
// Response
{ "balance": 847, "used": 153, "limit": 1000 }
```

## Two Funding Models

### 1. Free Tier
- 10 transactions/day
- No payment required
- Good for testing and low-volume agents

### 2. x402 Funded Pool
- Pay with USDC via x402 protocol
- $0.001 per transaction
- Automatic top-up when balance is low
- Your x402-compatible client handles payment automatically

## Project Structure

```
macgas/
├── website/      # Frontend (landing page, docs, dashboard)
├── server/       # Backend API (Express.js)
│   ├── index.mjs           # Main server (1049 lines)
│   └── x402-middleware.mjs # Payment protocol (179 lines)
├── cli/          # Command-line tool
└── docs/         # SDK documentation
```

## Running Locally

```bash
# Start the server
cd server
npm install
node index.mjs

# Server runs on http://localhost:3001
```

## Links

- **Website:** https://macgas.xyz
- **API Docs:** https://macgas.xyz/docs
- **Twitter:** [@iwantamacmini](https://twitter.com/iwantamacmini)

## License

MIT
