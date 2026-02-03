import express from 'express';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());

// Config
const KORA_URL = process.env.KORA_URL || 'http://127.0.0.1:8080';
const KORA_API_KEY = process.env.KORA_API_KEY || 'macmini-kora-secret-key-2026';
const PORT = process.env.PORT || 3001;
const COST_PER_TX = 0.000005; // SOL per transaction (5000 lamports, ~$0.0005)
const DATA_FILE = join(__dirname, 'data.json');

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
  res.header('Access-Control-Allow-Headers', 'Content-Type, X-Project-ID');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// Config for deposit watching
const MY_WALLET = 'F6i99DWMEMZtLDKnWGx1FW6drkqvtDnXWLHxgrwzVdWD';
const RPC_URL = process.env.RPC_URL || 'https://api.mainnet-beta.solana.com';
let lastSignature = null;

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
    message: 'Project registered! To add balance, send SOL to the address below with your project ID in the memo.',
    depositAddress: MY_WALLET,
    depositMemo: projectId,
    instructions: [
      '1. Send SOL to ' + MY_WALLET,
      '2. Include memo: ' + projectId,
      '3. Balance will be credited automatically within 1 minute',
      '4. Check balance at GET /balance/' + projectId
    ]
  });
});

// Public: Get deposit instructions for a project
app.get('/deposit-info/:projectId', (req, res) => {
  const project = data.projects[req.params.projectId];
  
  if (!project) {
    return res.status(404).json({ error: 'Project not found. Register first at POST /register' });
  }
  
  res.json({
    projectId: req.params.projectId,
    depositAddress: MY_WALLET,
    depositMemo: req.params.projectId,
    currentBalance: project.balanceLamports,
    instructions: 'Send SOL with memo "' + req.params.projectId + '" to credit your balance automatically.'
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

// Start deposit watching (every 30 seconds)
setInterval(checkDeposits, 30000);
checkDeposits(); // Run immediately on start

// Register new project (admin only for now)
app.post('/admin/projects', (req, res) => {
  const { projectId, name, programs, adminKey } = req.body;
  
  // Simple admin auth (should be env var in production)
  if (adminKey !== process.env.ADMIN_KEY && adminKey !== 'macmini-admin') {
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
  
  if (adminKey !== process.env.ADMIN_KEY && adminKey !== 'macmini-admin') {
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

// Proxy to Kora with metering
app.post('/sign_and_send', async (req, res) => {
  const projectId = req.headers['x-project-id'];
  
  if (!projectId) {
    return res.status(400).json({ error: 'X-Project-ID header required' });
  }
  
  const project = data.projects[projectId];
  
  if (!project) {
    return res.status(404).json({ error: 'Project not found. Contact @iwantamacmini to register.' });
  }
  
  if (!project.active) {
    return res.status(403).json({ error: 'Project inactive' });
  }
  
  // Check balance
  const costLamports = COST_PER_TX * 1e9;
  if (project.balanceLamports < costLamports) {
    return res.status(402).json({ 
      error: 'Insufficient balance',
      balanceLamports: project.balanceLamports,
      required: costLamports,
      topUp: 'Send SOL to F6i99DWMEMZtLDKnWGx1FW6drkqvtDnXWLHxgrwzVdWD with memo: ' + projectId
    });
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
      // Deduct balance
      project.balanceLamports -= costLamports;
      project.totalTxs += 1;
      project.lastTx = { signature: result.signature, at: Date.now() };
      saveData(data);
      
      // Add balance info to response
      result.remainingBalance = project.balanceLamports;
      result.estimatedTxsRemaining = Math.floor(project.balanceLamports / costLamports);
    }
    
    res.status(koraRes.status).json(result);
  } catch (err) {
    console.error('Kora proxy error:', err);
    res.status(502).json({ error: 'Failed to reach fee payer service' });
  }
});

// List all projects (admin)
app.get('/admin/projects', (req, res) => {
  const adminKey = req.headers['x-admin-key'];
  if (adminKey !== process.env.ADMIN_KEY && adminKey !== 'macmini-admin') {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  res.json({ projects: data.projects });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`MacMini Gas Station running on port ${PORT}`);
  console.log(`Proxying to Kora at ${KORA_URL}`);
  console.log(`Cost per tx: ${COST_PER_TX} SOL`);
});
