// §5/§53-A — REGRESSION: "actor is not a function" ở route /retail/:id/refund.
// Bug gốc: api.js không truyền `actor` vào registerRetailRoutes, nhưng handler
// refund gọi actor(req). Test capture handler thật từ registerRetailRoutes và
// chứng minh: CÓ actor → không crash "is not a function"; THIẾU actor → tái hiện bug.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const temp = mkdtempSync(join(tmpdir(), 'dandpak-refund-actor-'));
process.env.SQLITE_PATH = join(temp, 'store.db');
process.env.STORAGE_PATH = join(temp, 'storage');
process.env.DATA_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.NODE_ENV = 'development';

const { migrate } = await import('./db.js');
migrate();
const { registerRetailRoutes } = await import('./modules/retail/routes.js');

// Bắt handler cuối (đã wrap) theo path từ registerRetailRoutes.
function captureRefundHandler(deps) {
  const routes = {};
  const api = {
    get() {}, put() {}, delete() {}, use() {}, patch() {}, all() {},
    post(path, ...handlers) { routes[`POST ${path}`] = handlers[handlers.length - 1]; },
  };
  registerRetailRoutes(api, deps);
  return routes['POST /retail/:id/refund'];
}

const baseDeps = {
  wrap: (fn) => fn,                       // passthrough để lấy handler thô
  guard: () => (_req, _res, next) => next && next(),
  guardAny: () => (_req, _res, next) => next && next(),
  branch: () => 'sala',
  visibleBranch: () => 'sala',
  applyManualConfirm: () => null,
  assertBillEditable: () => null,
};

test('CÓ actor: handler refund KHÔNG crash "actor is not a function"', async () => {
  const handler = captureRefundHandler({ ...baseDeps, actor: (_req) => 'tester' });
  let err = null;
  try {
    await handler({ params: { id: 'khong-ton-tai' }, body: { reason: 'x' } });
  } catch (e) { err = e; }
  // Có thể lỗi "không tìm thấy đơn" — nhưng TUYỆT ĐỐI không được là actor-not-a-function.
  assert.ok(!/is not a function/.test(err?.message || ''),
    `không được crash actor: ${err?.message}`);
});

test('THIẾU actor (bug cũ): tái hiện đúng "actor is not a function"', async () => {
  const handler = captureRefundHandler({ ...baseDeps, actor: undefined });
  let err = null;
  try {
    await handler({ params: { id: 'khong-ton-tai' }, body: { reason: 'x' } });
  } catch (e) { err = e; }
  assert.ok(/is not a function/.test(err?.message || ''),
    `phải tái hiện bug khi thiếu actor, nhận: ${err?.message}`);
});
