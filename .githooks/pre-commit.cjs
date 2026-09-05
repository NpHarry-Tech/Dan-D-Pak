const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { execFileSync } = require('node:child_process');

const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const diff = execFileSync('git', ['diff', '--cached'], { cwd: root, encoding: 'utf8' });
if (!diff.trim()) process.exit(0);

// Aevum's session/config is intentionally machine-local and ignored. The hook
// entrypoint itself is tracked so every clone can opt into the same behavior via
// `git config core.hooksPath .githooks`.
const configPath = path.join(root, '.aevum', 'mcp.json');
if (!fs.existsSync(configPath)) process.exit(0);

let port = 3344;
try { port = JSON.parse(fs.readFileSync(configPath, 'utf8')).port || port; }
catch { process.exit(0); }

const body = JSON.stringify({ diff });
const request = http.request({
  hostname: '127.0.0.1', port, path: '/api/git/pre-commit', method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
}, (response) => {
  let data = '';
  response.on('data', (chunk) => { data += chunk; });
  response.on('end', () => {
    try {
      const result = JSON.parse(data);
      if (result.success) process.exit(0);
      console.error('\n[Aevum Git Hook] Commit blocked:');
      console.error(result.message || 'Quality check did not pass.');
      process.exit(1);
    } catch { process.exit(0); }
  });
});
request.on('error', () => process.exit(0));
request.end(body);
