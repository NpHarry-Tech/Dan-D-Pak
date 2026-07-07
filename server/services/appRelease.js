// Auto-update: phát hành bản cài mới cho các thiết bị (desktop Windows / tablet
// Android) TỪ VPS. Máy client hỏi /api/app/version, so buildNumber, mới hơn thì
// tải /api/app/download/<platform> về tự cài. Publish bản mới: POST /api/app/publish.
import fs from 'node:fs';
import nodePath from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = nodePath.dirname(fileURLToPath(import.meta.url));
const ROOT = nodePath.join(__dirname, '..');

// Thư mục chứa binary + manifest. Trên VPS nên mount volume bền cho thư mục này
// (đặt qua env RELEASES_DIR) để bản cài không mất khi rebuild container.
export const RELEASES_DIR = process.env.RELEASES_DIR
  ? nodePath.resolve(process.env.RELEASES_DIR)
  : nodePath.join(ROOT, 'releases');
const MANIFEST_PATH = nodePath.join(RELEASES_DIR, 'manifest.json');

const PLATFORMS = new Set(['windows', 'android']);
const EMPTY = { buildNumber: 0, version: '', file: '', notes: '', mandatory: false };

function ensureDir() {
  fs.mkdirSync(RELEASES_DIR, { recursive: true });
}

export function readManifest() {
  try {
    const raw = fs.readFileSync(MANIFEST_PATH, 'utf8');
    const m = JSON.parse(raw);
    return {
      windows: { ...EMPTY, ...(m.windows || {}) },
      android: { ...EMPTY, ...(m.android || {}) },
    };
  } catch {
    return { windows: { ...EMPTY }, android: { ...EMPTY } };
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

  const ext = platform === 'android' ? '.apk' : '.exe';
  const safeName = nodePath.basename(String(fileName || `dan-d-pak-${platform}-${version || bn}${ext}`))
    .replace(/[^a-zA-Z0-9._-]/g, '_');
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
  return { ok: true, platform, ...m[platform], bytes: buffer.length };
}

function badRequest(msg) { const e = new Error(msg); e.status = 400; return e; }
function notFound(msg) { const e = new Error(msg); e.status = 404; return e; }
