// CATALOGUE BÁN LẺ — máy tablet ngoài quầy cho khách tự chọn hàng.
//
// Ba điều PHẢI đúng, vì máy này nằm ngoài quầy và ai cũng chạm được:
//   1. Mỗi máy ghi vào ĐÚNG MỘT ô giỏ của nó, không giẫm lên giỏ thu ngân.
//   2. Tên máy đi kèm giỏ để POS hiện "Kệ hạt điều" thay cho "Hóa đơn 03".
//   3. Khách bấm thanh toán chỉ TÔ ĐỎ tab, KHÔNG tự tạo đơn hay thu tiền.
//
// Và một điều về dữ liệu: catalogue bán lẻ phải TÁCH HẲN khỏi menu quyển FnB —
// bật catalogue không được làm đổi menu đang chạy trên iPad nhà hàng.
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const temp = mkdtempSync(join(tmpdir(), 'dandpak-catalogue-'));
process.env.SQLITE_PATH = join(temp, 'store.db');
process.env.STORAGE_PATH = join(temp, 'storage');
process.env.DATA_ENCRYPTION_KEY = process.env.DATA_ENCRYPTION_KEY
  || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

const { migrate, db } = await import('./db.js');
const Catalogue = await import('./services/catalogue.js');
const Cart = await import('./services/retailCart.js');
const Book = await import('./services/bookMenu.js');

migrate();
const BR = 'sala';

const gio = (n = 1) => ({
  lines: Array.from({ length: n }, (_, i) => ({
    sku: { id: `s_${i}`, name: `Hat dieu ${i}` }, qty: 1, price: 100000,
  })),
});

// ── 1. Ô giỏ theo thiết bị ─────────────────────────────────────────────────
test('may catalogue luon ghi vao DUNG MOT o gio cua no', () => {
  const a = Catalogue.registerCatalogueDevice(BR, { device: 'tab_a', name: 'Ke hat dieu' });
  const o1 = Cart.claimCatalogueSlot(BR, { device: 'tab_a', deviceName: a.name });
  Cart.saveCart(BR, o1.slot, { ...gio(2), origin: 'catalogue', device_name: a.name },
    { actor: 'catalogue', device: 'tab_a' });

  // Hoi lai lan nua -> VAN o cu, khong nhay o (khach quay lai thay gio cu).
  const o2 = Cart.claimCatalogueSlot(BR, { device: 'tab_a' });
  assert.equal(o2.slot, o1.slot);
});

test('hai may catalogue KHONG giam o cua nhau', () => {
  Catalogue.registerCatalogueDevice(BR, { device: 'tab_b', name: 'Quay truoc' });
  const oA = Cart.claimCatalogueSlot(BR, { device: 'tab_a' });
  const oB = Cart.claimCatalogueSlot(BR, { device: 'tab_b' });
  assert.notEqual(oA.slot, oB.slot, 'hai may phai o hai o khac nhau');

  Cart.saveCart(BR, oB.slot, { ...gio(1), origin: 'catalogue', device_name: 'Quay truoc' },
    { actor: 'catalogue', device: 'tab_b' });
  const carts = Cart.listCarts(BR);
  assert.equal(carts.find(c => c.slot === oA.slot).lines.length, 2, 'gio may A phai con nguyen');
  assert.equal(carts.find(c => c.slot === oB.slot).lines.length, 1);
});

// ── 2. Tên máy đi kèm giỏ ──────────────────────────────────────────────────
test('gio mang theo TEN MAY va nguon goc de POS doi nhan tab', () => {
  const o = Cart.claimCatalogueSlot(BR, { device: 'tab_a' });
  const c = Cart.listCarts(BR).find(x => x.slot === o.slot);
  assert.equal(c.origin, 'catalogue');
  assert.equal(c.device_name, 'Ke hat dieu');
  assert.equal(c.pay_requested, false);
});

test('quan ly doi ten may thi ten moi duoc dung', () => {
  Catalogue.renameCatalogueDevice(BR, { device: 'tab_a', name: 'Ke hat dieu (moi)' });
  assert.equal(Catalogue.catalogueDeviceName(BR, 'tab_a'), 'Ke hat dieu (moi)');
  // May bao danh lai KHONG duoc de len ten quan ly vua dat.
  const lai = Catalogue.registerCatalogueDevice(BR, { device: 'tab_a', name: 'Ten may tu khai' });
  assert.equal(lai.name, 'Ke hat dieu (moi)');
});

