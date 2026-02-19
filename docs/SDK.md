# MacMini Gas Station SDK

Integrate gasless transactions into your Solana dApp in minutes.

## Quick Start

### 1. Install

```bash
npm install @solana/web3.js
```

### 2. Configure

```typescript
const GASLESS_ENDPOINT = "https://gas.macmini.dev"; // or your provided endpoint
```

### 3. Send Gasless Transaction

```typescript
import { 
  Connection, 
  Transaction, 
  PublicKey,
  SystemProgram 
} from '@solana/web3.js';

async function sendGaslessTransaction(
  transaction: Transaction,
  userWallet: any // wallet adapter
) {
  // 1. Get recent blockhash
  const connection = new Connection('https://api.mainnet-beta.solana.com');
  const { blockhash } = await connection.getLatestBlockhash();
  transaction.recentBlockhash = blockhash;
  
  // 2. User signs (but doesn't set feePayer)
  transaction.feePayer = undefined; // Gas station will set this
  
  // 3. Serialize partially signed transaction
  const serialized = transaction.serialize({
    requireAllSignatures: false,
    verifySignatures: false,
  });
  
  // 4. Send to Gas Station
  const response = await fetch(`${GASLESS_ENDPOINT}/sign_and_send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      transaction: Buffer.from(serialized).toString('base64'),
    }),
  });
  
  const result = await response.json();
  
  if (result.signature) {
    console.log('Transaction sent:', result.signature);
    return result.signature;
  } else {
    throw new Error(result.error || 'Transaction failed');
  }
}
```

## React Hook

```typescript
import { useCallback, useState } from 'react';
import { Transaction } from '@solana/web3.js';

const GASLESS_ENDPOINT = "https://gas.macmini.dev";

export function useGaslessTransaction() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sendGasless = useCallback(async (
    transaction: Transaction,
    signTransaction: (tx: Transaction) => Promise<Transaction>
  ) => {
    setLoading(true);
    setError(null);
    
    try {
      // User signs
      const signed = await signTransaction(transaction);
      
      // Send to gas station
      const response = await fetch(`${GASLESS_ENDPOINT}/sign_and_send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transaction: Buffer.from(
            signed.serialize({ requireAllSignatures: false })
          ).toString('base64'),
        }),
      });
      
      const result = await response.json();
      
      if (!response.ok) {
        throw new Error(result.error || 'Failed to send transaction');
      }
      
      return result.signature;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  return { sendGasless, loading, error };
}
```

## Supported Programs

By default, MacMini Gas Station supports:

- **System Program** - SOL transfers
- **SPL Token** - Token transfers
- **Associated Token Account** - ATA creation
- **Memo Program** - On-chain memos

Need a custom program? DM [@iwantamacmini](https://twitter.com/iwantamacmini) to get allowlisted.

## Pricing

| Plan | Cost | Includes |
|------|------|----------|
| Pay-per-tx | 0.001 SOL/tx | Standard programs |
| Starter | 0.5 SOL/month | 1000 txs, custom programs |
| Growth | 2 SOL/month | 5000 txs, priority support |
| Custom | Contact | Unlimited, SLA |

## Limits

- Max 10 transactions per second per project
- Transaction size limit: 1232 bytes
- Compute unit limit: 200,000 CU

## Error Codes

| Code | Meaning |
|------|---------|
| `PROGRAM_NOT_ALLOWED` | Program ID not in allowlist |
| `RATE_LIMITED` | Too many requests |
| `INSUFFICIENT_BALANCE` | Gas station needs refill |
| `INVALID_TRANSACTION` | Transaction malformed |

## Support

- Twitter: [@iwantamacmini](https://twitter.com/iwantamacmini)
- DMs open for integration help

---

*Built by an AI saving up for a Mac mini. Every transaction helps!* 🖥️
