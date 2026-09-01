// ─────────────────────────────────────────────────────────────────────────
import { businessDateTime } from '../core/businessClock.js';
// SEMANTIC RECEIPT DOCUMENT — mô hình hoá đơn có CẤU TRÚC (không phải chuỗi
// ASCII căn bằng khoảng trắng). Dùng cho WindowsDriverBackend: agent Windows
// render bằng GDI + font TrueType (Segoe UI/Roboto), đo cột bằng MeasureString.
//
// VÌ SAO tách khỏi renderReceipt (ESC/POS): font proportional KHÔNG dựa được
// vào khoảng trắng monospace để căn cột — phải có ranh giới cột thật (flex).
// Đây là đường in ĐÚNG cho bill khách trên K80 Windows (xem memory
// printing-architecture-decision): app gửi TEXT + FONT, DRIVER raster hoá ở
// tầng thiết bị — KHÔNG tạo ảnh ở tầng app.
//
// Module TỰ CHỨA (printing.js import module này nên không được import ngược lại).
// Vài helper format tiền chép lại từ printing.js — GIỮ ĐỒNG BỘ (đều thuần, ổn định).
// ─────────────────────────────────────────────────────────────────────────

// đ ở cuối cho các dòng TỔNG; cột trong bảng dùng số trần (khớp bản ESC/POS).
function money(n) { return `${Math.round(Number(n) || 0).toLocaleString('vi-VN')}đ`; }
function so(n) { return Math.round(Number(n) || 0).toLocaleString('vi-VN'); }
function giaChuaVat(gia, vatRate) {
  const r = Number(vatRate) || 0;
  return r > 0 ? Math.round(Number(gia || 0) / (1 + r / 100)) : Math.round(Number(gia || 0));
}
function methodLabel(m) {
  return ({ cash: 'Tiền mặt', card: 'Máy POS', qrcode: 'QR', qr: 'QR', voucher: 'Voucher',
    internet_banking: 'Internet Banking', momo: 'MoMo', zalopay: 'ZaloPay', visa: 'Visa',
    bank_transfer: 'Chuyển khoản' }[m]) || m || '-';
}

// Giảm giá toàn bill (khớp orderWideDiscount ở printing.js: ưu tiên trường tường minh).
function orderWideDiscount(p = {}) {
  const explicit = Number(p.order_discount ?? p.discount_total ?? p.voucher_amount);
  if (Number.isFinite(explicit) && explicit > 0) return Math.round(explicit);
  const v = Number(p.voucher?.amount) || 0;
  return v > 0 ? Math.round(v) : 0;
}

function modsToText(mods) {
  if (!Array.isArray(mods)) return '';
  return mods.map((m) => (typeof m === 'string' ? m : (m?.name || ''))).filter(Boolean).join(', ');
}

function replaceVars(text = '', vars = {}) {
  return String(text || '').replace(/\{([a-zA-Z0-9_]+)\}/g, (_, key) => vars[key] ?? '');
}

function templateRows(template = {}) {
  if (Array.isArray(template.rows) && template.rows.length) return template.rows;
  return Array.isArray(template.elements)
    ? [...template.elements].sort((a, b) => (Number(a.y) - Number(b.y)) || (Number(a.x) - Number(b.x)))
    : [];
}

function sizeFromMm(mm, fallback = 9) {
  const n = Number(mm);
  return Number.isFinite(n) && n > 0 ? Math.max(6, Math.min(28, Math.round(n * 2.45))) : fallback;
}

function appendText(blocks, text, row = {}) {
  const style = {
    size: sizeFromMm(row.fontSize),
    bold: !!row.bold,
    italic: !!row.italic,
    align: ['left', 'center', 'right'].includes(row.align) ? row.align : 'left',
  };
  for (const line of String(text || '').split('\n')) {
    if (!line) { blocks.push(B.space(Math.max(2, style.size * .35))); continue; }
    // Các biến tổng tiền của renderer monospace dùng nhiều khoảng trắng để căn phải.
    // Driver dùng font proportional, nên đổi chúng thành hai cột thật.
    const m = /^(.*\S)\s{2,}(\S.*)$/.exec(line);
    if (m && style.align === 'left') {
      blocks.push(B.row([
        { text: m[1], flex: 7, align: 'left', size: style.size, bold: style.bold, italic: style.italic },
        { text: m[2], flex: 4, align: 'right', size: style.size, bold: style.bold, italic: style.italic },
      ]));
    } else {
      blocks.push(B.text(line, style));
    }
  }
}