test('gio do NHAN VIEN bam van la origin staff, khong dinh ten may', () => {
  Cart.saveCart(BR, 50, gio(1), { actor: 'thungan', device: 'pos1' });
  const c = Cart.listCarts(BR).find(x => x.slot === 50);
  assert.equal(c.origin, 'staff');
  assert.equal(c.device_name, '');
});

test('ghi chu bill song sot qua snapshot chia se va queue chi co mot pending/entity', () => {
  Cart.saveCart(BR, 51, { ...gio(1), note: 'Giao cho chi Lan' },
    { actor: 'thungan', device: 'pos1' });
  Cart.saveCart(BR, 51, { ...gio(2), note: 'Giao cho chi Lan - sua lan 2' },
    { actor: 'thungan', device: 'pos1' });
  const c = Cart.listCarts(BR).find(x => x.slot === 51);
  assert.equal(c.note, 'Giao cho chi Lan - sua lan 2');

  // Cùng entity UPDATE liên tiếp không được tạo thêm công việc pending.
  // Chỉ entity có payload đầy đủ mới được vào Edge queue; app_settings bị loại
  // có chủ đích vì có thể chứa secret. Bật một hub thật rồi kiểm trên bàn.
  db.prepare(`UPDATE sync_hub_state SET hub_id=? WHERE id=1`).run('hub_test');
  db.prepare(`INSERT INTO tables(id,branch_id,zone,code,seats,status)
    VALUES (?,?,?,?,?,?)`).run('queue_dedupe_test', BR, 'Test', 'QD1', 2, 'free');
  db.prepare(`UPDATE tables SET seats=? WHERE id=? AND branch_id=?`)
    .run(3, 'queue_dedupe_test', BR);
  db.prepare(`UPDATE tables SET seats=? WHERE id=? AND branch_id=?`)
    .run(4, 'queue_dedupe_test', BR);
  const n = db.prepare(`SELECT COUNT(*) n FROM sync_queue
    WHERE status='pending' AND branch_id=? AND kind='tables' AND ref=?`)
    .get(BR, 'queue_dedupe_test').n;
  assert.equal(n, 1);
});

test('hai may cung mo co presence, snapshot cu bi chan khong ghi de', () => {
  const first = Cart.saveCart(BR, 52, { ...gio(1), note: 'ban dau' },
    { actor: 'A', device: 'pos_a' });
  Cart.touchCartPresence(BR, 52, { actor: 'B', device: 'pos_b' });
  const listed = Cart.listCarts(BR).find(x => x.slot === 52);
  assert.deepEqual(new Set(listed.active_devices.map(x => x.device)),
    new Set(['pos_a', 'pos_b']));

  const second = Cart.saveCart(BR, 52, { ...gio(2), note: 'may A sua' },
    { actor: 'A', device: 'pos_a', expectedVersion: first.version });
  assert.equal(second.version, first.version + 1);
  assert.throws(() => Cart.saveCart(BR, 52, { ...gio(3), note: 'may B ban cu' },
    { actor: 'B', device: 'pos_b', expectedVersion: first.version }),
  error => error?.status === 409 && error?.code === 'CART_VERSION_CONFLICT');
  assert.equal(Cart.listCarts(BR).find(x => x.slot === 52).note, 'may A sua');
});

// ── 3. Đòi thanh toán ──────────────────────────────────────────────────────
test('khach bam thanh toan chi TO DO tab, khong tao don', () => {
  const o = Cart.claimCatalogueSlot(BR, { device: 'tab_a' });
  const sau = Cart.requestCataloguePayment(BR, o.slot, { method: 'qr', device: 'tab_a' });
  assert.equal(sau.pay_requested, true);
  assert.equal(sau.pay_method, 'qr');
  // Van la gio nhap, chua thanh don.
  assert.ok(sau.lines.length > 0, 'hang trong gio phai con nguyen');
});

test('khach sua gio sau khi doi thanh toan thi go co do', () => {
  const o = Cart.claimCatalogueSlot(BR, { device: 'tab_a' });
  const sau = Cart.saveCart(BR, o.slot,
    { ...gio(3), origin: 'catalogue', device_name: 'Ke hat dieu (moi)', pay_requested: false },
    { actor: 'catalogue', device: 'tab_a' });
  assert.equal(sau.pay_requested, false,
    'don da doi thi khong duoc giu co doi thanh toan cu');
});

