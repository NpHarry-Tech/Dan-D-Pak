// Cấu hình IN ẤN — màn "Cài đặt → Bill & Tem nhãn" + "Thiết bị / Máy in".
//
// Thứ tự trong file:
//   1. Schema mặc định  — DEFAULT_PRINT_CONFIG (einvoice / labels / kitchen / bill / printers)
//   2. Mẫu bill mặc định — defaultDanBillTemplate ("HÓA ĐƠN THANH TOÁN")
//   3. Chuẩn hoá        — migrate bill cũ, cap ảnh, suy ra loại/đường truyền máy in
//   4. Đọc / ghi        — getPrintConfig / autoSaveTemplate
import { now, audit } from '../../db.js';
import {
  PRINT_CONFIG_KEY, bool, str, plainObject, mergePlain,
  readJsonSetting, writeJsonSetting,
} from './shared.js';

// ── 1. Schema mặc định ──────────────────────────────────────────────────────
const DEFAULT_PRINT_CONFIG = {
  version: 1,
  einvoice: {
    provider: 'MISA',
    taxCode: '',
    company: 'DAN D PAK SALA',
    address: 'Sala, TP.HCM',
    phone: '',
    email: '',
    series: '',
    template: '',
    environment: 'demo',
    autoIssue: '0',
    invoiceMode: 'cash_register',
    legalBasis: 'ND70-2025_TT32-2025',
    issueTiming: 'at_payment',
    priceIncludesVat: '1',
    defaultVatRate: '8',
    standardVatRate: '10',
    vatReductionValidFrom: '2025-07-01',
    vatReductionValidTo: '2026-12-31',
    itemNamePolicy: 'exact_menu_sku',
    unitPolicy: 'required',
  },
  labels: {
    paper: '50x30',
    widthMm: 50,
    heightMm: 30,
    printerName: 'Máy in tem ly',
    copies: '1',
    printScale: 100,
    autoPrint: '1',
    templateKind: 'cup',
  },
  kitchen: {
    paper: 'K80',
    widthMm: 72,
    splitPerItem: '1',
    perUnit: '1',
    showStaff: '1',
  },
  bill: {
    storeName: 'Dan',
    storeSubtitle: 'Bon Appétit',
    address: 'Đường D9, KDT Sala, Phường An Khánh, Thành phố Hồ Chí Minh',
    taxCode: '',
    phone: '0938 525 659 - 0282 2533 607',
    email: '',
    paper: 'K80',
    widthMm: 72,
    heightMm: 320,
    printerName: 'Máy in Bill',
    copies: '1',
    printScale: 100,
    footer: 'Xin cảm ơn và hẹn gặp lại',
    showQr: '1',
    qrMode: 'lookup',
    qrText: '{invoiceLookupUrl}',
    qrCaption: 'Quét QR tra cứu hóa đơn',
    showTax: '1',
    taxIncludedText: 'Đơn giá đã bao gồm VAT',
    qrNote: 'Scan the QR code to let us know how you enjoyed meals with us',
    unitPriceMode: 'vat_included',
    autoPrint: '1',
    // Độ đậm bản in nhiệt (trình thiết kế mẫu in cho chọn light/medium/dark/max).
    // TỪNG THIẾU Ở ĐÂY: không có mặc định nên densityPrefix() nhận '' và không
    // gửi lệnh làm đậm nào, máy in chạy theo mặc định của nó — bản in rất mờ.
    // 'dark' khớp với giá trị trình thiết kế hiển thị khi chưa ai chỉnh.
    printDensity: 'dark',
  },
  printers: [
    { id: 'kitchen', name: '', systemName: '', label: 'Phiếu bếp', type: 'Phiếu bếp', output: 'kitchen_ticket', location: 'Bếp', active: true, auto: true, connection: 'browser', ip: '', port: 9100, cashDrawer: false, openDrawerOnPrint: false },
    { id: 'bar', name: '', systemName: '', label: 'Phiếu bar', type: 'Phiếu bar', output: 'kitchen_ticket', location: 'Bar', active: true, auto: true, connection: 'browser', ip: '', port: 9100, cashDrawer: false, openDrawerOnPrint: false },
    { id: 'bill', name: '', systemName: '', label: 'Hóa đơn', type: 'Hóa đơn', output: 'receipt', location: 'Thu ngân', active: true, auto: true, connection: 'browser', ip: '', port: 9100, cashDrawer: true, openDrawerOnPrint: true },
    { id: 'label', name: '', systemName: '', label: 'Tem nhãn', type: 'Tem nhãn', output: 'cup_label', location: 'Quầy tem', active: true, auto: false, connection: 'browser', ip: '', port: 9100, cashDrawer: false, openDrawerOnPrint: false },
    { id: 'runner', name: '', systemName: '', label: 'Phiếu chạy món', type: 'Phiếu chạy món', output: 'runner', location: 'Runner', active: true, auto: false, connection: 'browser', ip: '', port: 9100, cashDrawer: false, openDrawerOnPrint: false },
    { id: 'report', name: '', systemName: '', label: 'Báo cáo A4', type: 'Báo cáo A4', output: 'report', location: 'Văn phòng', active: true, auto: false, connection: 'system', ip: '', port: 9100, cashDrawer: false, openDrawerOnPrint: false },
  ],
  templates: {
    label: null,
    bill: null,
  },
};

