import { db, now, audit } from '../db.js';

const DEFAULTS = {
  ipad_staff_pin: '0000',
};
function storedFourDigitPin(value, fallback = DEFAULTS.ipad_staff_pin) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length >= 4 ? digits.slice(0, 4) : fallback;
}
const INTEGRATIONS_KEY = 'integrations_config';
const PRINT_CONFIG_KEY = 'print_config';
const OPERATIONS_CONFIG_KEY = 'operations_config';
const NOTIFICATION_SOUND_KEY = 'notification_sound_config';
const DEFAULT_PRINT_CONFIG = {
  version: 1,
  einvoice: {
    provider: 'MISA',
    taxCode: '',
    company: 'DAN D PAK SALA',
    address: 'Sala, TP.HCM',
    phone: '',
    email: '',
    series: 'C26TMB',
    template: '1/001',
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
    autoPrintDineIn: '1',
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
  },
  printers: [
    { id: 'kitchen', name: '', systemName: '', label: 'Phiếu bếp', type: 'Phiếu bếp', output: 'kitchen_ticket', location: 'Bếp', active: true, auto: true, connection: 'manual', ip: '', port: 9100, cashDrawer: false, openDrawerOnPrint: false },
    { id: 'bar', name: '', systemName: '', label: 'Phiếu bar', type: 'Phiếu bar', output: 'kitchen_ticket', location: 'Bar', active: true, auto: true, connection: 'manual', ip: '', port: 9100, cashDrawer: false, openDrawerOnPrint: false },
    { id: 'bill', name: '', systemName: '', label: 'Hóa đơn', type: 'Hóa đơn', output: 'receipt', location: 'Thu ngân', active: true, auto: true, connection: 'manual', ip: '', port: 9100, cashDrawer: true, openDrawerOnPrint: true },
    { id: 'label', name: '', systemName: '', label: 'Tem nhãn', type: 'Tem nhãn', output: 'cup_label', location: 'Quầy tem', active: true, auto: false, connection: 'manual', ip: '', port: 9100, cashDrawer: false, openDrawerOnPrint: false },
    { id: 'runner', name: '', systemName: '', label: 'Phiếu chạy món', type: 'Phiếu chạy món', output: 'runner', location: 'Runner', active: true, auto: false, connection: 'manual', ip: '', port: 9100, cashDrawer: false, openDrawerOnPrint: false },
    { id: 'report', name: '', systemName: '', label: 'Báo cáo A4', type: 'Báo cáo A4', output: 'report', location: 'Văn phòng', active: true, auto: false, connection: 'system', ip: '', port: 9100, cashDrawer: false, openDrawerOnPrint: false },
  ],
  templates: {
    label: null,
    bill: null,
  },
};

// Dan payment-receipt column grid (monospace, 42 cols):
// name(17) · SL(2) · Đ.Giá(9) · T.Tiền(10), single-space separators.
const DAN_BILL_COLS = { width: 42, nameW: 17, qtyW: 2, priceW: 9, amountW: 10 };
function danItemsHeader() {
  const { nameW, qtyW, priceW, amountW } = DAN_BILL_COLS;
  return 'Tên món'.padEnd(nameW) + ' ' + 'SL'.padStart(qtyW) + ' ' + 'Đ.Giá'.padStart(priceW) + ' ' + 'T.Tiền'.padStart(amountW);
}
function danCenter(text, width = DAN_BILL_COLS.width) {
  const s = String(text || '');
  if (s.length >= width) return s;
  return ' '.repeat(Math.floor((width - s.length) / 2)) + s;
}
function danBillRule() { return '-'.repeat(DAN_BILL_COLS.width); }

