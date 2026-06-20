// Shared order/invoice history (Lịch sử bán hàng) — used by POS & Retail.
// Lists past paid/void orders, shows a full receipt, and supports reprint —
// like KiotViet "Lịch sử bán hàng" / Odoo Orders.
import { api, money, esc, toast, getUser } from './client.js';

const CHANNELS = [
  { v: '', label: 'Tất cả kênh' },
  { v: 'dine_in', label: 'Tại bàn' },
  { v: 'retail', label: 'Bán lẻ' },
  { v: 'online', label: 'Online' },
  { v: 'takeaway', label: 'Mang đi' },
];
const METHOD_VN = { cash: 'Tiền mặt', card: 'Thẻ', bank_transfer: 'Chuyển khoản', qrcode: 'QR', qr: 'QR', momo: 'MoMo', zalopay: 'ZaloPay', visa: 'Visa', voucher: 'Voucher' };
const fmtTime = (iso) => { try { return new Date(iso).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); } catch { return ''; } };

let ov = null, listEl = null, detailEl = null, qEl = null, chEl = null, debTimer = null;
let opts = { allowRefund: false, onAfterChange: null };

function ensureOverlay() {
  if (ov) return;
  injectCss();
  ov = document.createElement('div');
  ov.id = 'ohOverlay';
  ov.className = 'oh-overlay';
  ov.innerHTML = `
    <div class="oh-modal">
      <div class="oh-head">
        <h3>📋 Lịch sử bán hàng</h3>
        <button class="oh-x" id="ohClose">✕</button>
      </div>
      <div class="oh-body">
        <div class="oh-left">
          <div class="oh-filters">
            <input id="ohQ" class="oh-q" placeholder="Tìm mã đơn / bàn / mã HĐ…" autocomplete="off">
            <select id="ohCh" class="oh-ch">${CHANNELS.map(c => `<option value="${c.v}">${c.label}</option>`).join('')}</select>
          </div>
          <div class="oh-list" id="ohList"><div class="oh-empty">Đang tải…</div></div>
        </div>
        <div class="oh-right" id="ohDetail"><div class="oh-empty">Chọn một đơn để xem chi tiết</div></div>
      </div>
    </div>`;
  document.body.appendChild(ov);
  listEl = ov.querySelector('#ohList');
  detailEl = ov.querySelector('#ohDetail');
  qEl = ov.querySelector('#ohQ');
  chEl = ov.querySelector('#ohCh');
  ov.querySelector('#ohClose').onclick = close;
  ov.onclick = (e) => { if (e.target === ov) close(); };
  qEl.oninput = () => { clearTimeout(debTimer); debTimer = setTimeout(load, 280); };
  chEl.onchange = load;
}

async function load() {
  if (!listEl) return;
  const q = encodeURIComponent(qEl.value.trim());
  const ch = encodeURIComponent(chEl.value);
  listEl.innerHTML = '<div class="oh-empty">Đang tải…</div>';
  let rows = [];
  try { rows = await api(`/orders/history?limit=80&q=${q}&channel=${ch}`); } catch (e) { listEl.innerHTML = `<div class="oh-empty">Lỗi tải: ${esc(e.message)}</div>`; return; }
  if (!rows.length) { listEl.innerHTML = '<div class="oh-empty">Không có đơn nào.</div>'; return; }
  listEl.innerHTML = rows.map(o => {
    const methods = (o.methods || []).map(m => METHOD_VN[m.method] || m.method).join(', ');
    const voidBadge = o.status === 'void' ? '<span class="oh-badge void">Đã hủy</span>' : '';
    const invBadge = o.invoice_no ? `<span class="oh-badge inv">HĐ ${esc(o.invoice_no)}</span>` : '';
    return `<div class="oh-row" data-id="${esc(o.id)}">
      <div class="oh-r1"><b>#${esc(o.number)}</b><span class="oh-tot">${money(o.total)}</span></div>
      <div class="oh-r2"><span>${esc(o.channel_label || '')}</span><span class="oh-time">${fmtTime(o.paid_at || o.created_at)}</span></div>
      <div class="oh-r3"><span>${o.item_count || 0} món · ${esc(methods || '—')}</span><span>${voidBadge}${invBadge}</span></div>
    </div>`;
  }).join('');
  listEl.querySelectorAll('.oh-row').forEach(r => r.onclick = () => {
    listEl.querySelectorAll('.oh-row').forEach(x => x.classList.remove('on'));
    r.classList.add('on');
    showDetail(r.dataset.id);
  });
}

async function showDetail(id) {
  detailEl.innerHTML = '<div class="oh-empty">Đang tải…</div>';
  let r;
  try {
    const [receipt, _] = await Promise.all([
      api(`/orders/${id}/receipt`),
      refreshPrintConfig()
    ]);
    r = receipt;
  } catch (e) { detailEl.innerHTML = `<div class="oh-empty">Lỗi: ${esc(e.message)}</div>`; return; }
  const canRefund = opts.allowRefund && r.status === 'paid' && r.channel === 'retail';
  detailEl.innerHTML = receiptHtml(r) + `
    <div class="oh-actions">
      <button class="btn primary" id="ohPrint">🖨️ In lại hóa đơn</button>
      ${r.invoice ? `<a class="btn" href="${esc(r.invoice.lookup_url)}" target="_blank">🔎 Tra cứu HĐĐT</a>` : ''}
      ${canRefund ? `<button class="btn danger" id="ohRefund">↩ Đổi trả / Hoàn hàng</button>` : ''}
    </div>
    <div id="ohRefundForm"></div>`;
  detailEl.querySelector('#ohPrint').onclick = () => printReceipt(r);
  const rfBtn = detailEl.querySelector('#ohRefund');
  if (rfBtn) rfBtn.onclick = () => showRefundForm(r);
}

