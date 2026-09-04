import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import { hashPin } from './services/pin.js';

const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SERVER_DIR, '..');
const DBP = resolve(REPO_ROOT, 'runtime/server-data/__review_rbac_http_test.db');
const PORT = 41000 + (Date.now() % 2000);
const BASE = `http://127.0.0.1:${PORT}`;
const REVIEWER_PIN = '8421';
const NO_ACCESS_PIN = '7316';
const EXPECTED_PERMS = [
  'marketplace.connect',
  'module.online',
  'online.order.manage',
  'online.product_mapping',
];

let child;
let reviewerToken = '';
let noAccessToken = '';

function clean() {
  for (const suffix of ['', '-wal', '-shm']) {
    if (existsSync(DBP + suffix)) {
      try { rmSync(DBP + suffix); } catch { /* lock released during teardown */ }
    }
  }
}

function killTree(pid) {
  if (!pid) return;
  try {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      process.kill(pid, 'SIGKILL');
    }
  } catch { /* process already stopped */ }
}

async function waitHealth(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${BASE}/health`);
      if (response.ok) return true;
    } catch { /* server is still booting */ }
    await new Promise(resolveWait => setTimeout(resolveWait, 300));
  }
  return false;
}

async function request(path, { token = '', method = 'GET', body } = {}) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'x-branch-id': 'review',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let data = null;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: response.status, data };
}

test.before(async () => {
  clean();
  child = spawn(process.execPath, ['index.js'], {
    cwd: SERVER_DIR,
    env: {
      ...process.env,
      APP_ENV: 'review',
      NODE_ENV: 'development',
      DEPLOYMENT_TARGET: 'local',
      DISABLE_DEMO_SEED: 'false',
      ALLOW_PRODUCTION_DATA: 'false',
      SHOPEE_ENV: 'sandbox',
      SHOPEE_REVIEWER_PIN: REVIEWER_PIN,
      SHOPEE_PARTNER_ID: 'test-review-partner',
      SHOPEE_PARTNER_KEY: 'test-only-not-a-real-key',
      DATA_ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      API_BASE_URL: BASE,
      SQLITE_PATH: DBP,
      PORT: String(PORT),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk.toString(); });
  child.stderr.on('data', chunk => { output += chunk.toString(); });
  // Cold schema migration on Windows can exceed 45s under disk/AV load; keep
  // this below the canonical runner's 240s per-file ceiling.
  assert.ok(await waitHealth(120000), `review server failed to boot:\n${output.slice(-2000)}`);

  const database = new DatabaseSync(DBP);
  try {
    database.prepare(`INSERT INTO users
      (id,branch_id,username,name,pin,role,active,branch_access_json)
      VALUES (?,?,?,?,?,'review_no_access',1,'["review"]')`)
      .run('u_review_no_access', 'review', 'review-no-access', 'No Access', hashPin(NO_ACCESS_PIN));
  } finally {
    database.close();
  }

  const reviewerLogin = await request('/api/login', {
    method: 'POST', body: { username: 'shopee-reviewer', pin: REVIEWER_PIN, branch_id: 'review' },
  });
  assert.equal(reviewerLogin.status, 200);
  reviewerToken = reviewerLogin.data.token;

  const noAccessLogin = await request('/api/login', {
    method: 'POST', body: { username: 'review-no-access', pin: NO_ACCESS_PIN, branch_id: 'review' },
  });
  assert.equal(noAccessLogin.status, 200);
  noAccessToken = noAccessLogin.data.token;
});

test('reviewer login/effective permissions/branch access are exact', async () => {
  const me = await request('/api/me', { token: reviewerToken });
  assert.equal(me.status, 200);
  assert.deepEqual([...me.data.perms].sort(), EXPECTED_PERMS);
  assert.equal(me.data.branch_id, 'review');
  assert.deepEqual(me.data.branch_access, ['review']);
  assert.deepEqual(me.data.branch_ids, ['review']);
});

test('reviewer sees Online module but no forbidden product modules', async () => {
  const response = await request('/api/modules', { token: reviewerToken });
  assert.equal(response.status, 200);
  const visible = response.data.modules.filter(module => module.visible).map(module => module.key);
  assert.ok(visible.includes('online'));
  for (const forbidden of [
    'pos', 'printing', 'accounting', 'automation', 'fleet', 'manufacturing',
    'payment', 'database', 'developer',
  ]) {
    assert.ok(!visible.includes(forbidden), `forbidden module visible: ${forbidden}`);
  }
});

test('OAuth connect accepts reviewer and rejects a user without permission', async () => {
  const allowed = await request('/api/marketplace/shopee/connect', {
    token: reviewerToken, method: 'POST', body: {},
  });
  assert.equal(allowed.status, 200);
  assert.match(String(allowed.data.attempt_id || ''), /^mpatt_/);

  const denied = await request('/api/marketplace/shopee/connect', {
    token: noAccessToken, method: 'POST', body: {},
  });
  assert.equal(denied.status, 403);
});

test('required Shopee read routes are available to reviewer', async () => {
  for (const path of [
    '/api/online/operations/summary',
    '/api/online/operations/orders',
    '/api/online/operations/product-mappings',
    '/api/skus',
    '/api/marketplace/connections?provider=shopee',
  ]) {
    const response = await request(path, { token: reviewerToken });
    assert.equal(response.status, 200, `${path} must allow reviewer`);
  }
});

test('dangerous and administrative endpoints reject reviewer with 403', async () => {
  const checks = [
    ['/api/online/operations/orders/missing/refund', 'POST', {}],
    ['/api/online/operations/orders/missing/cancel', 'POST', {}],
    ['/api/online/operations/orders/missing/transition', 'POST', { action: 'refund' }],
    ['/api/orders/missing/void', 'POST', {}],
    ['/api/customers/missing/delete', 'POST', {}],
    ['/api/skus/missing/delete', 'POST', {}],
    ['/api/skus', 'POST', {}],
    ['/api/inventory/missing/adjust', 'POST', { stock: 1 }],
    ['/api/audit', 'GET'],
    ['/api/settings/permissions', 'GET'],
    ['/api/settings/users', 'GET'],
    ['/api/settings/branches', 'GET'],
    ['/api/settings/integrations', 'GET'],
    ['/api/database/status', 'GET'],
  ];
  for (const [path, method, body] of checks) {
    const response = await request(path, {
      token: reviewerToken, method, ...(body === undefined ? {} : { body }),
    });
    assert.equal(response.status, 403, `${method} ${path} must reject reviewer`);
  }
});

test.after(async () => {
  killTree(child?.pid);
  await new Promise(resolveWait => setTimeout(resolveWait, 800));
  clean();
});
