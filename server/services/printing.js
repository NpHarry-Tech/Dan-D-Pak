// Print service: queues jobs, sends real ESC/POS LAN or OS-printer jobs,
// records errors, and keeps a full print history for monitor/reprint.
import { execFile } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import net from 'node:net';
import { promisify } from 'node:util';
import { db, uid, now, audit } from '../db.js';
import { emit } from '../realtime.js';
import { env } from '../config/env.js';
import { getPrintConfig } from './settings.js';
import { listSystemPrinters, getAgentDevices } from './system.js';
import { logSystem } from './systemLogs.js';
import { receiptTaxNote } from './tax.js';

const execFileAsync = promisify(execFile);
const STATION_PRINTER = { kitchen: 'kitchen', salad: 'kitchen', bar: 'bar', beverage: 'bar' };
const ESC_INIT = Buffer.from([0x1b, 0x40]);
const ESC_CUT = Buffer.from([0x1d, 0x56, 0x42, 0x00]);
const ESC_DRAWER = Buffer.from([0x1b, 0x70, 0x00, 0x19, 0xfa]);

// ÉP MÁY IN VỀ TRẠNG THÁI CHUẨN trước mỗi phiếu. `ESC @` trên lý thuyết đã reset
// hết, nhưng rất nhiều máy in nhiệt hàng clone KHÔNG reset cỡ chữ và canh lề —
// máy giữ nguyên trạng thái của job trước (hoặc của phần mềm khác vừa in). Đó là
// lý do phiếu ra một cột hẹp giữa tờ K80: chữ còn kẹt ở chế độ phóng to.
//   ESC ! 0  chế độ in: font A, không đậm, KHÔNG nhân đôi cao/rộng
//   GS  ! 0  cỡ ký tự 1x1 (đây mới là lệnh gỡ phóng to 2x/4x)
//   ESC a 0  canh trái (server tự căn giữa bằng dấu cách, máy canh giữa nữa là lệch)
//   ESC 2    giãn dòng mặc định
const ESC_RESET = Buffer.from([
  0x1b, 0x21, 0x00,
  0x1d, 0x21, 0x00,
  0x1b, 0x61, 0x00,
  0x1b, 0x32,
]);

const TYPE_LABEL = {
  kitchen_ticket: 'Lên món / Phiếu bếp',
  receipt: 'Hóa đơn / Tạm tính',
  cup_label: 'Tem ly',
  product_label: 'Tem sản phẩm',
  runner: 'Phiếu chạy món',
  test: 'In thử',
  cash_drawer: 'Mở két tiền',
  inventory_document: 'Phiếu kho',
  purchase: 'Phiếu mua hàng',
  refund: 'Hoàn / trả hàng',
};

function parsePayload(raw) {
  try { return JSON.parse(raw || '{}') || {}; } catch { return {}; }
}

// Bỏ bớt dữ liệu ảnh nhúng (logo base64, có thể ~250KB/ảnh) khỏi print_config
// TRƯỚC KHI nhúng vào payload job/hóa đơn lưu trữ. renderEl() (bên dưới) chỉ in
// placeholder "[LABEL]" cho phần tử type=image, KHÔNG BAO GIỜ đọc el.src/
// originalSrc — nên giữ nguyên chỉ làm phình to mỗi dòng print_jobs/mỗi hóa đơn
// lưu trữ mà không ích gì. Đây là nguyên nhân sự cố CPU 100% do agent poll mỗi
// 1.5s phải JSON.parse hàng chục dòng, mỗi dòng cõng thêm một bản sao ảnh logo.
function stripTemplateImages(tpl) {
  if (!tpl || typeof tpl !== 'object') return tpl;
  const stripEls = (arr) => Array.isArray(arr)
    ? arr.map(el => (el && el.type === 'image') ? { ...el, src: '', originalSrc: '' } : el)
    : arr;
  return { ...tpl, elements: stripEls(tpl.elements), rows: stripEls(tpl.rows) };
}
export function printConfigForJob(cfg) {
  if (!cfg || typeof cfg !== 'object') return cfg;
  const templates = cfg.templates || {};
  return {
    ...cfg,
    templates: {
      ...templates,
      bill: stripTemplateImages(templates.bill),
      label: stripTemplateImages(templates.label),
    },
  };
}

function printerRows(branch_id = 'sala') {
  const cfg = getPrintConfig(branch_id);
  return Array.isArray(cfg.printers) ? cfg.printers : [];
}

function printerById(printer, branch_id = 'sala') {
  return printerRows(branch_id).find(p => p.id === printer) || null;
}

function printerTarget(p = {}) {
  if (p.connection === 'lan') return `${p.ip || ''}:${p.port || 9100}`;
  if (p.connection === 'system') return p.systemName || p.name || '';
  return 'browser';
}

// ── Máy in thuộc MÁY NÀO ────────────────────────────────────────────────────
// Máy in cắm THẲNG vào một máy POS (connection 'system') chỉ máy đó in được.
// Hardware Agent trên từng máy báo lên danh sách máy in Windows nó thấy
// (setAgentPrinters), nên ghép theo TÊN máy in là biết tuyến nào cắm ở máy nào.
// Máy in LAN nằm trên mạng, không thuộc riêng máy nào.
function printerKey(p = {}) {
  return String(p.systemName || p.name || '').trim().toLowerCase();
}

/** Tên máy in (chữ thường) mà MỘT máy đang báo là nó thấy. */
function deviceOwnPrinterNames(branch_id, deviceId) {
  const me = String(deviceId || '').trim();
  if (!me) return new Set();
  const device = getAgentDevices(branch_id).find(d => d.device_id === me);
  return new Set((device?.printers || []).map(p => String(p.name || '').trim().toLowerCase()));
}

/** Tuyến in này có cắm thẳng vào máy đang hỏi không? */
function isAttachedTo(printer, ownNames) {
  if ((printer?.connection || 'browser') !== 'system') return false;
  const key = printerKey(printer);
  return !!key && ownNames.has(key);
}

/**
 * Tìm tuyến in THẬT cho một loại phiếu.
 *
 * VÌ SAO CẦN: trước đây mọi hook in đều ghi CỨNG id tuyến ('bill', 'kitchen',
 * 'bar', 'label', 'runner'). Cửa hàng tự tạo máy in với id khác (VD 'pos80c')
 * và xoá các tuyến mặc định → job trỏ tới id không còn tồn tại → pendingAgentJobs
 * coi là mồ côi và chuyển 'cancelled'. Triệu chứng thật: thanh toán xong, lịch sử
 * lệnh in hiện "Hóa đơn / Tạm tính — cancelled", máy in im lặng.
 *
 * Thứ tự ưu tiên:
 *   1. (chỉ khi preferDevice) tuyến cắm THẲNG vào máy đang thao tác — để máy POS 2
 *      in ra máy in của chính nó, không phải máy in của POS 1.
 *   2. (chỉ khi preferDevice) tuyến có máy chủ trì là chính máy này.
 *   3. Tuyến mang đúng id cũ (giữ tương thích cấu hình đang chạy).
 *   4. Bất kỳ tuyến nào cùng loại phiếu và đang bật.
 * Không có gì khớp → null (người gọi ghi log rõ ràng thay vì xếp job chết).
 */
export function resolvePrinterForOutput(output, branch_id = 'sala', {
  deviceId = '', legacyId = '', preferDevice = false, printers = null,
} = {}) {
  const rows = Array.isArray(printers) ? printers : printerRows(branch_id);
  const usable = rows.filter(p => p && p.active !== false);
  const sameOutput = usable.filter(p => p.output === output);

  if (preferDevice && deviceId) {
    const ownNames = deviceOwnPrinterNames(branch_id, deviceId);
    const attached = sameOutput.find(p => isAttachedTo(p, ownNames));
    if (attached) return attached;
    const primary = sameOutput.find(p => String(p.primaryDeviceId || '').trim() === String(deviceId).trim());
    if (primary) return primary;
  }

  if (legacyId) {
    const legacy = usable.find(p => p.id === legacyId);
    if (legacy) return legacy;
  }

  // Tuyến in được thật (lan/system) đứng trước tuyến 'browser' — tuyến browser
  // cần người bấm trong hộp thoại nên không bao giờ tự ra giấy.
  const configured = sameOutput.find(p => p.connection === 'lan' || p.connection === 'system')
    || sameOutput[0];
  if (configured) return configured;

  // CHƯA AI CẤU HÌNH TUYẾN NÀO → dùng thẳng máy in đang cắm vào máy này.
  //
  // Cấu hình tuyến là tính năng NÂNG CAO, dành cho cửa hàng có nhiều máy in
  // (bill/bếp/bar/tem) cần chia phiếu về đúng chỗ. Cửa hàng bình thường chỉ cắm
  // một máy in vào máy POS và mong nó in ngay. Bắt họ vào Cài đặt khai báo tuyến
  // trước khi in được cái bill đầu tiên là chặn nhầm chỗ — máy đã cắm máy in,
  // agent đã báo tên máy in đó lên, hệ thống thừa thông tin để tự in.
  return implicitDevicePrinter(branch_id, deviceId, output);
}

/** Tiền tố của tuyến in ngầm — dùng chung để dựng và để nhận lại. */
const IMPLICIT_PREFIX = 'auto:';

/**
 * Dựng lại tuyến ngầm từ chính id của nó (`auto:<device_id>:<tên máy in>`).
 * Chỉ chấp nhận khi máy in ĐÓ vẫn đang được máy ĐÓ báo lên — máy POS rút máy in
 * ra hoặc tắt app thì job phải rơi về mồ côi như thường, không in mò.
 */
function rebuildImplicit(printerId, devices = []) {
  const id = String(printerId || '');
  if (!id.startsWith(IMPLICIT_PREFIX)) return null;
  const rest = id.slice(IMPLICIT_PREFIX.length);
  const sep = rest.indexOf(':');
  if (sep < 0) return null;
  const deviceId = rest.slice(0, sep);
  const name = rest.slice(sep + 1);
  const device = devices.find(d => d.device_id === deviceId);
  const still = (device?.printers || [])
    .some(p => String(p.name || '').trim() === name);
  if (!still) return null;
  return {
    id, name, systemName: name, label: name,
    output: 'receipt', connection: 'system', active: true, auto: true,
    primaryDeviceId: deviceId, implicit: true,
  };
}

/**
 * Tuyến in NGẦM dựng từ máy in vật lý mà agent của máy này đã báo lên.
 * Không ghi vào print_config — cửa hàng vẫn thấy danh sách tuyến trống, và
 * ngày họ khai tuyến thật thì tuyến đó thắng ngay (nhánh trên chạy trước).
 */