function showRefundForm(r) {
  const box = detailEl.querySelector('#ohRefundForm');
  if (!box) return;
  box.innerHTML = `<div class="oh-refund">
    <label>Lý do đổi trả / hoàn hàng</label>
    <input id="ohRfReason" placeholder="VD: Khách trả hàng" value="Khách trả hàng">
    <div class="oh-rf-act">
      <button class="btn" id="ohRfCancel">Hủy</button>
      <button class="btn danger" id="ohRfOk">Xác nhận hoàn ${money(r.total)}</button>
    </div>
  </div>`;
  box.querySelector('#ohRfCancel').onclick = () => { box.innerHTML = ''; };
  box.querySelector('#ohRfOk').onclick = async () => {
    const reason = (box.querySelector('#ohRfReason').value || '').trim() || 'Khách trả hàng';
    const btn = box.querySelector('#ohRfOk'); btn.disabled = true; btn.textContent = 'Đang hoàn…';
    try {
      const res = await api(`/retail/${r.order_id}/refund`, { method: 'POST', body: { reason } });
      toast('Đã hoàn ' + money(res.refunded ?? r.total));
      if (opts.onAfterChange) opts.onAfterChange();
      await load();              // refresh list (order now shows as "Đã hủy")
      await showDetail(r.order_id);
    } catch (e) { toast(e.message, true); btn.disabled = false; btn.textContent = 'Xác nhận hoàn ' + money(r.total); }
  };
}
const fmtDate = (iso) => { try { return new Date(iso).toLocaleDateString('vi-VN'); } catch { return ''; } };
const fmtHm = (iso) => { try { return new Date(iso).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }); } catch { return ''; } };
const placeLabel = (r) => r.table_code ? 'Bàn ' + r.table_code
  : r.online_channel ? (r.online_channel + (r.online_ref ? ' · ' + r.online_ref : '')) : 'Quầy bán lẻ';
const statusLabel = (r) => r.status === 'void' ? 'ĐÃ HỦY / HOÀN' : 'Đã thanh toán';
const payLabel = (r) => (r.lines || []).map(l => METHOD_VN[l.method] || l.method).join(' / ') || 'Tiền mặt';

// Build numbered item rows, grouped by F&B vs Retail (like the BCM template).
function itemRows(r, render) {
  const fnb = r.items.filter(i => i.kind !== 'retail');
  const retail = r.items.filter(i => i.kind === 'retail');
  let stt = 0;
  const block = (arr) => arr.map(it => { stt++; return render(it, stt); }).join('');
  let out = '';
  if (fnb.length && retail.length) {
    out += render(null, null, '[ F&B — NHÀ HÀNG / ĐỒ UỐNG ]') + block(fnb);
    out += render(null, null, '[ RETAIL — SẢN PHẨM TIÊU DÙNG ]') + block(retail);
  } else {
    out += block(r.items);
  }
  return out;
}

let printConfig = {};
const cfgKey = k => `pos_erp_${k}_settings`;
function readLocalCfg(k) { try { return JSON.parse(localStorage.getItem(cfgKey(k)) || 'null'); } catch { return null; } }
function hasLocalPrintCfg() { return ['einvoice', 'labels', 'bill', 'printers', 'label_template', 'cup_label_template', 'bill_template'].some(k => localStorage.getItem(cfgKey(k))); }
function isLegacyBillTemplate(tpl) {
  return tpl?.standard === 'bcm_fiscal_receipt' && (Number(tpl.version || 0) < 3 || Number(tpl.heightMm || 0) > 260);
}
function mergePrintConfig(remote = {}) {
  const r = remote || {};
  if (r.updated_at || !hasLocalPrintCfg()) return r;
  const localBillTemplate = readLocalCfg('bill_template');
  const local = {
    einvoice: readLocalCfg('einvoice') || {},
    labels: readLocalCfg('labels') || {},
    bill: readLocalCfg('bill') || {},
    printers: readLocalCfg('printers') || r.printers,
    templates: { label: readLocalCfg('cup_label_template') || readLocalCfg('label_template') || r.templates?.label, bill: isLegacyBillTemplate(localBillTemplate) ? r.templates?.bill : (localBillTemplate || r.templates?.bill) },
  };
  return { ...r, einvoice: { ...(r.einvoice || {}), ...local.einvoice }, labels: { ...(r.labels || {}), ...local.labels }, bill: { ...(r.bill || {}), ...local.bill }, printers: local.printers || r.printers, templates: { ... (r.templates || {}), ...local.templates } };
}
async function refreshPrintConfig() { printConfig = mergePrintConfig(await api('/print/config').catch(() => printConfig || {})); }

function activePrintConfig(r) { return r?.print_config || printConfig || {}; }
function activeBillCfg(r) { return activePrintConfig(r).bill || {}; }
function activeBillTemplate(r) { return activePrintConfig(r).templates?.bill || null; }