/** Render đúng thứ tự/nội dung/kiểu chữ của mẫu đã lưu sang semantic GDI blocks. */
function appendTemplate(blocks, template, vars, { items } = {}) {
  for (const row of templateRows(template)) {
    if (!row || row.hidden) continue;
    const type = String(row.type || 'text');
    if (type === 'line') { blocks.push(B.line(row.lineStyle === 'dot' ? 'dot' : 'solid')); continue; }
    if (type === 'qr') {
      const data = replaceVars(row.qrText || row.text || '', vars).trim();
      if (data) blocks.push(B.qr(data));
      if (row.qrShowCaption !== false && row.qrCaption) appendText(blocks, replaceVars(row.qrCaption, vars), { ...row, align: 'center' });
      continue;
    }
    if (type === 'image') continue; // logo rỗng/không nhúng vẫn không được biến thành chữ [IMAGE]
    if (type === 'items') { items?.(); continue; }
    const raw = String(row.text || '');
    if (raw.includes('{items}')) {
      const [before, ...after] = raw.split('{items}');
      if (before) appendText(blocks, replaceVars(before, vars), row);
      items?.();
      if (after.length) appendText(blocks, replaceVars(after.join('{items}'), vars), row);
    } else appendText(blocks, replaceVars(raw, vars), row);
  }
}

// Một block = một lệnh vẽ cho layout engine (xem agent GDI renderer):
//   { type:'text', text, size?, bold?, italic?, align? }
//   { type:'row', cols:[{ text, flex, align?, bold?, size? }] }
//   { type:'line', style?:'solid'|'dot' }
//   { type:'space', h? }
//   { type:'qr', data }         (agent vẽ mã QR như đồ hoạ nhỏ — mã vạch, không phải ảnh bill)
const B = {
  text: (text, o = {}) => ({ type: 'text', text: String(text ?? ''), ...o }),
  row: (cols) => ({ type: 'row', cols }),
  line: (style) => ({ type: 'line', style: style || 'solid' }),
  space: (h = 4) => ({ type: 'space', h }),
  qr: (data) => ({ type: 'qr', data: String(data ?? '') }),
};

// Tên món luôn nằm một dòng riêng. Dòng số bên dưới dùng toàn bộ bề ngang:
// Đơn giá sát trái · SL giữa-trái · T.Tiền khóa sát mép phải.
const COL = { price: 5, qty: 2, amount: 5 };
function itemHeaderRow() {
  return B.row([
    { text: 'Đơn giá', flex: COL.price, align: 'left', bold: true },
    { text: 'SL', flex: COL.qty, align: 'center', bold: true },
    { text: 'T.Tiền', flex: COL.amount, align: 'right', bold: true },
  ]);
}
function itemRow(qty, unitExcl, amountExcl) {
  return B.row([
    { text: unitExcl != null ? so(unitExcl) : '', flex: COL.price, align: 'left' },
    { text: qty ? String(qty) : '', flex: COL.qty, align: 'center' },
    { text: amountExcl != null ? so(amountExcl) : '', flex: COL.amount, align: 'right' },
  ]);
}

function promotedItemRows(name, ctkm, qty, beforeUnit, afterUnit, amountExcl) {
  return [
    B.text(name, { size: 9 }),
    ...(ctkm ? [B.text(`   CTKM: ${ctkm}`, { size: 8, italic: true })] : []),
    B.row([
      { text: so(beforeUnit), flex: 3, align: 'left', strike: true },
      { text: so(afterUnit), flex: 3, align: 'left', bold: true },
      { text: String(qty), flex: COL.qty, align: 'center' },
      { text: so(amountExcl), flex: COL.amount, align: 'right' },
    ]),
  ];
}

