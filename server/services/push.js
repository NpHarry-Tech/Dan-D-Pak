// Đẩy thông báo tới thiết bị KỂ CẢ KHI APP ĐÃ TẮT (Firebase Cloud Messaging) —
// khác hẳn AppNotifier/local_notifier vốn chỉ hiện được khi app đang chạy.
// Khoá service-account đọc từ settings.js (mã hoá trong DB, không phải file
// .json trên đĩa — xem getFirebaseServiceAccount()).
//
// Nguyên tắc sắt: gửi push KHÔNG BAO GIỜ được làm hỏng nghiệp vụ chính (publish
// bản cập nhật, tạo đơn…) — mọi lỗi ở đây chỉ log, không throw ra ngoài.
import { db, uid, now, audit } from '../db.js';
import { getFirebaseServiceAccount } from './settings.js';
import { logger } from '../core/logger.js';

let _app = null;
let _initFailed = false;

async function getMessaging(branch_id) {
  if (_initFailed) return null;
  const serviceAccount = getFirebaseServiceAccount(branch_id);
  if (!serviceAccount) return null;
  try {
    const admin = await import('firebase-admin');
    if (!_app) {
      // Nhiều branch có thể dùng CHUNG 1 project Firebase (thường tình) — chỉ
      // khởi tạo app mặc định MỘT LẦN, tái dùng cho mọi lần gửi sau.
      _app = admin.default.apps.length
        ? admin.default.app()
        : admin.default.initializeApp({
            credential: admin.default.credential.cert(serviceAccount),
          });
    }
    return admin.default.messaging(_app);
  } catch (e) {
    _initFailed = true;
    logger.warn('firebase-admin init failed', { message: e?.message });
    return null;
  }
}

/** Lưu/cập nhật token FCM của 1 thiết bị (gọi khi app khởi động/đăng nhập
 *  và mỗi khi Firebase phát token mới). UPSERT theo device_id — 1 thiết bị chỉ
 *  giữ 1 dòng, token cũ tự bị ghi đè. */
export function registerDeviceToken(body = {}, branch_id = 'sala') {
  const deviceId = String(body.device_id || '').trim();
  const fcmToken = String(body.fcm_token || '').trim();
  if (!deviceId || !fcmToken) throw new Error('Thiếu device_id hoặc fcm_token');
  const platform = String(body.platform || 'android').trim().slice(0, 20);
  const userId = body.user_id ? String(body.user_id).trim().slice(0, 80) : null;

  const existing = db.prepare(`SELECT id FROM device_tokens WHERE device_id=?`).get(deviceId);
  if (existing) {
    db.prepare(`UPDATE device_tokens SET branch_id=?, user_id=?, platform=?, fcm_token=?, updated_at=? WHERE device_id=?`)
      .run(branch_id, userId, platform, fcmToken, now(), deviceId);
    return { ok: true, id: existing.id };
  }
  const id = uid('dtk_');
  db.prepare(`INSERT INTO device_tokens (id,branch_id,device_id,user_id,platform,fcm_token,updated_at) VALUES (?,?,?,?,?,?,?)`)
    .run(id, branch_id, deviceId, userId, platform, fcmToken, now());
  return { ok: true, id };
}

function removeDeadToken(deviceId) {
  try { db.prepare(`DELETE FROM device_tokens WHERE device_id=?`).run(deviceId); } catch { /* best-effort */ }
}

async function deliver(messaging, rows, { title, body, data = {} }) {
  let sent = 0, failed = 0;
  for (const row of rows) {
    try {
      await messaging.send({
        token: row.fcm_token,
        notification: { title: String(title || ''), body: String(body || '') },
        data: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)])),
        android: { priority: 'high' },
      });
      sent++;
    } catch (e) {
      failed++;
      // Token hết hạn/app đã gỡ trên thiết bị đó → dọn luôn, không gửi lại nữa.
      const code = e?.errorInfo?.code || e?.code || '';
      if (String(code).includes('registration-token-not-registered') ||
          String(code).includes('invalid-argument')) {
        removeDeadToken(row.device_id);
      }
    }
  }
  return { sent, failed };
}

/** Gửi 1 thông báo tới TẤT CẢ thiết bị đã đăng ký của 1 chi nhánh (lọc thêm
 *  theo platform nếu truyền vào — vd chỉ 'android' cho thông báo cập nhật app
 *  Windows không áp dụng). Trả về {sent, failed} — không throw. */
export async function sendPushToBranch(branch_id, { title, body, data = {}, platform = null } = {}) {
  try {
    const messaging = await getMessaging(branch_id);
    if (!messaging) return { sent: 0, failed: 0, reason: 'not_configured' };
    const rows = platform
      ? db.prepare(`SELECT * FROM device_tokens WHERE branch_id=? AND platform=?`).all(branch_id, platform)
      : db.prepare(`SELECT * FROM device_tokens WHERE branch_id=?`).all(branch_id);
    if (!rows.length) return { sent: 0, failed: 0, reason: 'no_devices' };
    const result = await deliver(messaging, rows, { title, body, data });
    audit('push.sent', { title, ...result, total: rows.length }, branch_id);
    return result;
  } catch (e) {
    logger.warn('sendPushToBranch failed', { message: e?.message });
    return { sent: 0, failed: 0, reason: 'error' };
  }
}

/** Gửi tới MỌI thiết bị đã đăng ký của 1 nền tảng, BẤT KỂ chi nhánh — dùng
 *  cho thông báo mang tính toàn hệ thống (bản cập nhật app mới). Nhiều chi
 *  nhánh thường dùng chung 1 project Firebase nên chỉ cần khoá của 'sala'. */
export async function sendPushForNewAppVersion(platform, { title, body, data = {} } = {}) {
  try {
    const messaging = await getMessaging('sala');
    if (!messaging) return { sent: 0, failed: 0, reason: 'not_configured' };
    const rows = db.prepare(`SELECT * FROM device_tokens WHERE platform=?`).all(platform);
    if (!rows.length) return { sent: 0, failed: 0, reason: 'no_devices' };
    const result = await deliver(messaging, rows, { title, body, data });
    audit('push.sent', { title, ...result, total: rows.length, scope: 'all_branches' }, 'sala');
    return result;
  } catch (e) {
    logger.warn('sendPushForNewAppVersion failed', { message: e?.message });
    return { sent: 0, failed: 0, reason: 'error' };
  }
}