test('gio trong thi khong doi thanh toan duoc', () => {
  Cart.saveCart(BR, 60, { ...gio(1), origin: 'catalogue' }, { actor: 'catalogue', device: 'tab_c' });
  Cart.clearCart(BR, 60, { actor: 'catalogue', device: 'tab_c' });
  assert.throws(() => Cart.requestCataloguePayment(BR, 60, { device: 'tab_c' }),
    /không còn|đang trống/i);
});

// ── 4. Catalogue tách hẳn khỏi menu FnB ────────────────────────────────────
test('them trang catalogue KHONG dung toi menu quyen FnB dang chay', () => {
  const truoc = Book.getPublicBookConfig(BR);
  assert.ok(truoc.book, 'phai co menu FnB mac dinh');

  Book.addBookPage({ kind: 'retail', title: 'Catalogue ban le' }, BR,
    () => ({ url: '/uploads/catalogue/page_1.webp' }));

  const sau = Book.getPublicBookConfig(BR);
  assert.equal(sau.activeBookId, truoc.activeBookId,
    'menu FnB dang chay khong duoc doi khi them trang catalogue');
  assert.notEqual(sau.book.kind, 'retail');
});

test('catalogue ban le mac dinh TAT, bat roi moi phat cho man khach', () => {
  const c1 = Book.getPublicRetailCatalogue(BR);
  assert.equal(c1.enabled, false, 'chua bat thi man khach khong duoc chay');
  assert.ok(c1.book, 'nhung quyen thi da co de quan ly dung thu');

  Book.saveBookConfig({ ...Book.getBookConfig(BR), retailEnabled: true }, BR);
  const c2 = Book.getPublicRetailCatalogue(BR);
  assert.equal(c2.enabled, true);
  assert.equal(c2.book.kind, 'retail');
});

test('them anh TUNG TAM, moi tam la mot trang moi', () => {
  const cfg = Book.getBookConfig(BR);
  const quyen = cfg.books.find(b => b.kind === 'retail');
  const truoc = quyen.pages.length;
  Book.addBookPage({ kind: 'retail', book_id: quyen.id }, BR,
    () => ({ url: '/uploads/catalogue/page_2.webp' }));
  const sau = Book.getBookConfig(BR).books.find(b => b.id === quyen.id);
  assert.equal(sau.pages.length, truoc + 1);
  assert.match(sau.pages.at(-1).src, /page_2\.webp$/);
});

test('xoa mot trang thi cham diem tren trang do bi bo, trang sau lui mot bac', () => {
  const cfg = Book.getBookConfig(BR);
  const q = cfg.books.find(b => b.kind === 'retail');
  q.hotspots = [
    { id: 'h0', page: 0, sku_id: 's_0', x: 10, y: 10 },
    { id: 'h1', page: 1, sku_id: 's_1', x: 20, y: 20 },
  ];
  Book.saveBookConfig(cfg, BR);

  const sau = Book.removeBookPage({ book_id: q.id, page_id: q.pages[0].id }, BR)
    .books.find(b => b.id === q.id);
  assert.equal(sau.hotspots.length, 1, 'cham diem tren trang da xoa phai bi bo');
  assert.equal(sau.hotspots[0].id, 'h1');
  assert.equal(sau.hotspots[0].page, 0, 'trang phia sau phai lui mot bac');
});

test('cham diem catalogue tro toi SKU, khong phai mon FnB', () => {
  const cfg = Book.getBookConfig(BR);
  const q = cfg.books.find(b => b.kind === 'retail');
  q.hotspots = [{ id: 'h9', page: 0, sku_id: 's_99', x: 5, y: 5 }];
  const sau = Book.saveBookConfig(cfg, BR).books.find(b => b.id === q.id);
  assert.equal(sau.hotspots[0].sku_id, 's_99');
  assert.equal(sau.hotspots[0].menu_item_id, '', 'quyen ban le khong duoc cam mon FnB');
});

