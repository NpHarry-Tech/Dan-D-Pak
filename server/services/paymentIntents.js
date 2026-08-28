// Canonical bank-transfer identity. References belong to the receiving account
// namespace, not to a branch, bill number, register, or client display slot.
import crypto from 'node:crypto';
import { db, uid, now } from '../db.js';
import { businessParts } from '../core/businessClock.js';
import { getOperationsConfig } from './settings.js';

db.exec(`
  CREATE TABLE IF NOT EXISTS payment_reference_counters (
    tenant_id TEXT NOT NULL,
    payment_account_id TEXT NOT NULL,
    business_date TEXT NOT NULL,
    last_sequence INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL,
    PRIMARY KEY(tenant_id,payment_account_id,business_date)
  );
  CREATE TABLE IF NOT EXISTS payment_intents (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    branch_id TEXT NOT NULL,
    order_id TEXT NOT NULL,
    payment_account_id TEXT NOT NULL,
    payment_account_number TEXT NOT NULL,
    method TEXT NOT NULL,
    amount INTEGER NOT NULL,
    currency TEXT NOT NULL DEFAULT 'VND',
    prefix_snapshot TEXT NOT NULL,
    transfer_reference TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'WAITING',
    expires_at TEXT,
    client_request_id TEXT,
    provider TEXT,
    provider_transaction_id TEXT,
    created_at TEXT NOT NULL,
    confirmed_at TEXT,
    updated_at TEXT NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS ux_payment_intent_reference
    ON payment_intents(tenant_id,payment_account_id,transfer_reference);
  CREATE UNIQUE INDEX IF NOT EXISTS ux_payment_intent_client_request
    ON payment_intents(tenant_id,client_request_id) WHERE client_request_id IS NOT NULL;
  CREATE INDEX IF NOT EXISTS idx_payment_intent_order ON payment_intents(branch_id,order_id,created_at);
  CREATE INDEX IF NOT EXISTS idx_payment_intent_waiting ON payment_intents(payment_account_id,state,created_at);
`);
const intentColumns = new Map(db.prepare(`PRAGMA table_info(payment_intents)`).all().map(c => [c.name, c]));
const addIntentColumn = (name, sql) => {
  if (!intentColumns.has(name)) db.exec(`ALTER TABLE payment_intents ADD COLUMN ${name} ${sql}`);
};
addIntentColumn('payment_account_number', "TEXT NOT NULL DEFAULT ''");
addIntentColumn('order_revision', 'INTEGER NOT NULL DEFAULT 0');
addIntentColumn('snapshot_json', "TEXT NOT NULL DEFAULT '{}'");
addIntentColumn('created_by_user_id', 'TEXT');
addIntentColumn('created_by_device_id', 'TEXT');
addIntentColumn('created_by_register_id', 'TEXT');
addIntentColumn('confirmation_source', 'TEXT');
addIntentColumn('confirmed_by', 'TEXT');
addIntentColumn('payment_id', 'TEXT');
addIntentColumn('payment_line_id', 'TEXT');
addIntentColumn('bill_no', 'TEXT');
addIntentColumn('superseded_by', 'TEXT');
addIntentColumn('cancelled_at', 'TEXT');
addIntentColumn('metadata_json', "TEXT NOT NULL DEFAULT '{}'");

export const ACTIVE_STATES = ['CREATED', 'QR_PRESENTED', 'AWAITING_FUNDS', 'FUNDS_RECEIVED', 'FINALIZING'];
const activeSql = ACTIVE_STATES.map(x => `'${x}'`).join(',');
// Upgrade legacy WAITING rows first. If an old build produced more than one waiting
// row for an order, preserve every row for audit and supersede all but the newest.
db.prepare(`UPDATE payment_intents SET state='AWAITING_FUNDS' WHERE state='WAITING'`).run();
for (const duplicate of db.prepare(`SELECT tenant_id,branch_id,order_id FROM payment_intents
  WHERE state IN (${activeSql}) GROUP BY tenant_id,branch_id,order_id HAVING COUNT(*)>1`).all()) {
  const rows = db.prepare(`SELECT id FROM payment_intents WHERE tenant_id=? AND branch_id=? AND order_id=?
    AND state IN (${activeSql}) ORDER BY created_at DESC,id DESC`).all(duplicate.tenant_id, duplicate.branch_id, duplicate.order_id);
  for (const row of rows.slice(1)) db.prepare(`UPDATE payment_intents SET state='SUPERSEDED',cancelled_at=?,updated_at=? WHERE id=?`).run(now(), now(), row.id);
}
db.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS ux_payment_intent_active_order
    ON payment_intents(tenant_id,branch_id,order_id)
    WHERE state IN ('CREATED','QR_PRESENTED','AWAITING_FUNDS','FUNDS_RECEIVED','FINALIZING');
  CREATE UNIQUE INDEX IF NOT EXISTS ux_payment_intent_provider_tx
    ON payment_intents(provider,provider_transaction_id)
    WHERE provider IS NOT NULL AND provider_transaction_id IS NOT NULL;
  CREATE INDEX IF NOT EXISTS idx_payment_intent_reference_search ON payment_intents(branch_id,transfer_reference);
