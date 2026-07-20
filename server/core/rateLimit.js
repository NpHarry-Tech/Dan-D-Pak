// Rate-limiter in-memory (sliding fixed-window) dùng chung cho các endpoint CÔNG KHAI
// nhạy cảm (không có token để khóa theo user): iPad unlock (dò PIN 4 số), self-order
// check-in (dò SĐT khách)... Khóa theo IP nguồn. Không thay thế cho lockout theo
// username ở đăng nhập — đây là lớp phòng thủ bổ sung chống brute-force/enumeration.
import { clientIp } from './util.js';

const buckets = new Map(); // `${key}:${ip}` -> { count, resetAt }

export function rateLimit({ windowMs = 60_000, max = 30, key = 'rl', message = 'Quá nhiều yêu cầu trong thời gian ngắn. Vui lòng thử lại sau.' } = {}) {
  return function rateLimitMiddleware(req, res, next) {
    const id = `${key}:${clientIp(req) || 'unknown'}`;
    const nowMs = Date.now();
    let e = buckets.get(id);
    if (!e || e.resetAt <= nowMs) { e = { count: 0, resetAt: nowMs + windowMs }; buckets.set(id, e); }
    e.count += 1;
    if (e.count > max) {
      res.setHeader('Retry-After', Math.max(1, Math.ceil((e.resetAt - nowMs) / 1000)));
      return res.status(429).json({ error: message });
    }
    next();
  };
}

// Dọn định kỳ các bucket đã hết hạn để không phình bộ nhớ (không block shutdown).
setInterval(() => {
  const t = Date.now();
  for (const [k, v] of buckets) if (v.resetAt <= t) buckets.delete(k);
}, 5 * 60_000).unref();