// Default "HÓA ĐƠN THANH TOÁN" payment receipt for Dan / Bon Appétit.
// Variables are filled per-device by each receipt renderer.
function defaultDanBillText() {
  return [
    '{storeNameC}',
    '{storeSubtitleC}',
    '',
    '{addressBlock}',
    'Tel: {phone}',
    danBillRule(),
    danCenter('HÓA ĐƠN THANH TOÁN'),
    '',
    'Số Hóa Đơn: {billNo}  {place}',
    '{customerInfoBlock}',
    'Thu ngân: {cashier}',
    'Ngày/Giờ vào: {timeIn}',
    'Ngày/Giờ ra: {timeOut}',
    danBillRule(),
    danItemsHeader(),
    '{items}',
    danBillRule(),
    '{totalLine}',
    '{paymentLines}',
    '{paidLine}',
    '{changeLine}',
    '',
    '{taxNoteC}',
    '{footerBrandC}',
    '{footerC}',
    '',
    '{qrNoteC}',
  ].join('\n');
}

function defaultDanBillTemplate(bill = DEFAULT_PRINT_CONFIG.bill) {
  const widthMm = Number(bill.widthMm) || 72;
  const requestedHeight = Number(bill.heightMm) || DEFAULT_PRINT_CONFIG.bill.heightMm;
  const heightMm = requestedHeight >= 300 && requestedHeight <= 500 ? requestedHeight : DEFAULT_PRINT_CONFIG.bill.heightMm;
  return {
    kind: 'bill',
    version: 5,
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
      { id: 'bill_totals', type: 'text', x: 4, y: 62, w: 92, h: 14, text: '{totalLine}\n{paymentLines}\n{paidLine}\n{changeLine}', fontSize: 3.6, bold: false, align: 'left' },
      { id: 'line_4', type: 'line', x: 4, y: 77, w: 92, h: 0.5 },
      { id: 'bill_footer', type: 'text', x: 4, y: 79, w: 92, h: 10, text: '{taxNoteC}\n{footerBrandC}\n{footerC}', fontSize: 3.5, bold: false, align: 'center' },
      { id: 'bill_qr', type: 'qr', x: 35, y: 90, w: 30, h: 8, qrMode: 'lookup', qrText: '{invoiceLookupUrl}', qrCaption: 'Quét QR tra cứu hóa đơn', qrShowCaption: true }
    ],
  };
}
const DEFAULT_INTEGRATIONS = {
  version: 1,
  channels: {
    misa: {
      enabled: false,
      environment: 'sandbox',
      apiBase: '',
      taxCode: '',
      companyName: '',
      username: '',
      password: '',
      appId: '',
      secretKey: '',
      autoIssue: false,
      syncInvoices: true,
      syncCustomers: true,
      note: '',
    },
    payos: {
      enabled: false,
      environment: 'sandbox',
      clientId: '',
      apiKey: '',
      checksumKey: '',
      apiBase: 'https://api-merchant.payos.vn',
      returnUrl: '',
      cancelUrl: '',
      note: '',
    },
    vietqr: {
      enabled: false,
      environment: 'sandbox',
      username: '',
      password: '',
      apiBase: '',
      bankCode: '',
      bankAccount: '',
      userBankName: '',
      terminalCode: '',
      subTerminalCode: '',
      serviceCode: '',
      note: '',
    },
    // Đường B: dịch vụ đọc biến động số dư ngân hàng → webhook tự đóng bill.
    sepay: {
      enabled: false,
      environment: 'production',
      apiKey: '',          // SePay gửi header "Authorization: Apikey <apiKey>"
      accountNumber: '',   // số tài khoản nhận (lọc đúng tài khoản, để trống = nhận hết)
      bankCode: '',
      note: '',
    },
    casso: {
      enabled: false,
      environment: 'production',
      webhookSecret: '',   // Casso gửi header "secure-token: <webhookSecret>"
      accountNumber: '',
      note: '',
    },
    grabmerchant: {
      enabled: false,
      environment: 'sandbox',
      merchantId: '',
      storeId: '',
      clientId: '',
      clientSecret: '',
      webhookSecret: '',
      orderMode: 'manual_confirm',
      syncOrders: true,
      syncMenu: true,
      syncInventory: false,
      autoAccept: false,
      printOnReceive: true,
      note: '',
    },
    shopeefood: {
      enabled: false,
      environment: 'sandbox',
      merchantId: '',
      storeId: '',
      clientId: '',
      clientSecret: '',
      webhookSecret: '',
      orderMode: 'manual_confirm',
      syncOrders: true,
      syncMenu: true,
      syncInventory: false,
      autoAccept: false,
      printOnReceive: true,
      note: '',
    },
    befood: {
      enabled: false,
      environment: 'sandbox',
      merchantId: '',
      storeId: '',
      clientId: '',
      clientSecret: '',
      webhookSecret: '',
      orderMode: 'manual_confirm',
      syncOrders: true,
      syncMenu: false,
      syncInventory: false,
      autoAccept: false,
      printOnReceive: true,
      note: '',
    },
    grabmart: {
      enabled: false,
      environment: 'sandbox',
      merchantId: '',
      storeId: '',
      clientId: '',
      clientSecret: '',
      webhookSecret: '',
      orderMode: 'manual_confirm',
      syncOrders: true,
      syncProducts: true,
      syncInventory: true,
      autoAccept: false,
      printOnReceive: true,
      note: '',
    },
    website: {
      enabled: false,
      environment: 'sandbox',
      publicUrl: '',
      apiKey: '',
      webhookSecret: '',
      orderMode: 'manual_confirm',
      syncOrders: true,
      syncMenu: true,
      syncInventory: false,
      autoAccept: false,
      printOnReceive: true,
      note: '',
    },
  },
};
const DEFAULT_OPERATIONS_CONFIG = {
  version: 1,
  payment: {
    bankName: 'Vietcombank',
    bankCode: 'VCB',
    bankAccount: '0123456789',
    accountName: 'DAN D PAK',
    qrProvider: 'vietqr_public',
    transferPrefix: 'DANBILL',
    posTerminalName: 'POS May 1',
    // Máy POS thẻ (VCB SmartPOS...). mode: auto = native bridge gọi app ngân hàng trên máy;
    // manual = thu ngân tự quẹt rồi nhập approval code (luôn chạy được); mock = demo; off = tắt.
    cardTerminal: { mode: 'auto', provider: 'vcb', terminalName: 'VCB SmartPOS', autoPrint: true },
    methods: [
      { key: 'cash', label: 'Tien mat', enabled: true, kind: 'cash' },
      { key: 'internet_banking', label: 'Internet Banking', enabled: true, kind: 'qr' },
      { key: 'qrcode', label: 'QR Code', enabled: true, kind: 'qr' },
      { key: 'card', label: 'May POS', enabled: true, kind: 'pos' },
      { key: 'visa', label: 'Visa', enabled: true, kind: 'pos' },
      { key: 'momo', label: 'MoMo Pay', enabled: false, kind: 'wallet' },
      { key: 'zalopay', label: 'ZaloPay', enabled: false, kind: 'wallet' },
      { key: 'voucher', label: 'Voucher', enabled: true, kind: 'voucher' },
    ],
    customNotes: [],
  },
  shifts: {
    labels: [
      { key: 'morning', label: 'Ca sang', enabled: true },
      { key: 'evening', label: 'Ca toi', enabled: true },
    ],
    denominations: [500000, 200000, 100000, 50000, 20000, 10000, 5000, 2000, 1000],
    requireOpenShift: true,
    defaultDrawerCash: 4000000,
  },
};

