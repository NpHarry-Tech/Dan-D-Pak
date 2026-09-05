#!/usr/bin/env node
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';

const bills = Math.max(1, Number(process.argv[2] || 2000));
const iterations = Math.max(20, Number(process.argv[3] || 100));
const temp = mkdtempSync(join(tmpdir(), 'dandpak-shift-benchmark-'));
process.env.SQLITE_PATH = join(temp, 'store.db');
process.env.STORAGE_PATH = join(temp, 'storage');
process.env.DATA_ENCRYPTION_KEY ||= '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

const { db, migrate, uid, now } = await import('../server/db.js');
migrate();
const Shifts = await import('../server/services/shifts.js');
const branch = 'sala';
const shiftId = uid('shift_');
db.prepare(`INSERT INTO shifts (id,branch_id,shift_key,shift_label,status,opening_cash,opened_at)
  VALUES (?,?,?,?, 'open', 1000000, ?)`).run(shiftId, branch, 'bench', 'Benchmark', now());
for (let index = 0; index < 40; index++) {
  db.prepare(`INSERT OR IGNORE INTO tables (id,branch_id,code,zone,seats,status)
    VALUES (?,?,?,?,4,'free')`).run(`bench_t${index}`, branch, `T${index}`, 'Benchmark');
}
db.exec('BEGIN');
for (let index = 0; index < bills; index++) {
  const orderId = uid('o_');
  const paymentId = uid('pay_');
  const total = 20000 + (index % 50) * 1000;
  const timestamp = new Date(Date.now() - (bills - index) * 1000).toISOString();
  db.prepare(`INSERT INTO orders
    (id,branch_id,table_id,channel,status,bill_no,total,created_at,paid_at)
    VALUES (?,?,?,'dine_in','paid',?,?,?,?)`)
    .run(orderId, branch, `bench_t${index % 40}`, `BENCH${index}`, total, timestamp, timestamp);
  db.prepare(`INSERT INTO payments (id,order_id,shift_id,cashier,total,created_at)
    VALUES (?,?,?,?,?,?)`).run(paymentId, orderId, shiftId, 'benchmark', total, timestamp);
  db.prepare(`INSERT INTO payment_lines (id,payment_id,method,amount,tendered_amount)
    VALUES (?,?,'cash',?,?)`).run(uid('pl_'), paymentId, total, total);
}
db.exec('COMMIT');

for (let index = 0; index < 10; index++) Shifts.currentShift(branch);
const samples = [];
let state;
for (let index = 0; index < iterations; index++) {
  const started = performance.now();
  state = Shifts.currentShift(branch);
  samples.push(performance.now() - started);
}
samples.sort((a, b) => a - b);
const percentile = (p) => samples[Math.min(samples.length - 1, Math.ceil(samples.length * p) - 1)];
const sqliteVersion = db.prepare('SELECT sqlite_version() version').get().version;
console.log(JSON.stringify({
  status: 'VERIFIED',
  target: '/api/shifts/current (service path; excludes HTTP/network serialization)',
  environment: { platform: process.platform, node: process.version, sqlite: sqliteVersion },
  bills,
  iterations,
  milliseconds: {
    p50: Number(percentile(.50).toFixed(3)),
    p95: Number(percentile(.95).toFixed(3)),
    p99: Number(percentile(.99).toFixed(3)),
    max: Number(samples.at(-1).toFixed(3)),
  },
  payload_bytes: Buffer.byteLength(JSON.stringify(state)),
  returned_bill_details: state.report?.bills?.length || 0,
  total_bill_count: state.report?.bill_count || 0,
}, null, 2));
db.close();
try { rmSync(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); } catch {}
