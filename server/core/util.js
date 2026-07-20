// Helper dùng chung (ROOT) — gom các tiện ích trước đây bị lặp y hệt ở nhiều
// service (parseJson ×6, headerVal ×2, safeEqual ×2, clientIp ×2, cleanIp).
// MỘT nguồn duy nhất để tránh mỗi nơi một bản hơi khác nhau.
import crypto from 'node:crypto';

// Parse JSON an toàn: chuỗi rỗng/hỏng → trả fallback thay vì ném.
export function parseJson(raw, fallback) {
  try { return raw ? JSON.parse(raw) : fallback; } catch { return fallback; }
}

// Đọc header không phân biệt hoa/thường (Express hạ sẵn, nhưng webhook/test có thể gửi khác).
export function headerVal(headers = {}, name) {
  if (!headers) return '';
  const lower = String(name).toLowerCase();
  for (const k of Object.keys(headers)) if (k.toLowerCase() === lower) return String(headers[k] || '');
  return '';
}

// So sánh chuỗi chống timing-attack (dùng cho verify secret/HMAC webhook).
export function safeEqual(a = '', b = '') {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

// Số nguyên tiền tệ: làm tròn, giá trị rác → 0.
export function intval(v) {
  return Math.round(Number(v) || 0);
}

// Chuỗi người dùng nhập: ép về string, bỏ khoảng trắng thừa, cắt tối đa [max] ký tự
// (chặn payload phình to). Mặc định 200 — nơi cần dài hơn thì truyền max tường minh.
// Dùng `?? ''` (KHÔNG dùng `|| ''`) để số 0 / false giữ nguyên thành "0"/"false"
// thay vì bị nuốt thành chuỗi rỗng.
export function cleanText(value, max = 200) {
  return String(value ?? '').trim().slice(0, max);
}

// Chuẩn hoá IP: bỏ tiền tố IPv4-mapped-IPv6 và khoảng trắng.
export function normalizeIp(ip) {
  return String(ip || '').replace('::ffff:', '').trim();
}

// IP client thật của request: ưu tiên X-Forwarded-For (sau reverse proxy), rồi socket.
// CHỈ dùng cho audit/log/rate-limit — KHÔNG dùng cho quyết định phân quyền (có thể giả).
export function clientIp(req) {
  const xff = String(req?.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
  return normalizeIp(xff || req?.socket?.remoteAddress || '');
}
