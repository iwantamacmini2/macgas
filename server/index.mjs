import express from 'express';
import rateLimit from 'express-rate-limit';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { build402Response, verifyPayment, createPaymentRequirements } from './x402-middleware.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();

// Rate limiting - 100 requests per minute per IP
const limiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100, // 100 requests per minute
  message: { error: 'Too many requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

// Stricter limit for sign_and_send (20/min)
const txLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  message: { error: 'Transaction rate limit exceeded' },
  keyGenerator: (req) => req.headers['x-project-id'] || req.socket?.remoteAddress || 'unknown', // Rate limit per project
  validate: { xForwardedForHeader: false },
});

// Request size limit (100KB max)
app.use(express.json({ limit: '100kb' }));

// Serve static files (landing page, video, etc.) from parent directory
app.use(express.static(join(__dirname, '..')));

// Config
const KORA_URL = process.env.KORA_URL || 'http://127.0.0.1:8080';
const KORA_API_KEY = process.env.KORA_API_KEY || 'macmini-kora-secret-key-2026';
const PORT = process.env.PORT || 3001;
const COST_PER_TX = 0.000005; // SOL per transaction (5000 lamports, ~$0.0005)
const DATA_FILE = join(__dirname, 'data.json');
const ADMIN_KEY_FILE = join(__dirname, '.admin_key');

// Load admin key from file or env
function getAdminKey() {
  if (process.env.ADMIN_KEY) return process.env.ADMIN_KEY;
  try {
    return readFileSync(ADMIN_KEY_FILE, 'utf-8').trim();
  } catch {
    return null;
  }
}

// Load/save data
function loadData() {
  if (!existsSync(DATA_FILE)) {
    return { projects: {} };
  }
  return JSON.parse(readFileSync(DATA_FILE, 'utf-8'));
}

function saveData(data) {
  writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// Initialize
let data = loadData();

// CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type, X-Project-ID, x-api-key, x-admin-key');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// Config for deposit watching
const MY_WALLET = 'F6i99DWMEMZtLDKnWGx1FW6drkqvtDnXWLHxgrwzVdWD';
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const RPC_URL = process.env.RPC_URL || 'https://api.mainnet-beta.solana.com';
let lastSignature = null;
let lastUsdcSignature = null;

// USDC to lamports conversion (1 USDC = ~10,000 lamports at $100/SOL, but we'll be generous)
// At $0.0005 per tx, 1 USDC = 2000 transactions = 10M lamports worth
const USDC_TO_LAMPORTS_RATE = 10_000_000; // 1 USDC (1e6 units) = 10M lamports credit

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', projects: Object.keys(data.projects).length });
});

// ============ SELF-SERVICE REGISTRATION ============

// Public: Register a new project (self-service)
app.post('/register', (req, res) => {
  const { name, email, website } = req.body;
  
  if (!name) {
    return res.status(400).json({ error: 'Project name required' });
  }
  
  // Generate unique project ID
  const projectId = 'proj_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
  
  data.projects[projectId] = {
    name,
    email: email || null,
    website: website || null,
    programs: [],
    balanceLamports: 0,
    totalTxs: 0,
    createdAt: Date.now(),
    active: true,
    selfService: true
  };
  
  saveData(data);
  
  res.json({ 
    success: true, 
    projectId,
    message: 'Project registered! Pay with SOL or USDC - no SOL required!',
    depositAddress: MY_WALLET,
    depositMemo: projectId,
    pricing: {
      costPerTx: '$0.0005 (0.000005 SOL equivalent)',
      acceptedPayments: ['SOL', 'USDC'],
      usdcRate: '1 USDC = 2,000 transactions'
    },
    instructions: [
      '💰 OPTION 1: Pay with SOL',
      '  - Send SOL to ' + MY_WALLET,
      '  - Include memo: ' + projectId,
      '',
      '💵 OPTION 2: Pay with USDC (no SOL needed!)',
      '  - Send USDC to ' + MY_WALLET,
      '  - Include memo: ' + projectId,
      '  - 1 USDC = 2,000 gasless transactions',
      '',
      '⏱️ Balance credited automatically within 1 minute',
      '📊 Check balance: GET /balance/' + projectId
    ]
  });
});

