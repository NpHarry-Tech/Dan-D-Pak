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

/** Mọi `const TEN = Buffer.from([...])` trong file → { TEN: 'byte,byte,...' }. */
function hangLenh(src) {
  const out = {};
  const re = /const\s+(ESC_[A-Z_]+)\s*=\s*Buffer\.from\(\[([^\]]*)\]/g;
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
