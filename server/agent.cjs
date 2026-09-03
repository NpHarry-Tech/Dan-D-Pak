// ─────────────────────────────────────────────────────────────────────────
// Dan-D Pak — Hardware Agent (chạy TẠI CỬA HÀNG, do chính app Dan-D Pak POS
// tự khởi động ngầm — KHÔNG cần mở tay, KHÔNG hiện cửa sổ đen).
//
// Vì sao cần: khi database nằm trên VPS (datacenter), server KHÔNG thể với tới
// máy in USB/LAN, két tiền hay máy quẹt thẻ cắm trong cửa hàng. Agent này là
// "cánh tay nối dài" của server: chạy ngay trên máy POS, hỏi server xem có
// phiếu nào cần in không, rồi IN THẬT trên máy in/két tại chỗ và báo kết quả về.
//
// File này là CommonJS (.cjs) — để đóng gói được thành 1 file .exe độc lập
// bằng Node SEA (Single Executable Application), máy POS không cần cài Node.js
// riêng. App desktop (windows/runner) tự spawn file .exe này ẩn (không cửa sổ)
// ngay khi thu ngân đăng nhập, dùng LUÔN tài khoản/PIN vừa đăng nhập — không
// cần cấu hình file .env.agent riêng nữa.
//
// Chạy tay (khi cần gỡ lỗi): CENTRAL_URL=... AGENT_USERNAME=... AGENT_PIN=...
// BRANCH_ID=... node server/agent.cjs
//
// Zero dependency: chỉ dùng fetch (Node 18+) + net + child_process có sẵn.
// ─────────────────────────────────────────────────────────────────────────
'use strict';
const net = require('node:net');
const { execFile } = require('node:child_process');
const { mkdtempSync, writeFileSync, rmSync, existsSync, openSync, closeSync, readFileSync, unlinkSync } = require('node:fs');
const { tmpdir, platform, hostname } = require('node:os');
const { join, dirname } = require('node:path');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);

// Đóng gói SEA: process.execPath là chính file .exe này (không có "module file"
// thật trên đĩa để suy ra thư mục từ đường dẫn source như file .js thường).
const __basedir = dirname(process.execPath);

// ── Chỉ 1 tiến trình agent chạy tại 1 thời điểm ─────────────────────────────
// App desktop có thể spawn agent mỗi lần mở app/đăng nhập lại — nếu bản cũ vẫn
// còn sống (app tắt đột ngột, treo máy...), tự thoát ngay thay vì chạy chồng
// nhiều bản cùng lúc (vừa lãng phí vừa có thể tranh nhau in trùng 1 phiếu).
// Lock ghi kèm PID — nếu file lock còn sót lại nhưng tiến trình đó ĐÃ CHẾT
// (máy mất điện, agent bị kill cứng...), tự dọn lock cũ rồi giành lại, tránh
// bị khoá vĩnh viễn bởi 1 lock mồ côi.
const LOCK_PATH = join(tmpdir(), 'dandpak-agent.lock');
function pidAlive(pid) {
  try { process.kill(pid, 0); return true; }
  catch { return false; }
}
function acquireSingletonLock() {
  try {
    const existingPid = parseInt(readFileSync(LOCK_PATH, 'utf8').trim(), 10);
    if (existingPid && pidAlive(existingPid)) return false;
    try { unlinkSync(LOCK_PATH); } catch {} // lock mồ côi — dọn rồi giành lại bên dưới
  } catch {} // chưa có lock nào — bình thường
  try {
    const fd = openSync(LOCK_PATH, 'w');
    writeFileSync(fd, String(process.pid));
    closeSync(fd);
    return true;
  } catch {
    return false;
  }
}

// ── Nạp cấu hình: ưu tiên biến môi trường (app desktop truyền vào lúc spawn),
//    sau đó file .env.agent nằm cạnh .exe (chạy tay/gỡ lỗi) ─────────────────
function loadConfig() {
  const cfg = { ...loadEnvFile(join(__basedir, '.env.agent')), ...process.env };
  const c = {
    central: String(cfg.CENTRAL_URL || 'http://127.0.0.1:3000').replace(/\/+$/, ''),
    username: cfg.AGENT_USERNAME || '',
    pin: cfg.AGENT_PIN || '',
    branch: cfg.BRANCH_ID || 'sala',
    // Định danh MÁY đang chạy agent. App truyền DEVICE_ID xuống (cùng giá trị
    // với x-device-id của app) để server ghép "máy POS nào đang cắm máy in nào".
    // Không có thì lấy tên máy — vẫn phân biệt được các máy với nhau.
    deviceId: String(cfg.DEVICE_ID || '').trim() || `host_${hostname()}`,
    deviceName: String(cfg.DEVICE_NAME || '').trim() || hostname(),
    pollMs: Number(cfg.AGENT_POLL_MS) || 200,
    printersMs: Number(cfg.AGENT_PRINTERS_MS) || 20000,
    maxAttempts: Number(cfg.AGENT_MAX_ATTEMPTS) || 3,
    cooldownMs: Number(cfg.AGENT_COOLDOWN_MS) || 20000,
  };
  if (!c.username || !c.pin) {
    console.error('[agent] Thiếu AGENT_USERNAME / AGENT_PIN (truyền qua biến môi trường hoặc .env.agent).');
    process.exit(1);
  }
  return c;
}

