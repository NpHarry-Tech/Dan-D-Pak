import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const temp = mkdtempSync(join(tmpdir(), 'dandpak-reqlog-'));
process.env.SQLITE_PATH = join(temp, 'store.db');
process.env.STORAGE_PATH = join(temp, 'storage');
// Ngưỡng 1ms (0 bị coi falsy do `parseInt(...) || 1500`) — test không cần
// thật sự chờ 1.5s để trigger slow_request.
process.env.SLOW_REQUEST_MS = '1';

const { db, migrate } = await import('./db.js');
const { requestContextMiddleware } = await import('./core/requestContext.js');
const { requestLogger } = await import('./core/requestLogger.js');

migrate();

// Máy nào gọi API chậm phải TRUY VẾT được — thiếu thiết bị cụ thể (device_id/
// platform/os/app_version) thì "Endpoint chậm" chỉ báo có sự cố chứ không biết
// đi kiểm tra máy nào (đúng lỗi đã báo: mọi dòng slow_request đều chỉ có
// device_name='localhost', vì Platform.localHostname trên Android luôn trả
// 'localhost' — không dùng được để phân biệt máy).
const DEVICE_HEADERS = {
  'x-device-id': 'dev_tablet_pos1',
  'x-device-name': 'localhost',
  'x-app-version': '2026.07.25.1',
  'x-build-number': '35',
  'x-platform': 'android',
  'x-os-version': 'Android 13',
  'x-branch-id': 'sala',
};

function fakeRes() {
  const listeners = {};
  return {
    statusCode: 200,
    on: (event, cb) => { listeners[event] = cb; },
    fire: (event) => listeners[event]?.(),
  };
}

test('slow_request system log captures the originating device, not just device_name', async () => {
  const req = { method: 'GET', originalUrl: '/api/print/jobs?limit=50', headers: DEVICE_HEADERS, user: { username: 'harry' } };
  const res = fakeRes();

  await new Promise((resolve) => {
    requestContextMiddleware(req, res, () => {
      requestLogger(req, res, () => {
        // Simulate a slow response finishing well above the 1500ms threshold.
        setTimeout(() => { res.fire('finish'); resolve(); }, 5);
      });
    });
  });

  const row = db.prepare(
    `SELECT * FROM system_logs WHERE event_type='slow_request' AND endpoint LIKE '/api/print/jobs%' ORDER BY rowid DESC LIMIT 1`
  ).get();
  assert.ok(row, 'expected a slow_request row to be written');
  assert.equal(row.device_id, 'dev_tablet_pos1');
  assert.equal(row.platform, 'android');
  assert.equal(row.os_version, 'Android 13');
  assert.equal(row.app_version, '2026.07.25.1');
  assert.equal(row.build_number, '35');
});
