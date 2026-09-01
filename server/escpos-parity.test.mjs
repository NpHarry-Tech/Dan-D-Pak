// SERVER VÀ AGENT PHẢI GỬI CÙNG MỘT CHUỖI BYTE ESC/POS.
//
// Vì sao phải chốt bằng test: logic ESC/POS nằm TRÙNG LẶP ở hai nơi —
// server/services/printing.js (in trực tiếp, máy in LAN) và server/agent.cjs
// (in tại cửa hàng qua Hardware Agent). Không gộp được thành module dùng chung
// vì agent build bằng Node SEA (`--experimental-sea-config`), vốn đóng gói ĐÚNG
// MỘT file: `require('./escpos.cjs')` chạy được lúc dev rồi chết trong bản .exe.
//
// Hệ quả: mỗi lần sửa lệnh ESC/POS phải sửa CẢ HAI. Sự cố 2026-07-31 đúng kiểu
// này — thêm ESC_RESET để gỡ chữ bị phóng to; quên một bên là máy in ở cửa hàng
// và máy in LAN hành xử khác nhau, rất khó lần ra vì cả hai đều "có in".
//
// Test chỉ so DÃY BYTE của các hằng lệnh. Cố tình KHÔNG so mã nguồn của hàm:
// hai bên viết `̀-ͯ` và ký tự thật, `s ?? ''` và `s == null ? '' : s`
// — khác chữ nhưng cùng nghĩa, so chuỗi thô chỉ tạo báo động giả.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import test from 'node:test';

const here = dirname(fileURLToPath(import.meta.url));
const server = readFileSync(join(here, 'services', 'printing.js'), 'utf8');
const agent = readFileSync(join(here, 'agent.cjs'), 'utf8');
const setup = readFileSync(join(here, '..', 'flutter-apps', 'dandpak_desktop', 'setup.iss'), 'utf8');

/** Mọi `const TEN = Buffer.from([...])` trong file → { TEN: 'byte,byte,...' }. */
function hangLenh(src) {
  const out = {};
  const re = /const\s+(ESC_[A-Z0-9_]+)\s*=\s*Buffer\.from\(\[([^\]]*)\]/g;
  let m;
  while ((m = re.exec(src))) out[m[1]] = m[2].replace(/\s+/g, '');
  return out;
}

const cuaServer = hangLenh(server);
const cuaAgent = hangLenh(agent);

test('ca hai noi khai bao CUNG BO hang lenh ESC/POS', () => {
  const a = Object.keys(cuaServer).sort();
  const b = Object.keys(cuaAgent).sort();
  assert.ok(a.length >= 4, `server phai co it nhat 4 hang lenh, dang co ${a.length}`);
  assert.deepEqual(b, a,
    'mot ben co hang lenh ma ben kia khong co — hai duong in se lech nhau');
});

for (const name of ['ESC_INIT', 'ESC_RESET', 'ESC_CUT', 'ESC_DRAWER']) {
  test(`${name} giong het nhau o server va agent`, () => {
    assert.ok(cuaServer[name], `khong tim thay ${name} trong services/printing.js`);
    assert.ok(cuaAgent[name], `khong tim thay ${name} trong agent.cjs`);
    assert.equal(cuaAgent[name], cuaServer[name],
      `${name} da lech — may in tai cua hang se hanh xu khac may in LAN.\n` +
      `  printing.js: ${cuaServer[name]}\n  agent.cjs  : ${cuaAgent[name]}`);
  });
}

test('ESC_RESET thuc su chua lenh go phong to chu', () => {
  // Day la lenh sua su co "phieu ra mot cot hep giua to K80":
  //   ESC ! 0  (0x1b,0x21,0x00) chon font A, khong nhan doi cao/rong
  //   GS  ! 0  (0x1d,0x21,0x00) co ky tu 1x1  <- go phong to 2x/4x
  //   ESC a 0  (0x1b,0x61,0x00) canh trai
  // Ai do rut gon ESC_RESET ma bo mat GS ! 0 la loi cu quay lai ngay.
  const bytes = cuaServer.ESC_RESET;
  assert.ok(bytes, 'thieu ESC_RESET');
  assert.match(bytes, /0x1b,0x21,0x00/, 'thieu ESC ! 0 (font A, khong nhan doi)');
  assert.match(bytes, /0x1d,0x21,0x00/, 'thieu GS ! 0 — chu se lai bi phong to');
  assert.match(bytes, /0x1b,0x61,0x00/, 'thieu ESC a 0 (canh trai)');
});