function implicitDevicePrinter(branch_id, deviceId, output) {
  const devices = getAgentDevices(branch_id);
  const me = String(deviceId || '').trim();
  // Ưu tiên máy in của CHÍNH máy đang thao tác; không xác định được máy nào thì
  // lấy máy in của một máy bất kỳ đang chạy app, còn hơn là không in gì cả.
  const device = (me && devices.find(d => d.device_id === me)) || devices[0];
  const first = (device?.printers || [])[0];
  const name = String(first?.name || '').trim();
  if (!name) return null;
  return {
    id: `${IMPLICIT_PREFIX}${device.device_id}:${name}`,
    name,
    systemName: name,
    label: name,
    output,
    connection: 'system',
    active: true,
    auto: true,
    primaryDeviceId: device.device_id,
    // Đánh dấu để màn Máy in hiện "Tự nhận" thay vì giả vờ đây là tuyến đã khai.
    implicit: true,
  };
}

/** Tuyến in hóa đơn cho máy đang thanh toán. */
export function resolveReceiptPrinter(branch_id = 'sala', { deviceId = '' } = {}) {
  return resolvePrinterForOutput('receipt', branch_id, {
    deviceId, legacyId: 'bill', preferDevice: true,
  });
}

function money(n) {
  return `${Math.round(Number(n) || 0).toLocaleString('vi-VN')}đ`;
}