// ── 2. Mẫu bill mặc định "HÓA ĐƠN THANH TOÁN" (Dan / Bon Appétit) ───────────
// Các biến {…} được từng renderer (web + máy in nhiệt) thay giá trị lúc in.
function defaultDanBillTemplate(bill = DEFAULT_PRINT_CONFIG.bill) {
  const widthMm = Number(bill.widthMm) || 72;
  const requestedHeight = Number(bill.heightMm) || DEFAULT_PRINT_CONFIG.bill.heightMm;
  const heightMm = requestedHeight >= 300 && requestedHeight <= 500 ? requestedHeight : DEFAULT_PRINT_CONFIG.bill.heightMm;
  return {
    kind: 'bill',
    version: 7,
    standard: 'dan_payment_receipt',
    paper: bill.paper || 'K80',
    widthMm,
    heightMm,
    printerName: bill.printerName || 'Máy in Bill',
    copies: bill.copies || '1',
    printScale: Number(bill.printScale) || 100,
    selectedId: 'bill_header',
    elements: [
      { id: 'bill_logo', type: 'image', x: 38, y: 3, w: 24, h: 8, src: '', originalSrc: '', imgMode: 'threshold', threshold: 150, contrast: 1 },
      { id: 'bill_header', type: 'text', x: 4, y: 12, w: 92, h: 14, text: '{storeNameC}\n{storeSubtitleC}\n{addressBlock}\nTel: {phone}', fontSize: 3.5, bold: false, align: 'center' },
      { id: 'line_1', type: 'line', x: 4, y: 27, w: 92, h: 0.5 },
      { id: 'bill_title', type: 'text', x: 4, y: 29, w: 92, h: 4, text: 'HÓA ĐƠN THANH TOÁN', fontSize: 4.5, bold: true, align: 'center' },
      { id: 'bill_info', type: 'text', x: 4, y: 34, w: 92, h: 12, text: 'Số Hóa Đơn: {billNo}  {place}\n{customerInfoBlock}\nThu ngân: {cashier}\nNgày/Giờ vào: {timeIn}\nNgày/Giờ ra: {timeOut}', fontSize: 3.5, bold: false, align: 'left' },
      { id: 'line_2', type: 'line', x: 4, y: 45, w: 92, h: 0.5 },
      { id: 'bill_items', type: 'text', x: 4, y: 47, w: 92, h: 12, text: 'Tên món             SL     Đ.Giá     T.Tiền\n{items}', fontSize: 3.5, bold: false, align: 'left' },
      { id: 'line_3', type: 'line', x: 4, y: 60, w: 92, h: 0.5 },
      { id: 'bill_totals', type: 'text', x: 4, y: 62, w: 92, h: 14, text: '{subtotalLine}\n{vatLine}\n{orderPromoLine}\n{grandTotalLine}\n{paymentLines}\n{paidLine}\n{changeLine}', fontSize: 3.6, bold: false, align: 'left' },
      { id: 'line_4', type: 'line', x: 4, y: 77, w: 92, h: 0.5 },
      { id: 'bill_footer', type: 'text', x: 4, y: 79, w: 92, h: 10, text: '{noteBlock}\n{taxNoteC}\n{footerBrandC}\n{footerC}', fontSize: 3.5, bold: false, align: 'center' },
      { id: 'bill_qr', type: 'qr', x: 35, y: 90, w: 30, h: 8, qrMode: 'lookup', qrText: '{invoiceLookupUrl}', qrCaption: 'Quét QR tra cứu hóa đơn', qrShowCaption: true },
    ],
  };
}

// ── 3. Chuẩn hoá ────────────────────────────────────────────────────────────
/** Cửa hàng từng chạy tên/địa chỉ của BCM. Giá trị legacy được thay bằng mặc
 *  định Dan khi đọc, nên không cần migrate DB thủ công. */