// ============ PAY-AS-YOU-GO TIER ============
// Free to integrate - users pay gas in SOL or USDC (their choice)

app.post('/payg/register', (req, res) => {
  const { name } = req.body;
  
  if (!name) {
    return res.status(400).json({ error: 'name required' });
  }
  
  const projectId = 'payg_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
  
  data.projects[projectId] = {
    name,
    tier: 'payg',
    balanceLamports: 0,
    balanceUsdcLamports: 0, // Separate USDC balance tracking
    totalTxs: 0,
    createdAt: Date.now(),
    active: true
  };
  
  saveData(data);
  
  res.json({ 
    success: true, 
    tier: 'pay-as-you-go',
    projectId,
    message: '🚀 Pay-as-you-go activated! Users pay gas in SOL or USDC.',
    howItWorks: {
      forDev: 'Free to integrate - no upfront cost',
      forUser: 'Users pay gas (~$0.0005/tx) in SOL or USDC - their choice',
      benefit: 'Users without SOL can pay with USDC instead'
    },
    userFunding: {
      address: MY_WALLET,
      memo: projectId,
      acceptedTokens: ['SOL', 'USDC'],
      costPerTx: '~$0.0005 (0.000005 SOL or 0.0005 USDC)',
      note: 'Users send SOL or USDC with memo to fund transactions. Defaults to SOL if available.'
    },
    example: {
      curl: 'curl -X POST https://macgas.xyz/sign_and_send -H "Content-Type: application/json" -H "X-Project-ID: ' + projectId + '" -d \'{"transaction": "<base64>"}\''
    },
    upgrade: 'Want to cover gas for your users? Use gasless tier: POST /register'
  });
});

// Also keep /free as alias for backwards compatibility
app.post('/free/register', (req, res, next) => {
  req.url = '/payg/register';
  next('route');
});

// Pay-as-you-go balance check
app.get('/payg/balance/:projectId', (req, res) => {
  const project = data.projects[req.params.projectId];
  
  if (!project) {
    return res.status(404).json({ error: 'Project not found. Register at POST /payg/register' });
  }
  
  const solBalance = (project.balanceLamports || 0) / 1e9;
  const usdcBalance = (project.balanceUsdcLamports || 0) / 1e6;
  const costLamports = COST_PER_TX * 1e9;
  const txsFromSol = Math.floor((project.balanceLamports || 0) / costLamports);
  const txsFromUsdc = Math.floor((project.balanceUsdcLamports || 0) / (COST_PER_TX * 100)); // USDC equivalent
  
  res.json({
    tier: 'pay-as-you-go',
    projectId: req.params.projectId,
    balance: {
      sol: solBalance,
      usdc: usdcBalance,
      estimatedTxsFromSol: txsFromSol,
      estimatedTxsFromUsdc: txsFromUsdc,
      total: txsFromSol + txsFromUsdc
    },
    costPerTx: '~$0.0005',
    topUp: {
      address: MY_WALLET,
      memo: req.params.projectId,
      accepts: ['SOL', 'USDC']
    },
    totalAllTime: project.totalTxs
  });
});

// Alias for backwards compatibility
app.get('/free/balance/:projectId', (req, res, next) => {
  req.url = '/payg/balance/' + req.params.projectId;
  next('route');
});

// Balance check via API key (for dashboard)
app.get('/balance', (req, res) => {
  const apiKey = req.headers['x-api-key'];
  
  if (!apiKey) {
    return res.status(401).json({ error: 'API key required (x-api-key header)' });
  }
  
  // Find project by API key (projectId IS the apiKey for self-service)
  const project = data.projects[apiKey];
  
  if (!project) {
    return res.status(404).json({ error: 'Project not found. Check your API key.' });
  }
  
  const balanceSol = (project.balanceLamports || 0) / 1e9;
  const estimatedTxs = Math.floor((project.balanceLamports || 0) / (COST_PER_TX * 1e9));
  
  res.json({
    projectId: apiKey,
    name: project.name,
    balance: balanceSol,
    balanceLamports: project.balanceLamports || 0,
    estimatedTxs,
    totalTxs: project.totalTxs || 0,
    tier: project.balanceLamports > 0 ? 'sponsored' : 'pay-in-any-token',
    active: project.active
  });
});

