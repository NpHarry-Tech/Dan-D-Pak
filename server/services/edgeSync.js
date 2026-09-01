import crypto from 'node:crypto';
import { db, now } from '../db.js';
import { AppError } from '../core/errors.js';
import { safeEqual } from '../core/util.js';

const HUB_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{2,63}$/;
const EVENT_RE = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{5,127}$/;
const MAX_BATCH = 100;
const MAX_EVENT_BYTES = 2 * 1024 * 1024;
const TABLES = new Map([
  ['orders', { mutable: true, branch: 'branch_id' }],
  ['order_items', { mutable: true, parent: ['orders', 'order_id'] }],
  ['payments', { parent: ['orders', 'order_id'] }],
  ['payment_lines', { parent: ['payments', 'payment_id'], paymentParent: true }],
  ['sale_snapshots', { branch: 'branch_id' }],
  ['stock_movements', { branch: 'branch_id' }],
  ['shifts', { mutable: true, branch: 'branch_id' }],
  ['customers', { mutable: true, branch: 'branch_id' }],
  ['skus', { mutable: true, branch: 'branch_id' }],
  ['inventory_items', { mutable: true, branch: 'branch_id' }],
  ['stock_lots', { mutable: true, branch: 'branch_id' }],
  ['cash_drawer_entries', { mutable: true, branch: 'branch_id' }],
  ['cash_drawer_reimbursement_allocations', { mutable: true, branch: 'branch_id' }],
  ['tables', { mutable: true, branch: 'branch_id' }],
]);

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

export function payloadHash(payload) {
  return crypto.createHash('sha256').update(JSON.stringify(canonical(payload))).digest('hex');
}

function fail(message, code = 'EDGE_SYNC_INVALID', status = 400, details) {
  throw new AppError(message, { code, status, details });
}

export function edgeSignature(secret, timestamp, body) {
  return crypto.createHmac('sha256', secret).update(`${timestamp}.${JSON.stringify(body)}`).digest('hex');
}

export function assertEdgeSignature(presented, timestamp, body) {
  const expected = String(process.env.EDGE_SYNC_SHARED_SECRET || '');
  if (expected.length < 32) fail('Edge sync receiver is not configured', 'EDGE_SYNC_DISABLED', 503);
  const requestTime = Number(timestamp);
  if (!Number.isSafeInteger(requestTime) || Math.abs(Date.now() - requestTime) > 5 * 60 * 1000) {
    fail('Edge sync request timestamp is invalid or expired', 'EDGE_SYNC_EXPIRED', 401);
  }
  const expectedSignature = edgeSignature(expected, String(timestamp), body);
  if (!safeEqual(expectedSignature, presented)) fail('Invalid edge sync signature', 'EDGE_SYNC_UNAUTHORIZED', 401);
}

export function authorizedBranches(hubId) {
  let configured;
  try { configured = JSON.parse(String(process.env.EDGE_SYNC_ALLOWED_HUBS_JSON || '')); } catch {
    fail('Edge hub authorization map is not configured', 'EDGE_SYNC_DISABLED', 503);
  }
  const branches = configured && typeof configured === 'object' ? configured[hubId] : null;
  if (!Array.isArray(branches) || branches.length === 0) {
    fail('Edge hub is not authorized', 'EDGE_SYNC_HUB_FORBIDDEN', 403);
  }
  const owners = new Map();
  for (const [configuredHub, configuredBranches] of Object.entries(configured)) {
    if (!Array.isArray(configuredBranches)) fail('Edge hub authorization map is invalid', 'EDGE_SYNC_DISABLED', 503);
    for (const branch of configuredBranches.map(String)) {
      if (owners.has(branch) && owners.get(branch) !== configuredHub) {
        fail('A branch may have only one authoritative edge hub', 'EDGE_SYNC_DISABLED', 503);
      }
      owners.set(branch, configuredHub);
    }
  }
  return new Set(branches.map(String));
}

function quoted(name) {
  return `"${String(name).replaceAll('"', '""')}"`;
}

function tableColumns(table) {
  return new Set(db.prepare(`PRAGMA table_info(${quoted(table)})`).all().map((column) => column.name));
}

function eventBranch(spec, payload) {
  if (spec.branch) return payload[spec.branch];
  if (spec.paymentParent) {
    return db.prepare(`SELECT o.branch_id FROM payments p JOIN orders o ON o.id=p.order_id WHERE p.id=?`)
      .get(payload.payment_id)?.branch_id;
  }
  if (spec.parent) {
    return db.prepare(`SELECT branch_id FROM ${quoted(spec.parent[0])} WHERE id=?`)
      .get(payload[spec.parent[1]])?.branch_id;
  }
  return null;
}

function existingSelected(table, id, columns) {
  return db.prepare(
    `SELECT ${columns.map(quoted).join(',')} FROM ${quoted(table)} WHERE id=?`,
  ).get(id);
}