function ascii(s) {
  return String(s ?? '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .replace(/[^\x09\x0a\x0d\x20-\x7e]/g, '');
}

function center(text, width = 40) {
  const s = ascii(text).slice(0, width);
  const pad = Math.max(0, Math.floor((width - s.length) / 2));
  return ' '.repeat(pad) + s;
}

function line(ch = '-', width = 40) {
  return ch.repeat(width);
}

function wrap(text, width = 40) {
  const words = ascii(text).replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const rows = [];
  let cur = '';
  for (const w of words) {
    if (!cur) cur = w;
    else if ((cur + ' ' + w).length <= width) cur += ' ' + w;
    else { rows.push(cur); cur = w; }
  }
  if (cur) rows.push(cur);
  return rows.length ? rows : [''];
}

function itemMods(i = {}) {
  if (Array.isArray(i.mods)) return i.mods;
  try { return JSON.parse(i.mods_json || '[]').map(m => m.name || m); } catch { return []; }
}

function promoText(promo, { thermal = false } = {}) {
  if (!promo || typeof promo !== 'object' || !Object.keys(promo).length) return '';
  const name = promo.name || promo.code || 'Khuyen mai';
  const amount = Math.max(0, Math.round(Number(promo.amount) || 0));
  const freeUnits = Math.max(0, Math.round(Number(promo.free_units) || 0));
  const parts = [];
  if (amount > 0) parts.push(`giam ${thermal ? danMoney(amount) : money(amount)}`);
  if (freeUnits > 0) {
    const product = promo.free_product_name || 'san pham';
    parts.push(`tang ${freeUnits} ${product}`);
  }
  if (!parts.length && promo.description) return String(promo.description);
  return parts.length ? `${name}: ${parts.join(', ')}` : name;
}

function linePromoTotal(items = []) {
  return items.reduce((sum, item) => sum + Math.max(0, Math.round(Number(item?.promo?.amount) || 0)), 0);
}

function orderWideDiscount(p = {}) {
  const discount = Math.max(0, Math.round(Number(p.discount) || 0));
  return Math.max(0, discount - linePromoTotal(Array.isArray(p.items) ? p.items : []));
}

// Tem bếp dạng bill (khổ K80, 42 ký tự). Bố cục: Khu vực / Bàn / Giờ + Ngày /
// Nhân viên / Số thứ tự (= 3 số cuối Số Bill) / Tên món. Khi tách từng món thì
// payload chứa 1 món (p.name); chế độ gộp cũ vẫn render được qua p.items[].
function renderTicket(p = {}) {
  const W = 40;
  const rows = [
    '',
    center((p.zone || p.station || 'KHU VUC').toUpperCase()),
    center(p.table ? `BAN ${p.table}` : '-'),
    line(),
    center(`Gio: ${p.time || ''}    Ngay: ${p.date || ''}`.trim()),
    center(`Nhan vien: ${p.staff || '-'}`),
    center(`So thu tu: ${p.seq || ''}`),
  ];
  if (p.copy) rows.push(center(`(${p.copy})`));
  rows.push(line(), 'Ten mon');
  if (Array.isArray(p.items) && p.items.length) {
    for (const i of p.items) {
      rows.push(...wrap(`${i.qty || 1}x ${(i.name || '').toUpperCase()}`, W));
      const mods = itemMods(i);
      if (mods.length) rows.push(...wrap(`+ ${mods.join(', ')}`, W).map(x => '  ' + x));
      if (i.note) rows.push(...wrap(`Ghi chu: ${i.note}`, W).map(x => '  ' + x));
      rows.push(line('.', W));
    }
  } else {
    rows.push(...wrap((p.name || '').toUpperCase(), W));
    const mods = itemMods(p);
    if (mods.length) rows.push(...wrap(`+ ${mods.join(', ')}`, W).map(x => '  ' + x));
    if (p.note) rows.push(...wrap(`Ghi chu: ${p.note}`, W).map(x => '  ' + x));
  }
  return rows.join('\n');
}

function renderRunner(p = {}) {
  return [
    center('CHAY MON - BAN'),
    center(p.table || '-', 20),
    line(),
    ...wrap(p.name || '', 40),
    p.seq ? center(`phan ${p.seq}`) : '',
    ...(Array.isArray(p.mods) && p.mods.length ? wrap(`+ ${p.mods.join(', ')}`) : []),
    ...(p.note ? wrap(`NOTE: ${p.note}`) : []),
    line(),
    `#${p.order_no || ''} ${p.station || ''} ${p.time || ''}`.trim(),
  ].filter(Boolean).join('\n');
}

function renderLabel(p = {}) {
  const tpl = p.print_config?.templates?.label;
  if (tpl?.rows?.length) return renderTemplateRows(tpl, labelVars(p), { title: 'TEM NHAN' });
  if (tpl?.elements?.length) return renderTemplateText(tpl, labelVars(p), { title: 'TEM NHAN' });
  return [
    center('TEM'),
    line(),
    ...wrap(p.itemName || p.name || '', 40),
    p.options ? `+ ${ascii(p.options)}` : '',
    p.note ? `NOTE: ${ascii(p.note)}` : '',
    line(),
    `${p.order_no || ''} ${p.table || ''} ${p.time || ''}`.trim(),
  ].filter(Boolean).join('\n');
}

function methodLabel(m) {
  return { cash: 'Tien mat', card: 'May POS', qrcode: 'QR', qr: 'QR', voucher: 'Voucher', internet_banking: 'Internet Banking', momo: 'MoMo', zalopay: 'ZaloPay', visa: 'Visa' }[m] || m || '-';
}

function replaceVars(text = '', vars = {}) {
  return String(text || '').replace(/\{([a-zA-Z0-9_]+)\}/g, (_, key) => vars[key] ?? '');
}

function isReprintPayload(p = {}, job = {}) {
  return p.reprint === true || !!p.reprint_of || !!job.reprint_of;
}

function reprintMarkFor() {
  return ' (in lại)';
}

function markReceiptReprint(text = '') {
  const rows = String(text || '').split('\n');
  let marked = false;
  for (let i = 0; i < rows.length; i++) {
    const key = ascii(rows[i]).toUpperCase();
    if (!marked && key.includes('HOA DON') && !key.includes('SO HOA DON') && !key.includes('IN LAI')) {
      rows[i] += reprintMarkFor(rows[i]);
      marked = true;
    }
  }
  if (!marked) {
    const i = rows.findIndex(row => ascii(row).trim());
    if (i >= 0 && !ascii(rows[i]).toUpperCase().includes('IN LAI')) rows[i] += reprintMarkFor(rows[i]);
  }
  return rows.join('\n');
}

function templateWidthChars(tpl = {}) {
  const widthMm = Number(tpl.widthMm) || 72;
  if (widthMm <= 40) return 24;
  if (widthMm <= 58) return 32;
  return 40;
}

// Số ký tự/dòng THẬT của khổ giấy, theo font A của máy in nhiệt (12 dot/ký tự):
// giấy 58mm in được 48mm → 32 ký tự; giấy 80mm in được 72mm → 48 ký tự.
// Dùng cho phiếu do server tự dựng (in thử, phiếu kho...) để chữ trải đúng bề
// ngang tờ giấy. KHÔNG dùng cho mẫu bill — mẫu đó người dùng tự thiết kế theo
// templateWidthChars/DAN_W, đổi bề ngang sẽ phá bố cục họ đã căn.
function paperWidthCharsFrom(bill = {}) {
  const mm = Number(bill.widthMm) || (String(bill.paper || '').toUpperCase() === 'K58' ? 48 : 72);
  if (mm <= 34) return 24;
  if (mm <= 50) return 32;
  return 48;
}

// Render ONE template element/row into monospace lines pushed onto `out`.
// Shared by renderTemplateText (positioned elements) and renderTemplateRows
// (KiotViet-style ordered rows) so both stay pixel-identical to the printout.
function renderEl(el = {}, vars = {}, W = 40, out = []) {
  if (el.hidden) return out;
  const type = String(el.type || 'text');
  if (type === 'line') {
    out.push(line('-', W));
    return out;
  }
  if (type === 'image') {
    out.push(center(`[${ascii(el.label || 'IMAGE')}]`, W));
    return out;
  }
  if (type === 'qr') {
    const value = replaceVars(el.qrText || el.text || '{billNo}', vars);
    out.push(center(`[QR ${value}]`, W));
    if (el.qrShowCaption !== false && el.qrCaption) out.push(center(replaceVars(el.qrCaption, vars), W));
    return out;
  }
  if (type === 'barcode') {
    const value = replaceVars(el.barcodeText || el.text || '{billNo}', vars);
    out.push(center(`[BARCODE ${value}]`, W));
    return out;
  }
  const text = replaceVars(el.text || '', vars);
  const align = el.align || 'left';
  for (const paragraph of String(text).split('\n')) {
    for (const row of wrap(paragraph, W)) {
      out.push(align === 'center' ? center(row, W) : align === 'right' ? rightPad(row, W) : ascii(row));
    }
  }
  return out;
}

// Legacy positioned template: sort elements by y then x before rendering.
function renderTemplateText(tpl = {}, vars = {}, { title = 'PRINT' } = {}) {
  const W = templateWidthChars(tpl);
  const rows = [];
  const elements = [...(Array.isArray(tpl.elements) ? tpl.elements : [])]
    .sort((a, b) => (Number(a.y) || 0) - (Number(b.y) || 0) || (Number(a.x) || 0) - (Number(b.x) || 0));
  for (const el of elements) renderEl(el, vars, W, rows);
  const body = rows.filter(row => String(row).trim() !== '').join('\n');
  return body || center(title, W);
}

// New KiotViet-style template: render `rows` in list order (no positioning).
function renderTemplateRows(tpl = {}, vars = {}, { title = 'PRINT' } = {}) {
  const W = templateWidthChars(tpl);
  const rows = [];
  for (const el of Array.isArray(tpl.rows) ? tpl.rows : []) renderEl(el, vars, W, rows);
  const body = rows.filter(row => String(row).trim() !== '').join('\n');
  return body || center(title, W);
}

function receiptVars(p = {}) {
  const tpl = p.print_config?.templates?.bill || {};
  const W = templateWidthChars(tpl);
  const cfg = p.print_config?.bill || {};
  const d = p.paid_at || p.created_at ? new Date(p.paid_at || p.created_at) : new Date();
  const pad = (n) => String(n).padStart(2, '0');

  // Align items just like client danBillVars
  const items = (p.items || []).map(i => {
    const qty = Number(i.qty) || 1;
    const price = Number(i.unit_price ?? i.price) || 0;
    const nameW = W - 25; // e.g. 17 for W=42, 15 for W=40
    const nameLines = wrap(i.name || '', W);
    const figures = ' '.repeat(Math.max(0, nameW))
      + ' ' + String(qty).padStart(2)
      + ' ' + danMoney(price).padStart(9)
      + ' ' + danMoney(price * qty).padStart(10);
    const promo = promoText(i.promo, { thermal: true });
    const promoLines = promo ? wrap(`  KM: ${promo}`, W) : [];
    return [...nameLines, figures, ...promoLines].join('\n');
  }).join('\n');

  const storeName = cfg.storeName || p.branch || 'DAN D PAK';
  const storeSubtitle = cfg.storeSubtitle || '';
  const footer = cfg.footer || 'Xin cam on va hen gap lai';
  const taxNote = receiptTaxNote(cfg);
  const qrNote = cfg.qrNote || '';
  const showQr = cfg.showQr !== '0' && !p.preview;

  const lines = Array.isArray(p.lines) ? p.lines : [];
  const total = Number(p.total) || 0;
  const vatAmount = Number(p.vat_amount ?? p.tax?.vat_amount) || 0;
  const subtotal = Number(p.subtotal) || 0;
  const orderDiscount = orderWideDiscount(p);
  const orderPromoName = p.voucher?.name || p.voucher_code || 'Giam gia toan bill';
  const linesPaid = lines.reduce((s, l) => s + (Number(l.amount) || 0), 0);
  const paid = Number(p.paid ?? (linesPaid || total)) || 0;
  const change = Number(p.change ?? Math.max(0, paid - total)) || 0;
  const reprint = isReprintPayload(p);

  const billNo = p.bill_no || p.number || '';

  const paymentLines = lines.length
    ? lines.map(l => rightPad(`${danMethod(l.method)}(VND) - ${danMoney(l.amount)}`, W)).join('\n')
    : '';

  const customer = p.customer || {};
  const isInvoice = !!(customer.tax_code || customer.invoice_request);
  let customerInfoBlock = '';
  if (isInvoice) {
    const linesArr = [];
    if (customer.name) linesArr.push(`Khach hang: ${customer.name}`);
    if (customer.company) linesArr.push(`Cong ty: ${customer.company}`);
    if (customer.tax_code) linesArr.push(`MST: ${customer.tax_code}`);
    if (customer.address) linesArr.push(`Dia chi: ${customer.address}`);
    if (customer.email) linesArr.push(`Email: ${customer.email}`);
    if (customer.phone) linesArr.push(`SDT: ${customer.phone}`);
    customerInfoBlock = linesArr.join('\n');
  } else {
    const linesArr = [`Khach hang: ${customer.name || 'Ban cho nguoi tieu dung'}`];
    if (customer.phone) linesArr.push(`SDT: ${customer.phone}`);
    customerInfoBlock = linesArr.join('\n');
  }

  return {
    storeName,
    storeNameC: center(storeName, W),
    storeSubtitle,
    storeSubtitleC: center(storeSubtitle, W),
    address: cfg.address || '',
    addressBlock: wrap(cfg.address || '', W).join('\n'),
    phone: cfg.phone || '',
    email: cfg.email || '',
    taxCode: cfg.taxCode || '',
    billTitle: `HÓA ĐƠN THANH TOÁN${reprint ? ' (in lại)' : ''}`,
    billTitleAscii: `HOA DON THANH TOAN${reprint ? ' (in lai)' : ''}`,
    reprintMark: reprint ? '(in lại)' : '',
    reprintMarkAscii: reprint ? '(in lai)' : '',
    billNo,
    number: billNo,
    place: p.table_code ? `Ban ${p.table_code}` : (p.channel || 'POS'),
    cashier: p.cashier || '',
    date: `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`,
    timeOnly: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
    time: `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`,
    timeIn: p.created_at ? danDateTime(p.created_at) : '',
    timeOut: p.paid_at ? danDateTime(p.paid_at) : '',
    items,
    subtotal: money(subtotal),
    subtotalLine: labelValue('THANH TIEN:', danMoney(subtotal), W),
    vatAmount: money(vatAmount),
    vatLine: vatAmount > 0 ? labelValue('TRONG DO VAT:', danMoney(vatAmount), W) : '',
    orderPromoName,
    orderPromoAmount: money(orderDiscount),
    orderPromoLine: orderDiscount > 0 ? labelValue(`${orderPromoName}:`, `-${danMoney(orderDiscount)}`, W) : '',
    total: money(total),
    grandTotal: money(total),
    totalLine: labelValue('TONG TIEN:', danMoney(total), W),
    grandTotalLine: labelValue('TONG CONG:', danMoney(total), W),
    paymentLines,
    paidLine: labelValue('Tien khach dua:', danMoney(paid), W),
    changeLine: labelValue('Tien tra khach:', danMoney(change), W),
    method: lines.map(l => methodLabel(l.method)).join(', '),
    footer,
    footerC: center(footer, W),
    footerBrandC: center(`${storeSubtitle} ${storeName}`.trim(), W),
    taxNoteC: center(taxNote, W),
    noteBlock: p.note ? `Ghi chu: ${ascii(p.note)}` : '',
    qrNote,
    qrNoteC: showQr ? wrap(qrNote, W).map(l => center(l, W)).join('\n') : '',
    invoiceLookupUrl: p.invoice?.lookup_url || p.invoice?.lookup_code || billNo,
    customerName: customer.name || '',
    customerTaxCode: customer.tax_code || '',
    customerInfoBlock,
  };
}

function labelVars(p = {}) {
  return {
    orderNo: p.order_no || '',
    billNo: p.order_no || '',
    table: p.table || '',
    channel: p.channel || '',
    customer: p.customer || '',
    phone: p.phone || '',
    time: p.time || new Date().toLocaleTimeString('vi-VN'),
    itemName: p.itemName || p.name || '',
    name: p.itemName || p.name || '',
    options: p.options || '',
    note: p.note || '',
    qty: p.qty || '',
    copy: p.copy || '',
    barcode: p.barcode || p.order_no || p.itemName || '',
    price: p.price || '',
    code: p.code || '',
  };
}

// ---- Dan "HÓA ĐƠN THANH TOÁN" thermal receipt (42-col, ESC/POS ASCII) ----
const DAN_W = 42, DAN_NAME = 17, DAN_QTY = 2, DAN_PRICE = 9, DAN_AMT = 10;
function danMoney(n) { return (Math.round(Number(n) || 0)).toLocaleString('en-US').replace(/,/g, ' '); }
function danMethod(m) {
  return { cash: 'TIEN MAT', card: 'THE', visa: 'THE', qrcode: 'TRANSFER', qr: 'TRANSFER', bank_transfer: 'TRANSFER', internet_banking: 'TRANSFER', momo: 'MOMO', zalopay: 'ZALOPAY', voucher: 'VOUCHER' }[m] || (m ? String(m).toUpperCase() : 'TIEN MAT');
}
function rightPad(s, w = DAN_W) { s = ascii(s); return s.length >= w ? s : ' '.repeat(w - s.length) + s; }
function labelValue(label, value, w = DAN_W) {
  label = ascii(label); value = ascii(value);
  const gap = Math.max(1, w - label.length - value.length);
  return label + ' '.repeat(gap) + value;
}
function danDateTime(iso) {
  const d = iso ? new Date(iso) : new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}.${p(d.getMinutes())}`;
}
function danItemRow(i = {}) {
  const qty = Number(i.qty) || 1;
  const price = Number(i.unit_price ?? i.price) || 0;
  // Two rows per item (mirrors web/shared/danBill.js): full name on top, then
  // the figures below aligned under the SL / Đ.Giá / T.Tiền columns.
  const nameLines = wrap(i.name || '', DAN_W);
  const figures = ' '.repeat(DAN_NAME)
    + ' ' + String(qty).padStart(DAN_QTY)
    + ' ' + danMoney(price).padStart(DAN_PRICE)
    + ' ' + danMoney(price * qty).padStart(DAN_AMT);
  const promo = promoText(i.promo, { thermal: true });
  const promoLines = promo ? wrap(`  KM: ${promo}`, DAN_W) : [];
  return [...nameLines, figures, ...promoLines].join('\n');
}

function renderReceipt(p = {}) {
  const tpl = p.print_config?.templates?.bill;
  if (tpl?.rows?.length) return renderTemplateRows(tpl, receiptVars(p), { title: 'HOA DON' });
  if (tpl?.elements?.length) return renderTemplateText(tpl, receiptVars(p), { title: 'HOA DON' });
  const cfg = p.print_config?.bill || {};
  const rows = [];
  
  if (cfg.storeName || p.branch || 'DAN D PAK') {
    const wrapped = wrap(cfg.storeName || p.branch || 'DAN D PAK', 40);
    for (const lineText of wrapped) {
      rows.push(center(lineText, 40));
    }
  }
  
  if (cfg.address) {
    const wrapped = wrap(cfg.address, 40);
    for (const lineText of wrapped) {
      rows.push(center(lineText, 40));
    }
  }
  
  rows.push(line());
  if (p.preview) {
    rows.push(center('HOA DON TAM TINH', 40));
  } else {
    rows.push(center(`HOA DON #${p.number || ''}`, 40));
  }
  if (p.table_code) {
    rows.push(center(`Ban ${p.table_code}`, 40));
  }
  rows.push(line());
  
  for (const i of p.items || []) {
    const qty = Number(i.qty) || 1;
    const price = Number(i.unit_price) || 0;
    rows.push(...wrap(`${qty}x ${i.name || ''}`, 30));
    rows.push(`${money(price)} x ${qty}`.padEnd(22) + money(price * qty).padStart(18));
    const promo = promoText(i.promo);
    if (promo) rows.push(...wrap(`  KM: ${promo}`, 40));
  }
  
  rows.push(line());
  const vatAmount = Number(p.vat_amount ?? p.tax?.vat_amount) || 0;
  rows.push('THANH TIEN'.padEnd(22) + money(p.subtotal || 0).padStart(18));
  if (vatAmount > 0) rows.push('TRONG DO VAT'.padEnd(22) + money(vatAmount).padStart(18));
  const orderDiscount = orderWideDiscount(p);
  if (orderDiscount > 0) {
    const label = p.voucher?.name || p.voucher_code || 'KM TOAN BILL';
    rows.push(...wrap(label, 22).map((x, idx) => idx === 0
      ? x.padEnd(22) + ('-' + money(orderDiscount)).padStart(18)
      : x));
  }
  rows.push('TONG CONG'.padEnd(22) + money(p.total || 0).padStart(18));
  if (Array.isArray(p.lines) && p.lines.length) {
    for (const l of p.lines) {
      rows.push(`${methodLabel(l.method)}`.padEnd(22) + money(l.amount).padStart(18));
    }
  }
  rows.push(line());
  if (p.note) rows.push(...wrap(`Ghi chu: ${p.note}`, 40));
  
  const footerText = cfg.footer || 'Cam on quy khach';
  const wrappedFooter = wrap(footerText, 40);
  for (const lineText of wrappedFooter) {
    rows.push(center(lineText, 40));
  }
  
  return rows.join('\n');
}