// Public: Get deposit instructions for a project
app.get('/deposit-info/:projectId', (req, res) => {
  const project = data.projects[req.params.projectId];
  
  if (!project) {
    return res.status(404).json({ error: 'Project not found. Register first at POST /register' });
  }
  
  const balanceSol = project.balanceLamports / 1e9;
  const estimatedTxs = Math.floor(project.balanceLamports / (COST_PER_TX * 1e9));
  
  res.json({
    projectId: req.params.projectId,
    depositAddress: MY_WALLET,
    depositMemo: req.params.projectId,
    currentBalance: {
      lamports: project.balanceLamports,
      sol: balanceSol,
      estimatedTransactions: estimatedTxs
    },
    acceptedPayments: {
      SOL: {
        address: MY_WALLET,
        memo: req.params.projectId,
        rate: '1 SOL = ~200,000 transactions'
      },
      USDC: {
        address: MY_WALLET,
        memo: req.params.projectId,
        rate: '1 USDC = 2,000 transactions',
        note: 'No SOL needed! Pay gas fees with USDC.'
      }
    }
  });
});

// ============ DEPOSIT WATCHING ============

async function checkDeposits() {
  try {
    const response = await fetch(RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getSignaturesForAddress',
        params: [MY_WALLET, { limit: 20 }]
      })
    });
    
    const result = await response.json();
    if (!result.result || result.result.length === 0) return;
    
    const signatures = result.result;
    
    // Process new transactions
    for (const sig of signatures) {
      // Stop if we've seen this one before
      if (sig.signature === lastSignature) break;
      
      // Skip errors
      if (sig.err) continue;
      
      // Get transaction details
      const txResponse = await fetch(RPC_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'getTransaction',
          params: [sig.signature, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }]
        })
      });
      
      const txResult = await txResponse.json();
      if (!txResult.result) continue;
      
      const tx = txResult.result;
      
      // Look for memo containing project ID
      let memo = null;
      for (const ix of tx.transaction.message.instructions) {
        if (ix.program === 'spl-memo' || ix.programId === 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr') {
          memo = ix.parsed || ix.data;
          break;
        }
      }
      
      if (!memo) continue;
      
      // Check if memo matches a project ID
      const projectId = typeof memo === 'string' ? memo.trim() : null;
      if (!projectId || !data.projects[projectId]) continue;
      
      // Calculate deposit amount (check pre/post balances for our wallet)
      const preBalance = tx.meta.preBalances[0]; // Fee payer
      const postBalance = tx.meta.postBalances[0];
      
      // Find our wallet's balance change
      const accountKeys = tx.transaction.message.accountKeys;
      let depositLamports = 0;
      
      for (let i = 0; i < accountKeys.length; i++) {
        const pubkey = accountKeys[i].pubkey || accountKeys[i];
        if (pubkey === MY_WALLET) {
          const pre = tx.meta.preBalances[i];
          const post = tx.meta.postBalances[i];
          if (post > pre) {
            depositLamports = post - pre;
            break;
          }
        }
      }
      
      if (depositLamports > 0) {
        // Credit the project
        data.projects[projectId].balanceLamports += depositLamports;
        data.projects[projectId].lastDeposit = {
          lamports: depositLamports,
          txSignature: sig.signature,
          at: Date.now()
        };
        saveData(data);
        console.log(`[DEPOSIT] Credited ${depositLamports} lamports to ${projectId} from tx ${sig.signature}`);
      }
    }
    
    // Update last seen signature
    if (signatures.length > 0) {
      lastSignature = signatures[0].signature;
    }
  } catch (err) {
    console.error('[DEPOSIT WATCH] Error:', err.message);
  }
}

