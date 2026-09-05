#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';

function positiveInteger(value, fallback, minimum = 1) {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed < minimum) {
    throw new Error(`Expected an integer >= ${minimum}, received ${value}`);
  }
  return parsed;
}

function parseServerTiming(value) {
  const result = {};
  for (const part of String(value || '').split(',')) {
    const match = part.trim().match(/^([a-z]+);dur=(\d+(?:\.\d+)?)$/i);
    if (match) result[match[1]] = Number(match[2]);
  }
  for (const required of ['ingress', 'auth', 'db', 'serialize', 'total']) {
    if (!Number.isFinite(result[required])) throw new Error(`Missing Server-Timing phase: ${required}`);
  }
  return result;
}

function summarize(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (p) => sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)];
  return {
    p50: Number(at(.50).toFixed(3)),
    p95: Number(at(.95).toFixed(3)),
    p99: Number(at(.99).toFixed(3)),
    max: Number(sorted.at(-1).toFixed(3)),
  };
}

async function waitReady(base, child, output) {
  for (let attempt = 0; attempt < 3_000; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Server exited ${child.exitCode}: ${output.join('')}`);
    try {
      const response = await fetch(`${base}/health/ready`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for benchmark server readiness: ${output.join('')}`);
}

const bills = positiveInteger(process.argv[2], 2000);
const iterations = positiveInteger(process.argv[3], 100, 20);
const temp = mkdtempSync(join(tmpdir(), 'dandpak-shift-http-benchmark-'));
const sqlitePath = join(temp, 'store.db');
const storagePath = join(temp, 'storage');
const port = 34_000 + Math.floor(Math.random() * 1_000);
const base = `http://127.0.0.1:${port}`;
const pin = '4826';
const output = [];
let child;

try {
  process.env.SQLITE_PATH = sqlitePath;
  process.env.STORAGE_PATH = storagePath;
  process.env.DISABLE_DEMO_SEED = '1';
  process.env.DATA_ENCRYPTION_KEY ||= '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  const { db, migrate, uid, now } = await import('../server/db.js');
  const { hashPin } = await import('../server/services/pin.js');
  migrate();
  db.prepare(`INSERT OR REPLACE INTO users
    (id,branch_id,username,name,pin,role,active,branch_access_json)
    VALUES ('u_benchmark','sala','benchmark-owner','Benchmark Owner',?,'owner',1,'["*"]')`)
    .run(hashPin(pin));
  const shiftId = uid('shift_');
  db.prepare(`INSERT INTO shifts (id,branch_id,shift_key,shift_label,status,opening_cash,opened_at)
    VALUES (?,?,?,?,'open',1000000,?)`).run(shiftId, 'sala', 'bench', 'Benchmark', now());
  for (let index = 0; index < 40; index += 1) {
    db.prepare(`INSERT OR IGNORE INTO tables (id,branch_id,code,zone,seats,status)
      VALUES (?,?,?,?,4,'free')`).run(`bench_t${index}`, 'sala', `T${index}`, 'Benchmark');
  }
  db.exec('BEGIN');
  for (let index = 0; index < bills; index += 1) {
    const orderId = uid('o_');
    const paymentId = uid('pay_');
    const total = 20000 + (index % 50) * 1000;
    const timestamp = new Date(Date.now() - (bills - index) * 1000).toISOString();
    db.prepare(`INSERT INTO orders
      (id,branch_id,table_id,channel,status,bill_no,total,created_at,paid_at)
      VALUES (?,?,?,'dine_in','paid',?,?,?,?)`)
      .run(orderId, 'sala', `bench_t${index % 40}`, `BENCH${index}`, total, timestamp, timestamp);
    db.prepare(`INSERT INTO payments (id,order_id,shift_id,cashier,total,created_at)
      VALUES (?,?,?,?,?,?)`).run(paymentId, orderId, shiftId, 'benchmark', total, timestamp);
    db.prepare(`INSERT INTO payment_lines (id,payment_id,method,amount,tendered_amount)
      VALUES (?,?,'cash',?,?)`).run(uid('pl_'), paymentId, total, total);
    // Keep startup HĐĐT repair outside this endpoint benchmark. The synthetic paid
    // bill already has a completed invoice, as a settled production bill normally can.
    db.prepare(`INSERT INTO e_invoices
      (id,order_id,branch_id,provider,invoice_status,idempotency_key,customer_mode,created_at,updated_at)
      VALUES (?,?,?,'misa','ISSUED',?,'WALK_IN',?,?)`)
      .run(uid('inv_'), orderId, 'sala', `benchmark:${orderId}`, timestamp, timestamp);
  }
  db.exec('COMMIT');
  db.close();

  child = spawn(process.execPath, ['server/index.js'], {
    cwd: process.cwd(),
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      PORT: String(port),
      SQLITE_PATH: sqlitePath,
      STORAGE_PATH: storagePath,
      REQUEST_TIMING_DIAGNOSTICS: '1',
      OFFLINE_DECOMMISSIONED: 'true',
    },
  });
  child.stdout.on('data', (chunk) => output.push(chunk.toString()));
  child.stderr.on('data', (chunk) => output.push(chunk.toString()));
  await waitReady(base, child, output);

  const loginResponse = await fetch(`${base}/api/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-branch-id': 'sala' },
    body: JSON.stringify({ username: 'benchmark-owner', pin, branch_id: 'sala' }),
  });
  if (!loginResponse.ok) throw new Error(`Benchmark login failed: ${await loginResponse.text()}`);
  const token = (await loginResponse.json()).token;
  const phases = { ingress: [], auth: [], db: [], serialize: [], total: [], client_total: [] };
  let payloadBytes = 0;
  let state;

  for (let index = -10; index < iterations; index += 1) {
    const correlationId = `shift-benchmark-${index + 10}`;
    const started = performance.now();
    const response = await fetch(`${base}/api/shifts/current`, {
      headers: {
        authorization: `Bearer ${token}`,
        'x-branch-id': 'sala',
        'x-correlation-id': correlationId,
      },
    });
    const body = await response.text();
    const clientTotal = performance.now() - started;
    if (!response.ok) throw new Error(`Shift request failed ${response.status}: ${body}`);
    if (response.headers.get('x-correlation-id') !== correlationId) {
      throw new Error('Correlation ID was not preserved');
    }
    const timing = parseServerTiming(response.headers.get('server-timing'));
    if (index < 0) continue;
    for (const phase of ['ingress', 'auth', 'db', 'serialize', 'total']) phases[phase].push(timing[phase]);
    phases.client_total.push(clientTotal);
    payloadBytes = Buffer.byteLength(body);
    state = JSON.parse(body);
  }

  console.log(JSON.stringify({
    status: 'VERIFIED',
    target: 'GET /api/shifts/current over loopback HTTP',
    diagnostics: 'REQUEST_TIMING_DIAGNOSTICS=1; disabled by default',
    environment: { platform: process.platform, node: process.version },
    bills,
    iterations,
    milliseconds: Object.fromEntries(Object.entries(phases).map(([name, values]) => [name, summarize(values)])),
    payload_bytes: payloadBytes,
    returned_bill_details: state?.report?.bills?.length || 0,
    total_bill_count: state?.report?.bill_count || 0,
    correlation_id_echo: true,
  }, null, 2));
} finally {
  if (child && child.exitCode === null) {
    child.kill('SIGTERM');
    await Promise.race([
      new Promise((resolve) => child.once('exit', resolve)),
      new Promise((resolve) => setTimeout(resolve, 3_000)),
    ]);
    if (child.exitCode === null) child.kill('SIGKILL');
  }
  try { rmSync(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); } catch {}
}