function migrateBcmBillDefaults(bill = {}) {
  const D = DEFAULT_PRINT_CONFIG.bill;
  const legacyNames = ['District 1 - HCMC', 'CONG TY TNHH DICH VU TIEP THI BCM', 'CÔNG TY TNHH DỊCH VỤ TIẾP THỊ BCM'];
  const legacyName = !bill.storeName || legacyNames.includes(String(bill.storeName).trim());
  const legacyAddress = !bill.address || String(bill.address).startsWith('Branch:') || String(bill.address).includes('00.08 Th') || String(bill.address).includes('Sarimi');
  const legacySubtitle = !bill.storeSubtitle || /He thong|Hệ thống|BCM/i.test(String(bill.storeSubtitle));
  const legacyPhone = !bill.phone || String(bill.phone).replace(/D/g, '') === '0938525659';
  const legacyEmail = !bill.email || /bcm-vn\.com/i.test(String(bill.email));
  const legacyFooter = !bill.footer || /BCM|CAM ON QUY KHACH|Cảm ơn quý khách/i.test(String(bill.footer));
  const legacyTaxNote = !bill.taxIncludedText || /GTGT/i.test(String(bill.taxIncludedText));
  return {
    ...bill,
    storeName: legacyName ? D.storeName : bill.storeName,
    storeSubtitle: legacySubtitle ? D.storeSubtitle : bill.storeSubtitle,
    address: legacyAddress ? D.address : bill.address,
    taxCode: bill.taxCode === undefined ? D.taxCode : bill.taxCode,
    phone: legacyPhone ? D.phone : bill.phone,
    email: legacyEmail ? D.email : bill.email,
    heightMm: Number(bill.heightMm) > 260 ? D.heightMm : (Number(bill.heightMm) || D.heightMm),
    footer: legacyFooter ? D.footer : bill.footer,
    taxIncludedText: legacyTaxNote ? D.taxIncludedText : bill.taxIncludedText,
    qrNote: bill.qrNote || D.qrNote,
  };
}

// Chặn ảnh logo quá lớn ngay lúc lưu — không giới hạn trước đây từng khiến 1
// ảnh base64 ~250KB bị nhúng lặp lại vào MỌI job in + MỌI hóa đơn lưu trữ,
// gây nghẽn CPU khi Hardware Agent đọc lại hàng chục job/lần (xem printing.js
// printConfigForJob). renderEl() chỉ in placeholder chữ cho phần tử ảnh, không
// cần ảnh nét cao — 80KB base64 (~60KB ảnh gốc) là quá đủ cho logo hóa đơn nhiệt.
const MAX_TEMPLATE_IMAGE_BYTES = 80_000;

function capTemplateImage(el) {
  if (!el || el.type !== 'image') return el;
  const out = { ...el };
  if (typeof out.src === 'string' && out.src.length > MAX_TEMPLATE_IMAGE_BYTES) out.src = '';
  if (typeof out.originalSrc === 'string' && out.originalSrc.length > MAX_TEMPLATE_IMAGE_BYTES) out.originalSrc = '';
  return out;
}

function sanitizePrintTemplate(tpl) {
  if (!tpl || typeof tpl !== 'object') return null;
  return {
    ...tpl,
    elements: Array.isArray(tpl.elements) ? tpl.elements.map(el => capTemplateImage(plainObject(el))) : [],
    rows: Array.isArray(tpl.rows) ? tpl.rows.map(el => capTemplateImage(plainObject(el))) : tpl.rows,
  };
}

function sanitizeBillTemplate(tpl, bill) {
  const clean = sanitizePrintTemplate(tpl);
  // Anything that is not an up-to-date Dan payment receipt (e.g. the old BCM
  // fiscal template) is replaced with the Dan "HÓA ĐƠN THANH TOÁN" default.
  if (!clean || clean.kind !== 'bill' || clean.standard !== 'dan_payment_receipt' || Number(clean.version || 0) < 6) {
    return defaultDanBillTemplate(bill);
  }
  if (Number(clean.version || 0) < 7) {
    clean.version = 7;
    clean.elements = clean.elements.map(el => el.id === 'bill_footer' && !String(el.text || '').includes('{noteBlock}')
      ? { ...el, text: `{noteBlock}\n${el.text || ''}` }
      : el);
  }
  return clean;
}

