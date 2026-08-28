// ĐỔI KHỔ GIẤY VÀ KÍCH THƯỚC TEM PHẢI ĂN NGAY VÀO BẢN IN.
//
// Hai lỗi thật tìm ra ngày 2026-07-31 khi rà soát:
//
// 1) Bộ thiết kế mẫu ghi mã giấy 'K57' và widthMm = 57 (bề ngang TỜ GIẤY), còn
//    server so mã với 'K58' và so mm với ngưỡng 50. Kết quả: chọn K57 xong bill
//    VẪN dựng 48 ký tự rồi tràn ra ngoài giấy 57mm.
//
// 2) Tem chưa thiết kế mẫu thì render cắm cứng 40 ký tự, bỏ qua hoàn toàn kích
//    thước tem đã cài. Tem 35mm mà dựng 40 ký tự thì chữ tràn khỏi mép tem.
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const temp = mkdtempSync(join(tmpdir(), 'dandpak-paper-'));
process.env.SQLITE_PATH = join(temp, 'store.db');
process.env.STORAGE_PATH = join(temp, 'storage');
process.env.DATA_ENCRYPTION_KEY = process.env.DATA_ENCRYPTION_KEY
  || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.PRINT_DISPATCH = 'agent';

const { migrate } = await import('./db.js');
const Print = await import('./services/printing.js');
const System = await import('./services/system.js');
const AppSettings = await import('./services/settings.js');

migrate();

function dungChiNhanh(branch, bill = {}, labels = null) {
  AppSettings.updateSettings({
    print_config: {
      bill: { storeName: 'Dan D Pak', printDensity: 'dark', ...bill },
      ...(labels ? { labels } : {}),
      printers: [],
    },
  }, branch);
  System.setAgentPrinters(branch, [{ Name: 'POS-80C' }], {
    deviceId: `dev_${branch}`, deviceName: `POS-${branch}`,
  });
}

/** Bề ngang THẬT của phiếu = dòng dài nhất trong bản render. */
function beNgang(branch, deviceId) {
  const jobs = Print.pendingAgentJobs(branch, { limit: 5, deviceId });
  const j = jobs.find(x => x.type === 'test');
  assert.ok(j, 'phai co job in thu de do be ngang');
  return Math.max(...j.text.split('\n').map(l => l.length));
}

test('chon K57 thi bill dung 32 ky tu, KHONG tran giay', () => {
  // Bo thiet ke ghi ca hai: ma giay 'K57' va widthMm = 57 (be ngang to giay).
  dungChiNhanh('p57', { paper: 'K57', widthMm: 57 });
  Print.printReceipt({
    number: 'Dan3107270001', total: 50000, subtotal: 50000,
    items: [{ name: 'Hat dieu', qty: 1, unit_price: 50000 }],
    lines: [{ method: 'cash', amount: 50000 }],
  }, 'p57', { deviceId: 'dev_p57' });

  const w = beNgangReceipt('p57', 'dev_p57');
  assert.ok(w <= 32,
    `giay K57 chi in duoc 32 ky tu, dang dung ${w} — day la loi tran giay`);
});

test('K58 (ten cu) van hieu dung', () => {
  dungChiNhanh('p58', { paper: 'K58', widthMm: 48 });
  Print.printReceipt({
    number: 'Dan3107270002', total: 50000, subtotal: 50000,
    items: [{ name: 'Hat dieu', qty: 1, unit_price: 50000 }],
    lines: [{ method: 'cash', amount: 50000 }],
  }, 'p58', { deviceId: 'dev_p58' });
  assert.ok(beNgangReceipt('p58', 'dev_p58') <= 32);
});

test('khong khai gi thi mac dinh K80 = 48 ky tu', () => {
  dungChiNhanh('pdef', {});
  Print.printReceipt({
    number: 'Dan3107270003', total: 50000, subtotal: 50000,
    items: [{ name: 'Hat dieu rang muoi 500g', qty: 1, unit_price: 50000 }],
    lines: [{ method: 'cash', amount: 50000 }],
  }, 'pdef', { deviceId: 'dev_pdef' });
  const w = beNgangReceipt('pdef', 'dev_pdef');
  assert.ok(w > 32 && w <= 48, `mac dinh phai la kho K80, dang dung ${w}`);
});

