// Auto-update: phát hành bản cài mới cho các thiết bị (desktop Windows / tablet
// Android) TỪ VPS. Máy client hỏi /api/app/version, so buildNumber, mới hơn thì
// tải /api/app/download/<platform> về tự cài. Publish bản mới: POST /api/app/publish.
import fs from 'node:fs';
import nodePath from 'node:path';
import { fileURLToPath } from 'node:url';
import { sendPushForNewAppVersion } from './push.js';

const __dirname = nodePath.dirname(fileURLToPath(import.meta.url));
const ROOT = nodePath.join(__dirname, '..');

// Thư mục chứa binary + manifest. Trên VPS nên mount volume bền cho thư mục này
// (đặt qua env RELEASES_DIR) để bản cài không mất khi rebuild container.
export const RELEASES_DIR = process.env.RELEASES_DIR
  ? nodePath.resolve(process.env.RELEASES_DIR)
  : nodePath.join(ROOT, 'releases');
const MANIFEST_PATH = nodePath.join(RELEASES_DIR, 'manifest.json');

// KHE PHÁT HÀNH. Điện thoại và tablet là HAI bản khác nhau nên phải có khe
// riêng: trước đây cả hai cùng báo 'android' nên publish bản này là đè bản kia,
// và tablet có thể tải nhầm APK điện thoại.
// 'android' GIỮ NGUYÊN nghĩa cũ = tablet — đổi đi thì mọi tablet đang chạy sẽ
// hỏi một khe chưa có gì và im lặng không thấy bản cập nhật nào nữa.
const PLATFORMS = new Set(['windows', 'android', 'android-phone']);

/** Khe này chạy trên Android? (quyết định đuôi file và việc đẩy thông báo FCM) */
function laAndroid(platform) {
  return platform === 'android' || platform === 'android-phone';
}
const EMPTY = { buildNumber: 0, version: '', file: '', notes: '', mandatory: false };

function ensureDir() {
  fs.mkdirSync(RELEASES_DIR, { recursive: true });
}

export function readManifest() {
  // Dựng theo PLATFORMS chứ KHÔNG liệt kê tay từng khe: bản cũ chép cứng
  // { windows, android } nên thêm khe mới ('android-phone') là nó bị vứt ngay ở
  // bước đọc — publish báo thành công mà máy không bao giờ thấy bản cập nhật.
  const rong = () => Object.fromEntries([...PLATFORMS].map(p => [p, { ...EMPTY }]));
  try {
    const m = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
    const out = rong();
    for (const p of PLATFORMS) out[p] = { ...EMPTY, ...(m[p] || {}) };
    return out;
  } catch {
    return rong();
  }
}

function writeManifest(m) {
  ensureDir();
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(m, null, 2), 'utf8');
}

// Client gọi để biết bản mới nhất cho nền tảng của nó.
export function latestFor(platform) {
  if (!PLATFORMS.has(platform)) throw badRequest('Nền tảng không hỗ trợ');
  const entry = readManifest()[platform];
  return {
    platform,
    buildNumber: Number(entry.buildNumber) || 0,
    version: String(entry.version || ''),
    notes: String(entry.notes || ''),
    mandatory: entry.mandatory === true,
    // Đường dẫn tương đối — client tự ghép với địa chỉ server của nó.
    url: entry.file ? `/api/app/download/${platform}` : '',
    available: !!entry.file,
  };
}

// Trả đường dẫn file binary để stream tải về (đã chống path traversal).
export function releaseFilePath(platform) {
  if (!PLATFORMS.has(platform)) throw badRequest('Nền tảng không hỗ trợ');
  const entry = readManifest()[platform];
  if (!entry.file) throw notFound('Chưa có bản phát hành cho nền tảng này');
  const safe = nodePath.basename(entry.file); // chỉ lấy tên file, chặn ../
  const full = nodePath.join(RELEASES_DIR, safe);
  if (!fs.existsSync(full)) throw notFound('File cài đặt không còn trên máy chủ');
  return { path: full, name: safe };
}

// Lưu binary vừa upload + cập nhật manifest. Dùng bởi POST /api/app/publish.
export function publishRelease(platform, buffer, { version, buildNumber, notes, mandatory, fileName } = {}) {
  if (!PLATFORMS.has(platform)) throw badRequest('Nền tảng không hỗ trợ');
  if (!buffer || !buffer.length) throw badRequest('Thiếu nội dung file cài đặt');
  const bn = Number(buildNumber);
  if (!Number.isFinite(bn) || bn <= 0) throw badRequest('buildNumber phải là số nguyên dương');
  ensureDir();

  const ext = laAndroid(platform) ? '.apk' : '.exe';
  const rawName = nodePath.basename(String(fileName || `dan-d-pak-${platform}-${version || bn}${ext}`))
    .replace(/[^a-zA-Z0-9._-]/g, '_');
  // NAMESPACE THEO PLATFORM. APK tablet và phone `flutter build` ra ĐỀU tên
  // 'app-release.apk'; lưu chung tên là đè lên nhau → cả hai khe (android,
  // android-phone) trỏ CÙNG một file, ai publish sau thắng cả hai. (Desktop tên
  // file riêng nên chưa bao giờ dính — đúng vì sao chỉ 2 APK bị lộn 05/08/2026.)
  const safeName = `${platform}__${rawName}`;
  fs.writeFileSync(nodePath.join(RELEASES_DIR, safeName), buffer);

  const m = readManifest();
  m[platform] = {
    buildNumber: bn,
    version: String(version || String(bn)),
    file: safeName,
    notes: String(notes || ''),
    mandatory: mandatory === true || mandatory === 'true',
  };
  writeManifest(m);

  // Đẩy thông báo tới thiết bị NGAY CẢ KHI ĐANG TẮT — trước đây chỉ báo khi
  // mở app lên (thụ động, đúng vấn đề đã báo). Chỉ Android có FCM; không chờ
  // gửi xong mới trả response (publish không được chậm vì việc này).
  // Thông báo đẩy bám theo HỆ ĐIỀU HÀNH, không theo khe phát hành: bảng
  // device_tokens lưu mọi máy Android là 'android' (xem push_notifications.dart),
  // gửi theo 'android-phone' sẽ không tới máy nào cả.
  // Đổi lại, publish bản điện thoại cũng đánh thức tablet — vô hại: tablet mở app
  // lên, hỏi khe của chính nó, không thấy bản mới thì không hiện gì.
  if (laAndroid(platform)) {
    sendPushForNewAppVersion('android', {
      title: 'Dan-D Pak POS — Bản cập nhật mới',
      body: `Phiên bản ${m[platform].version} đã sẵn sàng. Mở app để cập nhật ngay.`,
      data: { type: 'app_update', buildNumber: String(bn), version: m[platform].version },
    }).catch(() => {});
  }

  return { ok: true, platform, ...m[platform], bytes: buffer.length };
}

function badRequest(msg) { const e = new Error(msg); e.status = 400; return e; }
function notFound(msg) { const e = new Error(msg); e.status = 404; return e; }
