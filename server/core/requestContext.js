import { AsyncLocalStorage } from 'node:async_hooks';

// Ngữ cảnh theo TỪNG request (thiết bị, correlation) — cho phép audit()/log ở
// sâu trong service biết "thao tác này đến từ máy nào" mà không phải luồn
// tham số qua mọi tầng. Client gửi tên máy qua header x-device-name.
export const requestContext = new AsyncLocalStorage();

export function requestContextMiddleware(req, _res, next) {
  requestContext.run({
    deviceName: String(req.headers?.['x-device-name'] || '').slice(0, 120),
    correlationId: String(req.headers?.['x-correlation-id'] || '').slice(0, 80),
  }, next);
}

export function currentDevice() {
  return requestContext.getStore()?.deviceName || '';
}