test('bill K80 va K57 dung cung bo cuc 3 cot, tien la gia chua VAT', () => {
  const receipt = {
    number: 'Dan0108260099', subtotal: 200000, goods_amount: 175000,
    vat_amount: 15000, total: 190000,
    items: [
      { name: 'Item A', unit: 'cái', qty: 2, unit_price: 50000, vat_rate: 8 },
      { name: 'Item B', unit: 'cái', qty: 1, unit_price: 100000, vat_rate: 8,
        promo: { name: 'CTKM Item B', amount: 10000 } },
    ],
    lines: [{ method: 'cash', amount: 190000 }],
  };

  dungChiNhanh('layout80', { paper: 'K80', widthMm: 80 });
  Print.printReceipt(receipt, 'layout80', { deviceId: 'dev_layout80' });
  const k80 = receiptText('layout80', 'dev_layout80');
  const k80Plain = k80.replace(/\u0336/g, '');
  assert.match(k80, /Đơn giá\s+SL\s+T\.Tiền/);
  assert.match(k80, /Item A \(cái\)\n46,296\s+2\s+92,593/);
  assert.match(k80Plain, /Item B \(cái\)\nCTKM: CTKM Item B\n92,593\s+83,333\s+1\s+83,333/);
  assert.doesNotMatch(k80Plain, /Đơn giá (trước|sau) CTKM:/);
  assert.match(k80, /Tổng tiền hàng:\s+175,000/);
  assert.match(k80, /VAT \(8%\):\s+15,000/);
  assert.match(k80, /Tổng thanh toán:\s+190,000/);
  assert.match(k80, /Bằng chữ: Một trăm chín mươi nghìn đồng/);
  assert.match(k80, /Hình thức thanh toán:\s+Tiền mặt/);
  const k80Lines = k80.split('\n');
  const k80Item = k80Lines[k80Lines.indexOf('Item A (cái)') + 1];
  for (const value of [k80Item, ...k80Lines.filter(line => /^(Tổng tiền hàng:|VAT \(8%\):|Tổng thanh toán:)/.test(line))]) {
    assert.equal(value.length, 48, `K80 phai ket thuc cot tien tai ky tu 48: "${value}"`);
  }
  assert.ok(k80Item.endsWith('92,593'));

  dungChiNhanh('layout57', { paper: 'K57', widthMm: 57 });
  Print.printReceipt(receipt, 'layout57', { deviceId: 'dev_layout57' });
  const k57 = receiptText('layout57', 'dev_layout57');
  assert.match(k57, /Đơn giá\s+SL\s+T\.Tiền/);
  assert.match(k57, /Item A \(cái\)\n46,296\s+2\s+92,593/);
  assert.equal(
    k80.split('\n').filter(x => /^(SL|Item|CTKM:|\d)/.test(x)).map(x => x.trim().replace(/\s+/g, ' ')).join('\n'),
    k57.split('\n').filter(x => /^(SL|Item|CTKM:|\d)/.test(x)).map(x => x.trim().replace(/\s+/g, ' ')).join('\n'),
    'K80 va K57 phai cung thu tu/noi dung, chi khac khoang trang cot',
  );
  assert.ok(Math.max(...k57.split('\n').map(l => l.replace(/\u0336/g, '').length)) <= 32);
  const k57Lines = k57.split('\n');
  const k57Item = k57Lines[k57Lines.indexOf('Item A (cái)') + 1];
  for (const value of [k57Item, ...k57Lines.filter(line => /^(Tổng tiền hàng:|VAT \(8%\):|Tổng thanh toán:)/.test(line))]) {
    assert.equal(value.length, 32, `K57 phai ket thuc cot tien tai ky tu 32: "${value}"`);
  }
  assert.ok(k57Item.endsWith('92,593'));
});

test('bill tach mua X tang Y va dat CTKM toan bill duoi tung san pham', () => {
  const receipt = {
    number: 'Dan0208260001', subtotal: 320000, goods_amount: 280000,
    vat_amount: 0, discount: 40000, total: 280000,
    items: [
      { name: 'Item A', qty: 1, unit_price: 100000,
        promo: { name: 'Giam 10% don tren 200k', amount: 10000, type: 'order' } },
      { name: 'Item B', qty: 6, unit_price: 20000,
        promo: { name: 'Mua 5 tang 1', amount: 20000, type: 'buy_x_get_1', free_units: 1 } },
      { name: 'Item C', qty: 1, unit_price: 100000,
        promo: { name: 'Giam 10% don tren 200k', amount: 10000, type: 'order' } },
    ],
    lines: [{ method: 'cash', amount: 280000 }],
  };
  dungChiNhanh('promo_layout', { paper: 'K80', widthMm: 80 });
  Print.printReceipt(receipt, 'promo_layout', { deviceId: 'dev_promo_layout' });
  const bill = receiptText('promo_layout', 'dev_promo_layout');
  const plain = bill.replace(/\u0336/g, '');
  assert.match(plain, /Item A\nCTKM: Giam 10% don tren 200k\n100,000\s+90,000\s+1\s+90,000/);
  assert.doesNotMatch(plain, /Đơn giá (trước|sau) CTKM:/);
  assert.match(bill, /Item B \(01\)\nCTKM: Mua 5 tang 1\n20,000\s+5\s+100,000/);
  assert.match(bill, /Item B \(02\)\nCTKM: Sản phẩm được tặng\n0\s+1\s+0/);
  assert.doesNotMatch(bill, /TRUOC CTKM|SAU CTKM|KM TOAN BILL/);
});