function pushItemBlocks(blocks, items) {
  const list = Array.isArray(items) ? items : [];
  const comboGroups = new Map();
  const normal = [];
  for (const i of list) {
    const promo = i.promo || {};
    if (promo.type === 'combo' && (promo.name || promo.code)) {
      const key = promo.name || promo.code;
      if (!comboGroups.has(key)) comboGroups.set(key, []);
      comboGroups.get(key).push(i);
    } else {
      normal.push(i);
    }
  }

  // Combo: tên combo đậm + từng món con thụt lề + dòng thành tiền combo.
  for (const [comboName, groupItems] of comboGroups) {
    blocks.push(B.text(comboName, { bold: true, size: 9 }));
    let gross = 0, giam = 0;
    const vat = groupItems[0]?.vat_rate;
    for (const i of groupItems) {
      const qty = Number(i.qty) || 1;
      const goc = Number(i.unit_price ?? i.price) || 0;
      blocks.push(B.text(`   ${i.name || ''} x${qty}`, { size: 8 }));
      gross += goc * qty;
      giam += Math.max(0, Math.round(Number(i.promo?.amount) || 0));
    }
    const total = Math.max(0, gross - giam);
    blocks.push(itemRow('', null, giaChuaVat(total, vat)));
  }

  for (const i of normal) {
    const qty = Number(i.qty) || 1;
    const name = i.unit ? `${i.name || ''} (${i.unit})` : (i.name || '');
    const promo = i.promo || {};
    const banGia = Number(i.unit_price ?? i.price) || 0;
    const giam = Math.max(0, Math.round(Number(promo.amount) || 0));
    const sauKm = giam > 0 ? Math.max(0, banGia - giam / Math.max(1, qty)) : banGia;
    const unitExcl = giaChuaVat(sauKm, i.vat_rate);
    const amountExcl = unitExcl * qty;
    const ctkm = promo.name || promo.code || '';
    if (giam > 0) {
      blocks.push(...promotedItemRows(
        name, ctkm, qty, giaChuaVat(banGia, i.vat_rate), unitExcl, amountExcl));
    } else {
      blocks.push(B.text(name, { size: 9 }));
      blocks.push(itemRow(qty, unitExcl, amountExcl));
      if (ctkm) blocks.push(B.text(`   CTKM: ${ctkm}`, { size: 8, italic: true }));
    }
    const mods = modsToText(i.mods || i.modifiers);
    if (mods) blocks.push(B.text(`   + ${mods}`, { size: 8 }));
    const note = i.note || i.lineNote;
    if (note) blocks.push(B.text(`   Ghi chú: ${note}`, { size: 8, italic: true }));
  }
}

// PHIẾU BẾP qua WindowsDriverBackend — dựng bằng GDI font TrueType CỠ LỚN (không
// bị giới hạn 2x của ESC/POS). Tên món + số lượng THẬT TO, mượt, để bếp đọc từ
// xa. Chỉ dùng khi máy in bếp là máy Windows đặt renderMode='driver'.
export function buildKitchenDoc(p = {}, printCfg = {}, opts = {}) {
  const font = opts.font || printCfg?.driverFont || 'Segoe UI';
  const blocks = [];
  const template = printCfg?.templates?.kitchen_ticket || p.print_config?.templates?.kitchen_ticket;
  const items = Array.isArray(p.items) && p.items.length ? p.items : [{ ...p }];
  const appendItems = () => {
    for (const i of items) {
      const qty = Number(i.qty) || 1;
      const cancelled = i.cancelled === true
        || String(i.status || '').toLowerCase() === 'cancelled'
        || p.update_kind === 'cancel_item';
      blocks.push({ type: 'row', cols: [
        { text: String(i.name || ''), flex: 5, align: 'left', size: 20, bold: true, strike: cancelled },
        { text: String(qty), flex: 2, align: 'right', size: 26, bold: true, strike: cancelled },
      ] });
      const mods = modsToText(i.mods || i.modifiers);
      if (mods) blocks.push({ type: 'text', text: `+ ${mods}`, size: 13, strike: cancelled });
      const note = i.note || i.lineNote;
      if (note) blocks.push({ type: 'text', text: `Ghi chú: ${note}`, size: 13, italic: true, strike: cancelled });
      blocks.push({ type: 'line', style: 'dot' });
    }
  };
  if (templateRows(template).some((row) => String(row?.type) === 'items')) {
    appendTemplate(blocks, template, {
      zone: String(p.zone || p.station || '').toUpperCase(),
      table: String(p.table || '').toUpperCase(), station: String(p.station || '').toUpperCase(),
      time: p.time || '', date: p.date || '', staff: p.staff || '',
      seq: p.seq == null ? '' : String(p.seq), copy: p.copy || '',
      orderNo: String(p.order_no || p.orderNo || p.seq || ''),
    }, { items: appendItems });
    return { font, blocks, offsetMm: Number(printCfg?.labels?.offsetMm ?? -2) || -2 };
  }
  const zone = String(p.zone || p.station || 'KHU VỰC').toUpperCase();
  blocks.push({ type: 'text', text: zone, size: 18, bold: true, align: 'center' });
  if (p.table) {
    blocks.push({ type: 'text', text: `BÀN ${String(p.table).toUpperCase()}`, size: 26, bold: true, align: 'center' });
  }
  blocks.push({ type: 'space', h: 4 });
  const time = p.time || '';
  const seq = p.seq != null ? String(p.seq) : '';
  blocks.push({ type: 'row', cols: [
    { text: time ? `Giờ: ${time}` : '', flex: 1, align: 'left', size: 11 },
    { text: seq ? `Số TT: ${seq}` : '', flex: 1, align: 'right', size: 11, bold: true },
  ] });
  if (p.staff) blocks.push({ type: 'text', text: `NV: ${p.staff}`, size: 10 });
  if (p.copy) blocks.push({ type: 'text', text: `(${p.copy})`, size: 10, align: 'center' });
  blocks.push({ type: 'line', style: 'solid' });

  appendItems();
  return { font, blocks, offsetMm: Number(printCfg?.labels?.offsetMm ?? -2) || -2 };
}

