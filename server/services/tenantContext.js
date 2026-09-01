// ─────────────────────────────────────────────────────────────────────────
// TENANT CONTEXT (§8/§38).
//
// Kiến trúc thương mại: MỖI HOSTNAME/BASE URL = MỘT TENANT/CHUỖI tách hoàn toàn.
// Hiện tại isolation là PHYSICAL: mỗi tenant = một app instance + DB + storage +
// backup riêng (production `store.db`, review `review.db`). Vì vậy tenant ở đây là
// IMPLICIT theo instance — nhưng code/API KHÔNG được giả định "chỉ có một tenant/
// một branch sala". Module này cung cấp TenantContext tường minh để:
//   1. gắn tenant id vào log/audit/correlation (không rò giữa tenant),
//   2. chặn Host header giả mạo (không tin X-Forwarded-Host vô điều kiện),
//   3. là điểm mở rộng khi sau này scale nhiều tenant/DB.
import { env } from '../config/env.js';

// Id tenant LOGIC (ổn định) cho instance hiện tại. Ưu tiên TENANT_ID tường minh;
// nếu không có, suy ra từ APP_ENV (review) hoặc mặc định 'production'. KHÔNG dùng
// để chọn DB (DB do SQLITE_PATH/instance quyết định) — chỉ để gắn ngữ cảnh.
export function tenantId() {
  const explicit = String(process.env.TENANT_ID || '').trim();
  if (explicit) return explicit;
  return env.isReview ? 'review' : 'production';
}

function hostnameOf(url) {
  try { return new URL(String(url)).hostname.toLowerCase(); } catch { return ''; }
}

// Tập hostname hợp lệ cho tenant này. Suy từ API_BASE_URL/APP_URL/CORS_ORIGIN đã
// cấu hình + localhost (healthcheck/LAN). Trả về Set RỖNG ⇒ "không cấu hình" ⇒
// KHÔNG enforce (môi trường dev/LAN nhập IP trần). Chỉ enforce khi đã khai host.
export function allowedHosts() {
  const hosts = new Set();
  for (const u of [env.API_BASE_URL, env.APP_URL, ...(env.CORS_ORIGINS || [])]) {
    const h = hostnameOf(u);
    if (h) hosts.add(h);
  }
  // Custom hosts tường minh (nhiều domain/tenant alias) qua ENV, phân tách bằng dấu phẩy.
  for (const h of String(process.env.TENANT_ALLOWED_HOSTS || '').split(',')) {
    const clean = h.trim().toLowerCase();
    if (clean) hosts.add(clean);
  }
  if (hosts.size) {
    // Healthcheck nội bộ + LAN luôn được phép khi đã có allowlist.
    hosts.add('localhost');
    hosts.add('127.0.0.1');
  }
  return hosts;
}

function requestHost(req) {
  // KHÔNG tin X-Forwarded-Host mù quáng. Reverse proxy tin cậy (Caddy) đặt Host
  // đúng; chỉ đọc Host chuẩn. Cắt cổng.
  const raw = String(req?.headers?.host || '').toLowerCase();
  return raw.split(':')[0].trim();
}

// Chặn Host giả mạo: nếu tenant đã khai host mà request tới bằng host lạ → từ chối
// (không phục vụ dữ liệu tenant này cho một hostname không thuộc tenant).
export function assertHostAllowed(req) {
  const allow = allowedHosts();
  if (!allow.size) return; // chưa cấu hình host ⇒ dev/LAN ⇒ bỏ qua
  const host = requestHost(req);
  if (!host || !allow.has(host)) {
    const e = new Error('Host không thuộc tenant này.');
    e.status = 421; // Misdirected Request
    throw e;
  }
}

// Middleware Express: gắn req.tenant + validate host. Đặt SỚM trong pipeline.
export function tenantMiddleware() {
  return (req, res, next) => {
    try {
      assertHostAllowed(req);
    } catch (e) {
      return res.status(e.status || 421).json({ error: e.message });
    }
    req.tenant = tenantId();
    next();
  };
}

// Ngữ cảnh tenant hiện tại (dùng cho log/audit/snapshot).
export function tenantContext() {
  return { tenant: tenantId(), env: env.isReview ? 'review' : env.NODE_ENV, allowedHosts: [...allowedHosts()] };
}