function loadEnvFile(path) {
  const out = {};
  try {
    if (!existsSync(path)) return out;
    for (const line of require('node:fs').readFileSync(path, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch {}
  return out;
}

let CFG;
let token = '';

const log = (...a) => console.log(new Date().toISOString(), '[agent]', ...a);

// ── HTTP tới server trung tâm ────────────────────────────────────────────────
async function apiFetch(path, { method = 'GET', body, retryAuth = true } = {}) {
  const res = await fetch(`${CFG.central}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'x-auth-token': token, Authorization: `Bearer ${token}` } : {}),
      'x-branch-id': CFG.branch,
    },
    body: body == null ? undefined : JSON.stringify(body),
  });
  if (res.status === 401 && retryAuth) {
    await login();
    return apiFetch(path, { method, body, retryAuth: false });
  }
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) throw new Error((data && data.error) || `HTTP ${res.status}`);
  return data;
}

async function login() {
  const r = await fetch(`${CFG.central}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: CFG.username, pin: CFG.pin, branch_id: CFG.branch }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || !data.token) throw new Error(data.error || `Đăng nhập agent thất bại (HTTP ${r.status})`);
  token = data.token;
  log(`đăng nhập OK (user=${CFG.username}, branch=${CFG.branch})`);
}

// ── In vật lý (ESC/POS) — bản rút gọn khớp với server/services/printing.js ───
const ESC_INIT = Buffer.from([0x1b, 0x40, 0x1c, 0x2e]);
const ESC_CUT = Buffer.from([0x1d, 0x56, 0x42, 0x00]);
const ESC_DRAWER = Buffer.from([0x1b, 0x70, 0x00, 0x19, 0xfa]);

// EP MAY IN VE TRANG THAI CHUAN truoc moi phieu - xem chu thich day du o
// server/services/printing.js. Tom tat: `ESC @` khong reset co chu tren nhieu
// may in clone, nen phieu ra mot cot hep giua to K80 vi chu con ket o che do
// phong to. ESC ! 0 + GS ! 0 ep ve 1x1, ESC a 0 canh trai, ESC 2 gian dong.
const ESC_RESET = Buffer.from([
  0x1b, 0x21, 0x00,
  0x1d, 0x21, 0x00,
  0x1b, 0x61, 0x00,
  0x1b, 0x32,
  0x1b, 0x74, 0x00,
  0x1d, 0x4c, 0x00, 0x00,
  0x1d, 0x57, 0xff, 0xff,
]);

function ascii(s) {
  return String(s == null ? '' : s)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .replace(/[^\x09\x0a\x0d\x20-\x7e]/g, '');
}

// GIỮ ĐỒNG BỘ với server/services/printing.js — cùng bảng mã, cùng lệnh, cùng
// thứ tự. Lệch một chỗ là bill in từ máy Windows khác bill in từ máy cầm tay.
const CP1258_PAGE = 30;
const CP1258_MAP = new Map(Object.entries({
  '0x20ac': 0x80, '0x201a': 0x82, '0x0192': 0x83, '0x201e': 0x84, '0x2026': 0x85,
  '0x2020': 0x86, '0x2021': 0x87, '0x02c6': 0x88, '0x2030': 0x89, '0x2039': 0x8b,
  '0x0152': 0x8c, '0x2018': 0x91, '0x2019': 0x92, '0x201c': 0x93, '0x201d': 0x94,
  '0x2022': 0x95, '0x2013': 0x96, '0x2014': 0x97, '0x02dc': 0x98, '0x2122': 0x99,
  '0x203a': 0x9b, '0x0153': 0x9c, '0x0178': 0x9f,
  '0x00a0': 0xa0, '0x00a1': 0xa1, '0x00a2': 0xa2, '0x00a3': 0xa3, '0x00a4': 0xa4,
  '0x00a5': 0xa5, '0x00a6': 0xa6, '0x00a7': 0xa7, '0x00a8': 0xa8, '0x00a9': 0xa9,
  '0x00aa': 0xaa, '0x00ab': 0xab, '0x00ac': 0xac, '0x00ad': 0xad, '0x00ae': 0xae,
  '0x00af': 0xaf, '0x00b0': 0xb0, '0x00b1': 0xb1, '0x00b2': 0xb2, '0x00b3': 0xb3,
  '0x00b4': 0xb4, '0x00b5': 0xb5, '0x00b6': 0xb6, '0x00b7': 0xb7, '0x00b8': 0xb8,
  '0x00b9': 0xb9, '0x00ba': 0xba, '0x00bb': 0xbb, '0x00bc': 0xbc, '0x00bd': 0xbd,
  '0x00be': 0xbe, '0x00bf': 0xbf,
  '0x00c0': 0xc0, '0x00c1': 0xc1, '0x00c2': 0xc2, '0x0102': 0xc3, '0x00c4': 0xc4,
  '0x00c5': 0xc5, '0x00c6': 0xc6, '0x00c7': 0xc7, '0x00c8': 0xc8, '0x00c9': 0xc9,
  '0x00ca': 0xca, '0x00cb': 0xcb, '0x0300': 0xcc, '0x00cd': 0xcd, '0x00ce': 0xce,
  '0x00cf': 0xcf,
  '0x0110': 0xd0, '0x00d1': 0xd1, '0x0309': 0xd2, '0x00d3': 0xd3, '0x00d4': 0xd4,
  '0x01a0': 0xd5, '0x00d6': 0xd6, '0x00d7': 0xd7, '0x00d8': 0xd8, '0x00d9': 0xd9,
  '0x00da': 0xda, '0x00db': 0xdb, '0x00dc': 0xdc, '0x01af': 0xdd, '0x0303': 0xde,
  '0x00df': 0xdf,
  '0x00e0': 0xe0, '0x00e1': 0xe1, '0x00e2': 0xe2, '0x0103': 0xe3, '0x00e4': 0xe4,
  '0x00e5': 0xe5, '0x00e6': 0xe6, '0x00e7': 0xe7, '0x00e8': 0xe8, '0x00e9': 0xe9,
  '0x00ea': 0xea, '0x00eb': 0xeb, '0x0301': 0xec, '0x00ed': 0xed, '0x00ee': 0xee,
  '0x00ef': 0xef,
  '0x0111': 0xf0, '0x00f1': 0xf1, '0x0323': 0xf2, '0x00f3': 0xf3, '0x00f4': 0xf4,
  '0x01a1': 0xf5, '0x00f6': 0xf6, '0x00f7': 0xf7, '0x00f8': 0xf8, '0x00f9': 0xf9,
  '0x00fa': 0xfa, '0x00fb': 0xfb, '0x00fc': 0xfc, '0x01b0': 0xfd, '0x20ab': 0xfe,
  '0x00ff': 0xff,
}).map(([k, v]) => [parseInt(k, 16), v]));

const FONT_SCALE = { 0: 0x00, 1: 0x01, 2: 0x02, 3: 0x11 };
// [[BC:dữ liệu]] = mã vạch 1D Code128 thật, [[QR:dữ liệu]] = mã QR thật.
// GIỮ ĐỒNG BỘ với server/services/printing.js (xem escpos-parity.test.mjs).
const MARK_RE = /\[\[(B[01]|S[0-3]|BC:[^\]]*|QR:[^\]]*)\]\]/g;