function applyEvent(event) {
  const spec = TABLES.get(event.kind);
  if (!spec) fail(`Unsupported edge event kind: ${event.kind}`);
  const payload = event.payload;
  if (!payload || Array.isArray(payload) || typeof payload !== 'object') fail('Event payload must be an object');
  if (Buffer.byteLength(JSON.stringify(payload)) > MAX_EVENT_BYTES) fail('Edge event payload is too large', 'EDGE_SYNC_TOO_LARGE', 413);
  if (!payload.id || String(payload.id) !== event.ref) fail('Event ref must match payload.id');

  const allowed = tableColumns(event.kind);
  const unknown = Object.keys(payload).filter((key) => !allowed.has(key));
  if (unknown.length) fail('Event payload contains unknown columns', 'EDGE_SYNC_SCHEMA_MISMATCH', 409, { unknown });
  const columns = Object.keys(payload);
  if (!columns.includes('id')) fail('Event payload has no primary ID');

  const branch = eventBranch(spec, payload);
  if (!branch || branch !== event.branchId) {
    fail('Event branch does not match its record relationship', 'EDGE_SYNC_BRANCH_MISMATCH', 409);
  }

  const existing = existingSelected(event.kind, payload.id, columns);
  if (existing && !spec.mutable) {
    const same = columns.every((column) => existing[column] === payload[column]);
    if (!same) fail('Immutable edge record conflicts with existing data', 'EDGE_SYNC_CONFLICT', 409);
    return 'duplicate-record';
  }

  const placeholders = columns.map(() => '?').join(',');
  const updates = columns.filter((column) => column !== 'id')
    .map((column) => `${quoted(column)}=excluded.${quoted(column)}`).join(',');
  const conflict = spec.mutable ? ` DO UPDATE SET ${updates}` : ' DO NOTHING';
  db.prepare(
    `INSERT INTO ${quoted(event.kind)}(${columns.map(quoted).join(',')}) VALUES(${placeholders})
     ON CONFLICT(id)${conflict}`,
  ).run(...columns.map((column) => payload[column]));
  return existing ? 'updated' : 'inserted';
}

function validateEnvelope(body) {
  const hubId = String(body?.hubId || '');
  if (!HUB_RE.test(hubId)) fail('Invalid hub ID');
  if (!Array.isArray(body?.events) || body.events.length < 1 || body.events.length > MAX_BATCH) {
    fail(`Edge sync batch must contain 1-${MAX_BATCH} events`);
  }
  const events = body.events.map((raw) => ({
    eventId: String(raw?.eventId || ''),
    hubId,
    sequence: Number(raw?.sequence),
    kind: String(raw?.kind || ''),
    ref: String(raw?.ref || ''),
    branchId: String(raw?.branchId || ''),
    operation: String(raw?.operation || ''),
    payload: raw?.payload,
  }));
  let previous = 0;
  for (const event of events) {
    if (!EVENT_RE.test(event.eventId)) fail('Invalid event ID');
    if (!Number.isSafeInteger(event.sequence) || event.sequence <= 0) fail('Invalid event sequence');
    if (event.sequence <= previous) fail('Events must be strictly ordered by sequence');
    if (event.operation !== 'upsert') fail('Unsupported edge event operation');
    if (!event.branchId) fail('Event branch is required');
    previous = event.sequence;
  }
  return { hubId, events };
}

export function receiveEdgeBatch(auth, body) {
  assertEdgeSignature(auth?.signature, auth?.timestamp, body);
  const { hubId, events } = validateEnvelope(body);
  const allowedBranches = authorizedBranches(hubId);
  for (const event of events) {
    if (!allowedBranches.has(event.branchId)) {
      fail('Edge hub is not authorized for this branch', 'EDGE_SYNC_BRANCH_FORBIDDEN', 403);
    }
  }
  const acknowledgements = [];
  db.exec('BEGIN IMMEDIATE;');
  try {
    db.prepare(`UPDATE sync_apply_state SET remote_apply=1 WHERE id=1`).run();
    let cursor = Number(db.prepare(`SELECT last_sequence FROM sync_hub_cursors WHERE hub_id=?`).get(hubId)?.last_sequence || 0);
    for (const event of events) {
      const hash = payloadHash(event.payload);
      const prior = db.prepare(`SELECT * FROM sync_inbox WHERE event_id=?`).get(event.eventId);
      if (prior) {
        if (prior.hub_id !== hubId || Number(prior.sequence) !== event.sequence || prior.payload_hash !== hash) {
          fail('Event ID was reused with different content', 'EDGE_SYNC_EVENT_REUSE', 409);
        }
        acknowledgements.push({ eventId: event.eventId, sequence: event.sequence, duplicate: true });
        continue;
      }
      if (event.sequence <= cursor) {
        fail('Unseen event sequence is behind the committed hub cursor', 'EDGE_SYNC_SEQUENCE_CONFLICT', 409);
      }
      const sequenceOwner = db.prepare(`SELECT event_id FROM sync_inbox WHERE hub_id=? AND sequence=?`)
        .get(hubId, event.sequence);
      if (sequenceOwner) {
        fail('Hub sequence was reused by a different event', 'EDGE_SYNC_SEQUENCE_CONFLICT', 409);
      }
      applyEvent(event);
      const appliedAt = now();
      db.prepare(`INSERT INTO sync_inbox(event_id,hub_id,sequence,kind,ref,payload_hash,received_at,applied_at)
                  VALUES(?,?,?,?,?,?,?,?)`)
        .run(event.eventId, hubId, event.sequence, event.kind, event.ref, hash, appliedAt, appliedAt);
      cursor = event.sequence;
      acknowledgements.push({ eventId: event.eventId, sequence: event.sequence, duplicate: false });
    }
    db.prepare(`INSERT INTO sync_hub_cursors(hub_id,last_sequence,updated_at) VALUES(?,?,?)
                ON CONFLICT(hub_id) DO UPDATE SET last_sequence=excluded.last_sequence,updated_at=excluded.updated_at`)
      .run(hubId, cursor, now());
    db.prepare(`UPDATE sync_apply_state SET remote_apply=0 WHERE id=1`).run();
    db.exec('COMMIT;');
    return { ok: true, hubId, acknowledged: acknowledgements, cursor };
  } catch (error) {
    try { db.exec('ROLLBACK;'); } catch {}
    throw error;
  }
}
