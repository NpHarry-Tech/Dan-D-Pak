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
