// MỖI THỜI ĐIỂM CHỈ MỘT ĐƯỜNG NHẬN CHUYỂN KHOẢN.
//
// Cửa hàng có nhiều cách nhận chuyển khoản (payOS, VietQR API, SePay, QR public,
// ẢNH QR TĨNH). Chúng LOẠI TRỪ LẪN NHAU: bật hai cái cùng lúc thì khách quét mã
// của đường này, hệ thống lại chờ tiền về theo đường kia — tiền vào rồi mà bill
// không tự đóng, hoặc tệ hơn là khớp nhầm sang bill khác.
//
// Yêu cầu vận hành (04/08/2026): tắt SePay + tắt QR ngân hàng thì ẢNH QR TĨNH
// phải TỰ LÊN THAY ở MỌI màn có bước chuyển khoản — màn phụ, iPad self-order,
// catalogue, POS — chứ không phải vào từng chỗ bật lại.
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const temp = mkdtempSync(join(tmpdir(), 'dandpak-qr-'));
process.env.SQLITE_PATH = join(temp, 'store.db');
process.env.STORAGE_PATH = join(temp, 'storage');
process.env.DATA_ENCRYPTION_KEY = process.env.DATA_ENCRYPTION_KEY
  || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

const { migrate } = await import('./db.js');
const Qr = await import('./services/qrProvider.js');
const AppSettings = await import('./services/settings.js');

migrate();

const NGAN_HANG = {
  bankCode: 'VCB', bankAccount: '0123456789', accountName: 'DAN D PAK',
};

function dungChiNhanh(branch, { payment = {}, channels = {} } = {}) {
  AppSettings.updateSettings({
    operations_config: { payment: { ...NGAN_HANG, ...payment } },
  }, branch);
  if (Object.keys(channels).length) {
    AppSettings.updateIntegrations({ channels }, branch);
  }
}

// ── QR tĩnh lên thay khi tắt hết đường tự đối soát ──────────────────────────
test('tat SePay + khong co cong nao -> QR TINH tu len thay', () => {
  const BR = 'qr_tinh';
  dungChiNhanh(BR, {
    payment: {
      qrProvider: '', // chua chon tay -> he thong tu quyet
      staticQrUrl: '/uploads/catalogue/qr_1.png',
      // TAT HAN QR ngan hang bang cong tac tuong minh. Xoa trong so tai khoan
      // KHONG co tac dung vi cau hinh luon roi ve mac dinh — do la ly do phai
      // co dung mot o de tat.
      bankQrEnabled: false,
    },
    channels: { sepay: { enabled: false }, payos: { enabled: false } },
  });
  const d = Qr.resolveQrProvider(BR);
  assert.equal(d.provider, 'static');
  assert.equal(d.tuDoiSoat, false, 'QR tinh KHONG tu doi soat — phai noi that');
  assert.equal(d.staticQrUrl, '/uploads/catalogue/qr_1.png');
});

test('chua tai anh QR tinh va cung chua khai ngan hang -> khong co duong nao', () => {
  const BR = 'qr_trong';
  dungChiNhanh(BR, {
    payment: { qrProvider: '', staticQrUrl: '', bankQrEnabled: false },
  });
  assert.equal(Qr.resolveQrProvider(BR).provider, '',
    'khong duoc bia ra mot duong khong dung duoc');
});

test('co ngan hang thi QR public duoc uu tien hon QR tinh', () => {
  const BR = 'qr_public';
  dungChiNhanh(BR, {
    payment: { qrProvider: '', staticQrUrl: '/uploads/catalogue/qr_1.png' },
  });
  const d = Qr.resolveQrProvider(BR);
  assert.equal(d.provider, 'vietqr_public',
    'QR mang so tien va noi dung CK thi tot hon anh tinh chung chung');
});

// ── Chọn tay được tôn trọng, nhưng phải dùng được ───────────────────────────
test('chon tay QR tinh thi ton trong, du ngan hang van khai day du', () => {
  const BR = 'qr_chontay';
  dungChiNhanh(BR, {
    payment: { qrProvider: 'static', staticQrUrl: '/uploads/catalogue/qr_2.png' },
  });
  assert.equal(Qr.resolveQrProvider(BR).provider, 'static');
});

test('chon tay mot duong CHUA DU THONG TIN -> roi ve duong khac VA canh bao', () => {
  const BR = 'qr_thieu';
  dungChiNhanh(BR, {
    payment: { qrProvider: 'payos', staticQrUrl: '' }, // payos chua bat/chua co khoa
  });
  const d = Qr.resolveQrProvider(BR);
  assert.notEqual(d.provider, 'payos');
  assert.match(d.canhBao, /payos/i,
    'phai noi ro dang chon payos ma chua du thong tin, dung im lang roi ve');
});

// ── Ép loại trừ khi lưu ─────────────────────────────────────────────────────
test('bat SePay thi payOS va VietQR bi TAT theo', () => {
  const sau = Qr.epLoaiTruQr({
    payos: { enabled: true, clientId: 'x' },
    vietqr: { enabled: true, username: 'u' },
    sepay: { enabled: true },
    casso: { enabled: true },
  }, 'sepay');
  assert.equal(sau.sepay.enabled, true, 'duong vua bat phai giu nguyen');
  assert.equal(sau.payos.enabled, false);
  assert.equal(sau.vietqr.enabled, false);
  assert.equal(sau.casso.enabled, false);
});

test('ep loai tru KHONG xoa khoa/cau hinh, chi tat co enabled', () => {
  const sau = Qr.epLoaiTruQr({
    payos: { enabled: true, clientId: 'giu-lai-nhe', apiKey: 'k' },
    sepay: { enabled: true },
  }, 'sepay');
  assert.equal(sau.payos.clientId, 'giu-lai-nhe',
    'tat di roi bat lai khong phai go lai toan bo khoa API');
  assert.equal(sau.payos.apiKey, 'k');
});

test('bat VietQR thi cac duong khac tat, ke ca khi chon la vietqr_api', () => {
  const sau = Qr.epLoaiTruQr({
    vietqr: { enabled: true }, sepay: { enabled: true }, payos: { enabled: true },
  }, 'vietqr');
  assert.equal(sau.vietqr.enabled, true);
  assert.equal(sau.sepay.enabled, false);
  assert.equal(sau.payos.enabled, false);
});

test('khong bat gi thi khong tat gi — luu cau hinh khac khong dung toi QR', () => {
  const truoc = { sepay: { enabled: true }, payos: { enabled: false } };
  const sau = Qr.epLoaiTruQr(truoc, '');
  assert.deepEqual(sau, truoc);
});

// ── Chốt chặn: mọi màn phải đi qua ĐÚNG một hàm ─────────────────────────────
test('loi sinh QR dung resolveQrProvider, khong man nao tu doan', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('./services/payments.js', import.meta.url), 'utf8');
  assert.match(src, /resolveQrProvider\(branch_id\)/,
    'buildPaymentQr phai hoi bo phan giai chung');
  assert.match(src, /provider === 'static'/,
    'loi sinh QR phai biet tra ve anh QR tinh');
});
