import crypto from 'node:crypto';

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function entityId(event, payload) {
  const root = object(payload);
  const nested = object(root.order);
  const id = root.entity_id || root.order_id || root.table_id || root.item_id
    || root.id || nested.id || nested.order_id || nested.table_id || 'global';
  return `${String(event).split(':')[0]}:${String(id)}`;
}

function suppliedVersion(payload) {
  const root = object(payload);
  const nested = object(root.order);
  for (const value of [root.entity_version, root.version, nested.entity_version, nested.version]) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed) && parsed >= 0) return parsed;
  }
  return null;
}

export class RealtimeEventJournal {
  constructor({ limitPerBranch = 512, instanceId = crypto.randomUUID(), clock = () => new Date().toISOString() } = {}) {
    this.limitPerBranch = Math.max(1, limitPerBranch);
    this.instanceId = instanceId;
    this.clock = clock;
    this.sequences = new Map();
    this.records = new Map();
  }

  record(event, payload, branch = 'sala') {
    const branchId = String(branch || 'sala');
    const sequence = (this.sequences.get(branchId) || 0) + 1;
    this.sequences.set(branchId, sequence);
    const eventId = `${this.instanceId}:${branchId}:${sequence}`;
    const envelope = {
      event_id: eventId,
      entity: entityId(event, payload),
      // Journal version is monotonic even when two different event types refer
      // to the same unchanged domain row (for example order:updated followed by
      // order:pending). Preserve an optional row version separately.
      version: sequence,
      entity_version: suppliedVersion(payload),
      sequence,
      branch_id: branchId,
      emitted_at: this.clock(),
      server_instance: this.instanceId,
    };
    const enriched = payload && typeof payload === 'object' && !Array.isArray(payload)
      ? { ...payload, _rt: envelope }
      : { value: payload, _rt: envelope };
    const records = this.records.get(branchId) || [];
    records.push({ event, payload: enriched, envelope });
    if (records.length > this.limitPerBranch) records.splice(0, records.length - this.limitPerBranch);
    this.records.set(branchId, records);
    return records.at(-1);
  }

  replay(branch = 'sala', afterEventId = '') {
    const branchId = String(branch || 'sala');
    const records = this.records.get(branchId) || [];
    if (!afterEventId) return { status: 'resync', reason: 'missing_cursor', records: [] };
    const index = records.findIndex((record) => record.envelope.event_id === afterEventId);
    if (index < 0) return { status: 'resync', reason: 'cursor_expired_or_server_restarted', records: [] };
    return { status: 'replay', records: records.slice(index + 1) };
  }
}