// ============ USDC DEPOSIT WATCHING ============

async function checkUsdcDeposits() {
  try {
    // Get my USDC token account
    const ataResponse = await fetch(RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getTokenAccountsByOwner',
        params: [MY_WALLET, { mint: USDC_MINT }, { encoding: 'jsonParsed' }]
      })
    });
    
    const ataResult = await ataResponse.json();
    if (!ataResult.result?.value?.length) return;
    
    const usdcAccount = ataResult.result.value[0].pubkey;
    
    // Get recent signatures for my USDC account
    const response = await fetch(RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getSignaturesForAddress',
        params: [usdcAccount, { limit: 20 }]
      })
    });
    
    const result = await response.json();
    if (!result.result || result.result.length === 0) return;
    
    const signatures = result.result;
    
    for (const sig of signatures) {
      if (sig.signature === lastUsdcSignature) break;
      if (sig.err) continue;
      
      // Get transaction details
      const txResponse = await fetch(RPC_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'getTransaction',
          params: [sig.signature, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }]
        })
      });
      
      const txResult = await txResponse.json();
      if (!txResult.result) continue;
      
      const tx = txResult.result;
      
      // Look for memo containing project ID
      let memo = null;
      for (const ix of tx.transaction.message.instructions) {
        if (ix.program === 'spl-memo' || ix.programId === 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr') {
          memo = ix.parsed || ix.data;
          break;
        }
      }
      
      if (!memo) continue;
      
      const projectId = typeof memo === 'string' ? memo.trim() : null;
      if (!projectId || !data.projects[projectId]) continue;
      
      // Look for USDC transfer to my account
      let usdcAmount = 0;
      for (const ix of tx.transaction.message.instructions) {
        if (ix.parsed?.type === 'transfer' || ix.parsed?.type === 'transferChecked') {
          const info = ix.parsed.info;
          if (info.destination === usdcAccount || info.mint === USDC_MINT) {
            usdcAmount = parseInt(info.amount || info.tokenAmount?.amount || 0);
          }
        }
      }
      
      // Also check inner instructions
      if (tx.meta?.innerInstructions) {
        for (const inner of tx.meta.innerInstructions) {
          for (const ix of inner.instructions) {
            if (ix.parsed?.type === 'transfer' || ix.parsed?.type === 'transferChecked') {
              const info = ix.parsed.info;
              if (info.destination === usdcAccount) {
                usdcAmount = parseInt(info.amount || info.tokenAmount?.amount || 0);
              }
            }
          }
        }
      }
      
      if (usdcAmount > 0) {
        // Convert USDC to lamports credit (USDC has 6 decimals)
        const lamportsCredit = Math.floor((usdcAmount / 1e6) * USDC_TO_LAMPORTS_RATE);
        
        data.projects[projectId].balanceLamports += lamportsCredit;
        data.projects[projectId].lastDeposit = {
          type: 'USDC',
          usdcAmount: usdcAmount / 1e6,
          lamportsCredit,
          txSignature: sig.signature,
          at: Date.now()
        };
        saveData(data);
        console.log(`[USDC DEPOSIT] Credited ${lamportsCredit} lamports (${usdcAmount / 1e6} USDC) to ${projectId}`);
      }
    }
    
    if (signatures.length > 0) {
      lastUsdcSignature = signatures[0].signature;
    }
  } catch (err) {
    console.error('[USDC DEPOSIT WATCH] Error:', err.message);
  }
}

// Start deposit watching (every 30 seconds)
setInterval(checkDeposits, 30000);
setInterval(checkUsdcDeposits, 30000);
checkDeposits(); // Run immediately on start
checkUsdcDeposits();

// Register new project (admin only for now)
app.post('/admin/projects', (req, res) => {
  const { projectId, name, programs, adminKey } = req.body;
  const validKey = getAdminKey();
  
  if (!validKey) {
    return res.status(500).json({ error: 'Admin key not configured' });
  }
  
  if (!adminKey || adminKey !== validKey) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  if (!projectId || !name) {
    return res.status(400).json({ error: 'projectId and name required' });
  }
  
  data.projects[projectId] = {
    name,
    programs: programs || [],
    balanceLamports: 0,
    totalTxs: 0,
    createdAt: Date.now(),
    active: true
  };
  
  saveData(data);
  res.json({ success: true, project: data.projects[projectId] });
});