function code128Bytes(data) {
  const d = String(data).slice(0, 40);
  const chars = [...d].map(c => c.charCodeAt(0) & 0x7f);
  return [
    0x1b, 0x61, 0x01, 0x1d, 0x48, 0x02, 0x1d, 0x66, 0x00,
    0x1d, 0x68, 80, 0x1d, 0x77, 0x02,
    0x1d, 0x6b, 0x49, chars.length + 2, 0x7b, 0x42, ...chars,
    0x0a, 0x1b, 0x61, 0x00,
  ];
}
function qrBytes(data) {
  const bytes = [...String(data).slice(0, 512)].map(c => c.charCodeAt(0) & 0xff);
  const store = 3 + bytes.length;
  return [
    0x1b, 0x61, 0x01,
    0x1d, 0x28, 0x6b, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00,
    0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x43, 0x06,
    0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x45, 0x31,
    0x1d, 0x28, 0x6b, store & 0xff, (store >> 8) & 0xff, 0x31, 0x50, 0x30, ...bytes,
    0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30,
    0x0a, 0x1b, 0x61, 0x00,
  ];
}

function markToBytes(tag) {
  // In dam = ESC E (emphasized) KEM ESC G (double-strike) — xem chu thich o
  // printing.js. GIU DONG BO 3 builder (escpos-parity.test.mjs).
  if (tag === 'B1') return [0x1b, 0x45, 0x01, 0x1b, 0x47, 0x01];
  if (tag === 'B0') return [0x1b, 0x45, 0x00, 0x1b, 0x47, 0x00];
  if (tag.startsWith('BC:')) return code128Bytes(tag.slice(3));
  if (tag.startsWith('QR:')) return qrBytes(tag.slice(3));
  const n = FONT_SCALE[Number(tag[1]) || 0];
  return [0x1d, 0x21, n == null ? 0x00 : n];
}

