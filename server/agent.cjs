// ─────────────────────────────────────────────────────────────────────────
// Dan D Pak — Hardware Agent (chạy TẠI CỬA HÀNG, do chính app Dan D Pak POS
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
const ESC_INIT = Buffer.from([0x1b, 0x40]);
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
]);

function ascii(s) {
  return String(s == null ? '' : s)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .replace(/[^\x09\x0a\x0d\x20-\x7e]/g, '');
}

function densityPrefix(density) {
  const on = (cmd) => Buffer.from([0x1b, cmd, 0x01]);
  switch (String(density || '').toLowerCase()) {
    case 'dark': return on(0x47);
    case 'max': return Buffer.concat([on(0x47), on(0x45)]);
    default: return Buffer.alloc(0);
  }
}

function escposBuffer(text, opts) {
  opts = opts || {};
  const cut = opts.cut !== false;
  const drawer = !!opts.drawer;
  const density = opts.density || '';
  return Buffer.concat([
    ESC_INIT,
    ESC_RESET,
    densityPrefix(density),
    Buffer.from(ascii(text) + '\n\n', 'utf8'),
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
  $di.pDocName = 'Dan D Pak'
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

async function writeSystemPrinter(name, text, opts) {
  opts = opts || {};
  const safeName = String(name || '').replace(/[^a-zA-Z0-9\s\-_\\]/g, '');

  if (opts.raw) {
    const buffer = escposBuffer(text, { drawer: opts.drawer, density: opts.density });
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

  const dir = mkdtempSync(join(tmpdir(), 'dandpak-agent-'));
  const file = join(dir, 'job.txt');
  writeFileSync(file, ascii(text) + '\n', 'utf8');
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
  if (j.connection === 'lan') {
    if (!j.ip) throw new Error('Máy in LAN thiếu IP');
    await writeLan(j.ip, j.port || 9100, escposBuffer(j.text, { drawer: drawer, density: j.density }));
  } else if (j.connection === 'system') {
    if (!j.systemName) throw new Error('Thiếu tên máy in hệ điều hành');
    // j.raw = máy in nhiệt → gửi nguyên byte ESC/POS qua spooler (datatype RAW),
    // nhờ vậy độ đậm, cắt giấy và xung mở két đều tới được máy in. Server bản cũ
    // không gửi cờ này thì rơi về đường driver như trước, không vỡ gì.
    await writeSystemPrinter(j.systemName, j.text, {
      raw: j.raw === true,
      drawer: drawer,
      density: j.density,
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
