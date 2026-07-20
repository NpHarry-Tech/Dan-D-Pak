import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('activity log keeps domain audit and drops duplicate technical noise', () => {
  const api = readFileSync(new URL('./api.js', import.meta.url), 'utf8');
  const reports = readFileSync(new URL('./services/reports.js', import.meta.url), 'utf8');
  const logs = readFileSync(new URL('./services/systemLogs.js', import.meta.url), 'utf8');
  const routes = readFileSync(new URL('./modules/audit/routes.js', import.meta.url), 'utf8');
  const auditStore = readFileSync(new URL('./db/audit.js', import.meta.url), 'utf8');

  assert.match(api, /if \(status < 500\) return/);
  assert.doesNotMatch(api, /audit\('system\.error'/);
  for (const action of [
    'system.error',
    'client.crash',
    'print.failed',
    'print.agent.failed',
    'einvoice.backfill_failed',
    'einvoice.auto_create_failed',
  ]) {
    assert.match(reports, new RegExp(action.replace('.', '\\.')));
  }
  const printing = readFileSync(new URL('./services/printing.js', import.meta.url), 'utf8');
  assert.doesNotMatch(printing, /audit\('print\.(?:agent\.)?failed'/);
  assert.match(logs, /event_type = 'socket_error'/);
  assert.match(logs, /event_type = 'slow_request' AND source = 'flutter_app'/);
  assert.match(logs, /event_type IN \('print_failed','payment_failed'\) AND source = 'flutter_app'/);
  assert.match(logs, /endpoint LIKE '\/api\/system-logs%'/);
  assert.match(logs, /ROW_NUMBER\(\) OVER/);
  assert.match(routes, /entry\.eventId/);
  assert.match(routes, /WHERE request_id = \?/);
  assert.match(auditStore, /TECHNICAL_ONLY_ACTIONS\.has\(action\)/);
});
