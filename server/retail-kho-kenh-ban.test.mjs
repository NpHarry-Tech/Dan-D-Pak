// KHO NÀO CẤP HÀNG CHO KÊNH BÁN LẺ — VÀ VÌ SAO DANH MỤC RỖNG.
//
// SỰ CỐ THẬT (chi nhánh Vietfoods, 04/08/2026): cửa hàng nối kho với Retail rồi
// mà bấm vào Retail POS không thấy sản phẩm nào, cũng không có lời giải thích
// nào trên màn hình.
//
// Có HAI nơi cùng nói về "kho nào cấp hàng cho kênh bán":
//   1. `retail_config.standalone.warehouse_id` — chọn ĐÍCH DANH một kho cho
//      kênh bán lẻ (Cài đặt → Kho & kênh bán).
//   2. Ô tick "kênh bán" trên từng kho (`sales_channels_json`).
// Luật hiện hành: chọn đích danh THẮNG, chọn rồi thì không lọc thêm bằng ô tick
// nữa — hai bộ lọc chồng lên nhau mà lệch nhau thì kết quả luôn rỗng. Mấy test
// đầu khoá chặt luật đó lại.
//
// Nhưng danh mục vẫn rỗng được vì lý do chính đáng: kho được chọn chưa có hàng,
// hoặc chưa kho nào được nối. Khi ấy màn hình PHẢI nói rõ hàng đang nằm ở kho
// nào và sửa ở đâu — trống trơn không kèm giải thích là ngõ cụt, đúng thứ cửa
// hàng vừa gặp phải.
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const temp = mkdtempSync(join(tmpdir(), 'dandpak-khokenh-'));
process.env.SQLITE_PATH = join(temp, 'store.db');
process.env.STORAGE_PATH = join(temp, 'storage');
process.env.DATA_ENCRYPTION_KEY = process.env.DATA_ENCRYPTION_KEY
  || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

const { migrate } = await import('./db.js');
const Inv = await import('./services/inventory.js');
const AppSettings = await import('./services/settings.js');

migrate();
const BR = 'sala';

// Kho A: KHÔNG tick kênh bán lẻ. Kho B: có tick.
const khoA = Inv.createWarehouse(
  { name: 'Kho Vietfoods', type: 'retail', sales_channels: [] }, BR);
const khoB = Inv.createWarehouse(
  { name: 'Kho quay vong', type: 'retail', sales_channels: ['retail'] }, BR);

// Hàng hoá nằm ở kho A — đúng cái kho cửa hàng vừa chọn cho Retail.
Inv.createSku({ name: 'Hat dieu rang muoi', price: 90000, unit: 'goi',
  warehouse_id: khoA.id }, BR);
Inv.createSku({ name: 'Hat macca', price: 150000, unit: 'goi',
  warehouse_id: khoA.id }, BR);
// Một mặt hàng ở kho B để chắc chắn bộ lọc vẫn còn tác dụng thật.
Inv.createSku({ name: 'Nho kho', price: 60000, unit: 'goi',
  warehouse_id: khoB.id }, BR);

function tenHang(res) {
  return (res.items || res).map(s => s.name).sort();
}

test('chon dich danh kho cho Retail thi POS ban le PHAI co hang cua kho do', () => {
  AppSettings.updateSettings({
    retail_config: {
      sync: true,
      standalone: { warehouse_id: khoA.id, price_book_id: 'default' },
    },
  }, BR);

  const res = Inv.listSkus(BR, { channel: 'retail', page: 1, limit: 50 });
  assert.deepEqual(tenHang(res), ['Hat dieu rang muoi', 'Hat macca'],
    'kho da duoc chon dich danh cho Retail — hang cua kho do phai hien ra');
});

test('mat "Them retail" trong POS F&B cung theo dung kho da chon', () => {
  const res = Inv.listSkus(BR, { channel: 'fnb_retail', page: 1, limit: 50 });
  assert.deepEqual(tenHang(res), ['Hat dieu rang muoi', 'Hat macca'],
    'sync=true thi mat F&B dung y cau hinh cua POS ban le');
});

test('CHUA chon dich danh thi van loc theo o tick kenh ban nhu cu', () => {
  AppSettings.updateSettings({
    retail_config: {
      sync: true,
      standalone: { warehouse_id: '', price_book_id: 'default' },
    },
  }, BR);

  const res = Inv.listSkus(BR, { channel: 'retail', page: 1, limit: 50 });
  assert.deepEqual(tenHang(res), ['Nho kho'],
    'khong chi dich danh kho nao thi o tick "kenh ban" van la thu quyet dinh');
});

