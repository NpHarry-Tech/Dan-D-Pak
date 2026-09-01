import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn, spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';

const ROOT = path.resolve('.');
const SECRET = 'wan-cut-canary-secret-that-is-longer-than-32-characters';

function cleanupTempDirectory(target) {
  try { fs.rmSync(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); }
  catch { /* Windows may retain a just-closed SQLite handle briefly; OS temp is recoverable. */ }
}

function runSetup(code, env) {
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', code], {
    cwd: ROOT,
    env: { ...process.env, NODE_ENV: 'test', DISABLE_DEMO_SEED: 'true', ...env },
    encoding: 'utf8',
    timeout: 30_000,
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

async function waitForHealth(port, child, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`server exited early with ${child.exitCode}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok && (await response.json()).ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`server health timeout on port ${port}`);
}

function startServer(port, dbPath, storagePath, extraEnv = {}) {
  const logs = [];
  const child = spawn(process.execPath, ['server/index.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      PORT: String(port),
      DEPLOYMENT_TARGET: 'local',
      SQLITE_PATH: dbPath,
      STORAGE_PATH: storagePath,
      DISABLE_DEMO_SEED: 'true',
      CORS_ORIGIN: 'http://127.0.0.1',
      // Online-only là mặc định production. Test edge replication (LEGACY, giữ
      // inert cho rollback) phải BẬT lại tường minh — đây cũng là bằng chứng
      // đường rollback còn hoạt động khi OFFLINE_DECOMMISSIONED=false.
      OFFLINE_DECOMMISSIONED: 'false',
      ...extraEnv,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => logs.push(String(chunk)));
  child.stderr.on('data', (chunk) => logs.push(String(chunk)));
  return { child, logs };
}

async function stopServer(child) {
  if (child.exitCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    new Promise((resolve) => setTimeout(resolve, 5000)),
  ]);
  if (child.exitCode === null) {
    child.kill('SIGKILL');
    await Promise.race([
      new Promise((resolve) => child.once('exit', resolve)),
      new Promise((resolve) => setTimeout(resolve, 5000)),
    ]);
  }
}

async function waitForReplication(vpsDbPath, edgeDbPath, timeoutMs = 25_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    let vps;
    let edge;
    try {
      vps = new DatabaseSync(vpsDbPath, { readOnly: true });
      edge = new DatabaseSync(edgeDbPath, { readOnly: true });
      const replicated = vps.prepare(`SELECT COUNT(*) n FROM payments WHERE id='wan-payment-1'`).get().n === 1 &&
        vps.prepare(`SELECT COUNT(*) n FROM sale_snapshots WHERE id='wan-snapshot-1'`).get().n === 1 &&
        vps.prepare(`SELECT COUNT(*) n FROM e_invoices WHERE order_id='wan-order-1'`).get().n === 1 &&
        vps.prepare(`SELECT COUNT(*) n FROM invoice_allocations WHERE order_id='wan-order-1'`).get().n === 1 &&
        vps.prepare(`SELECT stock FROM skus WHERE id='wan-sku'`).get()?.stock === 9;
      const pulled = edge.prepare(`SELECT price FROM menu_items WHERE id='wan-menu'`).get()?.price === 65000 &&
        edge.prepare(`SELECT invoice_status FROM e_invoices WHERE order_id='wan-order-1'`).get()?.invoice_status === 'SYNCED_TO_CLOUD' &&
        edge.prepare(`SELECT COUNT(*) n FROM catalogue_snapshot_state WHERE branch_id='sala'`).get().n === 1;
      const pending = edge.prepare(
        `SELECT COUNT(*) n FROM sync_queue WHERE status='pending' AND payload_json IS NOT NULL`,
      ).get().n;
      if (replicated && pulled && pending === 0) return;
    } catch {} finally {
      try { vps?.close(); } catch {}
      try { edge?.close(); } catch {}
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('edge replication did not converge before timeout');
}

// Four clean migrations plus two server boots are materially slower on Windows
// CI than on Linux; keep the replication deadlines strict but allow setup time.
test('WAN cut/reconnect replicates one cash sale then pulls the newer catalogue exactly once', { timeout: 120_000 }, async () => {
  for (const name of fs.readdirSync(os.tmpdir()).filter((item) => item.startsWith('dandpak-wan-cut-'))) {
    cleanupTempDirectory(path.join(os.tmpdir(), name));
  }
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'dandpak-wan-cut-'));
  const vpsDb = path.join(temp, 'vps.db');
  const edgeDb = path.join(temp, 'edge.db');
  const setupBase = `
    const {db,migrate}=await import('./server/db.js'); migrate();
    const warehouse=db.prepare("SELECT id FROM warehouses WHERE branch_id='sala' AND type='retail' LIMIT 1").get();
    db.prepare("INSERT INTO categories(id,branch_id,name,sort) VALUES('wan-cat','sala','WAN',1)").run();
    db.prepare("INSERT INTO menu_items(id,branch_id,category_id,name,price) VALUES('wan-menu','sala','wan-cat','WAN item',50000)").run();
    db.prepare("INSERT INTO skus(id,branch_id,name,price,stock,warehouse_id) VALUES('wan-sku','sala','WAN SKU',50000,10,?)").run(warehouse.id);
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); db.close();`;
  runSetup(setupBase, { SQLITE_PATH: vpsDb, STORAGE_PATH: path.join(temp, 'setup-storage') });
  fs.copyFileSync(vpsDb, edgeDb);

  runSetup(`
    const {db,migrate}=await import('./server/db.js'); migrate();
    db.prepare("UPDATE menu_items SET price=65000 WHERE id='wan-menu'").run();
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); db.close();`,
  { SQLITE_PATH: vpsDb, STORAGE_PATH: path.join(temp, 'vps-prepare') });

  runSetup(`
    const {db,migrate}=await import('./server/db.js'); migrate(); const at=new Date().toISOString();
    db.prepare("INSERT INTO shifts(id,branch_id,user_id,user_name,status,opened_at) VALUES('wan-shift','sala','u1','Cashier','open',?)").run(at);
    db.prepare("INSERT INTO orders(id,branch_id,channel,status,total,created_at,paid_at) VALUES('wan-order-1','sala','retail','paid',50000,?,?)").run(at,at);
    db.prepare("INSERT INTO order_items(id,order_id,sku_id,name,qty,unit_price,status,created_at) VALUES('wan-item-1','wan-order-1','wan-sku','WAN SKU',1,50000,'served',?)").run(at);
    db.prepare("INSERT INTO payments(id,order_id,shift_id,idempotency_key,cashier,total,created_at) VALUES('wan-payment-1','wan-order-1','wan-shift','wan-cash-once','Cashier',50000,?)").run(at);
    db.prepare("INSERT INTO payment_lines(id,payment_id,method,amount,tendered_amount,reference) VALUES('wan-line-1','wan-payment-1','cash',50000,50000,'offline')").run();
    db.prepare("INSERT INTO sale_snapshots(id,order_id,payment_id,branch_id,pricing_hash,snapshot_json,paid_at,business_date,created_at) VALUES('wan-snapshot-1','wan-order-1','wan-payment-1','sala','wan-hash','{}',?,?,?)").run(at,at.slice(0,10),at);
    db.prepare("UPDATE skus SET stock=9 WHERE id='wan-sku'").run();
    const {createInvoiceRequest}=await import('./server/services/einvoice.js');
    createInvoiceRequest('wan-order-1','WALK_IN',{},'sala','offline-canary');
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); db.close();`,
  { SQLITE_PATH: edgeDb, STORAGE_PATH: path.join(temp, 'edge-prepare'), EDGE_HUB_ID: 'wan-sala-edge' });

  const vpsPort = await freePort();
  const edgePort = await freePort();
  const vps = startServer(vpsPort, vpsDb, path.join(temp, 'vps-storage'), {
    EDGE_SYNC_SHARED_SECRET: SECRET,
    EDGE_SYNC_ALLOWED_HUBS_JSON: JSON.stringify({ 'wan-sala-edge': ['sala'] }),
  });
  let edge;
  try {
    await waitForHealth(vpsPort, vps.child);
    edge = startServer(edgePort, edgeDb, path.join(temp, 'edge-storage'), {
      EDGE_HUB_ID: 'wan-sala-edge',
      EDGE_SYNC_UPSTREAM_URL: `http://127.0.0.1:${vpsPort}`,
      EDGE_SYNC_SHARED_SECRET: SECRET,
    });
    await waitForHealth(edgePort, edge.child);
    await waitForReplication(vpsDb, edgeDb);

    const before = new DatabaseSync(vpsDb, { readOnly: true });
    const inboxBefore = before.prepare(`SELECT COUNT(*) n FROM sync_inbox WHERE hub_id='wan-sala-edge'`).get().n;
    assert.equal(before.prepare(`SELECT COUNT(*) n FROM payments WHERE id='wan-payment-1'`).get().n, 1);
    assert.equal(before.prepare(`SELECT COUNT(*) n FROM payment_lines WHERE id='wan-line-1'`).get().n, 1);
    assert.equal(before.prepare(`SELECT COUNT(*) n FROM e_invoices WHERE order_id='wan-order-1'`).get().n, 1);
    assert.equal(before.prepare(`SELECT COUNT(*) n FROM invoice_allocations WHERE order_id='wan-order-1'`).get().n, 1);
    assert.equal(before.prepare(`SELECT einvoice_id FROM orders WHERE id='wan-order-1'`).get().einvoice_id,
      before.prepare(`SELECT id FROM e_invoices WHERE order_id='wan-order-1'`).get().id);
    before.close();
    await new Promise((resolve) => setTimeout(resolve, 7000));
    const after = new DatabaseSync(vpsDb, { readOnly: true });
    assert.equal(after.prepare(`SELECT COUNT(*) n FROM payments WHERE id='wan-payment-1'`).get().n, 1);
    assert.equal(after.prepare(`SELECT COUNT(*) n FROM payment_lines WHERE id='wan-line-1'`).get().n, 1);
    assert.equal(after.prepare(`SELECT COUNT(*) n FROM e_invoices WHERE order_id='wan-order-1'`).get().n, 1);
    assert.equal(after.prepare(`SELECT COUNT(*) n FROM invoice_allocations WHERE order_id='wan-order-1'`).get().n, 1);
    assert.equal(after.prepare(`SELECT COUNT(*) n FROM sync_inbox WHERE hub_id='wan-sala-edge'`).get().n, inboxBefore);
    assert.equal(after.prepare(`PRAGMA quick_check`).get().quick_check, 'ok');
    after.close();
  } catch (error) {
    error.message += `\nVPS logs:\n${vps.logs.join('')}\nEDGE logs:\n${edge?.logs.join('') || ''}`;
    throw error;
  } finally {
    await stopServer(edge?.child);
    await stopServer(vps.child);
    cleanupTempDirectory(temp);
  }
});
