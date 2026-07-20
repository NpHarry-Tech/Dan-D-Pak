import { db, now, audit } from '../db.js';
import { emit } from '../realtime.js';
import {
  DEFAULT_TAX_FILING_PROFILE as TAX_DEFAULT_PROFILE,
  sanitizeTaxFilingProfile as sanitizeTaxProfile,
} from './tax.js';

const DEFAULTS = {
  ipad_staff_pin: '0000',
};
function storedFourDigitPin(value, fallback = DEFAULTS.ipad_staff_pin) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length >= 4 ? digits.slice(0, 4) : fallback;
}
// Mật khẩu 4 số dễ đoán — cấm dùng cho thiết bị khách (kiosk đặt tại bàn, ai
// cũng chạm được nên PIN yếu = mở toang màn nhân viên).
const WEAK_IPAD_PINS = new Set([
  '0000', '1111', '2222', '3333', '4444', '5555', '6666', '7777', '8888', '9999',
  '1234', '4321', '2345', '3456', '4567', '5678', '6789', '0123', '1212', '2580',
]);
const INTEGRATIONS_KEY = 'integrations_config';
const PRINT_CONFIG_KEY = 'print_config';
const OPERATIONS_CONFIG_KEY = 'operations_config';
const NOTIFICATION_SOUND_KEY = 'notification_sound_config';
const TAX_FILING_PROFILE_KEY = 'tax_filing_profile';
const CUSTOMER_DISPLAY_KEY = 'customer_display';
const LOYALTY_CONFIG_KEY = 'loyalty_config';

// Second-screen (customer-facing display) config. Ad images are stored inline
// as data URLs — same approach as the receipt logo — so no upload pipeline is
// needed. Capped to keep the settings row a sane size.
const DEFAULT_CUSTOMER_DISPLAY = {
  enabled: false,
  secondsPerImage: 20,
  images: [], // list of 'data:image/...' (or http) URLs
};
const CUSTOMER_DISPLAY_MAX_IMAGES = 12;

const DEFAULT_LOYALTY_CONFIG = {
  version: 1,
  enabled: false,
  phoneRequired: true,
  earn: {
    amount: { enabled: true, spend: 10000, points: 1, rounding: 'floor', minSpend: 0 },
    order: { enabled: false, points: 1, minSpend: 0 },
    birthday: { enabled: false, multiplier: 2 },
    productBonus: [],
  },
  redeem: { enabled: false, pointValue: 1000, minPoints: 10, maxPercent: 50 },
  cashback: { enabled: false, percent: 0, as: 'points', minSpend: 0 },
  tiers: [
    { name: 'Silver', fromPoints: 0, earnMultiplier: 1, discountPct: 0 },
    { name: 'Gold', fromPoints: 200, earnMultiplier: 1.1, discountPct: 3 },
    { name: 'Platinum', fromPoints: 600, earnMultiplier: 1.25, discountPct: 5 },
  ],
  actions: [
    { key: 'signup', label: 'Đăng ký số điện thoại', points: 10, enabled: true },
    { key: 'referral', label: 'Giới thiệu bạn bè', points: 30, enabled: false },
    { key: 'review', label: 'Đánh giá trải nghiệm', points: 5, enabled: false },
    { key: 'birthday', label: 'Quà sinh nhật', points: 20, enabled: false },
  ],
};