function bool(v, fallback = false) {
  if (v === undefined) return fallback;
  return v === true || v === 1 || v === '1' || v === 'true';
}
function str(v, max = 800) {
  return String(v ?? '').trim().slice(0, max);
}
function pickEnv(v) {
  return 'production';
}
function pickOrderMode(v) {
  return ['manual_confirm', 'auto_confirm'].includes(v) ? v : 'manual_confirm';
}
function mergeChannel(input = {}, def = {}) {
  const out = { ...def };
  for (const key of Object.keys(def)) {
    if (typeof def[key] === 'boolean') out[key] = bool(input[key], def[key]);
    else if (key === 'environment') out[key] = pickEnv(input[key]);
    else if (key === 'orderMode') out[key] = pickOrderMode(input[key]);
    else out[key] = str(input[key], key === 'note' ? 1200 : 500);
  }
  return out;
}
function sanitizeIntegrations(raw = {}) {
  const input = raw && typeof raw === 'object' ? raw : {};
  const channels = {};
  for (const [key, def] of Object.entries(DEFAULT_INTEGRATIONS.channels)) {
    channels[key] = mergeChannel(input.channels?.[key] || input[key] || {}, def);
  }
  return {
    version: 1,
    updated_at: input.updated_at || null,
    channels,
  };
}