test('job in that luon dung mau moi nhat trong Settings, khong dung payload cu', () => {
  dungChiNhanh('latest_template', { paper: 'K80', widthMm: 80 });
  Print.printReceipt({
    number: 'BILL-MOI', total: 10000, subtotal: 10000,
    items: [{ name: 'Item', qty: 1, unit_price: 10000 }],
  }, 'latest_template', { deviceId: 'dev_latest_template' });
  AppSettings.autoSaveTemplate({
    kind: 'bill',
    template: {
      kind: 'bill', version: 8, standard: 'dan_payment_receipt',
      rows: [{ id: 'new', type: 'text', text: 'MAU MOI {billNo}' }],
    },
  }, 'latest_template');

  const bill = receiptText('latest_template', 'dev_latest_template');
  assert.match(bill, /MAU MOI BILL-MOI/);
  assert.doesNotMatch(bill, /MAU CU/);
});

test('tam tinh dung tieu de rieng, bo trong so bill va hien gio Viet Nam', () => {
  dungChiNhanh('preview_title', { paper: 'K80', widthMm: 80 });
  Print.printReceipt({
    preview: true, number: 'KHONG-DUOC-IN', created_at: '2026-08-01T17:30:00.000Z',
    total: 10000, goods_amount: 10000,
    items: [{ name: 'Item', qty: 1, unit_price: 10000 }],
  }, 'preview_title', { deviceId: 'dev_preview_title' });
  const bill = receiptText('preview_title', 'dev_preview_title');
  assert.match(bill, /HÓA ĐƠN TẠM TÍNH/);
  assert.doesNotMatch(bill, /HÓA ĐƠN THANH TOÁN|KHONG-DUOC-IN|IN LẠI/);
  assert.match(bill, /02\.08\.2026 00\.30|02\/08\/2026 00:30/);
});

test('in lai khong duoc gan nhan vao ten doanh nghiep khi mau bo dong tieu de', () => {
  dungChiNhanh('reprint_company', { paper: 'K57', widthMm: 57 });
  AppSettings.autoSaveTemplate({
    kind: 'bill',
    template: {
      kind: 'bill', version: 8, standard: 'dan_payment_receipt',
      rows: [
        { id: 'company', type: 'text', text: 'CONG TY DICH VU TIEP THI BCM', align: 'center' },
        { id: 'meta', type: 'text', text: 'So bill: {billNo}' },
      ],
    },
  }, 'reprint_company');
  const text = Print.renderJobText({
    type: 'receipt', branch_id: 'reprint_company', reprint_of: 'old-job',
    payload_json: JSON.stringify({
      reprint: true, number: 'B001', total: 10000,
      items: [{ name: 'Item', qty: 1, unit_price: 10000 }],
    }),
  }, 'reprint_company', { paper: 'K57', widthMm: 57 });
  // Dong tieu de chen them phai la tieng Viet CO DAU nhu moi phieu khac —
  // truoc day cho chen ban khong dau nen mot to bill co ca hai kieu chu.
  assert.match(text, /HÓA ĐƠN THANH TOÁN \(IN LẠI\)/);
  assert.match(text, /CONG TY DICH VU TIEP THI BCM/);
  assert.doesNotMatch(text, /BCM.*IN L[AẠ]I/);
});

test('mau da co tieu de IN LAI thi khong chen lap them dong thu hai', () => {
  dungChiNhanh('reprint_once', { paper: 'K57', widthMm: 57 });
  AppSettings.autoSaveTemplate({
    kind: 'bill',
    template: {
      kind: 'bill', version: 8, standard: 'dan_payment_receipt',
      rows: [
        { id: 'title', type: 'text', text: 'HOA DON THANH TOAN (IN LAI)', align: 'center' },
        { id: 'meta', type: 'text', text: 'So bill: {billNo}' },
      ],
    },
  }, 'reprint_once');
  const text = Print.renderJobText({
    type: 'receipt', branch_id: 'reprint_once', reprint_of: 'old-job',
    payload_json: JSON.stringify({ reprint: true, number: 'B002', total: 10000 }),
  }, 'reprint_once', { paper: 'K57', widthMm: 57 });
  assert.equal((text.match(/HÓA ĐƠN THANH TOÁN/g) || []).length, 1, text);
  assert.match(text, /\(in lại\)/i);
});