const DEFAULT_TAX_FILING_PROFILE = {
  hasProfile: false,
  taxCode: '',
  businessName: '',
  transitionDate: '',
  locations: [],
  revenueGroup: 1,
  productScope: 'all',
  scopeValue: [],
  confirmNoTax: false,
  taxRates: [
    { category: 'distribution', name: 'Bán buôn/Bán lẻ', vat: 1.0, pit: 0.5 },
    { category: 'services', name: 'Dịch vụ', vat: 5.0, pit: 2.0 },
    { category: 'manufacturing', name: 'Sản xuất', vat: 3.0, pit: 1.5 },
    { category: 'catering', name: 'Ăn uống/Giải trí', vat: 2.0, pit: 1.0 }
  ]
};
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
// Variables are filled per-device by each receipt renderer (web + thermal).
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
    '{subtotalLine}',
    '{vatLine}',
    '{orderPromoLine}',
    '{grandTotalLine}',
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
    version: 6,
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
    haravan: {
      enabled: false,
      environment: 'production',
      shopDomain: '',
      accessToken: '',
      webhookSecret: '',
      clientId: '',
      clientSecret: '',
      verifyToken: '',
      locationId: '',
      apiBase: 'https://apis.haravan.com',
      defaultBranchId: 'ONLINE',
      orderMode: 'manual_confirm',
      syncOrders: true,
      syncProducts: true,
      syncInventory: true,
      printOnReceive: true,
      note: '',
    },
  },
};
// Card-terminal hardware the POS app can drive. The A920Pro is an Android smart
// POS (PAX Technology, Shenzhen) — the bank/acquirer app runs ON the device and
// the POS app triggers it via native intent in "auto" mode.
export const CARD_TERMINAL_MODELS = [
  { key: 'pax_a920pro', label: 'PAX A920Pro', vendor: 'PAX Technology (Shenzhen)', android: true, builtinPrinter: true },
  { key: 'pax_a920', label: 'PAX A920', vendor: 'PAX Technology', android: true, builtinPrinter: true },
  { key: 'pax_a80', label: 'PAX A80', vendor: 'PAX Technology', android: true, builtinPrinter: true },
  { key: 'vcb_smartpos', label: 'VCB SmartPOS', vendor: 'Vietcombank', android: true, builtinPrinter: true },
  { key: 'sunmi_p2', label: 'Sunmi P2', vendor: 'Sunmi', android: true, builtinPrinter: true },
  { key: 'other', label: 'Máy khác', vendor: '', android: false, builtinPrinter: false },
];
// Acquirer / bank app that actually authorises the card payment on the device.
export const CARD_TERMINAL_PROVIDERS = [
  { key: 'vcb', label: 'Vietcombank (VCB)' },
  { key: 'vietinbank', label: 'VietinBank' },
  { key: 'bidv', label: 'BIDV' },
  { key: 'techcombank', label: 'Techcombank' },
  { key: 'mbbank', label: 'MB Bank' },
  { key: 'napas', label: 'NAPAS' },
  { key: 'other', label: 'Khác' },
];

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
    // Máy POS thẻ (PAX A920Pro của PAX Technology - Shenzhen). mode: auto = native
    // bridge gọi app ngân hàng chạy trên máy; manual = thu ngân tự quẹt rồi nhập
    // approval code (luôn chạy được); mock = demo; off = tắt. deviceModel = phần cứng,
    // provider = ngân hàng/acquirer xử lý giao dịch trên máy đó.
    cardTerminal: { mode: 'auto', provider: 'vcb', deviceModel: 'pax_a920pro', terminalName: 'PAX A920Pro', autoPrint: true },
    // 4 phương thức chuẩn (đã gom): Internet Banking + QR Code → bank
    // ("Chuyển khoản"), Máy POS + Visa → visa. Config cũ được canonicalize
    // khi đọc (consolidatePaymentMethods) nên không cần migrate DB.
    methods: [
      { key: 'cash', label: 'Tiền mặt', enabled: true, kind: 'cash' },
      { key: 'bank', label: 'Chuyển khoản', enabled: true, kind: 'qr' },
      { key: 'visa', label: 'Visa', enabled: true, kind: 'pos' },
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
const MASKED_SECRET_PREFIX = '********';
const SECRET_FIELD_RE = /(password|secret|apikey|checksumkey|clientsecret|token)/i;
function isSecretField(key) {
  return SECRET_FIELD_RE.test(String(key || ''));
}
export function isMaskedIntegrationSecret(v) {
  const s = String(v ?? '').trim();
  return s.startsWith(MASKED_SECRET_PREFIX) || /^•{4,}/u.test(s);
}
function maskSecretValue(v) {
  const s = str(v, 500);
  if (!s) return '';
  return `${MASKED_SECRET_PREFIX}${s.slice(-4)}`;
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
function mergeIntegrationsForSave(body = {}, branch_id = 'br1') {
  const input = plainObject(body);
  const current = getIntegrations(branch_id);
  const channels = {};
  const inputChannels = plainObject(input.channels);
  for (const [key, def] of Object.entries(DEFAULT_INTEGRATIONS.channels)) {
    const hasChannel = Object.prototype.hasOwnProperty.call(inputChannels, key)
      || Object.prototype.hasOwnProperty.call(input, key);
    const provided = hasChannel ? plainObject(inputChannels[key] || input[key]) : {};
    const base = current.channels?.[key] || {};
    const merged = hasChannel ? { ...base, ...provided } : base;
    for (const field of Object.keys(def)) {
      if (!isSecretField(field)) continue;
      if (merged[field] === undefined || isMaskedIntegrationSecret(merged[field])) {
        merged[field] = base[field] || '';
      }
    }
    channels[key] = merged;
  }
  return { ...input, version: 1, updated_at: now(), channels };
}
function maskIntegrations(clean = {}) {
  const out = { ...clean, channels: {} };
  for (const [key, channel] of Object.entries(clean.channels || {})) {
    out.channels[key] = { ...channel };
    for (const field of Object.keys(out.channels[key])) {
      if (isSecretField(field)) out.channels[key][field] = maskSecretValue(out.channels[key][field]);
    }
  }
  return out;
}
export function mergeIntegrationChannelSecrets(channel, input = {}, branch_id = 'br1') {
  const key = String(channel || '').trim();
  const def = DEFAULT_INTEGRATIONS.channels[key];
  if (!def) return plainObject(input);
  const current = getIntegrations(branch_id).channels?.[key] || {};
  const out = { ...current, ...plainObject(input) };
  for (const field of Object.keys(def)) {
    if (!isSecretField(field)) continue;
    if (out[field] === undefined || isMaskedIntegrationSecret(out[field])) {
      out[field] = current[field] || '';
    }
  }
  return out;
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
  if (!clean || clean.kind !== 'bill' || clean.standard !== 'dan_payment_receipt' || Number(clean.version || 0) < 6) {
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
  if (['lan', 'system', 'browser'].includes(raw)) return raw;
  if (str(p.ip || p.host || '', 80)) return 'lan';
  if (str(p.systemName || p.name || '', 200)) return 'system';
  return 'browser';
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
  const rawModel = str(src.deviceModel || def.deviceModel, 40).toLowerCase();
  const deviceModel = CARD_TERMINAL_MODELS.some(m => m.key === rawModel) ? rawModel : def.deviceModel;
  return {
    mode,
    provider: str(src.provider || def.provider, 40).toLowerCase(),
    deviceModel,
    terminalName: str(src.terminalName || def.terminalName, 120),
    ip: str(src.ip || '127.0.0.1', 80),
    port: Math.max(1, Math.min(65535, parseInt(src.port) || 25000)),
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

// Gom các key phương thức cũ về 4 chuẩn: Internet Banking / QR Code /
// bank_transfer → bank ("Chuyển khoản"); Máy POS (card) / Visa → visa.
// Config đã lưu trong DB được canonicalize mỗi lần đọc, nên client luôn
// thấy đúng 4 tab dù chi nhánh chưa lưu lại settings.
const METHOD_CANON = {
  cash: 'cash',
  bank: 'bank', internet_banking: 'bank', qrcode: 'bank', qr: 'bank',
  bank_transfer: 'bank', banking: 'bank', transfer: 'bank',
  visa: 'visa', card: 'visa', pos_card: 'visa', pos: 'visa', may_pos: 'visa', credit: 'visa',
  voucher: 'voucher',
};
const CANON_LABEL = { cash: 'Tiền mặt', bank: 'Chuyển khoản', visa: 'Visa', voucher: 'Voucher' };
const CANON_KIND = { cash: 'cash', bank: 'qr', visa: 'pos', voucher: 'voucher' };

export function canonicalMethodKey(key) {
  return METHOD_CANON[String(key || '').trim().toLowerCase()] || String(key || '').trim().toLowerCase();
}

function consolidatePaymentMethods(list) {
  const out = [];
  const byKey = new Map();
  for (const m of list) {
    const canon = canonicalMethodKey(m.key);
    const existing = byKey.get(canon);
    if (existing) {
      // Gom trùng: bật nếu bất kỳ bản ghi nào đang bật.
      existing.enabled = existing.enabled || m.enabled;
      continue;
    }
    const merged = {
      ...m,
      key: canon,
      label: CANON_LABEL[canon] || m.label,
      kind: CANON_KIND[canon] || m.kind,
    };
    byKey.set(canon, merged);
    out.push(merged);
  }
  return out;
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
      methods: consolidatePaymentMethods(rawMethods.map(sanitizePaymentMethod)),
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

// ── Cấu hình bán RETAIL (Cài đặt → Kho & kênh bán) ──────────────────────────
// Hai "mặt trận" bán retail: POS bán lẻ độc lập (standalone) và mục "Thêm
// retail" trong POS F&B (fnb). Mỗi bên chọn KHO lấy hàng + BẢNG GIÁ riêng;
// sync=true → fnb dùng y cấu hình standalone (tick "đồng bộ cả 2").
const DEFAULT_RETAIL_CONFIG = {
  sync: true,
  standalone: { warehouse_id: '', price_book_id: 'default' },
  fnb: { warehouse_id: '', price_book_id: 'default' },
};

function sanitizeRetailSection(raw = {}) {
  return {
    // '' = theo liên kết kênh bán của kho (hành vi cũ, không ép kho cụ thể).
    warehouse_id: String(raw?.warehouse_id || '').slice(0, 80),
    price_book_id: String(raw?.price_book_id || 'default').slice(0, 80) || 'default',
  };
}

export function sanitizeRetailConfig(raw = {}) {
  const standalone = sanitizeRetailSection(raw.standalone);
  const sync = raw.sync !== false;
  return {
    sync,
    standalone,
    fnb: sync ? { ...standalone } : sanitizeRetailSection(raw.fnb),
  };
}

export function getRetailConfig(branch_id = 'br1') {
  const row = db.prepare(`SELECT value FROM app_settings WHERE branch_id=? AND key='retail_config'`).get(branch_id);
  let parsed = {};
  try { parsed = row?.value ? JSON.parse(row.value) : {}; } catch { parsed = {}; }
  return sanitizeRetailConfig({ ...DEFAULT_RETAIL_CONFIG, ...parsed });
}

export function getSettings(branch_id = 'br1') {
  const rows = db.prepare(`SELECT key,value FROM app_settings WHERE branch_id=?`).all(branch_id);
  const out = { ...DEFAULTS, ...Object.fromEntries(rows.map(r => [r.key, r.value])) };
  out.ipad_staff_pin = storedFourDigitPin(out.ipad_staff_pin);
  // Cờ để Cài đặt cảnh báo/ép đổi: thiết bị khách còn dùng mật khẩu mặc định 0000.
  out.ipad_pin_is_default = WEAK_IPAD_PINS.has(out.ipad_staff_pin);
  out.print_config = getPrintConfig(branch_id);
  out.operations_config = getOperationsConfig(branch_id);
  out.notification_sound_config = getNotificationSoundConfig(branch_id);
  out.tax_filing_profile = getTaxFilingProfile(branch_id);
  out.customer_display = getCustomerDisplayConfig(branch_id);
  out.loyalty_config = getLoyaltyConfig(branch_id);
  out.retail_config = getRetailConfig(branch_id);
  return out;
}

export function updateSettings(body = {}, branch_id = 'br1') {
  const current = getSettings(branch_id);
  const next = {};
  if (body.ipad_staff_pin !== undefined) {
    const pin = String(body.ipad_staff_pin || '').trim();
    if (!/^\d{4}$/.test(pin)) throw new Error('Mật khẩu iPad phải đúng 4 chữ số');
    // Ép đặt mật khẩu MẠNH khi thiết lập: không cho lưu dãy mặc định/dễ đoán
    // (0000/1111/1234…) — chống việc đổi từ mặc định này sang mặc định khác.
    if (WEAK_IPAD_PINS.has(pin)) throw new Error('Mật khẩu iPad quá dễ đoán (0000/1111/1234…). Hãy chọn 4 số khác.');
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
  if (body.tax_filing_profile !== undefined) {
    next.tax_filing_profile = sanitizeTaxFilingProfile(body.tax_filing_profile);
  }
  if (body.customer_display !== undefined) {
    next.customer_display = sanitizeCustomerDisplay(body.customer_display);
  }
  if (body.loyalty_config !== undefined) {
    next.loyalty_config = sanitizeLoyaltyConfig(body.loyalty_config);
  }
  if (body.retail_config !== undefined) {
    next.retail_config = sanitizeRetailConfig(body.retail_config);
  }
  const ins = db.prepare(`INSERT OR REPLACE INTO app_settings (branch_id,key,value,updated_at) VALUES (?,?,?,?)`);
  for (const [key, value] of Object.entries(next)) {
    ins.run(branch_id, key, typeof value === 'object' ? JSON.stringify(value) : value, now());
  }
  audit('settings.update', { keys: Object.keys(next) }, branch_id);
  // Đồng bộ đa thiết bị: mọi máy đang mở (POS/tablet/KDS) tự tải lại config
  // (phương thức thanh toán, âm báo, màn khách...) ngay khi settings đổi.
  emit('settings:updated', { keys: Object.keys(next) }, branch_id);
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

function sanitizeCustomerDisplay(input = {}) {
  const src = input && typeof input === 'object' ? input : {};
  const images = Array.isArray(src.images)
    ? src.images
        .map(x => String(x || ''))
        .filter(x => x.startsWith('data:image/') || x.startsWith('http'))
        .slice(0, CUSTOMER_DISPLAY_MAX_IMAGES)
    : [];
  return {
    enabled: bool(src.enabled, false),
    secondsPerImage: Math.max(5, Math.min(120,
      parseInt(src.secondsPerImage) || DEFAULT_CUSTOMER_DISPLAY.secondsPerImage)),
    images,
  };
}

function nonNegativeInt(v, fallback = 0) {
  const n = parseInt(v);
  return Number.isFinite(n) ? Math.max(0, n) : fallback;
}

function nonNegativeNumber(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, n) : fallback;
}

function sanitizeLoyaltyConfig(input = {}) {
  const src = plainObject(input);
  const earn = plainObject(src.earn);
  const amount = plainObject(earn.amount);
  const order = plainObject(earn.order);
  const birthday = plainObject(earn.birthday);
  const redeem = plainObject(src.redeem);
  const cashback = plainObject(src.cashback);
  const tiers = (Array.isArray(src.tiers) ? src.tiers : DEFAULT_LOYALTY_CONFIG.tiers)
    .map((t, i) => ({
      name: str(t?.name || DEFAULT_LOYALTY_CONFIG.tiers[i]?.name || `Tier ${i + 1}`, 60),
      fromPoints: nonNegativeInt(t?.fromPoints, 0),
      earnMultiplier: Math.max(0.1, Math.min(20, nonNegativeNumber(t?.earnMultiplier, 1))),
      discountPct: Math.min(100, nonNegativeNumber(t?.discountPct, 0)),
    }))
    .filter(t => t.name)
    .sort((a, b) => a.fromPoints - b.fromPoints)
    .slice(0, 12);
  const actions = (Array.isArray(src.actions) ? src.actions : DEFAULT_LOYALTY_CONFIG.actions)
    .map((a, i) => ({
      key: str(a?.key || `action_${i + 1}`, 60).replace(/\s+/g, '_').toLowerCase(),
      label: str(a?.label || `Hành vi ${i + 1}`, 120),
      points: nonNegativeInt(a?.points, 0),
      enabled: bool(a?.enabled, false),
    }))
    .filter(a => a.key && a.label)
    .slice(0, 30);
  const productBonus = (Array.isArray(earn.productBonus) ? earn.productBonus : [])
    .map((p, i) => ({
      key: str(p?.key || `product_${i + 1}`, 60).replace(/\s+/g, '_').toLowerCase(),
      match: ['sku', 'category', 'name', 'brand'].includes(p?.match) ? p.match : 'sku',
      value: str(p?.value || '', 160),
      multiplier: Math.max(1, Math.min(20, nonNegativeNumber(p?.multiplier, 1))),
      extraPoints: nonNegativeInt(p?.extraPoints, 0),
      enabled: bool(p?.enabled, true),
    }))
    .filter(p => p.value)
    .slice(0, 50);
  return {
    version: 1,
    enabled: bool(src.enabled, DEFAULT_LOYALTY_CONFIG.enabled),
    phoneRequired: bool(src.phoneRequired, DEFAULT_LOYALTY_CONFIG.phoneRequired),
    earn: {
      amount: {
        enabled: bool(amount.enabled, true),
        spend: Math.max(1, nonNegativeInt(amount.spend, DEFAULT_LOYALTY_CONFIG.earn.amount.spend)),
        points: nonNegativeInt(amount.points, DEFAULT_LOYALTY_CONFIG.earn.amount.points),
        rounding: ['floor', 'round', 'ceil'].includes(amount.rounding) ? amount.rounding : 'floor',
        minSpend: nonNegativeInt(amount.minSpend, 0),
      },
      order: {
        enabled: bool(order.enabled, false),
        points: nonNegativeInt(order.points, DEFAULT_LOYALTY_CONFIG.earn.order.points),
        minSpend: nonNegativeInt(order.minSpend, 0),
      },
      birthday: {
        enabled: bool(birthday.enabled, false),
        multiplier: Math.max(1, Math.min(20, nonNegativeNumber(birthday.multiplier, 2))),
      },
      productBonus,
    },
    redeem: {
      enabled: bool(redeem.enabled, false),
      pointValue: nonNegativeInt(redeem.pointValue, DEFAULT_LOYALTY_CONFIG.redeem.pointValue),
      minPoints: nonNegativeInt(redeem.minPoints, DEFAULT_LOYALTY_CONFIG.redeem.minPoints),
      maxPercent: Math.min(100, nonNegativeNumber(redeem.maxPercent, DEFAULT_LOYALTY_CONFIG.redeem.maxPercent)),
    },
    cashback: {
      enabled: bool(cashback.enabled, false),
      percent: Math.min(100, nonNegativeNumber(cashback.percent, 0)),
      as: cashback.as === 'voucher' ? 'voucher' : 'points',
      minSpend: nonNegativeInt(cashback.minSpend, 0),
    },
    tiers: tiers.length ? tiers : DEFAULT_LOYALTY_CONFIG.tiers,
    actions,
    updated_at: src.updated_at || now(),
  };
}

export function getCustomerDisplayConfig(branch_id = 'br1') {
  const row = db.prepare(`SELECT value FROM app_settings WHERE branch_id=? AND key=?`)
    .get(branch_id, CUSTOMER_DISPLAY_KEY);
  if (!row?.value) return { ...DEFAULT_CUSTOMER_DISPLAY };
  try {
    return sanitizeCustomerDisplay(JSON.parse(row.value));
  } catch {
    return { ...DEFAULT_CUSTOMER_DISPLAY };
  }
}

export function getLoyaltyConfig(branch_id = 'br1') {
  const row = db.prepare(`SELECT value FROM app_settings WHERE branch_id=? AND key=?`)
    .get(branch_id, LOYALTY_CONFIG_KEY);
  if (!row?.value) return sanitizeLoyaltyConfig(DEFAULT_LOYALTY_CONFIG);
  try {
    return sanitizeLoyaltyConfig(JSON.parse(row.value));
  } catch {
    return sanitizeLoyaltyConfig(DEFAULT_LOYALTY_CONFIG);
  }
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

export function getPublicIntegrations(branch_id = 'br1') {
  return maskIntegrations(getIntegrations(branch_id));
}

function hasConfiguredChannel(channel = {}) {
  const c = plainObject(channel);
  return bool(c.enabled)
    || !!str(c.shopDomain || c.publicUrl || c.apiKey || c.accessToken || c.webhookSecret || c.clientSecret || c.checksumKey);
}

export function getIntegrationChannel(channel, branch_id = 'br1') {
  const key = String(channel || '').trim();
  const direct = getIntegrations(branch_id).channels?.[key];
  if (hasConfiguredChannel(direct)) return direct;
  const rows = db.prepare(`SELECT value FROM app_settings WHERE key=? ORDER BY updated_at DESC`).all(INTEGRATIONS_KEY);
  for (const row of rows) {
    try {
      const found = sanitizeIntegrations(JSON.parse(row.value)).channels?.[key];
      if (hasConfiguredChannel(found)) return found;
    } catch {}
  }
  return direct || DEFAULT_INTEGRATIONS.channels[key] || {};
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
  emit('settings:updated', { keys: [NOTIFICATION_SOUND_KEY] }, branch_id);
  return body;
}

export function updateIntegrations(body = {}, branch_id = 'br1') {
  const clean = sanitizeIntegrations(mergeIntegrationsForSave(body, branch_id));
  db.prepare(`INSERT OR REPLACE INTO app_settings (branch_id,key,value,updated_at) VALUES (?,?,?,?)`)
    .run(branch_id, INTEGRATIONS_KEY, JSON.stringify(clean), now());
  const enabled = Object.entries(clean.channels).filter(([, c]) => c.enabled).map(([k]) => k);
  audit('settings.update', { keys: [INTEGRATIONS_KEY], enabled_integrations: enabled }, branch_id);
  emit('settings:updated', { keys: [INTEGRATIONS_KEY] }, branch_id);
  return maskIntegrations(clean);
}

export function getTaxFilingProfile(branch_id = 'br1') {
  const row = db.prepare(`SELECT value FROM app_settings WHERE branch_id=? AND key=?`).get(branch_id, TAX_FILING_PROFILE_KEY);
  if (!row?.value) return sanitizeTaxProfile(TAX_DEFAULT_PROFILE);
  try { return sanitizeTaxProfile(JSON.parse(row.value)); }
  catch { return sanitizeTaxProfile(TAX_DEFAULT_PROFILE); }
}

export function sanitizeTaxFilingProfile(raw = {}) {
  return sanitizeTaxProfile(raw);
}