function encodeCp1258(text) {
  const giuNguyen = /[ĐđƠơƯư]/;
  const out = [];
  for (const ch of String(text == null ? '' : text)) {
    if (giuNguyen.test(ch)) { out.push(CP1258_MAP.get(ch.codePointAt(0))); continue; }
    for (const part of ch.normalize('NFD')) {
      const cp = part.codePointAt(0);
      if (cp < 0x80) { out.push(cp); continue; }
      const b = CP1258_MAP.get(cp);
      if (b != null) out.push(b);
      else for (const c of ascii(part)) out.push(c.charCodeAt(0));
    }
  }
  return Buffer.from(out);
}

function encodeForPrinter(text, charset) {
  if (charset === 'ascii') return Buffer.from(ascii(text), 'latin1');
  if (charset === 'cp1258') return encodeCp1258(text);
  return Buffer.from(String(text == null ? '' : text), 'utf8');
}

function encodeMarked(text, charset) {
  const parts = [];
  const src = String(text == null ? '' : text);
  let last = 0;
  for (const m of src.matchAll(MARK_RE)) {
    if (m.index > last) parts.push(encodeForPrinter(src.slice(last, m.index), charset));
    parts.push(Buffer.from(markToBytes(m[1])));
    last = m.index + m[0].length;
  }
  if (last < src.length) parts.push(encodeForPrinter(src.slice(last), charset));
  return Buffer.concat(parts);
}

function stripMarks(text) {
  return String(text == null ? '' : text).replace(MARK_RE, '');
}

function densityPrefix(density) {
  const on = (cmd) => Buffer.from([0x1b, cmd, 0x01]);
  const s = String(density || '').toLowerCase().trim();
  const rat = s === 'max' || s.includes('rat') || s.includes('very') || s.includes('max');
  const dam = rat || s === 'dark' || s.includes('dam') || s.includes('bold');
  if (!dam) return Buffer.alloc(0);
  // ESC 7 = chỉnh NHIỆT đầu in (xem chú thích đầy đủ ở services/printing.js).
  // ESC G / ESC E chỉ in đè thêm lượt, không làm giấy nhiệt đen hơn.
  const nhiet = rat
    ? Buffer.from([0x1b, 0x37, 15, 220, 2])
    : Buffer.from([0x1b, 0x37, 11, 160, 2]);
  return rat
    ? Buffer.concat([nhiet, on(0x47), on(0x45)])
    : Buffer.concat([nhiet, on(0x47)]);
}

// Buzzer: ESC B 3 tieng — GIU DONG BO voi printing.js. May khong co loa thi bo qua.
const ESC_BUZZER = Buffer.from([0x1b, 0x42, 0x03, 0x02]);

function escposBuffer(text, opts) {
  opts = opts || {};
  const cut = opts.cut !== false;
  const drawer = !!opts.drawer;
  const density = opts.density || '';
  const charset = opts.charset || 'utf8';
  const scale = FONT_SCALE[Math.max(0, Math.min(3, parseInt(opts.fontScale) || 0))];
  return Buffer.concat([
    ESC_INIT,
    ESC_RESET,
    charset === 'cp1258' ? Buffer.from([0x1b, 0x74, CP1258_PAGE]) : Buffer.alloc(0),
    scale ? Buffer.from([0x1d, 0x21, scale]) : Buffer.alloc(0),
    densityPrefix(density),
    encodeMarked(text, charset),
    Buffer.from('\n\n', 'latin1'),
    opts.buzzer ? ESC_BUZZER : Buffer.alloc(0),
    drawer ? ESC_DRAWER : Buffer.alloc(0),
    cut ? ESC_CUT : Buffer.alloc(0),
  ]);
}

function writeLan(host, port, buffer, timeoutMs) {
  timeoutMs = timeoutMs || 4500;
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port: Number(port) || 9100 });
    let done = false;
    const finish = (err) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      socket.destroy();
      err ? reject(err) : resolve();
    };
    const timer = setTimeout(
      () => finish(new Error(`Không kết nối được máy in LAN ${host}:${port}`)), timeoutMs);
    socket.on('connect', () => socket.write(buffer, (err) => err ? finish(err) : socket.end()));
    socket.on('close', () => finish());
    socket.on('error', finish);
  });
}

