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

const _uintOrNull = (v) => (/^\d+$/.test(String(v ?? '').trim()) ? parseInt(String(v).trim(), 10) : null);

// Xử lý sự kiện "cập nhật thành công" — FAIL-CLOSED. TUYỆT ĐỐI không audit
// app.update_success trừ khi vượt qua MỌI kiểm tra. Tách hàm để test runtime.
//   • Thiếu toBuild/key            → { ok:false, ignored:'missing-fields' } (route trả 400)
//   • Thiếu header x-build-number  → { ok:true,  ignored:'missing-build-header' }  (KHÔNG audit)
//   • Header không phải số hợp lệ  → { ok:true,  ignored:'invalid-build-header' }  (KHÔNG audit)
//   • Header != toBuild            → { ok:true,  ignored:'build-mismatch' }        (KHÔNG audit)
//   • toBuild <= fromBuild         → { ok:true,  ignored:'not-an-upgrade' }        (KHÔNG audit)
//   • Đã ghi (key trùng)           → { ok:true,  deduped:true }                    (KHÔNG audit lại)
//   • Hợp lệ                       → audit(app.update_success) + { ok:true, logged:true }
export function processUpdateEvent({ headers = {}, body = {}, branch_id = 'sala', actor = 'system' }) {
  const toBuild = _uintOrNull(body.toBuild);
  const fromBuild = _uintOrNull(body.fromBuild);
  const version = String(body.version || '').trim().slice(0, 40);
  const key = String(body.key || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 120);
  if (toBuild == null || !key) return { ok: false, ignored: 'missing-fields' };

  // BẮT BUỘC header x-build-number (build ĐANG CHẠY thật của thiết bị) tồn tại,
  // là số, và BẰNG toBuild. Thiếu/không hợp lệ/không khớp → KHÔNG audit.
  const rawBuild = String(headers['x-build-number'] ?? '').trim();
  if (rawBuild === '') return { ok: true, ignored: 'missing-build-header' };
  if (!/^\d+$/.test(rawBuild)) return { ok: true, ignored: 'invalid-build-header' };
  const actualBuild = parseInt(rawBuild, 10);
  if (actualBuild !== toBuild) return { ok: true, ignored: 'build-mismatch', actualBuild };

  if (fromBuild != null && toBuild <= fromBuild) return { ok: true, ignored: 'not-an-upgrade' };

  const dupe = db.prepare(
    `SELECT 1 FROM audit_log WHERE branch_id=? AND action='app.update_success' AND detail LIKE ? LIMIT 1`,
  ).get(branch_id, `%"key":"${key}"%`);
  if (dupe) return { ok: true, deduped: true };

  audit('app.update_success',
    { fromBuild, toBuild, version, key, deviceId: String(headers['x-device-id'] || '').slice(0, 120) },
    branch_id, actor);
  return { ok: true, logged: true };
}

export function registerAppReleaseRoutes(api, { wrap, guardAny, logRequestError }) {
// --- Ghi nhận CẬP NHẬT THÀNH CÔNG vào Nhật ký hoạt động (fail-closed) ---------
api.post('/app/update-event', wrap((req) => {
  const { branch_id, actor } = Auth.requirePermission(req, null); // chỉ cần đăng nhập
  const result = processUpdateEvent({
    headers: req.headers || {}, body: req.body || {}, branch_id,
    actor: actor?.username || actor?.name || 'system',
  });
  if (result.ignored === 'missing-fields') throw new Error('Thiếu toBuild/key');
  return result;
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