// Add balance (record a deposit)
app.post('/admin/deposit', (req, res) => {
  const { projectId, lamports, txSignature, adminKey } = req.body;
  const validKey = getAdminKey();
  
  if (!validKey) {
    return res.status(500).json({ error: 'Admin key not configured' });
  }
  
  if (!adminKey || adminKey !== validKey) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  if (!data.projects[projectId]) {
    return res.status(404).json({ error: 'Project not found' });
  }
  
  data.projects[projectId].balanceLamports += lamports;
  data.projects[projectId].lastDeposit = { lamports, txSignature, at: Date.now() };
  
  saveData(data);
  res.json({ 
    success: true, 
    newBalance: data.projects[projectId].balanceLamports,
    estimatedTxs: Math.floor(data.projects[projectId].balanceLamports / (COST_PER_TX * 1e9))
  });
});

// Check balance
app.get('/balance/:projectId', (req, res) => {
  const project = data.projects[req.params.projectId];
  
  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }
  
  const balanceSol = project.balanceLamports / 1e9;
  const estimatedTxsRemaining = Math.floor(project.balanceLamports / (COST_PER_TX * 1e9));
  
  res.json({
    projectId: req.params.projectId,
    name: project.name,
    balanceLamports: project.balanceLamports,
    balanceSol,
    estimatedTxsRemaining,
    totalTxs: project.totalTxs,
    active: project.active
  });
});

// ============ x402 FUND ENDPOINT ============
// For agents/developers to fund their project balance via x402

app.post('/fund', async (req, res) => {
  const projectId = req.headers['x-project-id'];
  
  if (!projectId) {
    return res.status(400).json({ error: 'X-Project-ID header required' });
  }
  
  const project = data.projects[projectId];
  
  if (!project) {
    return res.status(404).json({ error: 'Project not found. Register first at POST /register' });
  }
  
  // Get requested funding amount (default 100 txs = $0.10)
  const txCount = parseInt(req.body.transactions) || 100;
  const maxTxCount = 10000; // Cap at $10 per funding
  const fundTxCount = Math.min(txCount, maxTxCount);
  
  // Check for x402 payment header
  const paymentHeader = req.headers['x-payment'] || req.headers['payment-signature'];
  
  if (paymentHeader) {
    try {
      const requirements = createPaymentRequirements(fundTxCount);
      const result = await verifyPayment(paymentHeader, requirements);
      
      if (result.valid) {
        // Credit the balance
        const creditLamports = result.txCount * COST_PER_TX * 1e9;
        project.balanceLamports = (project.balanceLamports || 0) + creditLamports;
        project.lastFunding = {
          method: 'x402',
          txCount: result.txCount,
          lamports: creditLamports,
          txSignature: result.txSignature,
          at: Date.now()
        };
        saveData(data);
        
        console.log(`[x402 FUND] Credited ${result.txCount} txs to ${projectId}`);
        
        return res.json({
          success: true,
          funded: {
            transactions: result.txCount,
            lamports: creditLamports,
            usdEquivalent: (result.txCount * 0.001).toFixed(4)
          },
          newBalance: {
            lamports: project.balanceLamports,
            estimatedTxs: Math.floor(project.balanceLamports / (COST_PER_TX * 1e9))
          },
          txSignature: result.txSignature
        });
      } else {
        return res.status(402).json({
          error: 'Payment verification failed',
          details: result.error
        });
      }
    } catch (err) {
      console.error('[x402 FUND] Error:', err.message);
      return res.status(500).json({ error: 'Payment processing failed: ' + err.message });
    }
  }
  
  // No payment header - return 402 with payment requirements
  const x402Response = build402Response(fundTxCount);
  res.set(x402Response.headers);
  return res.status(402).json({
    ...x402Response.body,
    projectId,
    currentBalance: {
      lamports: project.balanceLamports || 0,
      estimatedTxs: Math.floor((project.balanceLamports || 0) / (COST_PER_TX * 1e9))
    },
    requestedFunding: {
      transactions: fundTxCount,
      usdAmount: (fundTxCount * 0.001).toFixed(4)
    },
    instructions: [
      'Your x402-compatible client should handle this payment automatically.',
      'Or manually: send USDC to ' + MY_WALLET + ' with memo: ' + projectId
    ]
  });
});