// Gửi NGUYÊN BYTE (datatype RAW) xuống spooler Windows — xem chú thích dài ở
// server/services/printing.js. Tóm tắt: Out-Printer để DRIVER Windows vẽ chữ
// thành ảnh xám khử răng cưa, máy in nhiệt rải hạt ảnh đó ra nên chữ RẤT MỜ và
// mọi lệnh ESC/POS (đậm, cắt giấy, mở két) bị nuốt. RAW đi thẳng vào firmware.
const RAW_PRINT_PS = `
$ErrorActionPreference='Stop'
Add-Type -Namespace DanDPak -Name Spool -MemberDefinition @'
[DllImport("winspool.drv", CharSet=CharSet.Unicode, SetLastError=true)]
public static extern bool OpenPrinter(string src, out IntPtr hPrinter, IntPtr pd);
[DllImport("winspool.drv", SetLastError=true)]
public static extern bool ClosePrinter(IntPtr hPrinter);
[DllImport("winspool.drv", CharSet=CharSet.Unicode, SetLastError=true)]
public static extern bool StartDocPrinter(IntPtr hPrinter, int level, [In] ref DOCINFO di);
[DllImport("winspool.drv", SetLastError=true)]
public static extern bool EndDocPrinter(IntPtr hPrinter);
[DllImport("winspool.drv", SetLastError=true)]
public static extern bool StartPagePrinter(IntPtr hPrinter);
[DllImport("winspool.drv", SetLastError=true)]
public static extern bool EndPagePrinter(IntPtr hPrinter);
[DllImport("winspool.drv", SetLastError=true)]
public static extern bool WritePrinter(IntPtr hPrinter, byte[] buf, int count, out int written);
[StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
public struct DOCINFO { [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
  [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
  [MarshalAs(UnmanagedType.LPWStr)] public string pDataType; }
'@
$bytes = [System.IO.File]::ReadAllBytes($env:DDP_JOB_FILE)
$h = [IntPtr]::Zero
if (-not [DanDPak.Spool]::OpenPrinter($env:DDP_PRINTER, [ref]$h, [IntPtr]::Zero)) {
  throw "Khong mo duoc may in: $env:DDP_PRINTER" }
try {
  $di = New-Object DanDPak.Spool+DOCINFO
  $di.pDocName = 'Dan-D Pak'
  $di.pDataType = 'RAW'
  if (-not [DanDPak.Spool]::StartDocPrinter($h, 1, [ref]$di)) { throw 'StartDocPrinter that bai' }
  try {
    [void][DanDPak.Spool]::StartPagePrinter($h)
    $written = 0
    if (-not [DanDPak.Spool]::WritePrinter($h, $bytes, $bytes.Length, [ref]$written)) {
      throw 'WritePrinter that bai' }
    if ($written -ne $bytes.Length) { throw "Chi gui duoc $written/$($bytes.Length) byte" }
    [void][DanDPak.Spool]::EndPagePrinter($h)
  } finally { [void][DanDPak.Spool]::EndDocPrinter($h) }
} finally { [void][DanDPak.Spool]::ClosePrinter($h) }
`;

async function writeSystemPrinterRaw(name, buffer) {
  const dir = mkdtempSync(join(tmpdir(), 'dandpak-agent-raw-'));
  const file = join(dir, 'job.bin');
  writeFileSync(file, buffer);
  try {
    await execFileAsync('powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', RAW_PRINT_PS],
      {
        timeout: 15000, windowsHide: true,
        env: Object.assign({}, process.env, {
          DDP_JOB_FILE: file, DDP_PRINTER: String(name || ''),
        }),
      });
  } finally {
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  }
}

