// MISA meInvoice — TOKEN: cache, tự gia hạn, và CHỈ MỘT request đăng nhập tại
// một thời điểm.
//
// Vì sao cần: bản trước gọi authenticate() lại từ đầu ở MỖI thao tác — phát
// hành, tra trạng thái, hủy. Quán bán 10 hóa đơn liền tay là 10 lần đăng nhập
// vào MISA trong vài giây; MISA giới hạn tần suất thì bị chặn, và bill dồn lại
// không ra được. Giờ token dùng chung, hết hạn mới lấy lại, và nhiều job cùng
// lúc chỉ tạo ĐÚNG MỘT lượt đăng nhập (single-flight).

import { callJson, MisaError } from './client.js';
import { endpointUrl } from './config.js';

/// key -> { token, expiresAt (ms), inflight (Promise|null) }
const cache = new Map();

/// Token gắn với TÀI KHOẢN + MÔI TRƯỜNG cụ thể. Đổi mật khẩu hay đổi môi
/// trường là khóa khác → token cũ không bị dùng nhầm.
function cacheKey(cfg) {
  return [
    cfg.environment || 'sandbox',
    String(cfg.apiBase || '').trim(),
    cfg.taxCode || '',
    cfg.username || '',
    // Băm nhẹ mật khẩu để đổi mật khẩu là đổi khóa, mà không giữ mật khẩu
    // nguyên văn trong bộ nhớ khóa.
    String(cfg.password || '').length,
  ].join('|');
}

/// MISA trả hạn token theo nhiều kiểu tùy gói dịch vụ. Đọc được cái nào dùng
/// cái đó; không đọc được thì coi như 30 phút — ngắn hơn thực tế thì chỉ tốn
/// thêm một lần đăng nhập, còn dài hơn thực tế thì job hỏng giữa chừng.
function expiryFrom(body) {
  const giay = Number(
    body?.expires_in ?? body?.expiresIn ?? body?.ExpiresIn ?? body?.expire_in,
  );
  if (Number.isFinite(giay) && giay > 0) return Date.now() + giay * 1000;

  const moc = body?.expires_at ?? body?.expiresAt ?? body?.ExpiredDate;
  if (moc) {
    const t = new Date(moc).getTime();
    if (Number.isFinite(t) && t > Date.now()) return t;
  }
  return Date.now() + 30 * 60 * 1000;
}

function tokenFrom(body) {
  return body?.access_token
    || body?.accessToken
    || body?.token
    || body?.Token
    || body?.data?.access_token
    || body?.data?.accessToken
    || body?.data?.token
    || '';
}

async function login(cfg) {
  const url = endpointUrl(cfg, 'auth');
  const body = await callJson(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      appid: cfg.appId || '',
      taxcode: cfg.taxCode || '',
      username: cfg.username || '',
      password: cfg.password || '',
    }),
  }, 15000);

  const token = tokenFrom(body);
  if (!token) {
    // 200 mà không có token = sai tài khoản/mã số thuế hoặc hết hạn dịch vụ.
    // Đây là lỗi DỮ LIỆU, thử lại không giúp gì.
    throw new MisaError(
      'MISA không trả về token — kiểm tra mã số thuế, tài khoản, mật khẩu và tình trạng dịch vụ.',
      { retryable: false, code: 'NO_TOKEN' },
    );
  }
  return { token, expiresAt: expiryFrom(body) };
}

/// Lấy token dùng được. [force] = bỏ cache, đăng nhập lại (dùng khi MISA vừa
/// trả 401 giữa chừng).
export async function getToken(cfg, { force = false } = {}) {
  const key = cacheKey(cfg);
  const hien = cache.get(key);

  // Còn hạn (chừa 60 giây an toàn) thì dùng lại.
  if (!force && hien?.token && hien.expiresAt - 60_000 > Date.now()) {
    return hien.token;
  }
  // Đang có người đăng nhập rồi thì CHỜ CHUNG, không tự đăng nhập thêm.
  if (!force && hien?.inflight) return hien.inflight;

  const inflight = login(cfg)
    .then(({ token, expiresAt }) => {
      cache.set(key, { token, expiresAt, inflight: null });
      return token;
    })
    .catch((e) => {
      cache.delete(key);
      throw e;
    });

  cache.set(key, { ...(hien || {}), inflight });
  return inflight;
}

/// Xóa token đang giữ (dùng khi ngắt kết nối hoặc đổi mật khẩu).
export function clearToken(cfg) {
  if (!cfg) {
    cache.clear();
    return;
  }
  cache.delete(cacheKey(cfg));
}

/// Chạy một thao tác cần token; gặp 401/403 thì lấy token mới và thử lại ĐÚNG
/// MỘT lần. Không lặp vô hạn khi tài khoản thật sự sai.
export async function withToken(cfg, fn) {
  const token = await getToken(cfg);
  try {
    return await fn(token);
  } catch (e) {
    const hetHan = e instanceof MisaError && (e.httpStatus === 401 || e.httpStatus === 403);
    if (!hetHan) throw e;
    const moi = await getToken(cfg, { force: true });
    return fn(moi);
  }
}
