import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { hashPin } from './services/pin.js';

const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SERVER_DIR, '..');
const DBP = resolve(REPO_ROOT, 'runtime/server-data/__payment_concurrency_http_test.db');
const STORAGE = resolve(REPO_ROOT, 'runtime/server-data/__payment_concurrency_http_storage');
const PORT_A = 43000 + (Date.now() % 1000);
const PORT_B = PORT_A + 1001;
const BASES = [`http://127.0.0.1:${PORT_A}`, `http://127.0.0.1:${PORT_B}`];
const BRANCH = 'concurrency';
const TEST_PIN = '8642';

process.env.SQLITE_PATH = DBP;
process.env.STORAGE_PATH = STORAGE;
process.env.NODE_ENV = 'development';
process.env.DISABLE_DEMO_SEED = 'true';
process.env.DATA_ENCRYPTION_KEY =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

const children = [];
const serverOutputs = new Map();
const serverDbPaths = []; // SQLITE_PATH thực sự truyền cho từng process (chứng minh dùng CHUNG một DB)
const tokens = new Map();
let db;

function clean() {
  for (const suffix of ['', '-wal', '-shm']) {
    if (existsSync(DBP + suffix)) {
      try { rmSync(DBP + suffix); } catch { /* released during teardown */ }
    }
  }
  if (existsSync(STORAGE)) {
    try { rmSync(STORAGE, { recursive: true, force: true }); } catch { /* best effort */ }
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
  } catch { /* already stopped */ }
}

function startServer(port) {
  const childEnv = {
    ...process.env,
    PORT: String(port),
    API_BASE_URL: `http://127.0.0.1:${port}`,
    DEPLOYMENT_TARGET: 'local',
  };
  serverDbPaths.push(childEnv.SQLITE_PATH);
  const child = spawn(process.execPath, ['index.js'], {
    cwd: SERVER_DIR,
    env: childEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk.toString(); });
  child.stderr.on('data', chunk => { output += chunk.toString(); });
  children.push(child);
  serverOutputs.set(port, () => output);
  return { child, output: () => output };
}

