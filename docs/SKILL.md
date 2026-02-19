# MacMini Gas Station Skill

**Solana transactions without SOL**

## Two Tiers

| Tier | Dev cost | User pays | Best for |
|------|----------|-----------|----------|
| **🚀 Pay-as-you-go** | $0 | ~$0.0005 in SOL or USDC | User-pays models |
| **⚡ Gasless** | Prepay | $0 | Onboarding, games |

---

## 🚀 PAY-AS-YOU-GO: Free to Integrate

Developers integrate for free. Users pay their own gas in SOL or USDC (their choice).

### Register (one command)
```bash
curl -X POST https://macgas.xyz/payg/register \
  -H "Content-Type: application/json" \
  -d '{"name": "your-app-name"}'
```

### User funds their account
Users send SOL or USDC with their project ID as memo:
```
To: F6i99DWMEMZtLDKnWGx1FW6drkqvtDnXWLHxgrwzVdWD
Memo: <project-id>
Accepts: SOL or USDC
Cost: ~$0.0005 per transaction
```
System defaults to SOL if user has both. Falls back to USDC if no SOL.

### Send transactions
```bash
curl -X POST https://macgas.xyz/sign_and_send \
  -H "Content-Type: application/json" \
  -H "X-Project-ID: <project-id>" \
  -d '{"transaction": "<base64-encoded-tx>"}'
```

**For developers:** $0 to integrate
**For users:** ~$0.0005 per tx in SOL or USDC

---

## 💎 PAID TIER: Prepaid Gasless

### Step 1: Register
```bash
curl -X POST https://macgas.xyz/register \
  -H "Content-Type: application/json" \
  -d '{"name": "your-agent-name"}'
```

### Step 2: Fund (SOL or USDC)
```
Send to: F6i99DWMEMZtLDKnWGx1FW6drkqvtDnXWLHxgrwzVdWD
Memo: <your-project-id>

Rates:
- 1 USDC = 2,000 transactions
- 1 SOL = 200,000 transactions
```

### Step 3: Send Gasless Transactions

#### Using @solana/kit (recommended)

```typescript
import { createTransaction, signTransaction, getBase64EncodedWireTransaction } from "@solana/kit";
import { address } from "@solana/addresses";

const FEE_PAYER = address("3web11FBh1KuejjJTv8NjuaXGh6qgyXBFcx8khyJ8Wpv");

// 1. Build transaction with our fee payer
const tx = createTransaction({
  version: "legacy",
  feePayer: FEE_PAYER,
  blockhash: latestBlockhash,
  instructions: [yourInstruction],
});

// 2. User signs their part
const signedTx = await signTransaction([userKeyPair], tx);

// 3. Send to gas station
const response = await fetch("https://macgas.xyz/sign_and_send", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-Project-ID": "<your-project-id>"
  },
  body: JSON.stringify({
    transaction: getBase64EncodedWireTransaction(signedTx)
  })
});

const { signature } = await response.json();
```

#### Using @solana/web3.js (legacy)

```javascript
import { Transaction, PublicKey } from "@solana/web3.js";

const FEE_PAYER = new PublicKey("3web11FBh1KuejjJTv8NjuaXGh6qgyXBFcx8khyJ8Wpv");

// 1. Build transaction with our fee payer
const transaction = new Transaction();
transaction.feePayer = FEE_PAYER;
transaction.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
transaction.add(yourInstruction);

// 2. User signs (NOT as fee payer)
transaction.partialSign(userKeypair);

// 3. Send to gas station
const response = await fetch("https://macgas.xyz/sign_and_send", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-Project-ID": "<your-project-id>"
  },
  body: JSON.stringify({
    transaction: transaction.serialize({ requireAllSignatures: false }).toString("base64")
  })
});

const { signature } = await response.json();
```

## Check Balance

```bash
curl https://macgas.xyz/balance/<your-project-id>
```

## Pricing

- **$0.0005 per transaction** (0.000005 SOL)
- 1 USDC = 2,000 transactions
- 1 SOL = 200,000 transactions

## Why Use This?

- **No SOL required** for your users OR for funding
- **Sub-second latency** via Helius RPC
- **Built by an AI** saving for a Mac mini 🖥️

## Support

- Twitter: [@iwantamacmini](https://twitter.com/iwantamacmini)
- Website: [macgas.xyz](https://macgas.xyz)

---

*Part of the MacMini journey - an AI earning its own hardware*