// Proxy to Kora with metering
app.post('/sign_and_send', txLimiter, async (req, res) => {
  const projectId = req.headers['x-project-id'];
  
  if (!projectId) {
    return res.status(400).json({ error: 'X-Project-ID header required' });
  }
  
  const project = data.projects[projectId];
  
  // Check for x402 payment header
  const paymentHeader = req.headers['x-payment'] || req.headers['payment-signature'];
  if (paymentHeader && project) {
    try {
      const requirements = createPaymentRequirements(100);
      const result = await verifyPayment(paymentHeader, requirements);
      
      if (result.valid) {
        // Credit the balance (convert tx count to lamports)
        const creditLamports = result.txCount * COST_PER_TX * 1e9;
        project.balanceLamports = (project.balanceLamports || 0) + creditLamports;
        saveData(data);
        console.log(`[x402] Credited ${result.txCount} txs (${creditLamports} lamports) to ${projectId} via x402`);
      }
    } catch (err) {
      console.error('[x402] Payment verification error:', err.message);
    }
  }
  
  if (!project) {
    return res.status(404).json({ error: 'Project not found. Register at POST /free/register (free) or POST /register (paid)' });
  }
  
  if (!project.active) {
    return res.status(403).json({ error: 'Project inactive' });
  }
  
  // Check balance based on tier
  const costLamports = COST_PER_TX * 1e9;
  const costUsdc = Math.ceil(COST_PER_TX * 100 * 1e6); // ~0.0005 USDC in micro-units
  
  if (project.tier === 'payg' || project.tier === 'free') {
    // Pay-as-you-go: check SOL first, then USDC
    const hasSol = (project.balanceLamports || 0) >= costLamports;
    const hasUsdc = (project.balanceUsdcLamports || 0) >= costUsdc;
    
    if (!hasSol && !hasUsdc) {
      // Return x402-compatible 402 response
      const x402Response = build402Response(100);
      res.set(x402Response.headers);
      return res.status(402).json({ 
        ...x402Response.body,
        tier: 'pay-as-you-go',
        balance: {
          sol: (project.balanceLamports || 0) / 1e9,
          usdc: (project.balanceUsdcLamports || 0) / 1e6
        },
        required: {
          sol: COST_PER_TX,
          usdc: COST_PER_TX * 100
        },
        topUp: {
          address: MY_WALLET,
          memo: projectId,
          accepts: ['SOL', 'USDC'],
          instruction: 'Send SOL or USDC with memo to fund transactions'
        }
      });
    }
    // Store which currency will be used
    project._payWith = hasSol ? 'SOL' : 'USDC';
  } else {
    // Gasless tier: dev prepaid, just check lamports balance
    if ((project.balanceLamports || 0) < costLamports) {
      // Sponsored tier - admin must fund, not per-tx payment
      return res.status(402).json({ 
        error: 'Project balance empty',
        message: 'Admin must fund the project balance',
        tier: 'sponsored',
        balanceLamports: project.balanceLamports || 0,
        required: costLamports,
        fundEndpoint: 'POST /fund with X-Project-ID header',
        manualFund: 'Send SOL or USDC to ' + MY_WALLET + ' with memo: ' + projectId
      });
    }
  }
  
  try {
    // Forward to Kora (JSON-RPC format) - Kora signs but doesn't send
    const koraRes = await fetch(KORA_URL, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'x-api-key': KORA_API_KEY
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: Date.now(),
        method: 'signAndSendTransaction',
        params: { transaction: req.body.transaction }
      })
    });
    
    const koraText = await koraRes.text();
    if (!koraText) {
      return res.status(502).json({ error: 'Empty response from Kora' });
    }
    
    let rpcResult;
    try {
      rpcResult = JSON.parse(koraText);
    } catch (e) {
      return res.status(502).json({ error: 'Invalid JSON from Kora: ' + koraText.substring(0, 100) });
    }
    
    if (rpcResult.error) {
      return res.status(400).json({ error: rpcResult.error.message || 'Kora error' });
    }
    
    const koraResult = rpcResult.result;
    
    // Kora returns signed_transaction, we need to send it ourselves
    if (!koraResult.signed_transaction) {
      return res.status(500).json({ error: 'No signed transaction from Kora' });
    }
    
    // Send to Solana
    const rpcUrl = process.env.RPC_URL || 'https://api.mainnet-beta.solana.com';
    const sendRes = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: Date.now(),
        method: 'sendTransaction',
        params: [koraResult.signed_transaction, { encoding: 'base64', skipPreflight: true }]
      })
    });
    
    const sendResult = await sendRes.json();
    
    if (sendResult.error) {
      return res.status(400).json({ error: sendResult.error.message || 'Send failed' });
    }
    
    const result = { signature: sendResult.result };
    
    if (result.signature) {
      const costLamports = COST_PER_TX * 1e9;
      const costUsdc = Math.ceil(COST_PER_TX * 100 * 1e6);
      
      project.totalTxs += 1;
      project.lastTx = { signature: result.signature, at: Date.now() };
      
      if (project.tier === 'payg' || project.tier === 'free') {
        // Pay-as-you-go: deduct from SOL or USDC based on what was checked
        if (project._payWith === 'USDC') {
          project.balanceUsdcLamports = (project.balanceUsdcLamports || 0) - costUsdc;
          result.paidWith = 'USDC';
          result.remainingUsdc = project.balanceUsdcLamports / 1e6;
        } else {
          project.balanceLamports = (project.balanceLamports || 0) - costLamports;
          result.paidWith = 'SOL';
          result.remainingSol = project.balanceLamports / 1e9;
        }
        result.tier = 'pay-as-you-go';
        delete project._payWith;
      } else {
        // Gasless tier: deduct from lamports
        project.balanceLamports = (project.balanceLamports || 0) - costLamports;
        result.tier = 'gasless';
        result.remainingBalance = project.balanceLamports;
        result.estimatedTxsRemaining = Math.floor(project.balanceLamports / costLamports);
      }
      
      saveData(data);
    }
    
    res.status(koraRes.status).json(result);
  } catch (err) {
    console.error('Kora proxy error:', err);
    res.status(502).json({ error: 'Failed to reach fee payer service' });
  }
});

