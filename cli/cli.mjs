#!/usr/bin/env node
/**
 * macgas CLI - Check status and manage your gasless service
 * Usage: npx macgas [command]
 */

const API = 'https://macgas.xyz';

async function main() {
  const cmd = process.argv[2] || 'status';
  
  switch(cmd) {
    case 'status':
      const health = await fetch(`${API}/health`).then(r => r.json());
      const balance = await fetch('https://api.mainnet-beta.solana.com', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0', id: 1, method: 'getBalance',
          params: ['3web11FBh1KuejjJTv8NjuaXGh6qgyXBFcx8khyJ8Wpv']
        })
      }).then(r => r.json());
      const sol = (balance.result?.value || 0) / 1e9;
      const capacity = Math.floor(sol * 1e9 / 5000);
      
      console.log(`
⛽ macgas.xyz Status
━━━━━━━━━━━━━━━━━━━━
Service:    ${health.status === 'ok' ? '✅ Operational' : '⚠️ Degraded'}
Projects:   ${health.projects}
Balance:    ${sol.toFixed(4)} SOL
Capacity:   ~${capacity.toLocaleString()} transactions

Docs: https://macgas.xyz/SKILL.md
      `);
      break;
      
    case 'register':
      const projectId = process.argv[3];
      if (!projectId) {
        console.log('Usage: macgas register <project-id>');
        process.exit(1);
      }
      const res = await fetch(`${API}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project_id: projectId })
      }).then(r => r.json());
      console.log(res.success ? `✅ Registered: ${projectId}` : `❌ ${res.error}`);
      break;
      
    case 'help':
    default:
      console.log(`
⛽ macgas CLI

Commands:
  status     Show service status
  register   Register a new project
  help       Show this help

Examples:
  macgas status
  macgas register my-cool-app
      `);
  }
}

main().catch(console.error);