test('moi phieu deu di qua ESC_INIT roi ESC_RESET, dung thu tu', () => {
  // ESC @ phai dung TRUOC: no khoi tao may in. Dat ESC_RESET truoc roi ESC @ sau
  // la ESC @ xoa sach phan reset vua gui.
  for (const [ten, src] of [['services/printing.js', server], ['agent.cjs', agent]]) {
    const m = src.match(/Buffer\.concat\(\[\s*ESC_INIT,\s*ESC_RESET,/);
    assert.ok(m, `${ten}: escposBuffer phai bat dau bang ESC_INIT roi ESC_RESET`);
  }
});

test('receipt raster has safe spooler driver, and setup replaces stale agents', () => {
  assert.match(agent, /WritePrinter/);
  assert.match(setup, /taskkill \/F \/IM dandpak-agent\.exe/i);
});

// ── BA DUONG IN PHAI RA CUNG MOT KIEU CHU ──────────────────────────────────
// server/services/printing.js  : may in LAN + may in Windows do chinh server in
// server/agent.cjs             : Hardware Agent tren may POS Windows
// local_print_agent.dart       : agent chay trong app (may POS cam tay Sunmi)
//
// Truoc day moi noi tu quyet: server/agent bo dau bang ascii(), con ban Dart
// gui thang UTF-8. Cung mot cua hang in ra cho co dau cho khong — dung trieu
// chung nguoi dung bao. Ba file phai dung CUNG bang ma va CUNG danh dau kieu chu.
const dart = readFileSync(join(here, '..', 'flutter-apps', 'dandpak_core', 'lib',
  'src', 'services', 'local_print_agent.dart'), 'utf8');

test('khong con noi nao tu y bo dau truoc khi gui ra may in', () => {
  // ascii() van duoc phep TON TAI (bang ma 'ascii' la lua chon cuoi cho may in
  // doi cu), nhung KHONG duoc goi vo dieu kien trong buoc dung byte.
  for (const [ten, src] of [['services/printing.js', server], ['agent.cjs', agent]]) {
    assert.doesNotMatch(src, /Buffer\.from\(ascii\(text\)\s*\+/,
      `${ten}: dang bo dau vo dieu kien khi dung byte ESC/POS`);
  }
  assert.doesNotMatch(dart, /utf8\.encode\('\$text/,
    'local_print_agent.dart: phai di qua _encodeMarked de ton trong bang ma');
});

test('bang ma CP1258 khai giong nhau o server va agent', () => {
  const lay = (src) => {
    const m = src.match(/CP1258_MAP[\s\S]*?\}\)\.map/);
    assert.ok(m, 'khong tim thay bang ma CP1258');
    return (m[0].match(/'0x[0-9a-f]{4}':\s*0x[0-9a-f]{2}/g) || []).join('|');
  };
  assert.equal(lay(agent), lay(server),
    'bang ma lech nhau — cung mot bill in ra hai kieu chu');
  assert.match(server, /CP1258_PAGE = 30/);
  assert.match(agent, /CP1258_PAGE = 30/);
});

test('danh dau kieu chu [[B]]/[[S]] duoc ca ba duong in hieu giong nhau', () => {
  for (const [ten, src] of [
    ['services/printing.js', server], ['agent.cjs', agent], ['local_print_agent.dart', dart],
  ]) {
    assert.match(src, /B\[01\]\|S\[0-3\]/, `${ten}: thieu bo bat danh dau kieu chu`);
    assert.match(src, /0x1b,\s*0x45,\s*0x01/, `${ten}: thieu lenh in dam ESC E 1`);
  }
  // Bang co chu phai giong het nhau: chi nhan BE CAO (0x01/0x02) o ba muc dau,
  // muc cuoi 0x11 moi nhan ca hai chieu. Lech bang nay la K80 tu nhien con 24 cot.
  const bang = (src, ten) => {
    const m = src.match(/(?:FONT_SCALE|_fontScale)\s*=\s*\{([\s\S]*?)\}/);
    assert.ok(m, `${ten}: khong tim thay bang co chu`);
    return (m[1].match(/\d\s*:\s*0x[0-9a-f]{2}/g) || [])
      .map(x => x.replace(/\s+/g, '')).join(',');
  };
  const chuan = '0:0x00,1:0x01,2:0x02,3:0x11';
  for (const [ten, src] of [
    ['services/printing.js', server], ['agent.cjs', agent], ['local_print_agent.dart', dart],
  ]) {
    assert.equal(bang(src, ten), chuan, `${ten}: bang co chu da lech`);
  }
});

test('do dam gui lenh chinh NHIET, khong chi in de them luot', () => {
  // ESC G / ESC E chi in de, khong lam giay nhiet den hon — do la ly do cua hang
  // de "rat dam" ma bill van mo. ESC 7 moi la lenh chinh nhiet dau in.
  for (const [ten, src] of [['services/printing.js', server], ['agent.cjs', agent]]) {
    assert.match(src, /0x1b,\s*0x37,/, `${ten}: thieu lenh ESC 7 chinh nhiet dau in`);
  }
  assert.match(dart, /0x1b, 0x37,/, 'local_print_agent.dart: thieu lenh ESC 7');
});