function plainObject(v) {
  return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
}
function mergePlain(def, input = {}) {
  return { ...def, ...plainObject(input) };
}
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
function sanitizePrintTemplate(tpl) {
  if (!tpl || typeof tpl !== 'object') return null;
  return {
    ...tpl,
    elements: Array.isArray(tpl.elements) ? tpl.elements.map(el => plainObject(el)) : [],
  };
}
function sanitizeBillTemplate(tpl, bill) {
  const clean = sanitizePrintTemplate(tpl);
  // Anything that is not an up-to-date Dan payment receipt (e.g. the old BCM
  // fiscal template) is replaced with the Dan "HÓA ĐƠN THANH TOÁN" default.
  if (!clean || clean.kind !== 'bill' || clean.standard !== 'dan_payment_receipt' || Number(clean.version || 0) < 5) {
    return defaultDanBillTemplate(bill);
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
  if (raw.startsWith('brow')) return 'manual';
  if (['lan', 'system', 'agent', 'manual'].includes(raw)) return raw;
  if (str(p.ip || p.host || '', 80)) return 'lan';
  if (str(p.agent || '', 80)) return 'agent';
  if (str(p.systemName || p.name || '', 200)) return 'system';
  return 'manual';
}
function sanitizePrintConfig(raw = {}) {
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
    })),
    templates: {
      label: sanitizePrintTemplate(input.templates?.label || input.label_template),
      bill: sanitizeBillTemplate(input.templates?.bill || input.bill_template, bill),
    },
  };
}

function sanitizeCardTerminal(c) {
  const def = DEFAULT_OPERATIONS_CONFIG.payment.cardTerminal;
  const src = c && typeof c === 'object' ? c : {};
  const mode = ['auto', 'manual', 'mock', 'off'].includes(src.mode) ? src.mode : def.mode;
  return {
    mode,
    provider: str(src.provider || def.provider, 40).toLowerCase(),
    terminalName: str(src.terminalName || def.terminalName, 120),
    autoPrint: bool(src.autoPrint, def.autoPrint !== false),
  };
}