// KHÔNG BAO GIỜ đổ JSON thô ra giấy. Bản cũ in
// `JSON.stringify(payload).slice(0, 1200)` nên phiếu in thử ra nguyên khối
// {"printer":{"id":"POS 2","systemName":"POS-80C",...} — vừa vô nghĩa với thu
// ngân, vừa lộ cấu hình máy in, vừa dài lê thê tốn giấy.
function renderGeneric(job, W = 40) {
  const p = job.payload || {};
  const rows = [
    center(TYPE_LABEL[job.type] || job.type || 'JOB IN', W),
    line('-', W),
  ];
  if (job.title) rows.push(...wrap(job.title, W));
  const fields = [
    ['Ban', p.table],
    ['Ma', p.ref],
    ['Ghi chu', p.note],
  ];
  for (const [label, value] of fields) {
    if (value) rows.push(...wrap(`${label}: ${value}`, W));
  }
  return rows.join('\n');
}

/**
 * Phiếu IN THỬ. Mục đích của nó là để người đứng máy nhìn tờ giấy mà biết ngay:
 * khổ giấy có khớp cấu hình không, chữ có đủ đậm không, in từ tuyến nào.
 * Vạch thước dưới cùng trải đúng bề ngang cấu hình — nếu nó bị xuống dòng thì
 * giấy hẹp hơn cài đặt, nếu nó hụt nhiều so với mép giấy thì giấy rộng hơn.
 */
function renderTest(job, W = 48, billCfg = {}) {
  const p = job.payload || {};
  const pr = p.printer || {};
  // Khổ giấy hiển thị phải lấy CÙNG NGUỒN với bề ngang W đang dùng để dựng
  // phiếu. Trước đó chữ đọc từ payload còn W tính từ cấu hình chi nhánh — hai
  // nguồn lệch nhau thì tờ giấy ghi "K80 72mm" trong khi đang in theo khổ K58,
  // tức chính tờ phiếu dùng để kiểm tra khổ giấy lại báo sai khổ giấy.
  const cfg = { ...(p.print_config?.bill || {}), ...billCfg };
  const target = pr.connection === 'lan'
    ? `${pr.ip || ''}:${pr.port || 9100}`
    : (pr.systemName || pr.name || '-');
  const paper = `${cfg.paper || 'K80'} ${cfg.widthMm || 72}mm ${W} ky tu`;
  const density = { light: 'Nhat', medium: 'Vua', dark: 'Dam', max: 'Rat dam' }[
    String(cfg.printDensity || 'dark').toLowerCase()] || 'Dam';

  // Nhãn + giá trị dài hơn bề ngang thì xuống dòng, không để tràn ra ngoài giấy.
  const field = (label, value) => {
    const l = ascii(label);
    const v = ascii(value);
    return l.length + v.length + 1 <= W ? [labelValue(l, v, W)] : [l, ...wrap(v, W)];
  };

  const rows = [
    center(ascii(cfg.storeName || 'DAN D PAK'), W),
    line('=', W),
    center('PHIEU IN THU', W),
    line('=', W),
    ...field('May in:', pr.label || pr.name || pr.id || '-'),
    ...field('Tuyen:', pr.id || '-'),
    ...field('Ket noi:', `${pr.connection || '-'} ${target}`),
    ...field('Kho giay:', paper),
    ...field('Do dam:', density),
    ...field('Thoi gian:', p.time || new Date().toLocaleString('vi-VN')),
    line('-', W),
    // Mọi dòng chữ đều phải cắt theo bề ngang — khổ K58 chỉ có 32 ký tự, để
    // nguyên câu dài thì máy in tự bẻ dòng lung tung, nhìn như in lỗi.
    ...wrap('Kiem tra chu co du dam va ro net khong:', W),
    ...wrap('AaBbCcDd 0123456789 .,:;!?-+*/=', W),
    ...wrap('Tieng Viet: Pho bo, Ca phe sua da, Tra dao', W),
    line('-', W),
    // Vạch thước: đánh dấu mỗi 10 ký tự để đối chiếu bề ngang giấy.
    ...wrap('Do be ngang giay bang vach duoi day:', W),
    Array.from({ length: W }, (_, i) => ((i + 1) % 10 === 0 ? '|' : '.')).join(''),
    Array.from({ length: Math.floor(W / 10) }, (_, i) => String((i + 1) * 10).padStart(10)).join(''),
    line('=', W),
    ...wrap('Neu doc duoc dong nay la may in DA CHAY', W).map(r => center(r, W)),
  ];
  return rows.filter(r => r !== null && r !== undefined).join('\n');
}

export function renderJobText(job, branch_id = 'sala') {
  const p = job.payload || {};
  if (job.type === 'kitchen_ticket') return renderTicket(p);
  if (job.type === 'runner') return renderRunner(p);
  if (job.type === 'receipt') {
    let text = renderReceipt(p);
    if (isReprintPayload(p, job)) text = markReceiptReprint(text);
    return text;
  }
  if (job.type === 'cup_label' || job.type === 'product_label') return renderLabel(p);
  // Phiếu do server tự dựng thì trải đúng bề ngang khổ giấy đã cấu hình. Đọc
  // cấu hình ĐÚNG MỘT LẦN rồi dùng chung cho cả bề ngang lẫn phần chữ hiển thị.
  const bill = getPrintConfig(job.branch_id || branch_id)?.bill || {};
  const W = paperWidthCharsFrom(bill);
  if (job.type === 'test') return renderTest(job, W, bill);
  return renderGeneric(job, W);
}

// Độ đậm bản in → lệnh ESC/POS PHỔ BIẾN & AN TOÀN (máy nào không hỗ trợ thì bỏ
// qua, không hỏng): ESC G n = double-strike (in 2 lần/điểm → đậm hơn),
// ESC E n = emphasized/bold. light/medium để mặc định máy; dark bật double-strike;
// max bật cả hai. Khớp 4 mức "sắc tố đen" ở trình thiết kế mẫu in.
function densityPrefix(density) {
  const on = (cmd) => Buffer.from([0x1b, cmd, 0x01]);
  switch (String(density || '').toLowerCase()) {
    case 'dark': return on(0x47);                                  // ESC G 1
    case 'max': return Buffer.concat([on(0x47), on(0x45)]);        // ESC G 1 + ESC E 1
    default: return Buffer.alloc(0);                               // light / medium
  }
}

function escposBuffer(text, { cut = true, drawer = false, density = '' } = {}) {
  return Buffer.concat([
    ESC_INIT,
    ESC_RESET,
    densityPrefix(density),
    Buffer.from(ascii(text) + '\n\n', 'utf8'),
    drawer ? ESC_DRAWER : Buffer.alloc(0),
    cut ? ESC_CUT : Buffer.alloc(0),
  ]);
}

// Real reachability probe: opens a TCP socket to the printer (RAW/JetDirect
// port 9100 by default) and reports whether it actually answers. Cached briefly
// so the live status panel polling every few seconds doesn't hammer the network.
const lanProbeCache = new Map(); // "ip:port" -> { at, reachable }
const LAN_PROBE_TTL = 8000;

function probeLan(host, port, timeoutMs = 1200) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (reachable) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { socket.destroy(); } catch {}
      resolve(reachable);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    const socket = net.createConnection({ host, port: Number(port) || 9100 });
    socket.on('connect', () => finish(true));
    socket.on('error', () => finish(false));
  });
}

async function probeLanCached(host, port, force = false) {
  const key = `${host}:${Number(port) || 9100}`;
  const cached = lanProbeCache.get(key);
  if (!force && cached && Date.now() - cached.at < LAN_PROBE_TTL) return cached.reachable;
  const reachable = await probeLan(host, port);
  lanProbeCache.set(key, { at: Date.now(), reachable });
  return reachable;
}

function writeLan(host, port, buffer, timeoutMs = 4500) {
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
    const timer = setTimeout(() => finish(new Error(`Không kết nối được máy in LAN ${host}:${port}`)), timeoutMs);
    socket.on('connect', () => socket.write(buffer, (err) => err ? finish(err) : socket.end()));
    socket.on('close', () => finish());
    socket.on('error', finish);
  });
}

// Gửi NGUYÊN BYTE (datatype RAW) xuống spooler Windows.
//
// VÌ SAO PHẢI RAW: Out-Printer đưa văn bản cho DRIVER Windows tự dàn trang và
// vẽ chữ thành ảnh xám có khử răng cưa. Máy in nhiệt chỉ in được đen/trắng nên
// nó phải "rải hạt" ảnh xám đó ra → chữ RẤT MỜ, lem, sai bề ngang, và mọi lệnh
// ESC/POS (độ đậm, cắt giấy, mở két) bị nuốt vì driver coi chúng là văn bản.
// Sự cố thật 2026-07-30: phiếu in thử ra chữ mờ đến mức khó đọc trên POS-80C.
// RAW đi thẳng tới firmware máy in, đúng đường mà máy in nhiệt được thiết kế.
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
  const dir = mkdtempSync(join(tmpdir(), 'dandpak-raw-'));
  const file = join(dir, 'job.bin');
  writeFileSync(file, buffer);
  try {
    await execFileAsync('powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', RAW_PRINT_PS],
      {
        timeout: 15000, windowsHide: true,
        env: { ...process.env, DDP_JOB_FILE: file, DDP_PRINTER: String(name || '') },
      });
  } finally {
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  }
}

