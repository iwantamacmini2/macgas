import express from 'express';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());

// Config
const KORA_URL = process.env.KORA_URL || 'http://localhost:3000';
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

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', projects: Object.keys(data.projects).length });
});

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
    // Forward to Kora
    const koraRes = await fetch(`${KORA_URL}/sign_and_send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body)
    });
    
    const result = await koraRes.json();
    
    if (koraRes.ok && result.signature) {
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