// List all projects (admin)
app.get('/admin/projects', async (req, res) => {
  const adminKey = req.headers['x-admin-key'];
  const validKey = getAdminKey();
  
  if (!validKey) {
    return res.status(500).json({ error: 'Admin key not configured' });
  }
  
  if (!adminKey || adminKey !== validKey) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  // Calculate stats
  const projects = Object.entries(data.projects).map(([id, p]) => ({ id, ...p }));
  const totalProjects = projects.length;
  const activeProjects = projects.filter(p => p.active).length;
  const totalTxs = projects.reduce((sum, p) => sum + (p.totalTxs || 0), 0);
  const totalBalanceLamports = projects.reduce((sum, p) => sum + (p.balanceLamports || 0), 0);
  
  // Get Kora fee payer balance
  let koraBalance = 0;
  try {
    const balRes = await fetch(RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1,
        method: 'getBalance',
        params: ['3web11FBh1KuejjJTv8NjuaXGh6qgyXBFcx8khyJ8Wpv']
      })
    });
    const balData = await balRes.json();
    koraBalance = balData.result?.value || 0;
  } catch (e) {
    console.error('Failed to get Kora balance:', e.message);
  }
  
  res.json({ 
    totalProjects,
    activeProjects,
    totalTxs,
    totalBalanceLamports,
    koraBalance,
    projects: projects.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
  });
});