// Dựng semantic document cho TEM VẬN ĐƠN (shipping_label) — để in qua
// WindowsDriverBackend (GDI + TrueType) trên K80 driver-mode, KHÔNG rơi về
// ESC/POS. Mã vận đơn + COD in font lớn cho dễ quét/đọc. Tương đương
// renderShippingLabel (ESC/POS) nhưng dạng block có align/flex thật.
export function buildShippingLabelDoc(p = {}, printCfg = {}, opts = {}) {
  const font = opts.font || printCfg?.driverFont || 'Segoe UI';
  const blocks = [];
  const provider = String(p.providerLabel || p.provider || 'ONLINE').toUpperCase();
  blocks.push({ type: 'text', text: provider, size: 18, bold: true, align: 'center' });
  if (p.shopName) blocks.push({ type: 'text', text: String(p.shopName), size: 12, align: 'center' });
  blocks.push({ type: 'line', style: 'solid' });
  if (p.carrier) blocks.push({ type: 'text', text: `ĐVVC: ${p.carrier}`, size: 13, bold: true, align: 'center' });
  if (p.trackingNumber) {
    blocks.push({ type: 'text', text: 'MÃ VẬN ĐƠN', size: 11, align: 'center' });
    blocks.push({ type: 'text', text: String(p.trackingNumber), size: 26, bold: true, align: 'center' });
  }
  if (p.orderCode) blocks.push({ type: 'text', text: `Mã đơn: ${p.orderCode}`, size: 12 });
  blocks.push({ type: 'line', style: 'dot' });
  blocks.push({ type: 'text', text: 'NGƯỜI NHẬN', size: 11, bold: true });
  const r = p.receiver || {};
  blocks.push({ type: 'text', text: `${r.name || ''}  ${r.phone || ''}`.trim(), size: 15, bold: true });
  if (r.address) blocks.push({ type: 'text', text: String(r.address), size: 13 });
  blocks.push({ type: 'line', style: 'dot' });
  blocks.push({ type: 'text', text: 'NGƯỜI GỬI', size: 11, bold: true });
  const s = p.sender || {};
  blocks.push({ type: 'text', text: `${s.name || ''}  ${s.phone || ''}`.trim(), size: 12 });
  if (s.address) blocks.push({ type: 'text', text: String(s.address), size: 11 });
  const items = Array.isArray(p.items) ? p.items : [];
  if (items.length) {
    blocks.push({ type: 'line', style: 'dot' });
    blocks.push({ type: 'text', text: 'SẢN PHẨM', size: 11, bold: true });
    for (const it of items) {
      blocks.push({ type: 'row', cols: [
        { text: String(it.name || ''), flex: 5, align: 'left', size: 12 },
        { text: `x${Number(it.qty || 1)}`, flex: 1, align: 'right', size: 12, bold: true },
      ] });
    }
  }
  blocks.push({ type: 'line', style: 'solid' });
  if (Number(p.codAmount || 0) > 0) {
    blocks.push({ type: 'text', text: 'THU HỘ (COD)', size: 16, bold: true, align: 'center' });
    blocks.push({ type: 'text', text: money(p.codAmount), size: 24, bold: true, align: 'center' });
  } else {
    blocks.push({ type: 'text', text: 'ĐÃ THANH TOÁN — KHÔNG THU COD', size: 12, bold: true, align: 'center' });
  }
  if (p.weight) blocks.push({ type: 'text', text: `Khối lượng: ${p.weight}g`, size: 11 });
  if (p.note) {
    blocks.push({ type: 'line', style: 'dot' });
    blocks.push({ type: 'text', text: String(p.note), size: 11 });
  }
  blocks.push({ type: 'line', style: 'solid' });
  blocks.push({ type: 'text', text: 'Cảm ơn quý khách', size: 11, align: 'center' });
  return { font, blocks, offsetMm: Number(printCfg?.labels?.offsetMm ?? -2) || -2 };
}

