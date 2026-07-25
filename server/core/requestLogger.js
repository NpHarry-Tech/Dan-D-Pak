import { logger } from './logger.js';
import { logSystem } from '../services/systemLogs.js';
import { currentRequestMetadata } from './requestContext.js';

// Request chậm hơn ngưỡng này (ms) → ghi cảnh báo slow_request vào system_logs.
// Export báo cáo/PDF vốn chậm bẩm sinh nên ngưỡng nới hơn.
const SLOW_MS = parseInt(process.env.SLOW_REQUEST_MS) || 1500;
const SLOW_MS_HEAVY = parseInt(process.env.SLOW_REQUEST_HEAVY_MS) || 8000;
const HEAVY_PATH = /\/reports\/export|\/config\/(import|export)|\/app\/download|\/documents\/.*\/download|image-upload|avatar-upload/;
// Đường ghi log không tự đo chính nó — tránh vòng lặp tự khuếch đại.
const SKIP_PATH = /\/system-logs|\/client-log/;

export function requestLogger(req, res, next) {
  const started = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - started;
    logger.info('http request', {
      method: req.method,
      url: req.originalUrl,
      status: res.statusCode,
      ms,
    });
    try {
      const url = req.originalUrl || req.url || '';
      if (SKIP_PATH.test(url)) return;
      const threshold = HEAVY_PATH.test(url) ? SLOW_MS_HEAVY : SLOW_MS;
      if (ms >= threshold) {
        // Thiết bị cụ thể nào chậm — thiếu field này thì "Endpoint chậm" chỉ
        // biết CÓ chuyện, không biết máy nào để đi kiểm tra (đúng lỗi đã báo:
        // mọi dòng đều hiện "localhost" vì Platform.localHostname trên
        // Android luôn trả "localhost", KHÔNG dùng được để phân biệt máy —
        // phải dựa vào x-device-id/platform/os/app-version thay vì tên máy).
        logSystem({
          level: 'warn',
          source: 'backend',
          eventType: 'slow_request',
          title: `Endpoint chậm: ${req.method} ${url.split('?')[0]} mất ${ms}ms`,
          message: `Ngưỡng ${threshold}ms · HTTP ${res.statusCode}`,
          endpoint: url,
          method: req.method,
          statusCode: res.statusCode,
          durationMs: ms,
          username: req.user?.username,
          branchId: req.headers?.['x-branch-id'],
          requestId: req.headers?.['x-request-id'],
          ...currentRequestMetadata(),
        });
      }
    } catch { /* đo lường không được phá request */ }
  });
  next();
}
