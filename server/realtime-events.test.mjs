import assert from 'node:assert/strict';
import test from 'node:test';
import { RealtimeEventJournal } from './core/realtimeEvents.js';

test('event envelope has stable replay id, entity, version and branch', () => {
  const journal = new RealtimeEventJournal({ instanceId: 'server-a', clock: () => '2026-09-05T00:00:00.000Z' });
  const first = journal.record('order:updated', { id: 'ord-1', version: 7 }, 'sala');
  const second = journal.record('payment:done', { order_id: 'ord-1' }, 'sala');
  assert.deepEqual(first.payload._rt, {
    event_id: 'server-a:sala:1', entity: 'order:ord-1', version: 1, entity_version: 7, sequence: 1,
    branch_id: 'sala', emitted_at: '2026-09-05T00:00:00.000Z', server_instance: 'server-a',
  });
  const replay = journal.replay('sala', first.envelope.event_id);
  assert.equal(replay.status, 'replay');
  assert.equal(replay.records.length, 1);
  assert.equal(replay.records[0].envelope.event_id, second.envelope.event_id);
});

test('replay is branch-isolated and expired/restart cursors demand resync', () => {
  const journal = new RealtimeEventJournal({ limitPerBranch: 2, instanceId: 'server-b' });
  const old = journal.record('table:updated', { id: 't1' }, 'sala');
  journal.record('table:updated', { id: 't2' }, 'sala');
  journal.record('table:updated', { id: 't3' }, 'sala');
  journal.record('table:updated', { id: 'h1' }, 'hanoi');
  assert.deepEqual(journal.replay('sala', old.envelope.event_id), {
    status: 'resync', reason: 'cursor_expired_or_server_restarted', records: [],
  });
  assert.equal(journal.replay('hanoi', 'server-b:sala:3').status, 'resync');
});