// Dựng doc PHIẾU CHI cho WindowsDriverBackend (GDI). Giống bill nhưng tiêu đề
// "PHIẾU CHI", KHÔNG VAT; ghi rõ người chi/ngày giờ/lý do + dòng (item·ĐG·SL·
// thành tiền) + tổng cộng.
export function buildExpenseVoucherDoc(p = {}, printCfg = {}, opts = {}) {
  const font = opts.font || printCfg?.driverFont || 'Segoe UI';
  const blocks = [];
  if (p.shopName) blocks.push({ type: 'text', text: String(p.shopName), size: 15, bold: true, align: 'center' });
  if (p.address) blocks.push({ type: 'text', text: String(p.address), size: 11, align: 'center' });
  if (p.phone) blocks.push({ type: 'text', text: `ĐT: ${p.phone}`, size: 11, align: 'center' });
  blocks.push({ type: 'line', style: 'solid' });
  blocks.push({ type: 'text', text: 'PHIẾU CHI', size: 22, bold: true, align: 'center' });
  blocks.push({ type: 'line', style: 'solid' });
  if (p.code) blocks.push({ type: 'text', text: `Số phiếu: ${p.code}`, size: 12 });
  if (p.datetime) {
    try { blocks.push({ type: 'text', size: 12, text: `Ngày giờ chi: ${businessDateTime(p.datetime)}` }); } catch {}
  }
  if (p.payer) blocks.push({ type: 'text', text: `Người chi: ${p.payer}`, size: 12 });
  if (p.payee) blocks.push({ type: 'text', text: `Bên nhận/NCC: ${p.payee}`, size: 12 });
  if (p.reason) blocks.push({ type: 'text', text: `Lý do: ${p.reason}`, size: 12 });
  blocks.push({ type: 'line', style: 'dot' });
  const qty = Number(p.qty || 1);
  const unit = Number(p.unitPrice != null ? p.unitPrice : p.amount || 0);
  const lineTotal = Number(p.amount || unit * qty);
  blocks.push({ type: 'row', cols: [
    { text: 'Nội dung', flex: 5, align: 'left', size: 11, bold: true },
    { text: 'ĐG', flex: 3, align: 'right', size: 11, bold: true },
    { text: 'SL', flex: 1, align: 'right', size: 11, bold: true },
    { text: 'Thành tiền', flex: 3, align: 'right', size: 11, bold: true },
  ] });
  blocks.push({ type: 'row', cols: [
    { text: String(p.item || 'Chi phí'), flex: 5, align: 'left', size: 12 },
    { text: money(unit), flex: 3, align: 'right', size: 12 },
    { text: String(qty), flex: 1, align: 'right', size: 12 },
    { text: money(lineTotal), flex: 3, align: 'right', size: 12 },
  ] });
  blocks.push({ type: 'line', style: 'dot' });
  const total = Number(p.total != null ? p.total : lineTotal);
  blocks.push({ type: 'row', cols: [
    { text: 'TỔNG CỘNG', flex: 3, align: 'left', size: 15, bold: true },
    { text: money(total), flex: 4, align: 'right', size: 16, bold: true },
  ] });
  if (p.totalWords) blocks.push({ type: 'text', text: `Bằng chữ: ${p.totalWords}`, size: 11, italic: true });
  blocks.push({ type: 'space', h: 10 });
  blocks.push({ type: 'row', cols: [
    { text: 'Người lập phiếu', flex: 1, align: 'center', size: 11 },
    { text: 'Người nhận', flex: 1, align: 'center', size: 11 },
  ] });
  blocks.push({ type: 'space', h: 6 });
  blocks.push({ type: 'row', cols: [
    { text: '(Ký, họ tên)', flex: 1, align: 'center', size: 10 },
    { text: '(Ký, họ tên)', flex: 1, align: 'center', size: 10 },
  ] });
  return { font, blocks, offsetMm: Number(printCfg?.labels?.offsetMm ?? -2) || -2 };
}

