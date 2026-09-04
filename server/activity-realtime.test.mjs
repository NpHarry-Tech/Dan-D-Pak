import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  setRealtimeEmitter, publishRealtime, hasRealtimeEmitter,
} from './core/realtimeBus.js';

test('realtimeBus is a no-op until an emitter is registered', () => {
  setRealtimeEmitter(null);
  assert.equal(hasRealtimeEmitter(), false);
  // Must not throw when no socket layer is present (unit test / cron / worker).
  assert.equal(publishRealtime('activity:new', { id: 'a_1' }, 'sala'), false);
});

test('realtimeBus forwards event/payload/branch to the registered emitter', () => {
  const seen = [];
  setRealtimeEmitter((event, payload, branch) => seen.push({ event, payload, branch }));
  assert.equal(hasRealtimeEmitter(), true);
  const ok = publishRealtime('activity:new', { id: 'a_2', action: 'x' }, 'branch-7');
  assert.equal(ok, true);
  assert.deepEqual(seen, [{ event: 'activity:new', payload: { id: 'a_2', action: 'x' }, branch: 'branch-7' }]);
  setRealtimeEmitter(null);
});

test('a throwing emitter never propagates to the caller (logging must not break business ops)', () => {
  setRealtimeEmitter(() => { throw new Error('socket down'); });
  assert.equal(publishRealtime('activity:new', { id: 'a_3' }, 'sala'), false);
  setRealtimeEmitter(null);
});

test('audit() emits activity:new AFTER the durable write, keyed by id (idempotency)', () => {
  const src = readFileSync(new URL('./db/audit.js', import.meta.url), 'utf8');
  // Emit must come after the SQLite insert block (post-commit), inside audit().
  const insertIdx = src.indexOf('INSERT INTO audit_log');
  const emitIdx = src.indexOf("publishRealtime('activity:new'");
  assert.ok(insertIdx > 0, 'audit_log insert present');
  assert.ok(emitIdx > insertIdx, 'activity:new emitted after the insert');
  // Payload must carry the id so clients can dedupe on reconnect/resync.
  assert.match(src, /publishRealtime\('activity:new', \{ id, branch_id, actor, action, detail: cleanDetail, created_at \}, branch_id\)/);
});

test('realtime.js registers its emit() into the bus at init', () => {
  const src = readFileSync(new URL('./realtime.js', import.meta.url), 'utf8');
  assert.match(src, /import \{ setRealtimeEmitter \} from '\.\/core\/realtimeBus\.js'/);
  assert.match(src, /setRealtimeEmitter\(emit\)/);
});

test('#1 update-event verifies the actual device build (x-build-number) not just client toBuild', () => {
  const src = readFileSync(new URL('./modules/appRelease/routes.js', import.meta.url), 'utf8');
  // Must read the per-request build header and reject when it disagrees with toBuild.
  assert.match(src, /x-build-number/);
  assert.match(src, /actualBuild\s*!==\s*toBuild/);
  assert.match(src, /build-mismatch/);
  // Still guards against a non-upgrade even if headers are absent.
  assert.match(src, /toBuild <= fromBuild/);
});
