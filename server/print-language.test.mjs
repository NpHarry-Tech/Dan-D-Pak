// "Ngôn ngữ in trên giấy" (Settings > Bill & Labels, ngay sau "Mẫu hóa đơn
// chuẩn") — độc lập với ngôn ngữ giao diện app. Bao trùm: (1) print_config
// lưu/đọc đúng printLang, (2) đường Windows-driver (GDI, buildReceiptDoc) in
// đúng ngôn ngữ đã chọn, (3) đường ESC/POS (renderJobText → receiptVars)
// cũng dịch được và KHÔNG lệch cột khi nhãn là chữ Hán (CJK rộng gấp đôi).
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const temp = mkdtempSync(join(tmpdir(), 'ddp-printlang-'));
process.env.SQLITE_PATH = join(temp, 'store.db');
process.env.STORAGE_PATH = join(temp, 'storage');
process.env.DATA_ENCRYPTION_KEY = process.env.DATA_ENCRYPTION_KEY
  || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

const { migrate } = await import('./db.js');
const AppSettings = await import('./services/settings.js');
const Print = await import('./services/printing.js');
const { buildReceiptDoc } = await import('./services/receipt_doc.js');
migrate();

const BR = 'sala';

const payload = () => ({
  company: { name: 'DAN D PAK' },
  bill_no: 'Dan120926001', cashier: 'Huy', table_code: 'A01',
  items: [{ name: 'Cà phê sữa đá', qty: 2, unit_price: 25000, vat_rate: 8 }],
  total: 54000, vat_amount: 4000, goods_amount: 50000,
  lines: [{ method: 'cash', amount: 60000 }], paid: 60000, change: 6000,
  total_words: 'Năm mươi tư nghìn đồng',
});

test('print_config mặc định printLang là vi, và lưu/đọc lại đúng giá trị hợp lệ', () => {
  const before = AppSettings.getPrintConfig(BR);
  assert.equal(before.printLang, 'vi');

  const saved = AppSettings.autoSaveTemplate({ kind: 'bill', template: { kind: 'bill' }, printLang: 'zh' }, BR);
  assert.equal(saved.print_config.printLang, 'zh');
  assert.equal(AppSettings.getPrintConfig(BR).printLang, 'zh');

  // Giá trị rác bị từ chối, quay về mặc định 'vi' — không cho lưu bậy.
  const rejected = AppSettings.autoSaveTemplate({ kind: 'bill', template: { kind: 'bill' }, printLang: 'fr' }, BR);
  assert.equal(rejected.print_config.printLang, 'vi');
});

test('buildReceiptDoc (Windows driver/GDI): printLang=en dịch nhãn cố định, giữ nguyên dữ liệu thật', () => {
  const doc = buildReceiptDoc(payload(), { bill: {}, printLang: 'en' });
  const flat = JSON.stringify(doc.blocks);
  assert.match(flat, /PAYMENT RECEIPT/);
  assert.match(flat, /Subtotal/);
  assert.match(flat, /TOTAL/);
  assert.match(flat, /Cashier: /);
  assert.match(flat, /Cà phê sữa đá/, 'tên món KHÔNG được dịch/đổi');
});

test('buildReceiptDoc (Windows driver/GDI): printLang=zh dịch thuần sang tiếng Trung', () => {
  const doc = buildReceiptDoc(payload(), { bill: {}, printLang: 'zh' });
  const flat = JSON.stringify(doc.blocks);
  assert.match(flat, /结账单/);
  assert.match(flat, /商品总额/);
  assert.match(flat, /合计/);
  assert.match(flat, /收银员：/);
  assert.match(flat, /大写：/);
  assert.doesNotMatch(flat, /HÓA ĐƠN THANH TOÁN/, 'không được còn sót tiếng Việt ở nhãn cố định');
});

test('buildReceiptDoc: KHÔNG đặt printLang (mặc định vi) → giữ nguyên hành vi cũ', () => {
  const doc = buildReceiptDoc(payload(), { bill: {} });
  const flat = JSON.stringify(doc.blocks);
  assert.match(flat, /HÓA ĐƠN THANH TOÁN/);
  assert.match(flat, /Tổng tiền hàng/);
});

test('ESC/POS (renderJobText qua template mặc định): printLang=zh dịch đúng và CỘT TIỀN vẫn thẳng hàng', () => {
  AppSettings.updateSettings({ print_config: { printLang: 'zh', bill: {} } }, BR);
  const job = Print.createJob({
    printer: 'bill', type: 'receipt', title: 'Bill', payload: payload(), branch_id: BR,
  });
  const text = Print.renderJobText(job, BR);
  assert.match(text, /结账单/);
  assert.match(text, /商品总额/);
  assert.match(text, /应付总额/);
  // Cột tiền phải THẲNG HÀNG bên phải: mỗi dòng "nhãn ... số tiền" phải có độ
  // dài hiển thị bằng độ rộng giấy K80 mặc định (không bị lố/hụt vì đếm sai
  // bề rộng chữ Hán). Kiểm tra các dòng tổng có số tiền đều dài bằng nhau.
  const totalLines = text.split('\n').filter((l) => /商品总额|应付总额/.test(l));
  assert.ok(totalLines.length >= 2, 'phải có ít nhất 2 dòng tổng tiền để so sánh độ dài');
  const lens = new Set(totalLines.map((l) => l.length));
  assert.equal(lens.size, 1, `các dòng tổng phải cùng độ dài ký tự (cùng khổ giấy): ${[...lens]}`);
});

test('ESC/POS: printLang=vi (mặc định) vẫn giữ nguyên hành vi/độ rộng cột như trước', () => {
  AppSettings.updateSettings({ print_config: { printLang: 'vi', bill: {} } }, BR);
  const job = Print.createJob({
    printer: 'bill', type: 'receipt', title: 'Bill', payload: payload(), branch_id: BR,
  });
  const text = Print.renderJobText(job, BR);
  assert.match(text, /HÓA ĐƠN THANH TOÁN/);
  assert.match(text, /Tổng tiền hàng/);
});