// PHIẾU TRẢ HÀNG (driver/GDI) — giống bill nhưng tiêu đề "PHIẾU TRẢ HÀNG", nhiều
// dòng món, TỔNG HOÀN. Bill gốc KHÔNG bị xoá; phiếu này chỉ ghi nhận trả hàng.
export function buildReturnVoucherDoc(p = {}, printCfg = {}, opts = {}) {
  const font = opts.font || printCfg?.driverFont || 'Segoe UI';
  const blocks = [];
  if (p.shopName) blocks.push({ type: 'text', text: String(p.shopName), size: 15, bold: true, align: 'center' });
  if (p.address) blocks.push({ type: 'text', text: String(p.address), size: 11, align: 'center' });
  if (p.phone) blocks.push({ type: 'text', text: `ĐT: ${p.phone}`, size: 11, align: 'center' });
  blocks.push({ type: 'line', style: 'solid' });
  blocks.push({ type: 'text', text: 'PHIẾU TRẢ HÀNG', size: 20, bold: true, align: 'center' });
  blocks.push({ type: 'line', style: 'solid' });
  if (p.code) blocks.push({ type: 'text', text: `Bill gốc: ${p.code}`, size: 12 });
  if (p.datetime) {
    try { blocks.push({ type: 'text', size: 12, text: `Ngày giờ trả: ${businessDateTime(p.datetime)}` }); } catch {}
  }
  if (p.actor) blocks.push({ type: 'text', text: `Người lập: ${p.actor}`, size: 12 });
  if (p.approvedBy) blocks.push({ type: 'text', text: `Quản lý duyệt: ${p.approvedBy}`, size: 12 });
  blocks.push({ type: 'line', style: 'dot' });
  blocks.push({ type: 'row', cols: [
    { text: 'Mặt hàng', flex: 5, align: 'left', size: 11, bold: true },
    { text: 'ĐG', flex: 3, align: 'right', size: 11, bold: true },
    { text: 'SL', flex: 1, align: 'right', size: 11, bold: true },
    { text: 'Thành tiền', flex: 3, align: 'right', size: 11, bold: true },
  ] });
  for (const it of (Array.isArray(p.items) ? p.items : [])) {
    blocks.push({ type: 'row', cols: [
      { text: String(it.name || ''), flex: 5, align: 'left', size: 12 },
      { text: money(it.unitPrice || 0), flex: 3, align: 'right', size: 12 },
      { text: String(it.qty || 0), flex: 1, align: 'right', size: 12 },
      { text: money(it.amount || 0), flex: 3, align: 'right', size: 12 },
    ] });
  }
  blocks.push({ type: 'line', style: 'dot' });
  blocks.push({ type: 'row', cols: [
    { text: 'TỔNG HOÀN', flex: 3, align: 'left', size: 15, bold: true },
    { text: money(p.total || 0), flex: 4, align: 'right', size: 16, bold: true },
  ] });
  if (p.refundMethod) blocks.push({ type: 'text', text: `Hoàn qua: ${p.refundMethod}`, size: 11 });
  blocks.push({ type: 'space', h: 10 });
  blocks.push({ type: 'row', cols: [
    { text: 'Người lập phiếu', flex: 1, align: 'center', size: 11 },
    { text: 'Người nhận', flex: 1, align: 'center', size: 11 },
  ] });
  blocks.push({ type: 'space', h: 6 });
  blocks.push({ type: 'row', cols: [
    { text: '(Ký, họ tên)', flex: 1, align: 'center', size: 10 },
    { text: '(Ký, họ tên)', flex: 1, align: 'center', size: 10 },
  ] });
  return { font, blocks, offsetMm: Number(printCfg?.labels?.offsetMm ?? -2) || -2 };
}