function replaceVars(text, vars) { return String(text || '').replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? `{${k}}`); }
function vndPlain(n) { return Math.round(Number(n) || 0).toLocaleString('en-US'); }
function pad2(n) { return String(n).padStart(2, '0'); }
function receiptDate(d) { return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`; }
function receiptTime(d) { return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; }
function internalBillNo(r, d) {
  if (r.bill_no && /^Dan\d{10}$/i.test(r.bill_no)) return r.bill_no;
  const seed = String(r.order_id || r.number || '1');
  let n = 0; for (const ch of seed) n = (n * 31 + ch.charCodeAt(0)) % 10000;
  return `Dan${pad2(d.getDate())}${pad2(d.getMonth() + 1)}${String(d.getFullYear()).slice(-2)}${String(n || 1).padStart(4, '0')}`;
}
function numberToVietnamese(n) {
  n = Math.round(Number(n) || 0);
  if (n === 0) return 'Không đồng';
  const digit = ['không', 'một', 'hai', 'ba', 'bốn', 'năm', 'sáu', 'bảy', 'tám', 'chín'], unit = ['', 'nghìn', 'triệu', 'tỷ'];
  function triad(num, full = false) {
    const tr = Math.floor(num / 100), ch = Math.floor((num % 100) / 10), dv = num % 10, out = [];
    if (tr > 0 || full) out.push(digit[tr] + ' trăm');
    if (ch > 1) { out.push(digit[ch] + ' mươi'); if (dv === 1) out.push('mốt'); else if (dv === 5) out.push('lăm'); else if (dv) out.push(digit[dv]); }
    else if (ch === 1) { out.push('mười'); if (dv === 5) out.push('lăm'); else if (dv) out.push(digit[dv]); }
    else if (dv) { if (tr > 0 || full) out.push('lẻ'); out.push(digit[dv]); }
    return out.join(' ');
  }
  const parts = []; let x = n, idx = 0;
  while (x > 0) { const g = x % 1000; if (g) parts.unshift(`${triad(g, parts.length > 0)} ${unit[idx]}`.trim()); x = Math.floor(x / 1000); idx++; }
  const s = parts.join(' ').replace(/\s+/g, ' ').trim();
  return s.charAt(0).toUpperCase() + s.slice(1) + ' đồng chẵn';
}
function lineCategory(i) { return i.station === 'retail' || i.sku_id || i.kind === 'retail' ? 'retail' : 'fnb'; }
function itemLineAmount(i, rate, priceIncludesVat) {
  const gross = (Number(i.unit_price) || 0) * (Number(i.qty) || 1);
  return priceIncludesVat ? Math.round(gross / (1 + rate / 100)) : gross;
}
function formatReceiptItemRow(idx, i, rate, priceIncludesVat) {
  const name = String(i.name || '').replace(/\s+/g, ' ').slice(0, 24).padEnd(24, ' ');
  const qty = String(i.qty || 1).padStart(2, ' ');
  const price = Number(i.unit_price || i.price || 0);
  const unit = Math.round(priceIncludesVat ? price / (1 + rate / 100) : price);
  const amount = priceIncludesVat ? Math.round((price * i.qty) / (1 + rate / 100)) : (price * i.qty);
  return `${String(idx).padStart(2, '0')}   ${name} ${qty} ${vndPlain(unit).padStart(9, ' ')} ${vndPlain(amount).padStart(12, ' ')}`;
}
function receiptItemsText(r) {
  const tax = r.tax || {}, rate = Number(tax.vat_rate || r.vat_rate || 8) || 0, inc = tax.price_includes_vat !== false;
  const groups = { fnb: [], retail: [] };
  (r.items || []).forEach(i => groups[lineCategory(i)].push(i));
  const rows = []; let idx = 1;
  if (groups.fnb.length) { rows.push('[DANH MỤC F&B - NHÀ HÀNG / ĐỒ UỐNG]'); groups.fnb.forEach(i => rows.push(formatReceiptItemRow(idx++, i, rate, inc))); }
  if (groups.retail.length) { if (rows.length) rows.push(''); rows.push('[DANH MỤC RETAIL - SẢN PHẨM TIÊU DÙNG]'); groups.retail.forEach(i => rows.push(formatReceiptItemRow(idx++, i, rate, inc))); }
  return rows.join('\n');
}
function receiptVarsBcm(r) {
  const cfg = activeBillCfg(r), ein = activePrintConfig(r).einvoice || {};
  const lines = r.lines || [];
  const rate = Number(r.vat_rate || ein.defaultVatRate || 8) || 0;
  const priceIncludesVat = true;
  const gross = Number(r.total || 0);
  const taxable = priceIncludesVat ? Math.round(gross / (1 + rate / 100)) : Number(r.subtotal || r.goods_amount || gross);
  const vat = priceIncludesVat ? gross - taxable : Math.round(taxable * rate / 100);
  const grand = priceIncludesVat ? gross : taxable + vat - (Number(r.discount) || 0);
  const d = new Date(r.paid_at || r.created_at || Date.now());
  const billNo = r.bill_no || r.number || '';
  const taxNote = cfg.taxIncludedText || (priceIncludesVat ? `Giá đã bao gồm thuế GTGT ${rate}% theo quy định` : `Chưa bao gồm thuế GTGT ${rate}%`);
  return {
    storeName: cfg.storeName || r.branch || r.company?.name || 'District 1 - HCMC',
    storeSubtitle: cfg.storeSubtitle || '(Hệ thống Phân phối F&B & Retail BCM)',
    address: cfg.address || r.company?.address || '',
    sellerTaxCode: ein.taxCode || cfg.taxCode || r.company?.tax_code || '',
    phone: cfg.phone || r.company?.phone || '',
    email: cfg.email || ein.email || r.company?.email || '',
    invoiceSeries: ein.series || 'C26TMB',
    taxInvoiceNo: r.tax_invoice_no || r.invoice?.invoice_no || '00000001',
    billNo,
    orderNo: billNo,
    table: r.table_code || 'Tại quầy',
    cashier: r.cashier || '',
    date: receiptDate(d),
    time: receiptDate(d) + ' ' + receiptTime(d),
    timeOnly: receiptTime(d),
    customerName: r.customer?.name || 'Khách không xuất hóa đơn',
    customerTaxCode: r.customer?.tax_code || '',
    items: receiptItemsText(r),
    subtotal: vndPlain(r.subtotal || r.goods_amount || 0),
    taxableAmount: vndPlain(taxable),
    vatRate: String(rate),
    vatAmount: vndPlain(vat || r.vat_amount || 0),
    discount: vndPlain(r.discount || 0),
    total: vndPlain(r.total || 0),
    grandTotal: vndPlain(grand),
    totalWords: r.total_words || numberToVietnamese(grand),
    taxNote,
    method: lines.length ? lines.map(l => METHOD_VN[l.method] || l.method).join(' / ') : (r.preview ? 'Chưa thanh toán' : '-'),
    paymentStatus: r.preview ? 'Chưa thanh toán' : 'Đã thanh toán',
    taxAuthorityCode: r.tax_authority_code || r.invoice?.lookup_code || '00F83A7B-2C9D-4E1A-8B6C-5D4E3F2A1B0C',
    footer: cfg.footer || 'Cảm ơn quý khách!',
  };
}
function renderTemplateReceipt(r) {
  const tpl = activeBillTemplate(r);
  if (!tpl?.elements?.length) return '';
  const vars = receiptVarsBcm(r);
  const w = Number(tpl.widthMm) || 72, h = Number(tpl.heightMm) || 180;
  const els = tpl.elements.map((el, i) => {
    const pos = `left:${Number(el.x) || 0}%;top:${Number(el.y) || 0}%;width:${Number(el.w) || 20}%;height:${el.type === 'line' ? 0 : (Number(el.h) || 8)}%;z-index:${i + 1}`;
    if (el.type === 'image') return `<div class="tpl-el tpl-img" style="${pos}">${el.src ? `<img src="${esc(el.src)}">` : ''}</div>`;
    if (el.type === 'line') return `<div class="tpl-el tpl-line" style="${pos}"></div>`;
    if (el.type === 'qr') return `<div class="tpl-el tpl-qr" style="${pos}"><div class="qr"></div></div>`;
    const align = el.align === 'center' ? 'center' : el.align === 'right' ? 'right' : el.align === 'justify' ? 'justify' : 'left';
    const justify = align === 'center' ? 'center' : align === 'right' ? 'flex-end' : 'flex-start';
    const decoration = [el.underline ? 'underline' : '', el.strike ? 'line-through' : ''].filter(Boolean).join(' ') || 'none';
    const block = el.id === 'bill_body';
    return `<div class="tpl-el" style="${pos};font-size:${Math.max(8, (Number(el.fontSize) || 5) * 1.95)}px;font-weight:${el.bold ? 800 : 500};font-style:${el.italic ? 'italic' : 'normal'};text-decoration:${decoration};text-align:${align};display:${block ? 'block' : 'flex'};align-items:${block ? 'flex-start' : 'center'};justify-content:${justify};padding:${block ? '8px 10px' : '0'}">${esc(replaceVars(el.text, vars))}</div>`;
  }).join('');
  const cfg = activeBillCfg(r);
  const hasTaxNote = tpl.elements.some(el => String(el.text || '').includes('{taxNote}'));
  const taxFallback = cfg.showTax !== '0' && !hasTaxNote ? `<div class="c" style="padding:0 16px 8px;font-size:10px;color:#666">${esc(vars.taxNote || '')}</div>` : '';
  return `<div class="receipt template" style="max-width:${w <= 58 ? 270 : 340}px;margin:0 auto"><div class="receipt-canvas-live" style="--receipt-ratio:${w}/${h}">${els}</div>${taxFallback}${cfg.showQr !== '0' && !r.preview ? `<div style="padding:0 16px 14px"><div class="qr"></div><div class="c" style="font-size:10px">Quét QR tra cứu hóa đơn</div></div>` : ''}</div>`;
}
function renderBasicReceipt(r) {
  const cfg = activeBillCfg(r);
  const store = cfg.storeName || r.branch || r.company?.name || 'District 1 - HCMC';
  const footer = cfg.footer || 'Cảm ơn quý khách!';
  const taxNote = cfg.taxIncludedText || `Giá đã bao gồm thuế GTGT ${r.vat_rate || 8}% theo quy định`;
  return `<div class="receipt">
      <div class="c"><h4>${esc(store)}</h4>${cfg.address || r.company?.address ? `<div>${esc(cfg.address || r.company?.address)}</div>` : ''}${cfg.phone || r.company?.phone ? `<div>${esc(cfg.phone || r.company?.phone)}</div>` : ''}<div>${r.preview ? 'PHIẾU TẠM TÍNH' : 'HÓA ĐƠN'} #${esc(r.bill_no || r.number || '')}</div>
      ${r.table_code ? `<div>Bàn: ${esc(r.table_code)}</div>` : ''}</div>
      <hr>
      ${(r.items || []).map(i => `<div class="li"><span>${i.qty}× ${esc(i.name)}</span><span>${money((i.unit_price || i.price || 0) * (i.qty || 1))}</span></div>`).join('')}
      <hr>
      <div class="li"><span>Tạm tính</span><span>${money(r.subtotal || r.goods_amount || 0)}</span></div>
      ${cfg.showTax !== '0' ? `<div class="li" style="font-size:10px;color:#666"><span>${esc(taxNote)}</span><span></span></div>` : ''}
      ${r.discount ? `<div class="li"><span>Giảm giá</span><span>-${money(r.discount)}</span></div>` : ''}
      <div class="li tt"><span>TỔNG</span><span>${money(r.total || 0)}</span></div>
      ${r.lines && r.lines.length ? '<hr>' + r.lines.map(l => `<div class="li"><span>${METHOD_VN[l.method] || l.method}</span><span>${money(l.amount)}</span></div>`).join('') : ''}
      ${!r.preview && r.change ? `<div class="li"><span>Tiền thối</span><span>${money(r.change)}</span></div>` : ''}
      ${cfg.showQr !== '0' && !r.preview ? `<div class="qr"></div><div class="c" style="font-size:10px">Quét QR tra cứu hóa đơn</div>` : ''}
      <hr><div class="c" style="font-size:10px">${esc(footer)}</div>
    </div>`;
}
function receiptContent(r) { return renderTemplateReceipt(r) || renderBasicReceipt(r); }

function receiptHtml(r) {
  if (activeBillTemplate(r)?.elements?.length) {
    return receiptContent(r);
  }
  const c = r.company || {};
  const rows = itemRows(r, (it, stt, groupLabel) => {
    if (groupLabel) return `<tr class="oh-grp"><td colspan="4">${esc(groupLabel)}</td></tr>`;
    const mods = (it.mods || []).map(m => m.label || m.name).filter(Boolean).join(', ');
    return `<tr><td class="oh-stt">${String(stt).padStart(2, '0')}</td><td>${esc(it.name)}${mods ? `<small class="oh-mods">+ ${esc(mods)}</small>` : ''}<small class="oh-mods">${it.qty} × ${money(it.unit_price)}</small></td><td class="r">${money(it.line_total)}</td></tr>`;
  });
  const inv = r.invoice;
  return `<div class="oh-receipt" id="ohReceipt">
    <div class="oh-rc-head">
      <div class="oh-rc-brand">${esc(c.name || '')}</div>
      ${c.address ? `<div class="oh-rc-addr">${esc(c.address)}</div>` : ''}
      <div class="oh-rc-addr">${c.tax_code ? 'MST: ' + esc(c.tax_code) : ''}${c.phone ? ' · ĐT: ' + esc(c.phone) : ''}</div>
      ${c.email ? `<div class="oh-rc-addr">${esc(c.email)}</div>` : ''}
    </div>
    <div class="oh-rc-title">HÓA ĐƠN BÁN HÀNG<small>(Khởi tạo từ máy tính tiền)</small></div>
    <div class="oh-rc-meta">
      ${inv ? `<div><span>Ký hiệu HĐ</span><b>${esc(inv.symbol || '')}</b></div><div><span>Số HĐ (Thuế)</span><b>${esc(inv.invoice_no || '')}</b></div>` : ''}
      <div><span>Số Bill (Nội bộ)</span><b>${esc(r.bill_no || r.number)}</b></div>
      <div><span>Ngày lập</span><b>${fmtDate(r.paid_at || r.created_at)}</b></div>
      <div><span>Giờ lập</span><b>${fmtHm(r.paid_at || r.created_at)}</b></div>
      <div><span>Thu ngân</span><b>${esc(r.cashier || '—')}</b></div>
      <div><span>Quầy / Bàn</span><b>${esc(placeLabel(r))}</b></div>
      ${r.customer?.name ? `<div><span>Khách hàng</span><b>${esc(r.customer.name)}</b></div>` : ''}
      ${r.customer?.tax_code ? `<div><span>MST khách</span><b>${esc(r.customer.tax_code)}</b></div>` : ''}
    </div>
    <table class="oh-rc-items"><thead><tr><th class="oh-stt">STT</th><th>Mặt hàng</th><th class="r">Thành tiền</th></tr></thead><tbody>${rows}</tbody></table>
    <div class="oh-rc-sum">
      <div class="oh-pl"><span>Cộng tiền hàng</span><b>${money(r.goods_amount)}</b></div>
      ${r.discount ? `<div class="oh-pl"><span>Giảm giá</span><b>-${money(r.discount)}</b></div>` : ''}
      <div class="oh-pl"><span>Thuế GTGT (${r.vat_rate}%)</span><b>${money(r.vat_amount)}</b></div>
      <div class="oh-pl oh-grand"><span>TỔNG THANH TOÁN</span><b>${money(r.total)}</b></div>
    </div>
    <div class="oh-rc-words">Bằng chữ: <i>${esc(r.total_words || '')}</i></div>
    <div class="oh-rc-sum">
      <div class="oh-pl"><span>Hình thức TT</span><b>${esc(payLabel(r))}</b></div>
      <div class="oh-pl"><span>Trạng thái</span><b>${esc(statusLabel(r))}</b></div>
      ${r.change ? `<div class="oh-pl"><span>Tiền thối</span><b>${money(r.change)}</b></div>` : ''}
    </div>
    ${inv ? `<div class="oh-rc-inv">MÃ CỦA CƠ QUAN THUẾ:<br><b>${esc(inv.lookup_code || '')}</b><br><small>Tra cứu tại https://gdt.gov.vn</small></div>` : ''}
    <div class="oh-rc-foot">HÓA ĐƠN ĐIỆN TỬ KHỞI TẠO TỪ MÁY TÍNH TIỀN<br>CẢM ƠN QUÝ KHÁCH — HẸN GẶP LẠI TẠI BCM!</div>
  </div>`;
}

function printReceipt(r) {
  const w = window.open('', '_blank', 'width=400,height=680');
  if (!w) { toast('Trình duyệt chặn cửa sổ in', true); return; }
  const tpl = activeBillTemplate(r);
  if (tpl?.elements?.length) {
    const vars = receiptVarsBcm(r);
    const widthMm = Number(tpl.widthMm) || 72, heightMm = Number(tpl.heightMm) || 180;
    w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(r.bill_no || r.number)}</title>
      <style>
        *{margin:0;padding:0;box-sizing:border-box}
        body{font-family:sans-serif;width:${widthMm <= 58 ? '270px' : '340px'};margin:0 auto;padding:10px;color:#000;font-size:12px;line-height:1.35}
        .receipt{background:#fff;color:#111;font-family:monospace;font-size:12px;max-width:340px;margin:0 auto}
        .receipt .c{text-align:center}
        .receipt h4{font-size:14px}
        .receipt hr{border:none;border-top:1px dashed #000;margin:8px 0}
        .receipt .li{display:flex;justify-content:space-between;gap:8px;padding:1.5px 0}
        .receipt .tt{font-weight:700;font-size:13.5px}
        .receipt.template{padding:0;overflow:hidden}
        .receipt-canvas-live{position:relative;width:100%;background:#fff;color:#111;aspect-ratio:var(--receipt-ratio,${widthMm}/${heightMm});min-height:360px}
        .receipt-canvas-live .tpl-el{position:absolute;white-space:pre-wrap;overflow:hidden;line-height:1.14;box-sizing:border-box}
        .receipt-canvas-live .tpl-img img{width:100%;height:100%;object-fit:contain}
        .receipt-canvas-live .tpl-line{border-top:1px dashed #000;height:0!important}
        .receipt-canvas-live .tpl-qr{display:flex;align-items:center;justify-content:center}
        .receipt-canvas-live .tpl-qr .qr{width:min(100%,84px);height:auto;aspect-ratio:1;margin:0}
        .c{text-align:center}
      </style></head><body>
      ${receiptContent(r)}
      <script>window.onload=function(){window.print();setTimeout(function(){window.close()},300)}<\/script>
      </body></html>`);
  } else {
    const c = r.company || {};
    const inv = r.invoice;
    const rows = itemRows(r, (it, stt, groupLabel) => {
      if (groupLabel) return `<tr><td colspan="3" class="grp">${esc(groupLabel)}</td></tr>`;
      const mods = (it.mods || []).map(m => m.label || m.name).filter(Boolean).join(', ');
      return `<tr><td class="stt">${String(stt).padStart(2, '0')}</td><td>${esc(it.name)}${mods ? `<small>+ ${esc(mods)}</small>` : ''}<small>${it.qty} × ${money(it.unit_price)}</small></td><td class="r">${money(it.line_total)}</td></tr>`;
    });
    w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(r.bill_no || r.number)}</title>
      <style>
        *{margin:0;padding:0;box-sizing:border-box}
        body{font-family:'Courier New',monospace;width:300px;margin:0 auto;padding:10px;color:#000;font-size:12px;line-height:1.35}
        .ct{text-align:center}.b{font-weight:bold}.r{text-align:right}
        .name{font-weight:bold;font-size:13px}
        .small,small{font-size:10px;color:#222;display:block}
        .title{text-align:center;font-weight:bold;font-size:14px;margin:6px 0 2px}
        .title small{font-weight:normal;font-size:10px}
        hr{border:none;border-top:1px dashed #000;margin:5px 0}
        .meta{font-size:11px}
        .meta div{display:flex;justify-content:space-between;gap:8px}
        table{width:100%;border-collapse:collapse;font-size:11px}
        td,th{padding:2px 0;text-align:left;vertical-align:top}
        th{border-bottom:1px solid #000;font-size:10px}
        .stt{width:24px}.r{text-align:right}
        .grp{font-weight:bold;font-size:10px;padding-top:4px}
        .row{display:flex;justify-content:space-between;font-size:12px;padding:1px 0}
        .grand{font-weight:bold;font-size:14px}
        .words{font-size:11px;font-style:italic;margin:4px 0}
        .tax{font-size:10px;text-align:center;margin-top:6px;word-break:break-all}
        .foot{text-align:center;font-size:10px;margin-top:8px;font-weight:bold}
      </style></head><body>
      <div class="ct name">${esc(c.name || '')}</div>
      ${c.address ? `<div class="ct small">${esc(c.address)}</div>` : ''}
      <div class="ct small">${c.tax_code ? 'MST: ' + esc(c.tax_code) : ''}${c.phone ? ' · ĐT: ' + esc(c.phone) : ''}</div>
      ${c.email ? `<div class="ct small">${esc(c.email)}</div>` : ''}
      <div class="title">HÓA ĐƠN BÁN HÀNG<small>(Khởi tạo từ máy tính tiền)</small></div>
      <hr>
      <div class="meta">
        ${inv ? `<div><span>Ký hiệu HĐ:</span><b>${esc(inv.symbol || '')}</b></div><div><span>Số HĐ (Thuế):</span><b>${esc(inv.invoice_no || '')}</b></div>` : ''}
        <div><span>Số Bill (Nội bộ):</span><b>${esc(r.bill_no || r.number)}</b></div>
        <div><span>Ngày lập:</span><span>${fmtDate(r.paid_at || r.created_at)} ${fmtHm(r.paid_at || r.created_at)}</span></div>
        <div><span>Thu ngân:</span><span>${esc(r.cashier || '—')}</span></div>
        <div><span>Quầy/Bàn:</span><span>${esc(placeLabel(r))}</span></div>
        ${r.customer?.name ? `<div><span>Khách hàng:</span><span>${esc(r.customer.name)}</span></div>` : ''}
        ${r.customer?.tax_code ? `<div><span>MST khách:</span><span>${esc(r.customer.tax_code)}</span></div>` : ''}
      </div>
      <hr>
      <table><thead><tr><th class="stt">STT</th><th>Mặt hàng</th><th class="r">T.Tiền</th></tr></thead><tbody>${rows}</tbody></table>
      <hr>
      <div class="row"><span>Cộng tiền hàng:</span><span>${money(r.goods_amount)}</span></div>
      ${r.discount ? `<div class="row"><span>Giảm giá:</span><span>-${money(r.discount)}</span></div>` : ''}
      <div class="row"><span>Thuế GTGT (${r.vat_rate}%):</span><span>${money(r.vat_amount)}</span></div>
      <div class="row grand"><span>TỔNG THANH TOÁN:</span><span>${money(r.total)}</span></div>
      <div class="words">Bằng chữ: ${esc(r.total_words || '')}</div>
      <div class="row"><span>Hình thức TT:</span><span>${esc(payLabel(r))}</span></div>
      <div class="row"><span>Trạng thái:</span><span>${esc(statusLabel(r))}</span></div>
      ${r.change ? `<div class="row"><span>Tiền thối:</span><span>${money(r.change)}</span></div>` : ''}
      ${inv ? `<hr><div class="tax">MÃ CỦA CƠ QUAN THUẾ:<br><b>${esc(inv.lookup_code || '')}</b><br>Tra cứu tại https://gdt.gov.vn</div>` : ''}
      <hr>
      <div class="foot">HÓA ĐƠN ĐIỆN TỬ KHỞI TẠO TỪ MÁY TÍNH TIỀN<br>CẢM ƠN QUÝ KHÁCH — HẸN GẶP LẠI TẠI BCM!</div>
      <script>window.onload=function(){window.print();setTimeout(function(){window.close()},300)}<\/script>
      </body></html>`);
  }
  w.document.close();
}

export function open() { ensureOverlay(); ov.classList.add('show'); load(); setTimeout(() => qEl && qEl.focus(), 80); }
export function close() { if (ov) ov.classList.remove('show'); }

// Mount a header button into a container.
// options: { allowRefund:bool, onAfterChange:fn, label:str } — Returns { open, close }.
export function mountOrderHistory(container, options = {}) {
  opts = { allowRefund: false, onAfterChange: null, ...options };
  if (typeof container === 'string') container = document.querySelector(container);
  if (container) {
    const label = options.label || (opts.allowRefund ? '📋 Lịch sử / Đổi trả' : '📋 Lịch sử');
    container.innerHTML = `<button class="btn sm" id="ohBtn" title="Xem lại đơn cũ, in lại hóa đơn${opts.allowRefund ? ' & đổi trả' : ''}">${label}</button>`;
    container.querySelector('#ohBtn').onclick = open;
  }
  return { open, close };
}

function injectCss() {
  if (document.getElementById('ohCss')) return;
  const s = document.createElement('style'); s.id = 'ohCss';
  s.textContent = `
  .oh-overlay{position:fixed;inset:0;z-index:950;background:rgba(13,20,29,.5);backdrop-filter:blur(4px);display:none;align-items:center;justify-content:center;padding:20px}
  .oh-overlay.show{display:flex}
  .oh-modal{background:var(--surface);border:1px solid var(--border);border-radius:16px;width:100%;max-width:880px;height:min(82vh,720px);display:flex;flex-direction:column;box-shadow:0 24px 70px rgba(15,23,42,.28);overflow:hidden}
  .oh-head{display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border-bottom:1px solid var(--border)}
  .oh-head h3{font-size:15px}
  .oh-x{background:var(--surface2);border-radius:8px;width:30px;height:30px;color:var(--muted);font-size:14px}
  .oh-x:hover{color:var(--text)}
  .oh-body{flex:1;display:grid;grid-template-columns:340px 1fr;min-height:0}
  .oh-left{border-right:1px solid var(--border);display:flex;flex-direction:column;min-height:0}
  .oh-filters{display:flex;gap:8px;padding:12px}
  .oh-q{flex:1;padding:9px 11px;border-radius:9px;background:var(--surface2);border:1px solid var(--border2);color:var(--text);font-size:13px}
  .oh-ch{padding:9px;border-radius:9px;background:var(--surface2);border:1px solid var(--border2);color:var(--text);font-size:12px}
  .oh-list{flex:1;overflow-y:auto;padding:0 10px 12px;display:flex;flex-direction:column;gap:7px}
  .oh-row{background:var(--surface2);border:1px solid var(--border);border-radius:11px;padding:10px 12px;cursor:pointer;transition:.1s}
  .oh-row:hover{border-color:var(--brand)}
  .oh-row.on{border-color:var(--brand);background:var(--brand-dim)}
  .oh-r1{display:flex;justify-content:space-between;align-items:center;font-size:13.5px}
  .oh-r1 b{font-family:var(--mono)}
  .oh-tot{font-family:var(--mono);color:var(--brand);font-weight:800}
  .oh-r2,.oh-r3{display:flex;justify-content:space-between;align-items:center;font-size:11px;color:var(--muted);margin-top:3px;gap:8px}
  .oh-time{flex-shrink:0;font-family:var(--mono)}
  .oh-badge{display:inline-block;font-size:10px;padding:1px 7px;border-radius:99px;margin-left:4px}
  .oh-badge.inv{background:var(--brand-dim);color:var(--brand)}
  .oh-badge.void{background:rgba(239,68,68,.15);color:#ef4444}
  .oh-right{overflow-y:auto;padding:16px;display:flex;flex-direction:column}
  .oh-empty{color:var(--muted);text-align:center;padding:40px 16px;font-size:13px;margin:auto}
  .oh-receipt{background:var(--surface2);border:1px dashed var(--border2);border-radius:12px;padding:16px}
  .oh-rc-head{text-align:center;border-bottom:1px dashed var(--border2);padding-bottom:10px;margin-bottom:10px}
  .oh-rc-brand{font-weight:800;font-size:15px}
  .oh-rc-addr{font-size:11px;color:var(--muted);margin-top:2px}
  .oh-rc-no{font-family:var(--mono);font-size:12.5px;margin-top:6px}
  .oh-rc-time{font-size:11px;color:var(--muted);font-family:var(--mono)}
  .oh-rc-items{width:100%;border-collapse:collapse;font-size:12.5px}
  .oh-rc-items th{text-align:left;color:var(--muted);font-size:11px;border-bottom:1px solid var(--border);padding-bottom:4px}
  .oh-rc-items td{padding:4px 0;vertical-align:top}
  .oh-rc-items .c{text-align:center}.oh-rc-items .r{text-align:right;font-family:var(--mono)}
  .oh-mods{display:block;font-size:10.5px;color:var(--doing)}
  .oh-rc-sum{border-top:1px dashed var(--border2);margin-top:8px;padding-top:8px}
  .oh-pl{display:flex;justify-content:space-between;font-size:12.5px;padding:2px 0}
  .oh-pl b{font-family:var(--mono)}
  .oh-grand{font-size:14.5px;font-weight:800;color:var(--brand);border-top:1px solid var(--border);margin-top:4px;padding-top:5px}
  .oh-rc-inv{margin-top:10px;font-size:11px;color:var(--muted);font-family:var(--mono);text-align:center}
  .oh-rc-foot{text-align:center;font-size:11px;color:var(--muted);margin-top:10px}
  .oh-actions{display:flex;gap:10px;margin-top:14px;flex-wrap:wrap}
  .oh-actions .btn{flex:1;justify-content:center;min-width:130px}
  .oh-refund{margin-top:12px;background:rgba(239,68,68,.07);border:1px solid rgba(239,68,68,.25);border-radius:11px;padding:12px}
  .oh-refund label{font-size:11px;color:var(--muted);display:block;margin-bottom:5px}
  .oh-refund input{width:100%;padding:9px 11px;border-radius:9px;background:var(--surface);border:1px solid var(--border2);color:var(--text);font-size:13px}
  .oh-rf-act{display:flex;gap:8px;margin-top:10px}
  .oh-rf-act .btn{flex:1;justify-content:center}
  @media (max-width:640px){ .oh-body{grid-template-columns:1fr} .oh-left{border-right:0;border-bottom:1px solid var(--border)} }
  .receipt{background:#fff;color:#111;font-family:monospace;font-size:12px;width:100%;max-width:340px;margin:0 auto;padding:12px;border:1px dashed var(--border)}
  .receipt .c{text-align:center}
  .receipt h4{font-size:14px}
  .receipt hr{border:none;border-top:1px dashed #000;margin:8px 0}
  .receipt .li{display:flex;justify-content:space-between;gap:8px;padding:1.5px 0}
  .receipt .tt{font-weight:700;font-size:13.5px}
  .receipt.template{padding:0;overflow:hidden;border:1px solid var(--border);border-radius:8px}
  .receipt-canvas-live{position:relative;width:100%;background:#fff;color:#111;aspect-ratio:var(--receipt-ratio,72/180);min-height:360px}
  .receipt-canvas-live .tpl-el{position:absolute;white-space:pre-wrap;overflow:hidden;line-height:1.14;box-sizing:border-box}
  .receipt-canvas-live .tpl-img img{width:100%;height:100%;object-fit:contain}
  .receipt-canvas-live .tpl-line{border-top:1px dashed #000;height:0!important}
  .receipt-canvas-live .tpl-qr{display:flex;align-items:center;justify-content:center}
  .receipt-canvas-live .tpl-qr .qr{width:min(100%,84px);height:auto;aspect-ratio:1;margin:0}
  .receipt .qr{width:74px;height:74px;margin:8px auto 2px;background:repeating-conic-gradient(#111 0 25%,#fdfdf8 0 50%) 0 0/14px 14px;border:4px solid #111}`;
  document.head.appendChild(s);
}
