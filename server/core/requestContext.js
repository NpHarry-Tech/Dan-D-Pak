import { AsyncLocalStorage } from 'node:async_hooks';

// Ngữ cảnh theo TỪNG request (thiết bị, correlation) — cho phép audit()/log ở
// sâu trong service biết "thao tác này đến từ máy nào" mà không phải luồn
// tham số qua mọi tầng. Client gửi tên máy qua header x-device-name.
export const requestContext = new AsyncLocalStorage();

export function requestContextMiddleware(req, _res, next) {
  requestContext.run({
    // Người đăng nhập chưa biết ở thời điểm này (attachUser chạy sau) — để trống
    // rồi attachUser điền vào qua setRequestUser(). Nhờ vậy tầng service sâu bên
    // trong biết "ai đang thao tác" mà không phải luồn req qua từng hàm.
    user: null,
    deviceName: String(req.headers?.['x-device-name'] || '').slice(0, 120),
    deviceId: String(req.headers?.['x-device-id'] || '').slice(0, 120),
    appVersion: String(req.headers?.['x-app-version'] || '').slice(0, 40),
    buildNumber: String(req.headers?.['x-build-number'] || '').slice(0, 20),
    platform: String(req.headers?.['x-platform'] || '').slice(0, 30),
    osVersion: String(req.headers?.['x-os-version'] || '').slice(0, 120),
    correlationId: String(req.headers?.['x-correlation-id'] || '').slice(0, 80),
  }, next);
}

/** attachUser gọi sau khi giải mã token. Store là object nên gán trực tiếp được. */
export function setRequestUser(user) {
  const ctx = requestContext.getStore();
  if (ctx) ctx.user = user || null;
}

/** Người đang thao tác trong request hiện tại, hoặc null (tác vụ nền/cron). */
export function currentRequestUser() {
  return requestContext.getStore()?.user || null;
}

export function currentRequestMetadata() {
  const ctx = requestContext.getStore() || {};
  return {
    device_id: ctx.deviceId || '',
    device_name: ctx.deviceName || '',
    app_version: ctx.appVersion || '',
    build_number: ctx.buildNumber || '',
    platform: ctx.platform || '',
    os_version: ctx.osVersion || '',
    correlation_id: ctx.correlationId || '',
  };
}