async function waitHealth(base, output, timeoutMs = 120000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${base}/health`);
      if (response.ok) return;
    } catch { /* booting */ }
    await new Promise(resolveWait => setTimeout(resolveWait, 250));
  }
  assert.fail(`server failed to boot at ${base}:\n${output().slice(-2000)}`);
}

async function request(base, path, { method = 'GET', body, auth = tokens.get(base) || '', key = '' } = {}) {
  let response;
  try {
    response = await fetch(`${base}${path}`, {
      method,
      headers: {
        'x-branch-id': BRANCH,
        'x-device-id': `device-${base.slice(-2)}`,
        ...(auth ? { authorization: `Bearer ${auth}` } : {}),
        ...(key ? { 'idempotency-key': key } : {}),
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    const port = Number(new URL(base).port);
    return { base, status: 0, data: { network_error: error?.message, server_output: serverOutputs.get(port)?.().slice(-3000) } };
  }
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { base, status: response.status, data };
}

// Chứng minh 150 request THẬT SỰ được chia cho CẢ HAI process (không phải một
// server nuốt hết còn server kia chết): tập base của các phản hồi phải gồm đủ 2.
function assertSplitAcrossBothProcesses(responses) {
  const bases = new Set(responses.map(r => r.base));
  assert.equal(bases.size, 2, `request phải được xử lý bởi CẢ HAI process, thấy: ${[...bases].join(', ')}`);
  for (const base of BASES) {
    assert.ok(responses.some(r => r.base === base && r.status !== 0),
      `process ${base} phải xử lý ít nhất một request (không chết/không ECONNRESET toàn bộ)`);
  }
}

function insertFnbOrder(id, tableId) {
  const at = new Date().toISOString();
  db.prepare(`INSERT INTO tables (id,branch_id,zone,code,seats,status)
    VALUES (?,?,?, ?,4,'busy')`).run(tableId, BRANCH, 'Tầng 1', tableId);
  db.prepare(`INSERT INTO orders
    (id,branch_id,table_id,channel,status,subtotal,discount,goods_amount,vat_amount,total,created_at)
    VALUES (?,?,?,'dine_in','open',50000,0,50000,0,50000,?)`)
    .run(id, BRANCH, tableId, at);
  db.prepare(`INSERT INTO order_items
    (id,order_id,name,qty,unit_price,vat_rate,station,status,created_at)
    VALUES (?,?,?,1,50000,0,'kitchen','served',?)`)
    .run(`item-${id}`, id, 'Món concurrency', at);
}

function count(table, where = '', ...params) {
  return db.prepare(`SELECT COUNT(*) n FROM ${table}${where ? ` WHERE ${where}` : ''}`)
    .get(...params).n;
}

test.before(async () => {
  clean();
  const first = startServer(PORT_A);
  await waitHealth(BASES[0], first.output);

  const databaseModule = await import('./db.js');
  db = databaseModule.db;
  db.prepare(`INSERT OR REPLACE INTO branches (id,name,code,active) VALUES (?,?,?,1)`)
    .run(BRANCH, 'Concurrency Test', 'CONC');
  db.prepare(`INSERT INTO users
    (id,branch_id,username,name,pin,role,active,branch_access_json)
    VALUES ('u_concurrency',?,?,?,?,'concurrency_cashier',1,?)`)
    .run(BRANCH, 'concurrency-cashier', 'Concurrency Cashier', hashPin(TEST_PIN),
      JSON.stringify([BRANCH]));
  for (const permission of ['pay', 'sell', 'order.confirm']) {
    db.prepare(`INSERT OR IGNORE INTO role_perms (role,perm) VALUES ('concurrency_cashier',?)`)
      .run(permission);
  }
  db.prepare(`INSERT INTO shifts
    (id,branch_id,user_id,user_name,shift_key,shift_label,opening_cash,status,opened_at)
    VALUES ('shift_concurrency',?,'u_concurrency','Concurrency Cashier','day','Ca ngày',0,'open',?)`)
    .run(BRANCH, new Date().toISOString());
  db.prepare(`INSERT INTO warehouses (id,branch_id,code,name,type,active)
    VALUES ('wh_concurrency',?,'CONC-WH','Concurrency Warehouse','retail',1)`).run(BRANCH);

  const Inventory = await import('./services/inventory.js');
  Inventory.createSku({
    id: 'sku_concurrency', code: 'CONC-SKU', name: 'SKU concurrency',
    price: 20000, stock: 100, warehouse_id: 'wh_concurrency',
  }, BRANCH);
  insertFnbOrder('order_same_key', 'table_same_key');
  insertFnbOrder('order_different_keys', 'table_different_keys');

  const second = startServer(PORT_B);
  await waitHealth(BASES[1], second.output);
  for (const base of BASES) {
    const login = await request(base, '/api/login', {
      method: 'POST', auth: '',
      body: { username: 'concurrency-cashier', pin: TEST_PIN, branch_id: BRANCH },
    });
    assert.equal(login.status, 200, JSON.stringify(login.data));
    tokens.set(base, login.data.token);
  }
});

test('hai server CHIA SẺ đúng một file DB TUYỆT ĐỐI (không phải hai temp DB riêng)', () => {
  assert.equal(serverDbPaths.length, 2, 'đã spawn đúng hai server process');
  assert.ok(isAbsolute(serverDbPaths[0]), `SQLITE_PATH phải tuyệt đối: ${serverDbPaths[0]}`);
  assert.equal(serverDbPaths[0], serverDbPaths[1], 'HAI process phải trỏ CÙNG một file DB');
  assert.equal(serverDbPaths[0], DBP, 'và đó là DB dùng chung của test');
  assert.ok(existsSync(DBP), 'file DB chung phải tồn tại thật trên đĩa');
  // Bằng chứng gián tiếp mạnh hơn: các test dưới đọc cardinality qua `db` (mở trên
  // DBP) và THẤY các hàng do request HTTP tới CẢ HAI server ghi vào — cùng một file.
});

test('50 HTTP payments cùng key qua hai server → một payment/outbox/invoice', async () => {
  const responses = await Promise.all(Array.from({ length: 50 }, (_, index) =>
    request(BASES[index % 2], '/api/orders/order_same_key/pay', {
      method: 'POST', key: 'same-http-payment',
      body: { lines: [{ method: 'cash', amount: 50000 }] },
    })));
  assertSplitAcrossBothProcesses(responses);
  assert.ok(responses.every(response => response.status === 200),
    JSON.stringify(responses.filter(response => response.status !== 200).slice(0, 3)));
  assert.equal(new Set(responses.map(response => response.data.payment_id)).size, 1);
  assert.equal(count('payments', 'order_id=?', 'order_same_key'), 1);
  assert.equal(count('sale_snapshots', 'order_id=?', 'order_same_key'), 1);
  assert.equal(count('e_invoices', 'order_id=?', 'order_same_key'), 1);
  assert.equal(count('receipt_print_outbox', 'payment_id IN (SELECT id FROM payments WHERE order_id=?)',
    'order_same_key'), 1);
  assert.equal(db.prepare(`SELECT status FROM tables WHERE id='table_same_key'`).get().status, 'free');
});

test('50 HTTP payments khác key qua hai server → một success, còn lại 409 rõ mã', async () => {
  const responses = await Promise.all(Array.from({ length: 50 }, (_, index) =>
    request(BASES[index % 2], '/api/orders/order_different_keys/pay', {
      method: 'POST', key: `different-http-payment-${index}`,
      body: { lines: [{ method: 'cash', amount: 50000 }] },
    })));
  assertSplitAcrossBothProcesses(responses);
  assert.equal(responses.filter(response => response.status === 200).length, 1);
  const conflicts = responses.filter(response => response.status === 409);
  assert.equal(conflicts.length, 49);
  assert.ok(conflicts.every(response => response.data.code === 'ORDER_ALREADY_PAID'));
  assert.equal(count('payments', 'order_id=?', 'order_different_keys'), 1);
  assert.equal(count('sale_snapshots', 'order_id=?', 'order_different_keys'), 1);
  assert.equal(count('e_invoices', 'order_id=?', 'order_different_keys'), 1);
  assert.equal(count('receipt_print_outbox', 'payment_id IN (SELECT id FROM payments WHERE order_id=?)',
    'order_different_keys'), 1);
});

test('Retail 50 HTTP retries qua hai server → một order/payment/stock mutation/print job', async () => {
  const beforeStock = db.prepare(`SELECT stock FROM skus WHERE id='sku_concurrency'`).get().stock;
  const responses = await Promise.all(Array.from({ length: 50 }, (_, index) =>
    request(BASES[index % 2], '/api/retail/checkout', {
      method: 'POST', key: 'same-retail-checkout',
      body: {
        client_request_id: 'same-retail-checkout',
        items: [{ sku_id: 'sku_concurrency', qty: 1 }],
        payments: [{ method: 'cash', amount: 20000 }],
      },
    })));
  assertSplitAcrossBothProcesses(responses);
  assert.ok(responses.every(response => response.status === 200),
    JSON.stringify(responses.filter(response => response.status !== 200).slice(0, 3)));
  const order = db.prepare(`SELECT id FROM orders WHERE branch_id=? AND client_request_id=?`)
    .get(BRANCH, 'same-retail-checkout');
  assert.ok(order);
  assert.equal(count('orders', 'branch_id=? AND client_request_id=?', BRANCH, 'same-retail-checkout'), 1);
  assert.equal(count('payments', 'order_id=?', order.id), 1);
  assert.equal(count('sale_snapshots', 'order_id=?', order.id), 1);
  assert.equal(count('e_invoices', 'order_id=?', order.id), 1);
  assert.equal(count('stock_movements', "ref=? AND type='sale'", order.id), 1);
  assert.equal(count('receipt_print_outbox', 'payment_id IN (SELECT id FROM payments WHERE order_id=?)',
    order.id), 1);
  assert.equal(db.prepare(`SELECT stock FROM skus WHERE id='sku_concurrency'`).get().stock,
    beforeStock - 1);
});

test.after(async () => {
  for (const child of children) killTree(child.pid);
  await new Promise(resolveWait => setTimeout(resolveWait, 800));
  try { db?.close(); } catch { /* already closed */ }
  clean();
});