// ── WindowsDriverBackend: in HOÁ ĐƠN bằng GDI + font TrueType ────────────────
// Nhận SEMANTIC DOC (json blocks) từ server, vẽ bằng System.Drawing.Printing +
// DrawString/MeasureString (đo cột thật, ten dai TU XUONG DONG), font TrueType
// cai san tren Windows → driver raster hoa o tang thiet bi. KHONG tao anh o tang
// app (khac han in-anh). Do chieu cao noi dung truoc de giay vua khit, khong phi
// giay roll. GIU DONG BO layout voi services/receipt_doc.js + gdi renderer server.
const GDI_RECEIPT_PS = `
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Drawing
$doc = [System.IO.File]::ReadAllText($env:DDP_DOC_FILE, [System.Text.Encoding]::UTF8) | ConvertFrom-Json
$fontName = [string]$doc.font
if (-not $fontName) { $fontName = 'Segoe UI' }
# K80 is 80 mm paper, but common 203-dpi heads only expose about 72 mm
# (576 dots) of printable width. Using nearly all 80 mm made right-aligned
# totals enter the printer dead zone, so e.g. 116.000d was printed as 116.
# Keep the custom paper at 80 mm and center the 72 mm document area first.
# The existing -2 mm calibration is then applied symmetrically from that
# centered origin (effective edges: about 2 mm left / 6 mm right), instead of
# placing the whole safety margin on the right and pulling the bill too far left.
$marginL = 16; $marginR = 16; $marginTop = 8; $marginBottom = 10; $paperW = 315
$printW = $paperW - $marginL - $marginR
$fontCache = @{}
function Get-Fnt($size, $bold, $italic, $strike=$false) {
  $key = "$size|$bold|$italic|$strike"
  if ($fontCache.ContainsKey($key)) { return $fontCache[$key] }
  $style = [System.Drawing.FontStyle]::Regular
  if ($bold) { $style = $style -bor [System.Drawing.FontStyle]::Bold }
  if ($italic) { $style = $style -bor [System.Drawing.FontStyle]::Italic }
  if ($strike) { $style = $style -bor [System.Drawing.FontStyle]::Strikeout }
  $f = New-Object System.Drawing.Font($fontName, [single]$size, $style)
  $fontCache[$key] = $f; return $f
}
function New-Sf($align) {
  $s = New-Object System.Drawing.StringFormat
  $s.Alignment = switch ($align) { 'center' { [System.Drawing.StringAlignment]::Center } 'right' { [System.Drawing.StringAlignment]::Far } default { [System.Drawing.StringAlignment]::Near } }
  return $s
}
$sfLeft = New-Sf 'left'; $sfCenter = New-Sf 'center'; $sfRight = New-Sf 'right'
function Get-Sf($align) { switch ($align) { 'center' { $sfCenter } 'right' { $sfRight } default { $sfLeft } } }
function Draw-StrikeLine($g, $txt, $f, $sf, [double]$x, [double]$y, [double]$w, [double]$h) {
  if (-not $txt) { return }
  $measured = [Math]::Min($w, [double]$g.MeasureString([string]$txt, $f, [int]$w, $sf).Width)
  $startX = switch ($sf.Alignment) {
    ([System.Drawing.StringAlignment]::Center) { $x + (($w - $measured) / 2) }
    ([System.Drawing.StringAlignment]::Far) { $x + $w - $measured }
    default { $x }
  }
  $pen = New-Object System.Drawing.Pen([System.Drawing.Color]::Black, [single]1.6)
  $g.DrawLine($pen, [single]$startX, [single]($y + ($h * 0.52)), [single]($startX + $measured), [single]($y + ($h * 0.52)))
  $pen.Dispose()
}
function Layout-Doc($g, [bool]$draw, [double]$x0, [double]$y0) {
  $y = [double]$y0; $black = [System.Drawing.Brushes]::Black
  foreach ($b in $doc.blocks) {
    switch ([string]$b.type) {
      'space' { $y += [double]($b.h); continue }
      'line' {
        $y += 2
        if ($draw) {
          $pen = New-Object System.Drawing.Pen([System.Drawing.Color]::Black, [single]0.8)
          if ([string]$b.style -eq 'dot') { $pen.DashStyle = [System.Drawing.Drawing2D.DashStyle]::Dot }
          $g.DrawLine($pen, [single]$x0, [single]$y, [single]($x0 + $printW), [single]$y); $pen.Dispose()
        }
        $y += 4; continue
      }
      'qr' {
        $f = Get-Fnt 8 $false $false; $t = "Tra cuu: " + [string]$b.data
        $h = $g.MeasureString($t, $f, [int]$printW, $sfCenter).Height
        if ($draw) { $g.DrawString($t, $f, $black, (New-Object System.Drawing.RectangleF([single]$x0,[single]$y,[single]$printW,[single]$h)), $sfCenter) }
        $y += $h; continue
      }
      'text' {
        $size = if ($b.size) { $b.size } else { 9 }
        $f = Get-Fnt $size ([bool]$b.bold) ([bool]$b.italic) ([bool]$b.strike); $txt = [string]$b.text; $sfa = Get-Sf ([string]$b.align)
        $h = if ($txt -ne '') { $g.MeasureString($txt, $f, [int]$printW, $sfa).Height } else { $f.GetHeight($g) }
        if ($draw -and $txt -ne '') {
          $g.DrawString($txt, $f, $black, (New-Object System.Drawing.RectangleF([single]$x0,[single]$y,[single]$printW,[single]($h+1))), $sfa)
          if ([bool]$b.strike) { Draw-StrikeLine $g $txt $f $sfa $x0 $y $printW $h }
        }
        $y += $h; continue
      }
      'row' {
        $totalFlex = 0.0; foreach ($c in $b.cols) { $totalFlex += [double]$c.flex }
        $rowH = 0.0
        foreach ($c in $b.cols) {
          $cw = $printW * ([double]$c.flex / $totalFlex)
          $size = if ($c.size) { $c.size } else { 9 }
          $f = Get-Fnt $size ([bool]$c.bold) ([bool]$c.italic) ([bool]$c.strike)
          $hh = if ([string]$c.text -ne '') { $g.MeasureString([string]$c.text, $f, [int]$cw, (Get-Sf ([string]$c.align))).Height } else { $f.GetHeight($g) }
          if ($hh -gt $rowH) { $rowH = $hh }
        }
        if ($draw) {
          $cx = [double]$x0
          foreach ($c in $b.cols) {
            $cw = $printW * ([double]$c.flex / $totalFlex)
            if ([string]$c.text -ne '') {
              $size = if ($c.size) { $c.size } else { 9 }
              $f = Get-Fnt $size ([bool]$c.bold) ([bool]$c.italic) ([bool]$c.strike)
              $cellSf = Get-Sf ([string]$c.align)
              $g.DrawString([string]$c.text, $f, $black, (New-Object System.Drawing.RectangleF([single]$cx,[single]$y,[single]$cw,[single]($rowH+1))), $cellSf)
              if ([bool]$c.strike) { Draw-StrikeLine $g ([string]$c.text) $f $cellSf $cx $y $cw $rowH }
            }
            $cx += $cw
          }
        }
        $y += $rowH; continue
      }
    }
  }
  return ($y - $y0)
}
$pd = New-Object System.Drawing.Printing.PrintDocument
$pd.PrinterSettings.PrinterName = $env:DDP_PRINTER
$mg = $pd.PrinterSettings.CreateMeasurementGraphics()
$contentH = Layout-Doc $mg $false 0 0
$mg.Dispose()
$paperH = [int][math]::Ceiling($contentH) + $marginTop + $marginBottom + 6
$pd.DefaultPageSettings.PaperSize = New-Object System.Drawing.Printing.PaperSize('Receipt', $paperW, $paperH)
$pd.DefaultPageSettings.Margins = New-Object System.Drawing.Printing.Margins($marginL, $marginR, $marginTop, $marginBottom)
$pd.add_PrintPage({
  param($sender, $e)
  $e.Graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
  # 1 mm = 3.937 hundredths of an inch. Mặc định -2 mm để bù đầu in thực tế lệch phải.
  $offsetMm = if ($null -ne $doc.offsetMm) { [double]$doc.offsetMm } else { -2.0 }
  # Calibration requested for the installed K80 head: move the complete
  # document another 2 mm from right to left without changing its width.
  $offsetMm -= 2.0
  $x = [double]$e.MarginBounds.Left + ($offsetMm * 3.937007874)
  [void](Layout-Doc $e.Graphics $true $x ([double]$e.MarginBounds.Top))
  $e.HasMorePages = $false
})
$pd.Print()
`;