test('noteBlock in ghi chu va dung ba dong trong de viet tay', () => {
  dungChiNhanh('receipt_note', { paper: 'K57', widthMm: 57 });
  AppSettings.autoSaveTemplate({
    kind: 'bill',
    template: {
      kind: 'bill', version: 8, standard: 'dan_payment_receipt',
      rows: [
        { id: 'note', type: 'text', text: '{noteBlock}' },
        { id: 'footer', type: 'text', text: 'Cam on' },
      ],
    },
  }, 'receipt_note');
  const text = Print.renderJobText({
    type: 'receipt', branch_id: 'receipt_note',
    payload: { number: 'B003', total: 10000, note: 'ABC123456XYZ' },
  }, 'receipt_note', { paper: 'K57', widthMm: 57 });
  assert.match(text, /Ghi chú: ABC123456XYZ\n\n\n\nCam on/);
});

test('noteBlock van in nhan Ghi chu khi khong co noi dung', () => {
  dungChiNhanh('receipt_empty_note', { paper: 'K57', widthMm: 57 });
  AppSettings.autoSaveTemplate({
    kind: 'bill',
    template: {
      kind: 'bill', version: 8, standard: 'dan_payment_receipt',
      rows: [
        { id: 'note', type: 'text', text: '{noteBlock}' },
        { id: 'footer', type: 'text', text: 'Cam on' },
      ],
    },
  }, 'receipt_empty_note');
  const text = Print.renderJobText({
    type: 'receipt', branch_id: 'receipt_empty_note',
    payload: { number: 'B004', total: 10000, note: '' },
  }, 'receipt_empty_note', { paper: 'K57', widthMm: 57 });
  assert.match(text, /Ghi chú:\n\n\n\nCam on/);
});

test('mau tem rieng phat sinh lenh ESC POS bold va co chu', () => {
  AppSettings.updateSettings({ print_config: {
    bill: { storeName: 'Dan D Pak' },
    labels: { widthMm: 50 },
    printers: [{ id: 'styled', name: 'STYLED', systemName: 'STYLED', output: 'product_label', connection: 'system', active: true }],
    templates: { product_label: { kind: 'product_label', rows: [
      { id: 'name', type: 'text', text: '{itemName}', bold: true, fontSize: 6 },
    ] } },
  } }, 'styled_label');
  System.setAgentPrinters('styled_label', [{ Name: 'STYLED' }], { deviceId: 'dev_styled', deviceName: 'POS' });
  Print.printProductLabel('styled_label', { sku: { name: 'Hat dieu', barcode: '123' } });
  const job = Print.pendingAgentJobs('styled_label', { limit: 5, deviceId: 'dev_styled' })
    .find(j => j.type === 'product_label');
  assert.match(job.text, /\[\[B1\]\]\[\[S2\]\]Hat dieu\[\[S0\]\]\[\[B0\]\]/);
});

test('TEM chua thiet ke mau van theo kich thuoc tem da cai', () => {
  // Tem nho 35mm: khong duoc dung 40 ky tu nhu truoc.
  // Tem dung VAT TU KHAC bill nen KHONG tu roi ve may in bill (se phi giay bill),
  // phai khai tuyen tem that -> khai o day.
  AppSettings.updateSettings({
    print_config: {
      bill: { storeName: 'Dan D Pak', printDensity: 'dark' },
      labels: { widthMm: 35 },
      printers: [{
        id: 'may_tem', name: 'TEM-35', systemName: 'TEM-35', label: 'May in tem',
        output: 'product_label', connection: 'system', active: true, auto: true,
      }],
    },
  }, 'ptem');
  System.setAgentPrinters('ptem', [{ Name: 'TEM-35' }], {
    deviceId: 'dev_ptem', deviceName: 'POS-TEM',
  });
  Print.printProductLabel('ptem', {
    sku: { name: 'Hat dieu rang muoi 500g', barcode: 'DDP-CAS-500', price: 165000 },
    copies: 1,
  });

  const jobs = Print.pendingAgentJobs('ptem', { limit: 10, deviceId: 'dev_ptem' });
  const tem = jobs.find(j => j.type === 'product_label');
  assert.ok(tem, 'phai tao duoc job tem');
  const w = Math.max(...tem.text.split('\n').map(l => l.length));
  assert.ok(w <= 24,
    `tem 35mm chi vua 24 ky tu, dang dung ${w} — chu se tran khoi mep tem`);
});

function beNgangReceipt(branch, deviceId) {
  const jobs = Print.pendingAgentJobs(branch, { limit: 10, deviceId });
  const j = jobs.find(x => x.type === 'receipt');
  assert.ok(j, 'phai co job hoa don');
  return Math.max(...j.text.split('\n').map(l => l.length));
}

function receiptText(branch, deviceId) {
  const jobs = Print.pendingAgentJobs(branch, { limit: 10, deviceId });
  const job = jobs.find(x => x.type === 'receipt');
  assert.ok(job, 'phai co job hoa don');
  return job.text;
}
