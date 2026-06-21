// Shared rendering helpers for the Dan "HÓA ĐƠN THANH TOÁN" payment receipt.
// Used by POS, Retail and the order-history reprint so every device produces
// the same bill from the same print-config + template. Layout mirrors the
// thermal ESC/POS renderer in server/services/printing.js (42-col grid).

export const DAN_BILL_WIDTH = 42;
const COL = { nameW: 17, qtyW: 2, priceW: 9, amountW: 10 };

const DAN_METHOD = {
  cash: 'TIỀN MẶT', card: 'THẺ', visa: 'THẺ',
  qrcode: 'TRANSFER', qr: 'TRANSFER', bank_transfer: 'TRANSFER', internet_banking: 'TRANSFER',
  momo: 'MOMO', zalopay: 'ZALOPAY', voucher: 'VOUCHER',
};

export function vndSpace(n) {
  return Math.round(Number(n) || 0).toLocaleString('en-US').replace(/,/g, ' ');
}
export function danCenter(text, w = DAN_BILL_WIDTH) {
  const s = String(text || '');
  return s.length >= w ? s : ' '.repeat(Math.floor((w - s.length) / 2)) + s;
}
export function danRight(text, w = DAN_BILL_WIDTH) {
  const s = String(text || '');
  return s.length >= w ? s : ' '.repeat(w - s.length) + s;
}
export function danLabelValue(label, value, w = DAN_BILL_WIDTH) {
  label = String(label || ''); value = String(value || '');
  const gap = Math.max(1, w - label.length - value.length);
  return label + ' '.repeat(gap) + value;
}
export function danWrap(text, w = DAN_BILL_WIDTH) {
  const words = String(text || '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const rows = []; let cur = '';
  for (const word of words) {
    if (!cur) cur = word;
    else if ((cur + ' ' + word).length <= w) cur += ' ' + word;
    else { rows.push(cur); cur = word; }
  }
  if (cur) rows.push(cur);
  return rows.length ? rows : [''];
}
export function danMethodLabel(m) {
  return DAN_METHOD[m] || (m ? String(m).toUpperCase() : 'TIỀN MẶT');
}
export function danPlace(r = {}) {
  if (r.table_code) return 'Bàn ' + r.table_code;
  if (r.online_channel) return r.online_channel + (r.online_ref ? ' · ' + r.online_ref : '');
  if (r.channel === 'takeaway') return 'Mang về';
  if (r.channel === 'retail') return 'Bán lẻ';
  return 'Tại quầy';
}
export function danDateTime(iso) {
  const d = iso ? new Date(iso) : new Date();
  if (isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}.${p(d.getMinutes())}`;
}
export function danItemRow(i = {}) {
  const qty = Number(i.qty) || 1;
  const price = Number(i.unit_price ?? i.price) || 0;
  const nameLines = danWrap(i.name || '', COL.nameW);
  const head = nameLines[0].padEnd(COL.nameW)
    + ' ' + String(qty).padStart(COL.qtyW)
    + ' ' + vndSpace(price).padStart(COL.priceW)
    + ' ' + vndSpace(price * qty).padStart(COL.amountW);
  return [head, ...nameLines.slice(1)].join('\n');
}
export function danItemsText(r = {}) {
  return (r.items || []).map(danItemRow).join('\n');
}

// Build all template variables specific to the Dan payment receipt.
// Spread the result into each device's receipt-variable object.
export function danBillVars(r = {}, cfg = {}) {
  const storeName = cfg.storeName || r.branch || 'Dan';
  const storeSubtitle = cfg.storeSubtitle || 'Bon Appétit';
  const footer = cfg.footer || 'Xin cảm ơn và hẹn gặp lại';
  const taxNote = cfg.taxIncludedText || 'Đơn giá đã bao gồm VAT';
  const qrNote = cfg.qrNote || 'Scan the QR code to let us know how you enjoyed meals with us';
  const lines = Array.isArray(r.lines) ? r.lines : [];
  const total = Number(r.total) || 0;
  const linesPaid = lines.reduce((s, l) => s + (Number(l.amount) || 0), 0);
  const paid = Number(r.paid ?? (linesPaid || total)) || 0;
  const change = Number(r.change ?? Math.max(0, paid - total)) || 0;
  // The QR note is only meaningful when a QR is actually rendered. The web
  // renderers draw the QR block when showQr is on and this is not a preview,
  // so blank the note otherwise (it would instruct scanning an absent QR).
  const showQr = cfg.showQr !== '0' && !r.preview;
  return {
    storeNameC: danCenter(storeName),
    storeSubtitleC: danCenter(storeSubtitle),
    addressBlock: danWrap(cfg.address || r.company?.address || '').join('\n'),
    place: danPlace(r),
    timeIn: danDateTime(r.created_at || r.paid_at),
    timeOut: danDateTime(r.paid_at || r.created_at),
    items: danItemsText(r),
    totalLine: danLabelValue('TỔNG TIỀN:', vndSpace(total)),
    paymentLines: lines.length
      ? lines.map(l => danRight(`${danMethodLabel(l.method)}(VND) - ${vndSpace(l.amount)}`)).join('\n')
      : '',
    paidLine: danLabelValue('Tiền khách đưa:', vndSpace(paid)),
    changeLine: danLabelValue('Tiền trả khách:', vndSpace(change)),
    taxNoteC: danCenter(taxNote),
    footerBrandC: danCenter(`${storeSubtitle} ${storeName}`.trim()),
    footerC: danCenter(footer),
    qrNote: showQr ? qrNote : '',
    qrNoteC: showQr ? danWrap(qrNote).map(l => danCenter(l)).join('\n') : '',
  };
}