function sanitizePaymentMethod(m, i = 0) {
  const fallback = DEFAULT_OPERATIONS_CONFIG.payment.methods[i] || {};
  const key = str(m?.key || fallback.key || `custom_${i + 1}`, 80).replace(/\s+/g, '_').toLowerCase();
  return {
    key,
    label: str(m?.label || fallback.label || key, 120),
    enabled: bool(m?.enabled, fallback.enabled !== false),
    kind: ['cash', 'qr', 'pos', 'wallet', 'voucher', 'other'].includes(m?.kind) ? m.kind : (fallback.kind || 'other'),
    note: str(m?.note || '', 500),
  };
}
function sanitizeOperationsConfig(raw = {}) {
  const input = plainObject(raw);
  const payment = plainObject(input.payment);
  const shifts = plainObject(input.shifts);
  const rawMethods = Array.isArray(payment.methods) && payment.methods.length ? payment.methods : DEFAULT_OPERATIONS_CONFIG.payment.methods;
  const rawLabels = Array.isArray(shifts.labels) && shifts.labels.length ? shifts.labels : DEFAULT_OPERATIONS_CONFIG.shifts.labels;
  const rawDenoms = Array.isArray(shifts.denominations) && shifts.denominations.length ? shifts.denominations : DEFAULT_OPERATIONS_CONFIG.shifts.denominations;
  return {
    version: 1,
    updated_at: input.updated_at || null,
    payment: {
      ...mergePlain(DEFAULT_OPERATIONS_CONFIG.payment, payment),
      bankName: str(payment.bankName || DEFAULT_OPERATIONS_CONFIG.payment.bankName, 120),
      bankCode: str(payment.bankCode || DEFAULT_OPERATIONS_CONFIG.payment.bankCode, 30).toUpperCase(),
      bankAccount: str(payment.bankAccount || DEFAULT_OPERATIONS_CONFIG.payment.bankAccount, 80),
      accountName: str(payment.accountName || DEFAULT_OPERATIONS_CONFIG.payment.accountName, 160),
      qrProvider: str(payment.qrProvider || DEFAULT_OPERATIONS_CONFIG.payment.qrProvider, 40),
      transferPrefix: str(payment.transferPrefix || DEFAULT_OPERATIONS_CONFIG.payment.transferPrefix, 40).replace(/\s+/g, '').toUpperCase(),
      posTerminalName: str(payment.posTerminalName || DEFAULT_OPERATIONS_CONFIG.payment.posTerminalName, 120),
      cardTerminal: sanitizeCardTerminal(payment.cardTerminal),
      methods: rawMethods.map(sanitizePaymentMethod),
      customNotes: Array.isArray(payment.customNotes) ? payment.customNotes.map(x => str(x, 160)).filter(Boolean) : [],
    },
    shifts: {
      labels: rawLabels.map((x, i) => ({
        key: str(x?.key || `shift_${i + 1}`, 80).replace(/\s+/g, '_').toLowerCase(),
        label: str(x?.label || `Ca ${i + 1}`, 120),
        enabled: bool(x?.enabled, true),
      })).filter(x => x.key && x.label),
      denominations: rawDenoms.map(x => Math.max(0, parseInt(x) || 0)).filter(Boolean)
        .filter((x, i, arr) => arr.indexOf(x) === i).sort((a, b) => b - a),
      requireOpenShift: bool(shifts.requireOpenShift, true),
      defaultDrawerCash: Math.max(0, parseInt(shifts.defaultDrawerCash ?? DEFAULT_OPERATIONS_CONFIG.shifts.defaultDrawerCash) || 0),
    },
  };
}

export function getSettings(branch_id = 'br1') {
  const rows = db.prepare(`SELECT key,value FROM app_settings WHERE branch_id=?`).all(branch_id);
  const out = { ...DEFAULTS, ...Object.fromEntries(rows.map(r => [r.key, r.value])) };
  out.ipad_staff_pin = storedFourDigitPin(out.ipad_staff_pin);
  out.print_config = getPrintConfig(branch_id);
  out.operations_config = getOperationsConfig(branch_id);
  out.notification_sound_config = getNotificationSoundConfig(branch_id);
  return out;
}

export function updateSettings(body = {}, branch_id = 'br1') {
  const current = getSettings(branch_id);
  const next = {};
  if (body.ipad_staff_pin !== undefined) {
    const pin = String(body.ipad_staff_pin || '').trim();
    if (!/^\d{4}$/.test(pin)) throw new Error('Mật khẩu iPad phải đúng 4 chữ số');
    next.ipad_staff_pin = pin;
  }
  if (body.print_config !== undefined) {
    next.print_config = sanitizePrintConfig({ ...body.print_config, updated_at: now() });
  }
  if (body.operations_config !== undefined) {
    next.operations_config = sanitizeOperationsConfig({ ...body.operations_config, updated_at: now() });
  }
  if (body.notification_sound_config !== undefined) {
    next.notification_sound_config = body.notification_sound_config;
  }
  const ins = db.prepare(`INSERT OR REPLACE INTO app_settings (branch_id,key,value,updated_at) VALUES (?,?,?,?)`);
  for (const [key, value] of Object.entries(next)) {
    ins.run(branch_id, key, typeof value === 'object' ? JSON.stringify(value) : value, now());
  }
  audit('settings.update', { keys: Object.keys(next) }, branch_id);
  return { ...current, ...next };
}

