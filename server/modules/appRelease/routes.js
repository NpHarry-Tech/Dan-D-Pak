// Route ownership: Auto-update (phát hành & phân phối bản cài mới cho thiết bị).
// Nghiệp vụ ở services/appRelease.js. Giữ NGUYÊN hành vi (download tự pipe res, không wrap).
import * as AppRelease from '../../services/appRelease.js';
import { raw } from 'express';
import { errorPayload } from '../../core/errors.js';
import fs from 'node:fs';
import { rateLimit } from '../../core/rateLimit.js';

const publishLimiter = rateLimit({ key: 'app-publish', windowMs: 60_000, max: 3 });

export function registerAppReleaseRoutes(api, { wrap, guardAny, logRequestError }) {
// --- Auto-update: phát hành & phân phối bản cài mới cho thiết bị ---
// Version: PUBLIC (client hỏi trước cả khi đăng nhập). Chỉ lộ số hiệu + ghi chú.
api.get('/app/version', wrap((req) => AppRelease.latestFor(
  String(req.query.platform || 'windows').toLowerCase())));
// Download: PUBLIC — stream file cài đặt (exe/apk) cho client tự cập nhật.
// KHÔNG dùng wrap() vì handler tự pipe vào res (wrap sẽ res.json sau khi đã gửi).
api.get('/app/download/:platform', (req, res) => {
  try {
    const { path: filePath, name } = AppRelease.releaseFilePath(
      String(req.params.platform || '').toLowerCase());
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    res.setHeader('Content-Type', 'application/octet-stream');
    fs.createReadStream(filePath).pipe(res);
  } catch (e) {
    logRequestError(req, e);
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