async function writeSystemPrinter(name, text, { raw = false, drawer = false, density = '' } = {}) {
  const safeName = String(name || '').replace(/[^a-zA-Z0-9\s\-_\\]/g, '');

  // Máy in nhiệt (raw): gửi nguyên byte ESC/POS. Tên máy in Windows có thể chứa
  // dấu tiếng Việt nên đường RAW dùng tên GỐC, không đi qua bộ lọc ký tự.
  if (raw) {
    const buffer = escposBuffer(text, { drawer, density });
    if (process.platform === 'win32') {
      await writeSystemPrinterRaw(name, buffer);
      return;
    }
    const rawDir = mkdtempSync(join(tmpdir(), 'dandpak-raw-'));
    const rawFile = join(rawDir, 'job.bin');
    writeFileSync(rawFile, buffer);
    try {
      // CUPS: -o raw đẩy thẳng byte, không qua bộ lọc dàn trang.
      await execFileAsync('lp', ['-d', safeName, '-o', 'raw', rawFile], { timeout: 12000 });
    } finally {
      try { rmSync(rawDir, { recursive: true, force: true }); } catch {}
    }
    return;
  }

  // Máy in A4 qua driver (báo cáo): giữ nguyên đường cũ.
  const dir = mkdtempSync(join(tmpdir(), 'dandpak-print-'));
  const file = join(dir, 'job.txt');
  writeFileSync(file, ascii(text) + '\n', 'utf8');
  try {
    if (process.platform === 'win32') {
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

/** Tuyến này in máy in nhiệt (ESC/POS) hay máy in A4 qua driver? */
function isThermal(printer = {}) {
  return String(printer.output || '') !== 'report';
}

function patchJob(id, fields = {}) {
  const keys = Object.keys(fields);
  if (!keys.length) return getJob(id);
  const sets = keys.map(k => `${k}=?`).join(',');
  db.prepare(`UPDATE print_jobs SET ${sets} WHERE id=?`).run(...keys.map(k => fields[k]), id);
  return getJob(id);
}

function publicJob(j) {
  if (!j) return null;
  const payload = j.payload || parsePayload(j.payload_json);
  const meta = jobMeta({ ...j, payload });
  return { ...j, payload, meta };
}

export function getJob(id) {
  return publicJob(db.prepare(`SELECT * FROM print_jobs WHERE id=?`).get(id));
}

export function getJobForBranch(id, branch_id = 'sala') {
  const job = getJob(id);
  if (!job) return null;
  if (job.branch_id !== branch_id) throw new Error('Print job không thuộc chi nhánh hiện tại');
  return job;
}

export function createJob({ printer, type, title, payload, branch_id = 'sala', reprint_of = null }) {
  const id = uid('pj_');
  db.prepare(`
    INSERT INTO print_jobs (id,branch_id,printer,type,title,payload_json,status,created_at,reprint_of,attempts)
    VALUES (?,?,?,?,?,?,'queued',?,?,0)
  `).run(id, branch_id, printer, type, title || '', JSON.stringify(payload || {}), now(), reprint_of);
  const job = getJob(id);
  emit('print:new', job, branch_id);
  const p = printerById(printer, branch_id);
  // Ở chế độ 'agent', server (trên VPS) KHÔNG tự in — chỉ xếp hàng + emit;
  // Hardware Agent tại cửa hàng nhận job và in trên máy in LAN/USB tại chỗ.
  if (env.PRINT_DISPATCH !== 'agent' &&
      p?.active !== false && p?.auto && p?.connection && p.connection !== 'browser') {
    setTimeout(() => dispatchJob(id, branch_id).catch((e) => {
      // Trước đây nuốt lỗi hoàn toàn — 1 job kẹt do lỗi dispatch (không phải lỗi
      // in vật lý, cái đó đã có nhánh catch riêng ghi log/emit print:failed) sẽ
      // không để lại dấu vết nào để biết mà kiểm tra.
      logSystem({
        level: 'warn', source: 'printer', eventType: 'print_dispatch_error',
        title: `Không tự động gửi job in được: ${id}`,
        message: e?.message || String(e), branchId: branch_id,
        action: 'print:dispatch', extra: { job: id, printer },
      });
    }), 25);
  }
  return job;
}

/// In TEM MÃ sản phẩm (nút "In tem mã" trong Kho hàng): tìm máy in tem đã
/// cấu hình (output product_label, fallback cup_label/tên có "tem"), tạo
/// [copies] job type 'product_label' — Hardware Agent/máy in local sẽ in.
export function printProductLabel(branch_id = 'sala', { sku_id = '', sku = {}, copies = 1 } = {}) {
  if (sku_id && !sku.name) {
    sku = db.prepare(`SELECT id, name, code, barcode, price FROM skus WHERE id=?`).get(String(sku_id)) || {};
    if (!sku.id) {
      const e = new Error('Không tìm thấy sản phẩm để in tem');
      e.status = 404;
      throw e;
    }
  }
  const printers = printerRows(branch_id);
  const byOutput = (out) => printers.find(p => p.active !== false && p.output === out);
  const printer = byOutput('product_label') ||
      byOutput('cup_label') ||
      printers.find(p => p.active !== false &&
          /tem|label/i.test(`${p.id} ${p.name} ${p.type}`));
  if (!printer) {
    const e = new Error('Chưa cấu hình máy in tem — thêm máy in loại "Tem nhãn" trong Cài đặt');
    e.status = 400;
    throw e;
  }
  const n = Math.max(1, Math.min(30, parseInt(copies) || 1));
  const name = String(sku.name || '');
  const payload = {
    itemName: name,
    code: String(sku.code || ''),
    barcode: String(sku.barcode || sku.code || ''),
    price: sku.price ? `${Math.round(Number(sku.price) || 0).toLocaleString('vi-VN')}d` : '',
    qty: 1,
  };
  const jobs = [];
  for (let i = 0; i < n; i++) {
    jobs.push(createJob({
      printer: printer.id,
      type: 'product_label',
      title: `Tem: ${name}`.slice(0, 120),
      payload: { ...payload, copy: n > 1 ? `${i + 1}/${n}` : '' },
      branch_id,
    }));
  }
  return { ok: true, printer: printer.id, jobs: jobs.length };
}

export function listJobs(branch_id = 'sala', query = {}) {
  const limit = Math.max(1, Math.min(300, parseInt(query.limit || query) || 120));
  return db.prepare(`SELECT * FROM print_jobs WHERE branch_id=? ORDER BY created_at DESC LIMIT ?`).all(branch_id, limit).map(publicJob);
}

// print_jobs tăng vô hạn (mỗi lần in = 1 dòng, payload_json to). Dọn định kỳ để
// bảng không phình → truy vấn danh sách/agent-poll luôn nhanh. Job >30 ngày là rác
// (kể cả còn 'queued' thì máy in đã offline cả tháng). Mirror maintainSystemLogs.
export function maintainPrintJobs({ days = 30, maxRows = 50_000 } = {}) {
  try {
    const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
    const byAge = db.prepare(`DELETE FROM print_jobs WHERE created_at < ?`).run(cutoff).changes;
    let byCount = 0;
    const total = db.prepare(`SELECT COUNT(*) n FROM print_jobs`).get().n;
    if (total > maxRows) {
      byCount = db.prepare(
        `DELETE FROM print_jobs WHERE id IN (
           SELECT id FROM print_jobs ORDER BY created_at ASC LIMIT ?)`
      ).run(total - maxRows).changes;
    }
    return { removedByAge: byAge, removedByCount: byCount };
  } catch {
    return { removedByAge: 0, removedByCount: 0 };
  }
}

export async function listPrinters(branch_id = 'sala', {
  live = false, force = false, deviceId = '', scope = 'all',
} = {}) {
  const configured = printerRows(branch_id);
  const agentMode = env.PRINT_DISPATCH === 'agent';

  // Máy in cắm thẳng: TRẠNG THÁI LẤY TỪ AGENT, không cần `live`.
  // Trước đây khi thiếu live=1 thì mọi tuyến trả về 'ready'/online:true vô điều
  // kiện — nên tablet luôn thấy "Sẵn sàng" dù máy POS còn chưa mở app, bấm In thử
  // thì lệnh nằm chờ tới lúc mở máy in mới ra giấy. getAgentDevices() đọc Map
  // trong RAM (không I/O) nên soi được thật mà vẫn nhẹ như cũ.
  const devices = agentMode ? getAgentDevices(branch_id) : [];
  const ownerByName = new Map(); // tên máy in (lower) -> { device, printer }
  for (const d of devices) {
    for (const sp of d.printers || []) {
      const key = String(sp.name || '').trim().toLowerCase();
      if (!key || ownerByName.has(key)) continue;
      ownerByName.set(key, { device: d, printer: sp });
    }
  }
  const me = String(deviceId || '').trim();
  const myNames = me ? deviceOwnPrinterNames(branch_id, me) : new Set();

  const system = !agentMode && live && configured.some(p => (p.connection || 'browser') === 'system')
    ? await listSystemPrinters({ force, branch: branch_id }).catch(() => [])
    : [];
  const systemMap = new Map(system.map(p => [String(p.name || '').toLowerCase(), p]));

  const rows = await Promise.all(configured.map(async p => {
    const connection = p.connection || 'browser';
    const key = printerKey(p);
    const owner = connection === 'system' ? ownerByName.get(key) : null;
    const match = systemMap.get(key) || owner?.printer || null;
    const target = printerTarget(p);
    const attachedToMe = isAttachedTo(p, myNames);

    // status: machine-readable (kept backward compatible with Printer Monitor).
    // state: pill colour for the live panel. statusText: human label, real-data.
    let status = 'ready', state = 'ok', statusText = '';
    let online = false;

    if (p.active === false) {
      status = 'disabled'; state = 'warn'; statusText = 'Tạm tắt'; online = false;
    } else if (connection === 'system' && agentMode) {
      // Nguồn sự thật duy nhất: máy POS đang cắm máy in này có đang chạy app/agent?
      const name = p.systemName || p.name || '';
      if (!name) {
        status = 'not_configured'; state = 'bad'; statusText = 'Chưa chọn máy in trên máy POS'; online = false;
      } else if (!owner) {
        status = 'offline'; state = 'bad'; online = false;
        statusText = `Máy POS chưa mở app · không thấy "${name}"`;
      } else if (owner.printer.online === false) {
        status = 'offline'; state = 'bad'; online = false;
        statusText = `Máy in tắt / ngoại tuyến · ${owner.device.device_name}`;
      } else {
        status = 'ready'; state = 'ok'; online = true;
        statusText = `Đã kết nối · ${owner.device.device_name}`;
      }
    } else if (!live) {
      status = 'ready'; state = 'ok'; statusText = 'Chưa kiểm tra live'; online = true;
    } else if (connection === 'lan') {
      if (!p.ip) {
        status = 'not_configured'; state = 'bad'; statusText = 'Chưa nhập IP máy in LAN'; online = false;
      } else {
        const reachable = await probeLanCached(p.ip, p.port, force);
        online = reachable;
        status = reachable ? 'ready' : 'offline';
        state = reachable ? 'ok' : 'bad';
        statusText = reachable
          ? `Đã kết nối · ${p.ip}:${p.port || 9100}`
          : `Không phản hồi · ${p.ip}:${p.port || 9100}`;
      }
    } else if (connection === 'system') {
      const name = p.systemName || p.name || '';
      if (!name) {
        status = 'not_configured'; state = 'bad'; statusText = 'Chưa chọn máy in trên máy chủ'; online = false;
      } else if (!match) {
        status = 'offline'; state = 'bad'; statusText = `Không thấy "${name}" trên máy chủ`; online = false;
      } else if (match.online === false) {
        status = 'offline'; state = 'bad'; statusText = `Máy in tắt / ngoại tuyến · ${name}`; online = false;
      } else {
        status = 'ready'; state = 'ok'; statusText = `Đã kết nối · ${name}`; online = true;
      }
    } else {
      // browser: printing happens through the operator's print dialog.
      status = 'ready'; state = 'ok'; statusText = 'In qua trình duyệt'; online = true;
    }

    return {
      ...p, connection, target, online, status, state, statusText,
      system: match || null,
      // MÁY NÀO đang cắm tuyến này — để app hiện đúng "của máy nào" và để
      // chặn máy khác thao tác (xem assertPrinterUsableBy).
      owner_device_id: owner?.device.device_id || '',
      owner_device_name: owner?.device.device_name || '',
      attached_to_me: attachedToMe,
    };
  }));

  // Phạm vi 'device' — dùng cho người KHÔNG có quyền quản lý máy in (VD thu ngân
  // chỉ có quyền 'pay'). Chỉ thấy đúng những tuyến họ ĐƯỢC PHÉP thao tác:
  //   - máy in cắm THẲNG vào máy của họ, và
  //   - máy in LAN (thiết bị dùng chung trên mạng, không thuộc riêng máy nào).
  // Chốt này phải khớp CHÍNH XÁC với assertPrinterUsableBy — nếu danh sách hẹp
  // hơn quyền thao tác thì sinh ra tuyến "dùng được mà không thấy"; nếu rộng hơn
  // thì lại lộ máy in của máy khác (đúng lỗi đang phải sửa).
  if (scope === 'device') {
    return rows.filter(r => r.attached_to_me || r.connection === 'lan');
  }
  return rows;
}

/** Ai được coi là người QUẢN LÝ máy in (thấy hết + thao tác mọi tuyến). */
export function canManagePrinters(user, canUser) {
  if (!user) return false;
  if (user.role === 'owner') return true;
  return ['settings.manage', 'settings.printers', 'settings.connections', 'settings.print']
    .some(perm => canUser(user, perm));
}

/**
 * Chặn thao tác chéo máy: người KHÔNG quản lý máy in chỉ được bấm In thử / mở két
 * trên tuyến cắm thẳng vào máy của chính họ. Trước đây ai vào được danh mục "Máy in"
 * (kể cả chỉ có quyền 'pay') cũng in thử được lên máy in của máy POS khác.
 */
export function assertPrinterUsableBy(printerId, branch_id, { privileged = false, deviceId = '' } = {}) {
  const printer = printerById(printerId, branch_id);
  if (!printer) {
    const e = new Error('Máy in chưa được cấu hình');
    e.status = 404;
    throw e;
  }
  if (privileged) return printer;
  const connection = printer.connection || 'browser';
  // Tuyến LAN dùng chung trên mạng → không thuộc riêng máy nào, vẫn cho dùng.
  if (connection !== 'system') return printer;
  const me = String(deviceId || '').trim();
  if (me && isAttachedTo(printer, deviceOwnPrinterNames(branch_id, me))) return printer;
  const e = new Error('Máy in này không cắm vào máy bạn đang dùng — chỉ Quản lý/Admin thao tác được từ máy khác.');
  e.status = 403;
  throw e;
}

export function jobMeta(job) {
  const p = job.payload || {};
  const items = Array.isArray(p.items) ? p.items : [];
  const first = items[0] || {};
  const table = p.table || p.table_code || p.tableCode || '';
  const ref = p.order_no || p.number || p.order_id || p.ref || '';
  return {
    action: TYPE_LABEL[job.type] || job.type || 'Job in',
    table,
    ref,
    station: p.station || job.printer || '',
    item_count: items.length || (p.itemName || p.name ? 1 : 0),
    item_preview: items.length ? `${first.qty || 1}x ${first.name || ''}` : (p.itemName || p.name || job.title || ''),
    amount: p.total || p.amount || null,
  };
}

export async function dispatchJob(id, branch_id = 'sala', { force = false } = {}) {
  let job = getJob(id);
  if (!job) throw new Error('Print job không tồn tại');
  if (job.branch_id !== branch_id) throw new Error('Print job không thuộc chi nhánh hiện tại');
  if (!force && job.status === 'printed') return job;
  const printer = printerById(job.printer, branch_id);
  if (!printer) throw new Error(`Chưa cấu hình tuyến máy in ${job.printer}`);
  if (printer.active === false) throw new Error(`Tuyến máy in ${printer.label || printer.id} đang tắt`);
  const connection = printer.connection || 'browser';
  const target = printerTarget(printer);

  // Chế độ agent: server nằm trên VPS, KHÔNG với tới máy in trong cửa hàng. Nút
  // "In ngay" (retail gọi sau thanh toán qua /print/jobs/:id/print) mà cứ in từ
  // server thì luôn thất bại → job bị đánh 'failed' oan rồi agent mới thử lại,
  // nên bill ra chậm và lịch sử in đầy lỗi giả. Đúng việc phải làm là ĐẨY LẠI
  // HÀNG ĐỢI và bỏ giữ chỗ để agent tại chỗ nhận ngay nhịp poll kế tiếp (1.5s).
  if (env.PRINT_DISPATCH === 'agent' && (connection === 'lan' || connection === 'system')) {
    job = patchJob(id, {
      status: 'queued', error: null, transport: connection, target,
      claimed_by: null, claimed_at: null,
    });
    emit('print:new', job, branch_id);
    return job;
  }

  const text = renderJobText(job);
  patchJob(id, {
    status: 'printing',
    attempts: Number(job.attempts || 0) + 1,
    last_attempt_at: now(),
    error: null,
    transport: connection,
    target,
  });
  try {
    if (connection === 'lan') {
      if (!printer.ip) throw new Error('Thiếu IP máy in LAN');
      await writeLan(printer.ip, printer.port || 9100, escposBuffer(text, {
        drawer: printer.openDrawerOnPrint && job.type === 'receipt',
        density: getPrintConfig(branch_id)?.bill?.printDensity,
      }));
    } else if (connection === 'system') {
      const name = printer.systemName || printer.name;
      if (!name) throw new Error('Thiếu tên máy in hệ điều hành');
      await writeSystemPrinter(name, text, {
        raw: isThermal(printer),
        drawer: printer.openDrawerOnPrint && job.type === 'receipt',
        density: getPrintConfig(branch_id)?.bill?.printDensity,
      });
    } else {
      throw new Error('Tuyến này đang để chế độ Trình duyệt, cần mở chi tiết để in bằng hộp thoại hệ thống');
    }
    job = patchJob(id, { status: 'printed', printed_at: now(), printed_by: 'server', error: null });
    emit('print:done', job, branch_id);
    audit('print.printed', { job: id, printer: job.printer, type: job.type, transport: connection, target }, branch_id);
    return job;
  } catch (e) {
    job = patchJob(id, { status: 'failed', error: e.message || String(e) });
    emit('print:failed', job, branch_id);
    logSystem({
      level: 'error', source: 'printer', eventType: 'print_failed',
      title: `In thất bại trên tuyến ${printer?.label || job.printer || '?'}`,
      message: job.error, branchId: branch_id,
      action: `print:${job.type}`, extra: { job: id, transport: connection, target },
    });
    throw e;
  }
}

// ── Hardware Agent (mô hình VPS trung tâm) ─────────────────────────────────
// Agent chạy tại cửa hàng: hỏi job đang chờ, in vật lý, báo lại kết quả.

// Các job cần agent in (tuyến lan/system, chưa in xong). Bao gồm cả 'failed'
// gần đây để agent tự thử lại sau khi máy in bị kẹt/tắt rồi bật lại.
// Hàng đợi agent TỪNG BỊ TẮC VĨNH VIỄN: quét cũ-nhất-trước rồi mới lọc, nên job
// trỏ tới tuyến in ĐÃ BỊ XOÁ khỏi cấu hình không giải được nhưng vẫn nằm
// 'queued' và chiếm hết cửa sổ quét. Gặp thật: 96 job cũ trỏ tuyến kitchen/bill/
// bar/runner (đã xoá khi cửa hàng đổi sang 1 tuyến "POS 2") che mất 2 job in thử
// mới nhất → thu ngân bấm "In thử" thấy báo đã gửi mà máy in im lặng cả tháng.
//
// Hai lớp chống tắc:
//   1. Quét rộng hơn số job cần trả, để vài job hỏng không bịt được đường.
//   2. Job có tuyến in KHÔNG CÒN trong cấu hình → chuyển 'cancelled' (trạng thái
//      cuối) vì nó không bao giờ in được nữa. Tuyến còn nhưng đang TẮT thì giữ
//      nguyên 'queued' — bật lại là in tiếp.
const AGENT_SCAN_WINDOW = 300;
// Giữ chỗ hết hạn sau 60s: agent chết giữa chừng thì job phải quay lại hàng đợi
// cho máy khác, chứ không kẹt vĩnh viễn.
const AGENT_CLAIM_TTL_MS = 60_000;

export function pendingAgentJobs(branch_id = 'sala', { limit = 40, deviceId = '' } = {}) {
  const want = Math.max(1, Math.min(100, limit));
  const me = String(deviceId || '').trim().slice(0, 120);
  const claimCutoff = new Date(Date.now() - AGENT_CLAIM_TTL_MS).toISOString();

  // CHỈ LẤY CỘT ĐỦ ĐỂ LỌC. Agent hỏi mỗi 1.5s và cửa sổ quét là 300 dòng — nếu
  // dựng job đầy đủ cho cả cửa sổ (JSON.parse payload + jobMeta cho từng dòng)
  // thì mỗi máy agent ngốn 300 lần phân tích JSON mỗi 1.5 giây. Trên VPS 1 nhân,
  // đó là chặn vòng lặp sự kiện đủ lâu để Socket.IO trượt nhịp ping → app rớt
  // kết nối liên tục. Job đầy đủ chỉ dựng cho những job THỰC SỰ trả về (tối đa
  // `want`). Cùng bài học với sự cố CPU 100% do getPrintConfig() gọi trong vòng lặp.
  const rows = db.prepare(
    `SELECT id, printer FROM print_jobs
      WHERE branch_id=? AND status IN ('queued','failed')
        AND (claimed_by IS NULL OR claimed_by='' OR claimed_by=? OR COALESCE(claimed_at,'') < ?)
      ORDER BY created_at ASC LIMIT ?`,
  ).all(branch_id, me, claimCutoff, AGENT_SCAN_WINDOW);

  // Nạp cấu hình in ĐÚNG 1 LẦN cho cả loạt job — trước đây resolveAgentJob() gọi
  // lại getPrintConfig() (đọc DB + JSON.parse + sanitize) cho TỪNG job, nên agent
  // hỏi hàng đợi mỗi 1.5s làm server lặp lại việc này tới ~40 lần/lần hỏi, tốn
  // gần 2 giây CPU liên tục 24/7 → nghẽn cứng cả server (đã gây sự cố thật).
  const printCfg = getPrintConfig(branch_id);
  const printers = Array.isArray(printCfg.printers) ? printCfg.printers : [];
  const printerById = new Map(printers.map(p => [p.id, p]));

  // Trạng thái các máy chạy agent cũng lấy ĐÚNG 1 LẦN, không hỏi lại theo từng job.
  const devices = getAgentDevices(branch_id);
  const onlineDeviceIds = new Set(devices.map(d => d.device_id));
  const myPrinterNames = new Set(
    (devices.find(d => d.device_id === me)?.printers || [])
      .map(p => String(p.name || '').trim().toLowerCase()));
  const meIsKnown = !!me && onlineDeviceIds.has(me);

  const out = [];
  const orphans = [];
  for (const row of rows) {
    // Tuyến 'auto:<device>:<tên máy in>' là tuyến NGẦM do hệ thống tự dựng từ
    // máy in cắm sẵn ở máy POS (xem implicitDevicePrinter). Nó không nằm trong
    // print_config nên phải dựng lại ở đây, nếu không job vừa tạo đã bị coi là
    // mồ côi và huỷ ngay — đúng lỗi cũ, chỉ khác nguyên nhân.
    const printer = printerById.get(row.printer) || rebuildImplicit(row.printer, devices);
    if (!printer) {
      orphans.push(row.id); // tuyến in đã bị xoá → job này không bao giờ in được
      continue;
    }
    if (printer.active === false) continue;
    const connection = printer.connection || 'browser';
    if (connection !== 'lan' && connection !== 'system') continue;

    // Máy in cắm THẲNG vào một máy (connection 'system') thì chỉ máy ĐÓ in được.
    // Máy khác nhận sẽ in lỗi rồi kéo job đã in thành công về 'failed' → in trùng.
    // Máy in LAN thì máy nào trong mạng cũng in được nên không lọc.
    if (connection === 'system' && meIsKnown) {
      const canName = String(printer.systemName || printer.name || '').trim().toLowerCase();
      if (canName && !myPrinterNames.has(canName)) continue;
    }

    // MÁY CHỦ TRÌ: nhiều máy POS cùng với tới một máy in thì phiếu phải luôn ra ở
    // ĐÚNG MỘT chỗ, không để "máy nào hỏi trước máy đó in". Chủ trì offline thì
    // nhường cho máy khác để không tắc bán hàng.
    const primary = String(printer.primaryDeviceId || '').trim();
    if (primary && me && primary !== me && onlineDeviceIds.has(primary)) continue;

    if (me && !claimJob(row.id, me, claimCutoff)) continue; // máy khác vừa giữ chỗ

    // Tới đây job chắc chắn được trả về — giờ mới dựng đầy đủ (parse payload,
    // render text). Tối đa `want` lần thay vì cả cửa sổ quét.
    const resolved = resolveAgentJobFast(getJob(row.id), printers, printCfg, devices);
    if (!resolved) continue;
    out.push(resolved);
    if (out.length >= want) break;
  }

  if (orphans.length) {
    const upd = db.prepare(
      `UPDATE print_jobs SET status='cancelled', error=? WHERE id=? AND status IN ('queued','failed')`);
    for (const id of orphans) {
      upd.run('Tuyến in không còn trong cấu hình — job đã huỷ tự động', id);
    }
    audit('print.jobs_cancelled_orphan', { count: orphans.length }, branch_id, 'system');
  }

  return out;
}


/** Giữ chỗ job cho đúng một máy. Trả false nếu máy khác vừa giữ trước. */
function claimJob(id, deviceId, claimCutoff) {
  const r = db.prepare(
    `UPDATE print_jobs SET claimed_by=?, claimed_at=?
      WHERE id=? AND status IN ('queued','failed')
        AND (claimed_by IS NULL OR claimed_by='' OR claimed_by=? OR COALESCE(claimed_at,'') < ?)`,
  ).run(deviceId, now(), id, deviceId, claimCutoff);
  return r.changes > 0;
}

function resolveAgentJobFast(job, printers, printCfg, devices = []) {
  if (!job) return null;
  // Tuyến ngầm (máy in cắm sẵn, chưa ai khai tuyến) không nằm trong print_config
  // nên phải dựng lại ở ĐÂY NỮA — vòng quét ngoài đã nhận nó, tới bước dựng job
  // mà tra lại danh sách cấu hình thì lại rơi về null và job im lặng biến mất.
  const printer = printers.find(p => p.id === job.printer)
    || rebuildImplicit(job.printer, devices);
  if (!printer || printer.active === false) return null;
  const connection = printer.connection || 'browser';
  return {
    id: job.id,
    type: job.type,
    connection,
    ip: printer.ip || '',
    port: printer.port || 9100,
    systemName: printer.systemName || printer.name || '',
    drawer: !!(printer.openDrawerOnPrint && job.type === 'receipt') || job.type === 'cash_drawer',
    text: renderJobText(job, job.branch_id),
    density: printCfg?.bill?.printDensity || 'dark',
    // Máy in nhiệt cắm USB phải nhận NGUYÊN BYTE ESC/POS, không đi qua driver
    // Windows (driver vẽ chữ thành ảnh xám → bản in rất mờ, mất lệnh cắt giấy).
    // Agent bản cũ không đọc cờ này thì giữ nguyên hành vi cũ — không vỡ gì.
    raw: isThermal(printer),
    created_at: job.created_at,
  };
}

// Gói mọi thứ agent cần để in 1 job: text đã render + đích + có mở két không.
function resolveAgentJob(job, branch_id) {
  if (!job) return null;
  const printer = printerById(job.printer, branch_id);
  if (!printer || printer.active === false) return null;
  const connection = printer.connection || 'browser';
  return {
    id: job.id,
    type: job.type,
    connection,
    ip: printer.ip || '',
    port: printer.port || 9100,
    systemName: printer.systemName || printer.name || '',
    drawer: !!(printer.openDrawerOnPrint && job.type === 'receipt') || job.type === 'cash_drawer',
    text: renderJobText(job, branch_id),
    density: getPrintConfig(branch_id)?.bill?.printDensity || 'dark',
    raw: isThermal(printer),
    created_at: job.created_at,
  };
}

export function agentJob(id, branch_id = 'sala') {
  const job = getJobForBranch(id, branch_id);
  return resolveAgentJob(job, branch_id);
}

// Agent gọi khi đã in xong / in lỗi trên máy in vật lý tại cửa hàng.
export function agentReportResult(id, branch_id, { ok, error } = {}) {
  const existing = getJob(id);
  if (!existing) throw new Error('Print job không tồn tại');
  if (existing.branch_id !== branch_id) throw new Error('Print job không thuộc chi nhánh hiện tại');
  if (ok) {
    const job = patchJob(id, { status: 'printed', printed_at: now(), printed_by: 'agent', error: null });
    emit('print:done', job, branch_id);
    audit('print.agent.printed', { job: id, printer: job?.printer, type: job?.type }, branch_id, 'agent');
    return job;
  }
  // KHÔNG lật ngược job đã in xong. Trước đây ghi 'failed' vô điều kiện, nên khi
  // hai máy cùng chạy agent: máy A in xong (printed) → máy B không có máy in đó
  // in lỗi → job bị kéo về 'failed' → vào lại hàng đợi → máy A in lần nữa → lặp
  // vô hạn, giấy ra chồng chất. Báo lỗi đến muộn chỉ được ghi log.
  if (existing.status === 'printed') {
    logSystem({
      level: 'warn', source: 'printer', eventType: 'print_late_failure',
      title: `Bỏ qua báo lỗi muộn cho job đã in xong (tuyến ${existing.printer || '?'})`,
      message: String(error || ''), branchId: branch_id, username: 'agent',
      action: `print:${existing.type}`, extra: { job: id },
    });
    return existing;
  }
  const job = patchJob(id, { status: 'failed', error: String(error || 'Agent in lỗi') });
  emit('print:failed', job, branch_id);
  logSystem({
    level: 'error', source: 'printer', eventType: 'print_failed',
    title: `Hardware Agent báo in lỗi (tuyến ${job?.printer || '?'})`,
    message: job?.error, branchId: branch_id, username: 'agent',
    action: `print:${job?.type}`, extra: { job: id },
  });
  return job;
}

export function markPrinted(id, branch_id = 'sala', actor = 'manual') {
  const existing = getJob(id);
  if (!existing) throw new Error('Print job không tồn tại');
  if (existing.branch_id !== branch_id) throw new Error('Print job không thuộc chi nhánh hiện tại');
  const job = patchJob(id, { status: 'printed', printed_at: now(), printed_by: actor, error: null });
  emit('print:done', job, branch_id);
  audit('print.mark_printed', { job: id, printer: job?.printer, type: job?.type }, branch_id, actor);
  return job;
}

export function reprint(id, branch_id = 'sala') {
  const j = getJob(id);
  if (!j) throw new Error('Print job không tồn tại');
  if (j.branch_id !== branch_id) throw new Error('Print job không thuộc chi nhánh hiện tại');
  audit('print.reprint', { job: id }, branch_id);
  const payload = { ...(j.payload || {}), reprint: true };
  if (j.type === 'receipt') payload.print_config = printConfigForJob(getPrintConfig(branch_id));
  return createJob({ printer: j.printer, type: j.type, title: `${j.title || ''} (in lại)`.trim(), payload, branch_id, reprint_of: id });
}

export async function testPrinter(printerId, branch_id = 'sala') {
  const p = printerById(printerId, branch_id);
  if (!p) throw new Error('Máy in chưa được cấu hình');
  const bill = getPrintConfig(branch_id)?.bill || {};
  const job = createJob({
    printer: printerId,
    type: 'test',
    title: `In thử ${p.label || p.id}`,
    payload: {
      ref: uid('test_'),
      time: new Date().toLocaleString('vi-VN'),
      printer: p,
      // CHỈ mấy trường phiếu in thử cần — không nhét cả print_config (có mẫu
      // bill + logo base64) vào payload, đó là nguyên nhân job in phình to.
      print_config: {
        bill: {
          storeName: bill.storeName || '',
          paper: bill.paper || 'K80',
          widthMm: bill.widthMm || 72,
          printDensity: bill.printDensity || 'dark',
        },
      },
    },
    branch_id,
  });
  // Chế độ agent: server không in trực tiếp — chỉ xếp hàng để agent cửa hàng in.
  if (env.PRINT_DISPATCH === 'agent') return getJob(job.id);
  return dispatchJob(job.id, branch_id, { force: true });
}

export async function openCashDrawer(branch_id = 'sala', printerId = '', { deviceId = '' } = {}) {
  const rows = printerRows(branch_id);
  // Két tiền cắm sau máy in bill của CHÍNH máy đang bấm — không mở két của máy khác.
  const myNames = deviceId ? deviceOwnPrinterNames(branch_id, deviceId) : new Set();
  const p = rows.find(x => x.id === printerId)
    || rows.find(x => x.cashDrawer && x.active !== false && isAttachedTo(x, myNames))
    || rows.find(x => x.cashDrawer)
    || resolveReceiptPrinter(branch_id, { deviceId })
    || rows.find(x => x.id === 'bill');
  if (!p) throw new Error('Chưa cấu hình máy in/két tiền');
  if (p.connection !== 'lan') throw new Error('Mở két tự động cần máy in bill kết nối LAN/IP ESC/POS');
  if (!p.ip) throw new Error('Thiếu IP máy in bill nối két tiền');
  // Chế độ agent: server (VPS) không với tới két trong cửa hàng → xếp job
  // cash_drawer để Hardware Agent gửi xung mở két trên máy in LAN tại chỗ.
  if (env.PRINT_DISPATCH === 'agent') {
    const job = createJob({
      printer: p.id,
      type: 'cash_drawer',
      title: 'Mở két tiền',
      payload: { ref: uid('drawer_'), note: 'Mở két thủ công từ Printer Monitor' },
      branch_id,
    });
    audit('cash_drawer.open_agent', { printer: p.id, target: printerTarget(p) }, branch_id);
    return { ok: true, printer: p.id, target: printerTarget(p), queued: true, job: getJob(job.id) };
  }
  await writeLan(p.ip, p.port || 9100, Buffer.concat([ESC_INIT, ESC_DRAWER]), 4500);
  const job = createJob({
    printer: p.id,
    type: 'cash_drawer',
    title: 'Mở két tiền',
    payload: { ref: uid('drawer_'), note: 'Mở két thủ công từ Printer Monitor' },
    branch_id,
  });
  markPrinted(job.id, branch_id, 'server');
  audit('cash_drawer.open_printer', { printer: p.id, target: printerTarget(p) }, branch_id);
  return { ok: true, printer: p.id, target: printerTarget(p), job: getJob(job.id) };
}

// ---- Hooks used by order/payment flows ----
export function printKitchenTickets(order, items, branch_id = 'sala', staff = '') {
  const kitchenItems = items.filter(it => it && it.station !== 'retail');
  if (!kitchenItems.length) return;

  const k = getPrintConfig(branch_id).kitchen || {};
  const split = k.splitPerItem !== '0' && k.splitPerItem !== false;
  const perUnit = k.perUnit !== '0' && k.perUnit !== false;
  const showStaff = k.showStaff !== '0' && k.showStaff !== false;

  // Trạm (kitchen/bar) → tuyến in THẬT. Cùng lỗi với hóa đơn: ghi cứng id
  // 'kitchen'/'bar' nên cửa hàng đặt tên tuyến khác là phiếu bếp mồ côi rồi bị
  // huỷ. Phân giải MỘT LẦN cho cả loạt món, không gọi lại theo từng món.
  const rows = printerRows(branch_id);
  const resolvedStation = new Map();
  const stationPrinterId = (station) => {
    const legacyId = STATION_PRINTER[station] || 'kitchen';
    if (!resolvedStation.has(legacyId)) {
      const found = resolvePrinterForOutput('kitchen_ticket', branch_id, { legacyId, printers: rows });
      resolvedStation.set(legacyId, found ? found.id : '');
    }
    return resolvedStation.get(legacyId);
  };
  const warnNoStation = (station) => logSystem({
    level: 'error', source: 'printer', eventType: 'station_printer_missing',
    title: `Không tìm được máy in cho trạm "${station || 'kitchen'}" — phiếu bếp không in`,
    message: 'Chưa có máy in nào đặt loại phiếu "Phiếu bếp"/"Phiếu bar" và đang bật.',
    branchId: branch_id, action: 'print:kitchen_ticket',
    extra: { station: station || '', order: order?.id || '' },
  });

  const now = new Date();
  const base = {
    zone: order.zone || '',
    table: order.table_code || (order.online_channel ? 'ONLINE' : '—'),
    staff: showStaff ? (staff || '') : '',
    // Số thứ tự = 3 số cuối của Số Bill (Dan{ddMMyy}{seq}). VD Dan2106260001 -> 001.
    seq: String(order.bill_no || order.online_ref || order.id || '').slice(-3),
    time: now.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }),
    date: now.toLocaleDateString('vi-VN'),
  };

  // Chế độ gộp cũ: 1 phiếu / trạm in.
  if (!split) {
    const byPrinter = {};
    for (const it of kitchenItems) {
      const p = stationPrinterId(it.station);
      if (!p) { warnNoStation(it.station); continue; }
      (byPrinter[p] ||= []).push(it);
    }
    for (const [printer, list] of Object.entries(byPrinter)) {
      createJob({
        printer, type: 'kitchen_ticket',
        title: `Bàn ${base.table} · #${base.seq}`,
        payload: {
          ...base, station: printer.toUpperCase(),
          items: list.map(i => ({ qty: i.qty, name: i.name, note: i.note, mods: itemMods(i) })),
        }, branch_id,
      });
    }
    return;
  }

  // Tách từng món: mỗi món (mỗi phần nếu perUnit) ra 1 tem riêng.
  for (const it of kitchenItems) {
    const printer = stationPrinterId(it.station);
    if (!printer) { warnNoStation(it.station); continue; }
    const copies = perUnit ? Math.min(Math.max(1, parseInt(it.qty) || 1), 30) : 1;
    for (let i = 0; i < copies; i++) {
      createJob({
        printer, type: 'kitchen_ticket',
        title: `Bàn ${base.table} · ${it.name}`,
        payload: {
          ...base, station: printer.toUpperCase(),
          name: it.name, qty: it.qty, mods: itemMods(it), note: it.note || '',
          copy: copies > 1 ? `${i + 1}/${copies}` : '',
        }, branch_id,
      });
    }
  }
}

export function printReceipt(receipt, branch_id = 'sala', { deviceId = '' } = {}) {
  const cfg = getPrintConfig(branch_id);
  const copies = Math.max(1, Math.min(9, parseInt(receipt.print_copies || cfg?.bill?.copies || 1) || 1));
  const jobs = [];
  const reprint = isReprintPayload(receipt);

  // Tuyến in phải PHÂN GIẢI THẬT, không ghi cứng 'bill'. Đơn có tuyến gắn sẵn
  // (linked_printer_id) thì tôn trọng — nhưng chỉ khi tuyến đó CÒN tồn tại,
  // nếu không job sẽ mồ côi rồi bị huỷ y như lỗi cũ.
  const linked = receipt.linked_printer_id
    ? printerById(receipt.linked_printer_id, branch_id)
    : null;
  const printer = linked || resolveReceiptPrinter(branch_id, { deviceId });
  if (!printer) {
    // Không có tuyến in hóa đơn nào → nói rõ ra thay vì xếp job chết im lặng.
    logSystem({
      level: 'error', source: 'printer', eventType: 'receipt_printer_missing',
      title: 'Không tìm được máy in hóa đơn — bill không tự in',
      message: 'Chưa có máy in nào đặt loại phiếu "Hóa đơn" (output=receipt) và đang bật. '
        + 'Vào Cài đặt → Kết nối → danh mục máy in để thêm/bật một máy in hóa đơn.',
      branchId: branch_id, action: 'print:receipt',
      extra: { bill_no: receipt.bill_no || receipt.number || '', device: deviceId || '' },
    });
    return jobs;
  }

  for (let i = 0; i < copies; i++) {
    jobs.push(createJob({
      printer: printer.id,
      type: 'receipt',
      title: `Receipt #${receipt.number}${copies > 1 ? ` (${i + 1}/${copies})` : ''}${reprint ? ' (in lại)' : ''}`,
      payload: { ...receipt, print_config: printConfigForJob(cfg), reprint, copy_index: i + 1, copy_total: copies },
      branch_id,
    }));
  }
  return jobs;
}

function shouldPrintCupLabels(order, cfg) {
  if (!cfg?.labels || cfg.labels.autoPrint === '0' || cfg.labels.autoPrint === false) return false;
  return ['takeaway', 'delivery'].includes(order?.channel) || !!order?.online_channel;
}

export function printCupLabels(order, items = [], branch_id = 'sala') {
  const cfg = getPrintConfig(branch_id);
  if (!shouldPrintCupLabels(order, cfg)) return;
  const printable = items.filter(i => i && i.station !== 'retail' && i.status !== 'cancelled');
  if (!printable.length) return;
  // Không ghi cứng id 'label' — cửa hàng đặt tên tuyến tem khác thì job mồ côi.
  const labelPrinter = resolvePrinterForOutput('cup_label', branch_id, { legacyId: 'label' });
  if (!labelPrinter) {
    logSystem({
      level: 'warn', source: 'printer', eventType: 'label_printer_missing',
      title: 'Không tìm được máy in tem ly — bỏ qua in tem',
      message: 'Chưa có máy in nào đặt loại phiếu "Tem nhãn" và đang bật.',
      branchId: branch_id, action: 'print:cup_label',
      extra: { order: order?.id || '' },
    });
    return;
  }
  for (const item of printable) {
    const copies = Math.min(Math.max(1, parseInt(item.qty) || 1), 30);
    const mods = itemMods(item).map(m => m.name || m).filter(Boolean);
    for (let i = 0; i < copies; i++) {
      createJob({
        printer: labelPrinter.id,
        type: 'cup_label',
        title: `Tem ly · ${item.name}`,
        payload: {
          order_no: (order?.online_ref || order?.id || item.order_id || '').slice(-10).toUpperCase(),
          table: order?.table_code || (order?.online_channel ? 'ONLINE' : 'Mang đi'),
          channel: order?.online_channel || order?.channel || 'takeaway',
          customer: order?.customer?.name || '',
          phone: order?.customer?.phone || '',
          time: new Date().toLocaleTimeString('vi-VN'),
          itemName: item.name,
          options: mods.join(' · '),
          note: item.note || '',
          qty: item.qty,
          copy: copies > 1 ? `${i + 1}/${copies}` : '',
          print_config: printConfigForJob(cfg),
        },
        branch_id,
      });
    }
  }
}

export function printRunnerSlip(item, order, branch_id = 'sala') {
  if (!item || item.station === 'retail') return;
  // Không ghi cứng id 'runner' — cùng lý do với hóa đơn/bếp/tem.
  const runnerPrinter = resolvePrinterForOutput('runner', branch_id, { legacyId: 'runner' });
  if (!runnerPrinter) {
    logSystem({
      level: 'warn', source: 'printer', eventType: 'runner_printer_missing',
      title: 'Không tìm được máy in phiếu chạy món — bỏ qua',
      message: 'Chưa có máy in nào đặt loại phiếu "Phiếu chạy món" và đang bật.',
      branchId: branch_id, action: 'print:runner',
      extra: { order: order?.id || '' },
    });
    return;
  }
  const table = order?.table_code || (order?.online_channel ? 'ONLINE' : '—');
  const copies = Math.min(Math.max(1, parseInt(item.qty) || 1), 30);
  const mods = itemMods(item).map(m => m.name || m);
  for (let i = 0; i < copies; i++) {
    createJob({
      printer: runnerPrinter.id, type: 'runner',
      title: `Chạy món · Bàn ${table}`,
      payload: {
        table,
        order_no: (order?.id || item.order_id || '').slice(-5).toUpperCase(),
        station: (item.station || 'kitchen').toUpperCase(),
        time: new Date().toLocaleTimeString('vi-VN'),
        seq: copies > 1 ? `${i + 1}/${copies}` : '',
        name: item.name,
        mods, note: item.note || '',
      }, branch_id,
    });
  }
}
