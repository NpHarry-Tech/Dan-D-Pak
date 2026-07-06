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
export function danPromoText(promo) {
  if (!promo || typeof promo !== 'object' || !Object.keys(promo).length) return '';
  const name = promo.name || promo.code || 'Khuyen mai';
  const amount = Math.max(0, Math.round(Number(promo.amount) || 0));
  const free = Math.max(0, Math.round(Number(promo.free_units) || 0));
  const parts = [];
  if (amount > 0) parts.push(`giam ${vndSpace(amount)}`);
  if (free > 0) parts.push(`tang ${free} ${promo.free_product_name || 'san pham'}`);
  if (!parts.length && promo.description) return String(promo.description);
  return parts.length ? `${name}: ${parts.join(', ')}` : name;
}
export function danLinePromoTotal(items = []) {
  return (items || []).reduce((s, item) => s + Math.max(0, Math.round(Number(item?.promo?.amount) || 0)), 0);
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
  // Two rows per item: full name on its own line(s) up top (wraps to full
  // width), then the figures below aligned under the SL / Đ.Giá / T.Tiền header.
  const nameLines = danWrap(i.name || '', DAN_BILL_WIDTH);
  const figures = ' '.repeat(COL.nameW)
    + ' ' + String(qty).padStart(COL.qtyW)
    + ' ' + vndSpace(price).padStart(COL.priceW)
    + ' ' + vndSpace(price * qty).padStart(COL.amountW);
  const promo = danPromoText(i.promo);
  const promoLines = promo ? danWrap(`  KM: ${promo}`, DAN_BILL_WIDTH) : [];
  return [...nameLines, figures, ...promoLines].join('\n');
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
  const subtotal = Number(r.subtotal ?? r.goods_amount) || 0;
  const vatAmount = Number(r.vat_amount ?? r.tax?.vat_amount) || 0;
  const orderDiscount = Math.max(0, Math.round(Number(r.discount) || 0) - danLinePromoTotal(r.items || []));
  const orderPromoName = r.voucher?.name || r.voucher_code || 'Giam gia toan bill';
  const linesPaid = lines.reduce((s, l) => s + (Number(l.amount) || 0), 0);
  const paid = Number(r.paid ?? (linesPaid || total)) || 0;
  const change = Number(r.change ?? Math.max(0, paid - total)) || 0;
  // The QR note is only meaningful when a QR is actually rendered. The web
  // renderers draw the QR block when showQr is on and this is not a preview,
  // so blank the note otherwise (it would instruct scanning an absent QR).
  const showQr = cfg.showQr !== '0' && !r.preview;
  const customer = r.customer || {};
  const isInvoice = !!(customer.tax_code || customer.invoice_request);
  let customerInfoBlock = '';
  if (isInvoice) {
    const linesArr = [];
    if (customer.name) linesArr.push(`Khách hàng: ${customer.name}`);
    if (customer.company) linesArr.push(`Công ty: ${customer.company}`);
    if (customer.tax_code) linesArr.push(`MST: ${customer.tax_code}`);
    if (customer.address) linesArr.push(`Địa chỉ: ${customer.address}`);
    if (customer.email) linesArr.push(`Email: ${customer.email}`);
    if (customer.phone) linesArr.push(`SĐT: ${customer.phone}`);
    customerInfoBlock = linesArr.join('\n');
  } else {
    const linesArr = [`Khách hàng: ${customer.name || 'Bán cho người tiêu dùng'}`];
    if (customer.phone) linesArr.push(`SĐT: ${customer.phone}`);
    customerInfoBlock = linesArr.join('\n');
  }

  return {
    customerName: customer.name || 'Bán cho người tiêu dùng',
    customerInfoBlock,
    storeNameC: danCenter(storeName),
    storeSubtitleC: danCenter(storeSubtitle),
    addressBlock: danWrap(cfg.address || r.company?.address || '').join('\n'),
    place: danPlace(r),
    timeIn: danDateTime(r.created_at || r.paid_at),
    timeOut: danDateTime(r.paid_at || r.created_at),
    items: danItemsText(r),
    subtotalLine: danLabelValue('THANH TIEN:', vndSpace(subtotal)),
    vatLine: vatAmount > 0 ? danLabelValue('VAT:', vndSpace(vatAmount)) : '',
    orderPromoLine: orderDiscount > 0 ? danLabelValue(`${orderPromoName}:`, `-${vndSpace(orderDiscount)}`) : '',
    grandTotalLine: danLabelValue('TONG CONG:', vndSpace(total)),
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
