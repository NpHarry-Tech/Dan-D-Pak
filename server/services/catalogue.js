// ─────────────────────────────────────────────────────────────────────────
// CATALOGUE BÁN LẺ — máy tablet đặt ngoài quầy cho KHÁCH tự xem và chọn hàng.
//
// Khác gì self-order F&B: bên kia khách ngồi tại BÀN nên đơn gắn với số bàn.
// Bán lẻ không có bàn — khách cầm máy đứng giữa kệ hàng. Thứ thay cho số bàn là
// CHÍNH CÁI MÁY: mỗi máy có tên riêng ("Kệ hạt điều", "Quầy trước"), và tên đó
// hiện lên POS thay cho nhãn "Hóa đơn 01" để thu ngân biết chạy tới đâu.
//
// File này giữ hai thứ:
//   1. Sổ đăng ký máy catalogue (device_id -> tên hiển thị)
//   2. Cấu hình thanh toán của màn khách (ảnh QR tĩnh dùng tạm)
// Giỏ hàng thì dùng lại retailCart.js — KHÔNG dựng hệ giỏ riêng, nếu không POS
// sẽ phải hiểu hai loại giỏ khác nhau.
// ─────────────────────────────────────────────────────────────────────────
import { db, now, audit } from '../db.js';
import { emit } from '../realtime.js';
import { readJsonSetting, writeJsonSetting } from './settings/shared.js';
import { resolveQrProvider } from './qrProvider.js';

const CATALOGUE_KEY = 'catalogue_config';

db.exec(`CREATE TABLE IF NOT EXISTS catalogue_devices (
  branch_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  last_seen TEXT,
  PRIMARY KEY(branch_id, device_id)
);`);

function txt(v, max = 120) {
  return String(v ?? '').trim().slice(0, max);
}

// ── 1. Sổ đăng ký máy ───────────────────────────────────────────────────────

/**
 * Máy catalogue báo danh. Gọi lúc mở màn khách và lặp lại theo nhịp — nhờ vậy
 * màn Cài đặt biết máy nào đang bật, máy nào đã tắt từ lâu.
 *
 * Chưa đặt tên thì lấy tạm phần đuôi định danh máy để nhân viên vẫn phân biệt
 * được hai máy với nhau, thay vì cả hai cùng hiện "Chưa đặt tên".
 */
export function registerCatalogueDevice(branch_id, { device = '', name = '' } = {}) {
  const id = txt(device);
  if (!id) throw new Error('Thiếu định danh thiết bị');
  const cu = db.prepare(`SELECT name FROM catalogue_devices WHERE branch_id=? AND device_id=?`)
    .get(branch_id, id);
  // Tên do QUẢN LÝ đặt trong Cài đặt là chính. Máy tự báo tên chỉ dùng khi chưa
  // ai đặt — nếu không, mỗi lần máy khởi động lại là tên quản lý đặt bị ghi đè.
  const ten = txt(cu?.name) || txt(name) || `Máy ${id.slice(-4)}`;
  db.prepare(`INSERT OR REPLACE INTO catalogue_devices (branch_id,device_id,name,last_seen)
      VALUES (?,?,?,?)`).run(branch_id, id, ten, now());
  return { device_id: id, name: ten };
}

export function listCatalogueDevices(branch_id = 'sala') {
  return db.prepare(`SELECT device_id, name, last_seen FROM catalogue_devices
      WHERE branch_id=? ORDER BY name`).all(branch_id);
}

/** Quản lý đặt lại tên máy trong Cài đặt. Tên đổi là POS đổi nhãn tab theo. */
export function renameCatalogueDevice(branch_id, { device = '', name = '' } = {}) {
  const id = txt(device);
  const ten = txt(name);
  if (!id) throw new Error('Thiếu định danh thiết bị');
  if (!ten) throw new Error('Tên thiết bị không được để trống');
  const r = db.prepare(`UPDATE catalogue_devices SET name=? WHERE branch_id=? AND device_id=?`)
    .run(ten, branch_id, id);
  if (!r.changes) throw new Error('Thiết bị chưa từng kết nối vào hệ thống');
  audit('catalogue.device_rename', { device: id, name: ten }, branch_id);
  emit('catalogue:devices', { device_id: id, name: ten }, branch_id);
  return { device_id: id, name: ten };
}