async function writeSystemPrinterDriver(printerName, docJson) {
  const dir = mkdtempSync(join(tmpdir(), 'dandpak-agent-drv-'));
  const file = join(dir, 'doc.json');
  writeFileSync(file, docJson, 'utf8');
  try {
    await execFileAsync('powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', GDI_RECEIPT_PS],
      {
        timeout: 20000, windowsHide: true,
        env: Object.assign({}, process.env, {
          DDP_DOC_FILE: file, DDP_PRINTER: String(printerName || ''),
        }),
      });
  } finally {
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  }
}

async function writeSystemPrinter(name, text, opts) {
  opts = opts || {};
  const safeName = String(name || '').replace(/[^a-zA-Z0-9\s\-_\\]/g, '');

  if (opts.raw) {
    const buffer = escposBuffer(text, {
      drawer: opts.drawer, density: opts.density,
      charset: opts.charset, fontScale: opts.fontScale, buzzer: opts.buzzer,
    });
    if (platform() === 'win32') {
      // Tên máy in Windows có thể có dấu — RAW dùng tên GỐC, không lọc ký tự.
      await writeSystemPrinterRaw(name, buffer);
      return;
    }
    const rawDir = mkdtempSync(join(tmpdir(), 'dandpak-agent-raw-'));
    const rawFile = join(rawDir, 'job.bin');
    writeFileSync(rawFile, buffer);
    try {
      await execFileAsync('lp', ['-d', safeName, '-o', 'raw', rawFile], { timeout: 12000 });
    } finally {
      try { rmSync(rawDir, { recursive: true, force: true }); } catch {}
    }
    return;
  }

  // Driver Windows tự lo phông chữ → giữ NGUYÊN tiếng Việt, chỉ bóc đánh dấu
  // kiểu chữ ESC/POS ra (driver sẽ in "[[B1]]" thành chữ nếu để lại).
  const dir = mkdtempSync(join(tmpdir(), 'dandpak-agent-'));
  const file = join(dir, 'job.txt');
  writeFileSync(file, stripMarks(text) + '\n', 'utf8');
  try {
    if (platform() === 'win32') {
      await execFileAsync('powershell.exe', [
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command',
        `Get-Content -Raw -LiteralPath ${JSON.stringify(file)} | Out-Printer -Name ${JSON.stringify(safeName)}`,
      ], { timeout: 12000, windowsHide: true });
    } else {
      await execFileAsync('lp', ['-d', safeName, file], { timeout: 12000 });
    }
  } finally {
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  }
}

