// Route ownership: Auto-update (phát hành & phân phối bản cài mới cho thiết bị).
// Nghiệp vụ ở services/appRelease.js. Giữ NGUYÊN hành vi (download tự pipe res, không wrap).
import * as AppRelease from '../../services/appRelease.js';
import * as Auth from '../../services/auth.js';
import { db, audit } from '../../db.js';
import { raw } from 'express';
import { errorPayload } from '../../core/errors.js';
import fs from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { rateLimit } from '../../core/rateLimit.js';

const publishLimiter = rateLimit({ key: 'app-publish', windowMs: 60_000, max: 3 });

export function registerAppReleaseRoutes(api, { wrap, guardAny, logRequestError }) {
// --- Ghi nhận CẬP NHẬT THÀNH CÔNG vào Nhật ký hoạt động ----------------------
// Thiết bị tự cập nhật ở phía client; để dòng "Cập nhật thành công" hiện trong
// Nhật ký hoạt động (audit_log) + realtime, client POST sự kiện này SAU khi đã
// xác nhận build mới đang chạy (so pending-update marker). Server là nguồn sự
// thật cho actor/branch. IDEMPOTENT theo `key` (marker của client) — gửi lại khi
// reconnect/retry KHÔNG tạo dòng trùng. audit() phát 'activity:new' post-write
// nên Desktop hiện ngay không cần đổi tab/polling.
api.post('/app/update-event', wrap((req) => {
  const { branch_id, actor } = Auth.requirePermission(req, null); // chỉ cần đăng nhập
  const b = req.body || {};
  const toBuild = parseInt(b.toBuild, 10);
  const fromBuild = Number.isFinite(parseInt(b.fromBuild, 10)) ? parseInt(b.fromBuild, 10) : null;
  const version = String(b.version || '').trim().slice(0, 40);
  const key = String(b.key || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 120);
  if (!Number.isFinite(toBuild) || !key) throw new Error('Thiếu toBuild/key');
  // Chỉ ghi khi THỰC SỰ lên build cao hơn (client đã đối chiếu marker; đây là chốt
  // chặn phía server để không ai ghi "thành công" khi không có cập nhật thật).
  if (fromBuild != null && toBuild <= fromBuild) return { ok: true, ignored: 'not-an-upgrade' };
  const dupe = db.prepare(
    `SELECT 1 FROM audit_log WHERE branch_id=? AND action='app.update_success' AND detail LIKE ? LIMIT 1`,
  ).get(branch_id, `%"key":"${key}"%`);
  if (dupe) return { ok: true, deduped: true };
  audit('app.update_success',
    { fromBuild, toBuild, version, key, deviceId: String(req.headers?.['x-device-id'] || '').slice(0, 120) },
    branch_id, actor?.username || actor?.name || 'system');
  return { ok: true, logged: true };
}));
// --- Auto-update: phát hành & phân phối bản cài mới cho thiết bị ---
// Version: PUBLIC (client hỏi trước cả khi đăng nhập). Chỉ lộ số hiệu + ghi chú.
api.get('/app/version', wrap((req, res) => {
  // Release state is origin-specific and must be revalidated after an endpoint
  // switch. Do not let a browser/proxy reuse a stale mandatory flag or URL.
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Vary', 'Host');
  return AppRelease.latestFor(
    String(req.query.platform || 'windows').toLowerCase());
}));
// Download: PUBLIC — stream file cài đặt (exe/apk) cho client tự cập nhật.
// KHÔNG dùng wrap() vì handler tự pipe vào res (wrap sẽ res.json sau khi đã gửi).
api.get('/app/download/:platform', async (req, res) => {
  try {
    const { path: filePath, name } = AppRelease.releaseFilePath(
      String(req.params.platform || '').toLowerCase());
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    res.setHeader('Content-Type', 'application/octet-stream');
    await pipeline(fs.createReadStream(filePath), res);
  } catch (e) {
    logRequestError(req, e);
    if (res.headersSent) { res.destroy(); return; }
    res.status(e.status || 400).json(errorPayload(e));
  }
});
// Publish: chỉ Owner/Admin. Nhận binary thô (raw) tới 300MB (đủ cho apk).
api.post('/app/publish',
  publishLimiter,
  guardAny('settings.manage'),
  raw({ type: '*/*', limit: '300mb' }),
  wrap((req) => AppRelease.publishRelease(
    String(req.query.platform || 'windows').toLowerCase(),
    req.body,
    {
      version: req.query.version,
      buildNumber: req.query.build,
      notes: req.query.notes,
      mandatory: req.query.mandatory,
      fileName: req.query.file,
    })));
}