test('duyet ton theo tung kho vat ly KHONG bi cau hinh ban le lam lech', () => {
  AppSettings.updateSettings({
    retail_config: {
      sync: true,
      standalone: { warehouse_id: khoA.id, price_book_id: 'default' },
    },
  }, BR);

  // Man "Kho hang" xem ton cua kho B — phai ra hang cua kho B, khong duoc dinh
  // theo kho ma cau hinh ban le dang tro toi.
  const res = Inv.listSkus(BR, { warehouse_id: khoB.id, page: 1, limit: 50 });
  assert.deepEqual(tenHang(res), ['Nho kho']);
});

test('danh muc rong PHAI noi ro vi sao, khong de man hinh trong tron', () => {
  // Tro kenh ban le vao mot kho moi tinh chua co hang nao.
  const khoRong = Inv.createWarehouse(
    { name: 'Kho moi', type: 'retail', sales_channels: ['retail'] }, BR);
  AppSettings.updateSettings({
    retail_config: {
      sync: true,
      standalone: { warehouse_id: khoRong.id, price_book_id: 'default' },
    },
  }, BR);

  const res = Inv.listSkus(BR, { channel: 'retail', page: 1, limit: 50 });
  assert.equal(res.total, 0);
  assert.equal(res.empty_reason?.code, 'warehouse_forced_empty');
  assert.match(res.empty_reason.message, /Kho moi/);
  assert.match(res.empty_reason.message, /Kho Vietfoods/,
    'phai chi ro hang dang nam o kho nao de con biet duong sua');
});

test('rong vi CHUA co hang thi khong bia ra ly do cau hinh', () => {
  const trong = 'chi_nhanh_trong';
  const res = Inv.listSkus(trong, { channel: 'retail', page: 1, limit: 50 });
  assert.equal(res.total, 0);
  assert.equal(res.empty_reason, undefined,
    'chua tao hang thi khong duoc do cho cau hinh kho');
});

test('rong vi go tu khoa tim kiem thi cung khong bia ly do', () => {
  AppSettings.updateSettings({
    retail_config: {
      sync: true,
      standalone: { warehouse_id: khoA.id, price_book_id: 'default' },
    },
  }, BR);
  const res = Inv.listSkus(BR,
    { channel: 'retail', page: 1, limit: 50, q: 'khong-co-mat-hang-nao-ten-nay' });
  assert.equal(res.total, 0);
  assert.equal(res.empty_reason, undefined);
});

// ── Catalogue bán lẻ dùng CHUNG kho với POS bán lẻ ────────────────────────────
//
// Màn khách catalogue và POS bán lẻ là hai mặt của cùng một quầy: khách chọn
// trên catalogue, thu ngân thu tiền trên POS. Hai bên mà lấy hàng từ hai kho
// khác nhau thì khách chọn được món POS không bán được, hoặc giá hai bên lệch.
// Vì vậy catalogue KHÔNG có cấu hình kho riêng — nó hỏi đúng kênh 'retail'.
test('catalogue lay hang tu DUNG cai kho da noi voi ban le', () => {
  AppSettings.updateSettings({
    retail_config: {
      sync: true,
      standalone: { warehouse_id: khoA.id, price_book_id: 'default' },
    },
  }, BR);

  const pos = Inv.listSkus(BR, { channel: 'retail', page: 1, limit: 500 });
  const catalogue = Inv.listSkus(BR, { channel: 'retail', page: 1, limit: 500 });
  assert.deepEqual(tenHang(catalogue), tenHang(pos));
  assert.deepEqual(tenHang(catalogue), ['Hat dieu rang muoi', 'Hat macca']);
});

test('doi kho ban le thi catalogue doi theo NGAY, khong giu ban cu', () => {
  AppSettings.updateSettings({
    retail_config: {
      sync: true,
      standalone: { warehouse_id: khoB.id, price_book_id: 'default' },
    },
  }, BR);
  const catalogue = Inv.listSkus(BR, { channel: 'retail', page: 1, limit: 500 });
  assert.deepEqual(tenHang(catalogue), ['Nho kho']);
});

test('gia catalogue theo BANG GIA cua kenh ban le, khong phai gia chung', () => {
  // Bang gia rieng cho kenh ban le -> ca POS lan catalogue deu phai theo gia do,
  // neu khong khach doc mot gia tren tablet roi ra quay tra mot gia khac.
  const book = Inv.savePriceBookMeta({ name: 'Gia le', status: 'active' }, BR);
  const nho = Inv.listSkus(BR, { page: 1, limit: 500 }).items
    .find(s => s.name === 'Nho kho');
  Inv.setPriceBookEntry({ book_id: book.id, sku_id: nho.id, price: 45000 }, BR);
  AppSettings.updateSettings({
    retail_config: {
      sync: true,
      standalone: { warehouse_id: khoB.id, price_book_id: book.id },
    },
  }, BR);

  const catalogue = Inv.listSkus(BR, { channel: 'retail', page: 1, limit: 500 });
  assert.equal(catalogue.items[0].price, 45000,
    'catalogue phai hien dung gia ma quay se thu');
});