async function printJob(j) {
  const drawer = !!j.drawer;
  // WindowsDriverBackend: server gửi semantic doc (renderMode='driver') → in bill
  // bằng GDI + font TrueType qua driver Windows. Chỉ máy in 'system'. Server bản
  // cũ không gửi trường này thì rơi về ESC/POS như thường.
  if (j.renderMode === 'driver' && j.driverDoc && j.connection === 'system') {
    if (!j.systemName) throw new Error('Thiếu tên máy in hệ điều hành');
    await writeSystemPrinterDriver(j.systemName, j.driverDoc);
    return;
  }
  if (j.connection === 'lan') {
    if (!j.ip) throw new Error('Máy in LAN thiếu IP');
    await writeLan(j.ip, j.port || 9100, escposBuffer(j.text, {
      drawer: drawer, density: j.density,
      charset: j.charset, fontScale: j.fontScale, buzzer: j.buzzer,
    }));
  } else if (j.connection === 'system') {
    if (!j.systemName) throw new Error('Thiếu tên máy in hệ điều hành');
    // j.raw = máy in nhiệt → gửi nguyên byte ESC/POS qua spooler (datatype RAW),
    // nhờ vậy độ đậm, cắt giấy và xung mở két đều tới được máy in. Server bản cũ
    // không gửi cờ này thì rơi về đường driver như trước, không vỡ gì.
    await writeSystemPrinter(j.systemName, j.text, {
      raw: j.raw !== false,
      drawer: drawer,
      density: j.density,
      charset: j.charset,
      fontScale: j.fontScale,
      buzzer: j.buzzer,
    });
  } else {
    throw new Error(`Tuyến "${j.connection}" không thuộc phạm vi agent`);
  }
}

// ── Vòng lặp: nhận job → in → báo kết quả ───────────────────────────────────
const inFlight = new Set();
const attempts = new Map();
const cooldown = new Map();

async function pollJobs() {
  let res;
  try {
    res = await apiFetch(`/api/agent/print/pending?limit=40&device_id=${encodeURIComponent(CFG.deviceId)}`);
  } catch (e) {
    log('không lấy được hàng đợi in:', e.message);
    return;
  }
  const jobs = (res && res.jobs) || [];
  for (const j of jobs) {
    if (inFlight.has(j.id)) continue;
    const cd = cooldown.get(j.id) || 0;
    if (Date.now() < cd) continue;
    const tried = attempts.get(j.id) || 0;
    if (tried >= CFG.maxAttempts) continue;
    inFlight.add(j.id);
    handleJob(j, tried).finally(() => inFlight.delete(j.id));
  }
}

async function handleJob(j, tried) {
  try {
    await printJob(j);
    attempts.delete(j.id);
    cooldown.delete(j.id);
    await apiFetch(`/api/agent/print/jobs/${j.id}/result`, { method: 'POST', body: { ok: true } });
    log(`đã in ${j.type} (${j.connection}${j.ip ? ' ' + j.ip : ''})`);
  } catch (e) {
    attempts.set(j.id, tried + 1);
    cooldown.set(j.id, Date.now() + CFG.cooldownMs);
    try {
      await apiFetch(`/api/agent/print/jobs/${j.id}/result`,
        { method: 'POST', body: { ok: false, error: e.message } });
    } catch {}
    log(`in lỗi ${j.type} (lần ${tried + 1}/${CFG.maxAttempts}):`, e.message);
  }
}

// ── Đẩy danh sách máy in của máy này lên server (cho màn Cài đặt) ────────────
async function reportPrinters() {
  try {
    const list = await listLocalPrinters();
    await apiFetch(`/api/agent/printers/report`, {
      method: 'POST',
      body: { printers: list, device_id: CFG.deviceId, device_name: CFG.deviceName },
    });
  } catch (e) {
    log('không báo được danh sách máy in:', e.message);
  }
}

async function listLocalPrinters() {
  try {
    if (platform() === 'win32') {
      const { stdout } = await execFileAsync('powershell.exe', [
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command',
        '$p=Get-CimInstance Win32_Printer | Select-Object Name,Default,WorkOffline,PrinterStatus,PortName,DriverName,ShareName; $p | ConvertTo-Json -Compress -Depth 3',
      ], { timeout: 5000, windowsHide: true });
      const parsed = JSON.parse(String(stdout || '[]').trim() || '[]');
      return Array.isArray(parsed) ? parsed : [parsed];
    }
    const { stdout } = await execFileAsync('lpstat', ['-p', '-d'], { timeout: 3000 });
    return String(stdout).split(/\r?\n/)
      .map((l) => l.match(/^printer\s+(\S+)/i)).filter(Boolean)
      .map(([, name]) => ({ Name: name }));
  } catch {
    return [];
  }
}

// ── Khởi động ────────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  if (!acquireSingletonLock()) {
    log('đã có 1 bản agent khác đang chạy trên máy này — tự thoát.');
    process.exit(0);
  }
  CFG = loadConfig();
  log(`kết nối server trung tâm ${CFG.central} (branch=${CFG.branch})`);
  while (true) {
    try { await login(); break; }
    catch (e) { log('chờ server / sai tài khoản:', e.message); await sleep(4000); }
  }
  await reportPrinters();
  await pollJobs();
  setInterval(() => pollJobs().catch(() => {}), CFG.pollMs);
  setInterval(() => reportPrinters().catch(() => {}), CFG.printersMs);
  log('sẵn sàng — đang chờ phiếu in.');
}

main().catch((e) => { console.error('[agent] lỗi nghiêm trọng:', e); process.exit(1); });