export function catalogueDeviceName(branch_id, device) {
  const id = txt(device);
  if (!id) return '';
  return txt(db.prepare(`SELECT name FROM catalogue_devices WHERE branch_id=? AND device_id=?`)
    .get(branch_id, id)?.name);
}

// ── 2. Cấu hình thanh toán màn khách ────────────────────────────────────────

const DEFAULT_CATALOGUE_CONFIG = {
  // Hình thức khách được chọn ở bước thanh toán. 'cash' nghĩa là gọi nhân viên
  // tới thu — màn khách KHÔNG tự nhận tiền.
  methods: ['qr', 'cash'],
  // ẢNH QR TĨNH dùng TẠM khi chưa đấu nối cổng thanh toán theo pháp nhân.
  // Khách quét chuyển khoản rồi nhân viên đối soát bằng mắt. Cố ý tách khỏi
  // luồng VietQR động (payments.js) — QR động sinh theo từng đơn và tự đối
  // soát; QR tĩnh thì KHÔNG, nên không được lẫn hai thứ vào nhau.
  staticQrUrl: '',
  staticQrNote: 'Quét mã để chuyển khoản, sau đó báo nhân viên để đối soát.',
  welcomeText: 'Mời quý khách chọn sản phẩm',
};

function sanitize(raw = {}) {
  const methods = Array.isArray(raw.methods)
    ? raw.methods.map(m => txt(m, 20)).filter(m => ['qr', 'cash', 'card'].includes(m))
    : DEFAULT_CATALOGUE_CONFIG.methods;
  return {
    methods: methods.length ? [...new Set(methods)] : DEFAULT_CATALOGUE_CONFIG.methods,
    staticQrUrl: txt(raw.staticQrUrl, 500),
    staticQrNote: txt(raw.staticQrNote, 300) || DEFAULT_CATALOGUE_CONFIG.staticQrNote,
    welcomeText: txt(raw.welcomeText, 200) || DEFAULT_CATALOGUE_CONFIG.welcomeText,
  };
}

export function getCatalogueConfig(branch_id = 'sala') {
  return readJsonSetting(branch_id, CATALOGUE_KEY, sanitize, DEFAULT_CATALOGUE_CONFIG);
}

/**
 * Bản cho MÀN KHÁCH.
 *
 * QR lấy từ BỘ PHÂN GIẢI THANH TOÁN, không phải từ cấu hình riêng của catalogue.
 * Nhờ vậy cửa hàng bật/tắt cổng ở Cài đặt → Thanh toán là màn khách đổi theo
 * ngay, và không thể xảy ra cảnh catalogue hiện một mã còn màn phụ hiện mã khác.
 */
export function getPublicCatalogueConfig(branch_id = 'sala') {
  const congKhai = getCatalogueConfig(branch_id);
  const duong = resolveQrProvider(branch_id);
  return {
    ...congKhai,
    qrProvider: duong.provider,
    // Chỉ có ảnh sẵn khi đường đang chạy là QR TĨNH. Các đường còn lại sinh QR
    // theo từng bill nên màn khách phải gọi API lúc thanh toán, không có ảnh
    // dựng sẵn để cắm vào đây.
    staticQrUrl: duong.provider === 'static' ? duong.staticQrUrl : '',
    staticQrNote: duong.staticQrNote || congKhai.staticQrNote,
    tuDoiSoat: duong.tuDoiSoat,
  };
}

export function saveCatalogueConfig(body = {}, branch_id = 'sala') {
  const next = sanitize({ ...getCatalogueConfig(branch_id), ...body });
  writeJsonSetting(branch_id, CATALOGUE_KEY, next);
  audit('catalogue.config_save', { methods: next.methods, hasQr: !!next.staticQrUrl }, branch_id);
  emit('catalogue:config', { updated_at: now() }, branch_id);
  return next;
}