function inferPrinterOutput(p = {}) {
  const raw = String(p.output || p.jobType || p.type || p.id || '').toLowerCase();
  if (raw.includes('bill') || raw.includes('hóa đơn') || raw.includes('hoa don') || raw.includes('receipt')) return 'receipt';
  if (raw.includes('tem') || raw.includes('label')) return raw.includes('sản phẩm') || raw.includes('san pham') ? 'product_label' : 'cup_label';
  if (raw.includes('runner') || raw.includes('chạy món') || raw.includes('chay mon')) return 'runner';
  if (raw.includes('report') || raw.includes('báo cáo') || raw.includes('bao cao')) return 'report';
  return 'kitchen_ticket';
}

function inferPrinterConnection(p = {}) {
  const raw = String(p.connection || p.transport || '').toLowerCase();
  if (['lan', 'system', 'browser'].includes(raw)) return raw;
  if (str(p.ip || p.host || '', 80)) return 'lan';
  if (str(p.systemName || p.name || '', 200)) return 'system';
  return 'browser';
}

export function sanitizePrintConfig(raw = {}) {
  const input = plainObject(raw);
  const bill = migrateBcmBillDefaults(mergePlain(DEFAULT_PRINT_CONFIG.bill, input.bill));
  const printers = Array.isArray(input.printers) ? input.printers : DEFAULT_PRINT_CONFIG.printers;
  return {
    version: 1,
    updated_at: input.updated_at || null,
    einvoice: mergePlain(DEFAULT_PRINT_CONFIG.einvoice, input.einvoice),
    labels: mergePlain(DEFAULT_PRINT_CONFIG.labels, input.labels),
    kitchen: mergePlain(DEFAULT_PRINT_CONFIG.kitchen, input.kitchen),
    bill,
    printers: printers.map((p, i) => ({
      id: str(p?.id || `printer_${i + 1}`, 80) || `printer_${i + 1}`,
      name: str(p?.name || p?.systemName || '', 200),
      systemName: str(p?.systemName || p?.name || '', 200),
      label: str(p?.label || p?.type || `Printer ${i + 1}`, 120),
      type: str(p?.type || p?.label || '', 120),
      output: inferPrinterOutput(p),
      location: str(p?.location || '', 120),
      active: bool(p?.active, true),
      auto: bool(p?.auto, false),
      connection: inferPrinterConnection(p),
      ip: str(p?.ip || p?.host || '', 80),
      port: Math.max(1, Math.min(65535, parseInt(p?.port) || 9100)),
      cashDrawer: bool(p?.cashDrawer || p?.drawer, false),
      openDrawerOnPrint: bool(p?.openDrawerOnPrint, false),
      // MÁY CHỦ TRÌ tuyến in này (device_id của máy POS). Khi hai máy POS cùng
      // với tới một máy in bill, đây là máy được ưu tiên in — để phiếu luôn ra ở
      // đúng một chỗ thay vì máy nào giành được thì in. Bỏ trống = máy nào đang
      // cắm máy in đó cũng in được (hành vi cũ). Máy chủ trì offline thì tự
      // chuyển cho máy khác, không để tắc bán hàng — xem pendingAgentJobs.
      primaryDeviceId: str(p?.primaryDeviceId || p?.primary_device_id || '', 120),
    })),
    templates: {
      label: sanitizePrintTemplate(input.templates?.label || input.label_template),
      bill: sanitizeBillTemplate(input.templates?.bill || input.bill_template, bill),
    },
  };
}

// ── 4. Đọc / ghi ────────────────────────────────────────────────────────────
export function getPrintConfig(branch_id = 'sala') {
  return readJsonSetting(branch_id, PRINT_CONFIG_KEY, sanitizePrintConfig, DEFAULT_PRINT_CONFIG);
}

/** Trình thiết kế mẫu in tự lưu sau mỗi thao tác — ghi thẳng print_config,
 *  không đi qua updateSettings để tránh đụng các nhóm cấu hình khác. */
export function autoSaveTemplate(body = {}, branch_id = 'sala') {
  const kind = body.kind === 'label' ? 'label' : 'bill';
  const current = getPrintConfig(branch_id);
  const next = sanitizePrintConfig({
    ...current,
    bill: body.bill ? mergePlain(current.bill, body.bill) : current.bill,
    labels: body.labels ? mergePlain(current.labels, body.labels) : current.labels,
    templates: {
      ...(current.templates || {}),
      [kind]: body.template,
    },
    updated_at: now(),
  });
  writeJsonSetting(branch_id, PRINT_CONFIG_KEY, next);
  audit('settings.template_autosave', {
    kind,
    elements: next.templates?.[kind]?.elements?.length || 0,
  }, branch_id);
  return {
    ok: true,
    kind,
    saved_at: next.updated_at,
    template: next.templates?.[kind] || null,
    print_config: next,
  };
}