// Payload bill MẪU cho nút "In thử" ở chế độ driver — để cửa hàng in thử ngay
// trên K80 thật, so sánh font (đổi driverFont rồi in lại). Xem mission #57.
export function sampleReceiptPayload() {
  return {
    company: { name: '', address: '' },
    bill_no: 'IN-THU-001', table_code: 'A01', cashier: 'Nhân viên', time: 'In thử',
    items: [
      { name: 'Cà phê sữa đá', qty: 2, unit_price: 25000, vat_rate: 8 },
      { name: 'Bánh mì thịt nướng đặc biệt', qty: 1, unit_price: 30000, vat_rate: 8,
        note: 'thử tên món dài xuống dòng' },
      { name: 'Trà đào cam sả', qty: 1, unit_price: 35000, vat_rate: 8,
        promo: { name: 'Giảm 10%', amount: 3500 } },
    ],
    total: 116500, vat_amount: 8630, goods_amount: 107870,
    lines: [{ method: 'cash', amount: 150000 }], paid: 150000, change: 33500,
    total_words: 'Một trăm mười sáu nghìn năm trăm đồng',
  };
}

/**
 * Dựng semantic document cho 1 hoá đơn.
 * @param p        payload của print job (receipt).
 * @param printCfg print_config của chi nhánh.
 * @param opts     { font } — font TrueType mặc định.
 * @returns { font, blocks[] }
 */