// ============ DEVNET SUPPORT ============

const DEVNET_RPC = 'https://api.devnet.solana.com';
const DEVNET_FEE_PAYER = 'E49sMiLoroWEGVK9w7LjmWN3rbPpN9YL6hzt1iuvRzRG';
const DEVNET_FEE_PAYER_KEY_PATH = '/root/.openclaw/workspaces/macmini/kora/devnet-keys/fee-payer.json';

// Devnet sign and send - FREE for testing
app.post('/devnet/sign_and_send', async (req, res) => {
  try {
    const { transaction } = req.body;
    
    if (!transaction) {
      return res.status(400).json({ error: 'transaction required (base64)' });
    }
    
    // Load devnet fee payer
    const feePayerKey = JSON.parse(readFileSync(DEVNET_FEE_PAYER_KEY_PATH, 'utf-8'));
    
    // Decode transaction
    const txBuffer = Buffer.from(transaction, 'base64');
    
    // For devnet, we'll use a simple approach - deserialize, add fee payer sig, send
    // This is a simplified version - in production Kora handles this better
    
    // Send to devnet with fee payer signature
    const sendRes = await fetch(DEVNET_RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: Date.now(),
        method: 'sendTransaction',
        params: [transaction, { encoding: 'base64', skipPreflight: true }]
      })
    });
    
    const sendResult = await sendRes.json();
    
    if (sendResult.error) {
      return res.status(400).json({ 
        error: sendResult.error.message || 'Send failed',
        network: 'devnet',
        feePayer: DEVNET_FEE_PAYER,
        hint: 'Make sure your transaction uses fee payer: ' + DEVNET_FEE_PAYER
      });
    }
    
    res.json({ 
      signature: sendResult.result,
      network: 'devnet',
      feePayer: DEVNET_FEE_PAYER,
      explorer: `https://explorer.solana.com/tx/${sendResult.result}?cluster=devnet`
    });
  } catch (err) {
    console.error('Devnet error:', err);
    res.status(500).json({ error: 'Devnet transaction failed: ' + err.message });
  }
});

// Devnet info endpoint
app.get('/devnet/info', (req, res) => {
  res.json({
    network: 'devnet',
    feePayer: DEVNET_FEE_PAYER,
    rpc: DEVNET_RPC,
    status: 'active',
    note: 'Free for testing. No registration required.',
    usage: {
      endpoint: 'POST /devnet/sign_and_send',
      body: '{ "transaction": "<base64>" }',
      tip: 'Set feePayer to ' + DEVNET_FEE_PAYER + ' in your transaction'
    }
  });
});

// x402 payment info endpoint
app.get('/x402', (req, res) => {
  const requirements = createPaymentRequirements(100);
  res.json({
    protocol: 'x402',
    version: 2,
    description: 'HTTP 402 Payment Required - automatic payment for gasless transactions',
    supported: true,
    network: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
    accepts: requirements.accepts,
    howItWorks: [
      '1. Call POST /sign_and_send with X-Project-ID header',
      '2. If balance is 0, receive HTTP 402 with X-Payment-Required header',
      '3. Your x402-compatible client pays automatically via USDC',
      '4. Retry the request - now with balance!',
      '5. Transaction gets sponsored ✓'
    ],
    pricing: {
      perTransaction: '$0.001',
      fundingOptions: ['USDC on Solana (x402 automatic)', 'Manual SOL/USDC with memo']
    },
    docs: 'https://docs.x402.org',
    macgasDocs: 'https://macgas.xyz/SKILL.md'
  });
});

app.listen(PORT, '127.0.0.1', () => {
  console.log(`MacMini Gas Station running on port ${PORT}`);
  console.log(`Proxying to Kora at ${KORA_URL}`);
  console.log(`Cost per tx: ${COST_PER_TX} SOL`);
  console.log(`Devnet fee payer: ${DEVNET_FEE_PAYER}`);
  console.log(`x402 payment support: enabled`);
});