`);

export function providerSafe(value = '', max = 8) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, c => c === 'đ' ? 'd' : 'D')
    .replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, max);
}

export function tenantId() {
  return String(process.env.TENANT_ID || process.env.APP_TENANT_ID || 'default').trim() || 'default';
}

export function paymentAccountIdentity(branch_id = 'sala') {
  const payment = getOperationsConfig(branch_id).payment || {};
  const bankCode = providerSafe(payment.bankCode || 'BANK', 20) || 'BANK';
  const account = providerSafe(payment.bankAccount || '', 40);
  if (!account) throw Object.assign(new Error('Chưa cấu hình tài khoản nhận chuyển khoản.'), { status: 409, code: 'PAYMENT_ACCOUNT_NOT_CONFIGURED' });
  const digest = crypto.createHash('sha256').update(`${bankCode}:${account}`).digest('hex').slice(0, 20);
  return { id: `bank_${digest}`, bankCode, account, payment };
}

function businessDateParts() {
  const p = businessParts();
  const yy = String(p.year).slice(-2);
  const mm = String(p.month).padStart(2, '0');
  const dd = String(p.day).padStart(2, '0');
  return { key: `${p.year}-${mm}-${dd}`, compact: `${yy}${mm}${dd}` };
}

function allocateReference(tenant_id, payment_account_id, prefix) {
  const date = businessDateParts();
  const stamp = now();
  db.prepare(`INSERT INTO payment_reference_counters
      (tenant_id,payment_account_id,business_date,last_sequence,updated_at)
      VALUES(?,?,?,1,?)
      ON CONFLICT(tenant_id,payment_account_id,business_date) DO UPDATE SET
        last_sequence=last_sequence+1,updated_at=excluded.updated_at`)
    .run(tenant_id, payment_account_id, date.key, stamp);
  const row = db.prepare(`SELECT last_sequence FROM payment_reference_counters
    WHERE tenant_id=? AND payment_account_id=? AND business_date=?`)
    .get(tenant_id, payment_account_id, date.key);
  const sequence = Number(row.last_sequence);
  if (sequence > 999999) throw Object.assign(new Error('Đã hết dải mã chuyển khoản trong ngày.'), { status: 409, code: 'PAYMENT_REFERENCE_EXHAUSTED' });
  return `${prefix}${date.compact}${String(sequence).padStart(6, '0')}`;
}

export function createPaymentIntent({ branch_id = 'sala', order_id, amount, method = 'qrcode', client_request_id = null,
  ttlMs = 15 * 60_000, order_revision = 0, snapshot = {}, user_id = null, device_id = null, register_id = null } = {}) {
  const tenant_id = tenantId();
  const requestId = String(client_request_id || '').trim() || null;
  if (requestId) {
    const replay = db.prepare(`SELECT * FROM payment_intents WHERE tenant_id=? AND client_request_id=?`).get(tenant_id, requestId);
    if (replay) return replay;
  }
  const account = paymentAccountIdentity(branch_id);
  const prefix = providerSafe(account.payment.transferPrefix || 'DANBILL', 8) || 'DANBILL';
  const stamp = now();
  const owns = !db.isTransaction;
  if (owns) db.prepare('BEGIN IMMEDIATE').run();
  try {
    const reference = allocateReference(tenant_id, account.id, prefix);
    const id = uid('pi_');
    const expires = new Date(Date.parse(stamp) + ttlMs).toISOString();
    const previous = db.prepare(`SELECT id FROM payment_intents WHERE tenant_id=? AND branch_id=? AND order_id=?
      AND state IN (${activeSql}) ORDER BY created_at DESC LIMIT 1`).get(tenant_id, branch_id, order_id);
    if (previous) db.prepare(`UPDATE payment_intents SET state='SUPERSEDED',cancelled_at=?,updated_at=? WHERE id=?`).run(stamp, stamp, previous.id);
    db.prepare(`INSERT INTO payment_intents
      (id,tenant_id,branch_id,order_id,payment_account_id,payment_account_number,method,amount,currency,prefix_snapshot,
       transfer_reference,state,expires_at,client_request_id,order_revision,snapshot_json,created_by_user_id,
       created_by_device_id,created_by_register_id,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,'VND',?,?,'AWAITING_FUNDS',?,?,?,?,?,?,?,?,?)`)
      .run(id, tenant_id, branch_id, order_id, account.id, account.account, method, Math.round(Number(amount) || 0),
        prefix, reference, expires, requestId, Number(order_revision) || 0, JSON.stringify(snapshot || {}),
        user_id, device_id, register_id, stamp, stamp);
    if (previous) db.prepare(`UPDATE payment_intents SET superseded_by=? WHERE id=?`).run(id, previous.id);
    if (owns) db.prepare('COMMIT').run();
    return db.prepare(`SELECT * FROM payment_intents WHERE id=?`).get(id);
  } catch (error) {
    if (owns && db.isTransaction) db.prepare('ROLLBACK').run();
    throw error;
  }
}

export function activeIntentForOrder(order_id, branch_id = 'sala') {
  return db.prepare(`SELECT * FROM payment_intents WHERE order_id=? AND branch_id=?
    AND state IN (${activeSql}) ORDER BY created_at DESC LIMIT 1`).get(order_id, branch_id) || null;
}

export function resolveIntent(id, branch_id = 'sala') {
  return db.prepare(`SELECT * FROM payment_intents WHERE id=? AND branch_id=?`).get(id, branch_id) || null;
}

export function intentStatusForOrder(order_id, branch_id = 'sala') {
  expireDueIntents();
  const intent = db.prepare(`SELECT * FROM payment_intents WHERE order_id=? AND branch_id=? ORDER BY created_at DESC LIMIT 1`).get(order_id, branch_id);
  if (!intent) return { order_id, state: 'NOT_FOUND', payment_intent: null };
  return { order_id, state: intent.state, payment_intent: intent };
}

export function findExactWaitingIntent({ accountNumber = '', reference = '', amount = 0 } = {}) {
  const normalized = providerSafe(reference, 64);
  const account = providerSafe(accountNumber, 40);
  if (!normalized || !account) return { status: 'UNMATCHED', intent: null };
  expireDueIntents();
  const rows = db.prepare(`SELECT * FROM payment_intents WHERE transfer_reference=?
    AND payment_account_number=?`).all(normalized, account);
  const exact = rows.filter(row => Number(row.amount) === Math.round(Number(amount) || 0));
  if (exact.length === 1) return { status: ACTIVE_STATES.includes(exact[0].state) ? 'MATCHED' : 'LATE', intent: exact[0] };
  return { status: exact.length > 1 ? 'AMBIGUOUS' : 'UNMATCHED', intent: null };
}

export function markIntent(id, state, { provider = null, provider_transaction_id = null, confirmation_source = null,
  confirmed_by = null, payment_id = null, payment_line_id = null, bill_no = null } = {}) {
  const stamp = now();
  db.prepare(`UPDATE payment_intents SET state=?,provider=COALESCE(?,provider),
    provider_transaction_id=COALESCE(?,provider_transaction_id),confirmation_source=COALESCE(?,confirmation_source),
    confirmed_by=COALESCE(?,confirmed_by),payment_id=COALESCE(?,payment_id),payment_line_id=COALESCE(?,payment_line_id),
    bill_no=COALESCE(?,bill_no),confirmed_at=CASE WHEN ?='SUCCEEDED' THEN ? ELSE confirmed_at END,
    updated_at=? WHERE id=?`).run(state, provider, provider_transaction_id, confirmation_source, confirmed_by,
      payment_id, payment_line_id, bill_no, state, stamp, stamp, id);
  return db.prepare(`SELECT * FROM payment_intents WHERE id=?`).get(id);
}

export function expireDueIntents(at = now()) {
  return db.prepare(`UPDATE payment_intents SET state='EXPIRED',cancelled_at=?,updated_at=?
    WHERE state IN ('CREATED','QR_PRESENTED','AWAITING_FUNDS') AND expires_at IS NOT NULL AND expires_at<=?`)
    .run(at, at, at).changes;
}

export function assertCanFinalize(id, order_id, branch_id, amount) {
  const intent = resolveIntent(id, branch_id);
  if (!intent || intent.order_id !== order_id) throw Object.assign(new Error('PaymentIntent không thuộc đơn/chi nhánh hiện tại.'), { status: 409, code: 'PAYMENT_INTENT_SCOPE_MISMATCH' });
  if (!ACTIVE_STATES.includes(intent.state)) {
    if (intent.state === 'SUCCEEDED') return { ...intent, idempotent: true };
    throw Object.assign(new Error(`PaymentIntent không còn hiệu lực (${intent.state}).`), { status: 409, code: 'PAYMENT_INTENT_NOT_ACTIVE' });
  }
  if (Number(intent.amount) !== Math.round(Number(amount) || 0)) throw Object.assign(new Error('Số tiền PaymentIntent không còn khớp đơn. Hãy tạo QR mới.'), { status: 409, code: 'PAYMENT_INTENT_AMOUNT_CHANGED' });
  return intent;
}