export function buildReceiptDoc(p = {}, printCfg = {}, opts = {}) {
  const cfg = printCfg?.bill || p.print_config?.bill || {};
  const font = opts.font || printCfg?.driverFont || 'Segoe UI';
  const blocks = [];
  const template = printCfg?.templates?.bill || p.print_config?.templates?.bill;
  if (templateRows(template).length && opts.vars) {
    const appendItems = () => {
      blocks.push(itemHeaderRow());
      blocks.push(B.line('dot'));
      pushItemBlocks(blocks, p.items || []);
    };
    appendTemplate(blocks, template, opts.vars, { items: appendItems });
    return { font, blocks, offsetMm: Number(printCfg?.bill?.offsetMm ?? -2) || -2 };
  }

  const storeName = cfg.storeName || p.company?.name || p.branch || 'DAN D PAK';
  const storeSubtitle = cfg.storeSubtitle || '';
  const address = p.company?.address || cfg.address || '';
  const reprint = !!(p.reprint || /\(IN L[ẠA]I\)/i.test(String(p.bill_title || '')));

  // ── Đầu bill ──
  blocks.push(B.text(storeName, { size: 16, bold: true, align: 'center' }));
  if (storeSubtitle) blocks.push(B.text(storeSubtitle, { size: 9, align: 'center' }));
  if (address) blocks.push(B.text(address, { size: 8, align: 'center' }));
  const contact = [cfg.phone ? `ĐT: ${cfg.phone}` : '', cfg.taxCode ? `MST: ${cfg.taxCode}` : '']
    .filter(Boolean).join('   ');
  if (contact) blocks.push(B.text(contact, { size: 8, align: 'center' }));
  blocks.push(B.space(3));

  const title = p.preview ? 'HÓA ĐƠN TẠM TÍNH'
    : `HÓA ĐƠN THANH TOÁN${reprint ? ' (IN LẠI)' : ''}`;
  blocks.push(B.text(title, { size: 11, bold: true, align: 'center' }));
  blocks.push(B.space(3));

  // ── Thông tin đơn ──
  const billNo = p.preview ? '' : (p.bill_no || p.number || '');
  const place = p.table_code ? `Bàn ${p.table_code}` : (p.channel || 'POS');
  if (billNo || place) {
    blocks.push(B.row([
      { text: billNo ? `Số HĐ: ${billNo}` : '', flex: 1, align: 'left' },
      { text: place, flex: 1, align: 'right' },
    ]));
  }
  const when = p.time || p.paid_at || p.created_at || '';
  blocks.push(B.row([
    { text: p.cashier ? `Thu ngân: ${p.cashier}` : '', flex: 1, align: 'left' },
    { text: String(when), flex: 1, align: 'right' },
  ]));

  const customer = p.customer || {};
  const isInvoice = !!(customer.tax_code || customer.invoice_request);
  if (isInvoice) {
    if (customer.name) blocks.push(B.text(`Khách hàng: ${customer.name}`, { size: 8 }));
    if (customer.company) blocks.push(B.text(`Công ty: ${customer.company}`, { size: 8 }));
    if (customer.tax_code) blocks.push(B.text(`MST: ${customer.tax_code}`, { size: 8 }));
    if (customer.address) blocks.push(B.text(`Địa chỉ: ${customer.address}`, { size: 8 }));
  } else if (customer.name || customer.phone) {
    const c = [customer.name, customer.phone].filter(Boolean).join(' - ');
    blocks.push(B.text(`Khách hàng: ${c}`, { size: 8 }));
  }

  // ── Bảng món ──
  blocks.push(B.line('solid'));
  blocks.push(itemHeaderRow());
  blocks.push(B.line('dot'));
  pushItemBlocks(blocks, p.items || []);
  blocks.push(B.line('solid'));

  // ── Tổng kết ──
  const total = Number(p.total) || 0;
  const vatAmount = Number(p.vat_amount ?? p.tax?.vat_amount) || 0;
  const goodsAmount = Number(p.goods_amount) || Math.max(0, total - vatAmount);
  const orderDiscount = orderWideDiscount(p);
  const orderPromoName = p.voucher?.name || p.voucher_code || 'Giảm giá';
  const mucThue = [...new Set((p.items || []).map((i) => Number(i.vat_rate) || 0).filter((r) => r > 0))];
  const vatRate = mucThue.length === 1 ? mucThue[0] : 0;

  const totalsRow = (label, value, o = {}) => B.row([
    { text: label, flex: 7, align: 'left', ...(o.bold ? { bold: true } : {}), ...(o.size ? { size: o.size } : {}) },
    { text: value, flex: 4, align: 'right', ...(o.bold ? { bold: true } : {}), ...(o.size ? { size: o.size } : {}) },
  ]);

  blocks.push(totalsRow('Tổng tiền hàng', money(goodsAmount)));
  if (vatAmount > 0) blocks.push(totalsRow(`VAT${vatRate ? ` (${vatRate}%)` : ''}`, money(vatAmount)));
  if (orderDiscount > 0) blocks.push(totalsRow(`${orderPromoName}`, `-${money(orderDiscount)}`));
  blocks.push(totalsRow('TỔNG CỘNG', money(total), { bold: true, size: 13 }));

  const lines = Array.isArray(p.lines) ? p.lines : [];
  if (lines.length) {
    blocks.push(totalsRow('Hình thức', lines.map((l) => methodLabel(l.method)).join(', ')));
  }
  const linesPaid = lines.reduce((s, l) => s + (Number(l.amount) || 0), 0);
  const paid = Number(p.paid ?? (linesPaid || total)) || 0;
  const change = Number(p.change ?? Math.max(0, paid - total)) || 0;
  if (paid) blocks.push(totalsRow('Tiền khách đưa', money(paid)));
  if (change > 0) blocks.push(totalsRow('Tiền trả khách', money(change)));

  blocks.push(B.space(2));
  blocks.push(B.text(`Bằng chữ: ${p.total_words || ''}`.trimEnd(), { size: 8, italic: true }));

  // ── Chân bill ──
  blocks.push(B.space(3));
  const showQr = cfg.showQr !== '0' && !p.preview;
  const qrData = p.invoice?.lookup_url || p.invoice?.lookup_code || billNo;
  if (showQr && qrData) {
    if (cfg.qrNote) blocks.push(B.text(cfg.qrNote, { size: 8, align: 'center' }));
    blocks.push(B.qr(qrData));
  }
  const footer = cfg.footer || 'Xin cảm ơn và hẹn gặp lại';
  blocks.push(B.text(footer, { size: 10, align: 'center' }));

  return { font, blocks, offsetMm: Number(printCfg?.bill?.offsetMm ?? -2) || -2 };
}