// ── 5. Cấu hình màn khách ──────────────────────────────────────────────────
test('cau hinh gui ra MAN KHACH khong bao gio kem mat khau thoat', () => {
  // Catalogue khong con mat khau thoat rieng — dung chung PIN "Thiet bi khach".
  // Du co gui len thi cung khong duoc luu, va tuyet doi khong ra may khach cam.
  Catalogue.saveCatalogueConfig({ exitPin: '9999' }, BR);
  assert.equal(Catalogue.getCatalogueConfig(BR).exitPin, undefined,
    'khong duoc tai lap mat khau rieng cho catalogue');
  assert.equal(Catalogue.getPublicCatalogueConfig(BR).exitPin, undefined,
    'may dat ngoai quay khong duoc cam mat khau thoat trong bo nho');
});

test('QR cua man khach lay tu CAU HINH THANH TOAN, khong phai rieng catalogue', async () => {
  // Mot nguon su that: bat/tat cong o Cai dat > Thanh toan la man khach doi
  // theo. Neu catalogue giu ban sao rieng thi se co canh catalogue hien mot ma
  // con man phu hien ma khac.
  const AppSettings = await import('./services/settings.js');
  AppSettings.updateSettings({
    operations_config: {
      payment: {
        bankQrEnabled: false,          // tat QR ngan hang
        staticQrUrl: '/uploads/catalogue/qr_9.png',
        qrProvider: '',
      },
    },
  }, BR);
  const congKhai = Catalogue.getPublicCatalogueConfig(BR);
  assert.equal(congKhai.qrProvider, 'static');
  assert.equal(congKhai.staticQrUrl, '/uploads/catalogue/qr_9.png');
  assert.equal(congKhai.tuDoiSoat, false,
    'QR tinh khong tu doi soat — man khach phai noi that voi khach');
});

test('mat khau thoat DUNG CHUNG voi PIN thiet bi khach', async () => {
  // Mot mat khau cho mot viec "mo khoa may dua khach". Hai ma rieng cho cung
  // mot viec thi quen ma nao la ket luon may do.
  const AppSettings = await import('./services/settings.js');
  AppSettings.updateSettings({ ipad_staff_pin: '7392' }, BR);
  assert.equal(AppSettings.verifyIpadStaffPin('7392', BR), true);
  assert.equal(AppSettings.verifyIpadStaffPin('7391', BR), false);
  assert.equal(Catalogue.checkCatalogueExitPin, undefined,
    'khong con duong rieng de thoat catalogue');
});

// ── 6. Chia danh mục trong catalogue ───────────────────────────────────────
//
// Quyển dày vài chục trang thì khách không lật hết để tìm. Mỗi trang gán được
// một DANH MỤC; màn khách dựng thanh danh mục nhảy thẳng tới trang đầu của mục.
test('danh muc gan theo trang, giu dung THU TU TRANG cua quyen', () => {
  const cfg = Book.getBookConfig(BR);
  const q = cfg.books.find(b => b.kind === 'retail');
  q.pages = [
    { id: 'p1', src: '/uploads/catalogue/1.png', label: 'T1', category: 'Hat dinh duong' },
    { id: 'p2', src: '/uploads/catalogue/2.png', label: 'T2', category: 'Hat dinh duong' },
    { id: 'p3', src: '/uploads/catalogue/3.png', label: 'T3', category: 'Trai cay say' },
    { id: 'p4', src: '/uploads/catalogue/4.png', label: 'T4', category: '' },
    { id: 'p5', src: '/uploads/catalogue/5.png', label: 'T5', category: 'Qua tang' },
  ];
  Book.saveBookConfig(cfg, BR);

  const cong = Book.getPublicRetailCatalogue(BR);
  assert.deepEqual(cong.categories, [
    { name: 'Hat dinh duong', page: 0 },
    { name: 'Trai cay say', page: 2 },
    { name: 'Qua tang', page: 4 },
  ], 'moi muc tro toi TRANG DAU cua no, va giu thu tu quyen (khong sap A-Z)');
});

test('trang khong gan muc thi khong sinh muc rong tren thanh', () => {
  const cong = Book.getPublicRetailCatalogue(BR);
  assert.ok(cong.categories.every(c => c.name), 'khong duoc co muc ten rong');
  assert.equal(cong.categories.length, 3);
});

test('danh muc SONG SOT qua mot vong luu — khong bi don dep mat', () => {
  const cfg = Book.getBookConfig(BR);
  const q = cfg.books.find(b => b.kind === 'retail');
  assert.equal(q.pages[2].category, 'Trai cay say');
  const sau = Book.saveBookConfig(cfg, BR).books.find(b => b.id === q.id);
  assert.equal(sau.pages[2].category, 'Trai cay say');
});