export function autoSaveTemplate(body = {}, branch_id = 'br1') {
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
  db.prepare(`INSERT OR REPLACE INTO app_settings (branch_id,key,value,updated_at) VALUES (?,?,?,?)`)
    .run(branch_id, PRINT_CONFIG_KEY, JSON.stringify(next), now());
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

export function verifyIpadStaffPin(pin, branch_id = 'br1') {
  return String(pin || '') === getSettings(branch_id).ipad_staff_pin;
}

export function getPrintConfig(branch_id = 'br1') {
  const row = db.prepare(`SELECT value FROM app_settings WHERE branch_id=? AND key=?`).get(branch_id, PRINT_CONFIG_KEY);
  if (!row?.value) return sanitizePrintConfig(DEFAULT_PRINT_CONFIG);
  try { return sanitizePrintConfig(JSON.parse(row.value)); }
  catch { return sanitizePrintConfig(DEFAULT_PRINT_CONFIG); }
}

export function getIntegrations(branch_id = 'br1') {
  const row = db.prepare(`SELECT value FROM app_settings WHERE branch_id=? AND key=?`).get(branch_id, INTEGRATIONS_KEY);
  if (!row?.value) return sanitizeIntegrations(DEFAULT_INTEGRATIONS);
  try { return sanitizeIntegrations(JSON.parse(row.value)); }
  catch { return sanitizeIntegrations(DEFAULT_INTEGRATIONS); }
}

export function getOperationsConfig(branch_id = 'br1') {
  const row = db.prepare(`SELECT value FROM app_settings WHERE branch_id=? AND key=?`).get(branch_id, OPERATIONS_CONFIG_KEY);
  if (!row?.value) return sanitizeOperationsConfig(DEFAULT_OPERATIONS_CONFIG);
  try { return sanitizeOperationsConfig(JSON.parse(row.value)); }
  catch { return sanitizeOperationsConfig(DEFAULT_OPERATIONS_CONFIG); }
}

export function getNotificationSoundConfig(branch_id = 'br1') {
  const row = db.prepare(`SELECT value FROM app_settings WHERE branch_id=? AND key=?`).get(branch_id, NOTIFICATION_SOUND_KEY);
  if (!row?.value) return null;
  try { return JSON.parse(row.value); } catch { return null; }
}

export function updateNotificationSoundConfig(body = {}, branch_id = 'br1') {
  db.prepare(`INSERT OR REPLACE INTO app_settings (branch_id,key,value,updated_at) VALUES (?,?,?,?)`)
    .run(branch_id, NOTIFICATION_SOUND_KEY, JSON.stringify(body), now());
  audit('settings.update', { keys: [NOTIFICATION_SOUND_KEY] }, branch_id);
  return body;
}

export function updateIntegrations(body = {}, branch_id = 'br1') {
  const clean = sanitizeIntegrations({ ...body, updated_at: now() });
  db.prepare(`INSERT OR REPLACE INTO app_settings (branch_id,key,value,updated_at) VALUES (?,?,?,?)`)
    .run(branch_id, INTEGRATIONS_KEY, JSON.stringify(clean), now());
  const enabled = Object.entries(clean.channels).filter(([, c]) => c.enabled).map(([k]) => k);
  audit('settings.update', { keys: [INTEGRATIONS_KEY], enabled_integrations: enabled }, branch_id);
  return clean;
}
