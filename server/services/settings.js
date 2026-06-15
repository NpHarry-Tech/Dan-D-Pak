import { db, now, audit } from '../db.js';

const DEFAULTS = {
  ipad_staff_pin: '000000',
};
const INTEGRATIONS_KEY = 'integrations_config';
const PRINT_CONFIG_KEY = 'print_config';
const OPERATIONS_CONFIG_KEY = 'operations_config';
const DEFAULT_PRINT_CONFIG = {
  version: 1,
  einvoice: {
    provider: 'MISA',
    taxCode: '0316756674',
    company: 'CÔNG TY TNHH DỊCH VỤ TIẾP THỊ BCM',
    address: '00.08 Tháp A1 - Khu chung cư phức hợp lô M1-M2 (Sarimi), Số 74 Nguyễn Cơ Thạch, Phường An Lợi Đông, TP. Thủ Đức, TP. Hồ Chí Minh',
    phone: '0938525659',
    email: 'customerservice@bcm-vn.com',
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
    templateKind: 'cup',
  },
  bill: {
    storeName: 'CÔNG TY TNHH DỊCH VỤ TIẾP THỊ BCM',
    storeSubtitle: '(Hệ thống Phân phối F&B & Retail BCM)',
    address: '00.08 Tháp A1 - Khu chung cư phức hợp lô M1-M2 (Sarimi), Số 74 Nguyễn Cơ Thạch, Phường An Lợi Đông, Thành phố Thủ Đức, Thành phố Hồ Chí Minh, Việt Nam',
    taxCode: '0316756674',
    phone: '0938525659',
    email: 'customerservice@bcm-vn.com',
    paper: 'K80',
    widthMm: 72,
    heightMm: 210,
    printerName: 'Máy in Bill',
    copies: '1',
    printScale: 100,
    footer: 'CẢM ƠN QUÝ KHÁCH - HẸN GẶP LẠI TẠI BCM!',
    showQr: '1',
    showTax: '1',
    taxIncludedText: 'Giá đã bao gồm thuế GTGT theo quy định',
    unitPriceMode: 'vat_included',
    autoPrint: '1',
  },
  printers: [
    { id: 'kitchen', name: 'Máy in Bếp', type: 'Phiếu bếp', active: true, auto: true },
    { id: 'bar', name: 'Máy in Bar', type: 'Phiếu bar', active: true, auto: true },
    { id: 'bill', name: 'Máy in Bill', type: 'Hóa đơn', active: true, auto: true },
    { id: 'label', name: 'Máy in Tem nhãn', type: 'Tem nhãn', active: true, auto: false },
  ],
  templates: {
    label: null,
    bill: null,
  },
};

function defaultBcmBillText() {
  return [
    '==================================================',
    '        {storeName}',
    '     {storeSubtitle}',
    'Địa chỉ: {address}',
    'Mã số thuế: {sellerTaxCode}',
    'Số điện thoại: {phone}',
    'Email: {email}',
    '==================================================',
    '',
    '                HÓA ĐƠN BÁN HÀNG',
    '          (Khởi tạo từ máy tính tiền)',
    '',
    'Ký hiệu HĐ: {invoiceSeries}      Số HĐ (Thuế): {taxInvoiceNo}',
    'Số Bill (Nội bộ): {billNo}',
    'Ngày lập: {date}       Giờ lập: {timeOnly}',
    'Thu ngân: {cashier}    Quầy/Bàn: {table}',
    '',
    'Khách hàng: {customerName}',
    'Mã số thuế: {customerTaxCode}',
    '--------------------------------------------------',
    'STT  Tên mặt hàng/Dịch vụ   SL   Đơn giá    Thành tiền',
    '--------------------------------------------------',
    '{items}',
    '--------------------------------------------------',
    'Cộng tiền hàng:                       {taxableAmount} VNĐ',
    'Thuế suất GTGT ({vatRate}%):          {vatAmount} VNĐ',
    '--------------------------------------------------',
    'TỔNG TIỀN THANH TOÁN:                 {grandTotal} VNĐ',
    '--------------------------------------------------',
    'Số tiền bằng chữ: {totalWords}.',
    '',
    'Hình thức thanh toán: {method}',
    'Trạng thái: {paymentStatus}',
    '',
    '--------------------------------------------------',
    'MÃ CỦA CƠ QUAN THUẾ:',
    '{taxAuthorityCode}',
    '',
    '(Quý khách có thể tra cứu hóa đơn này tại website:',
    'https://gdt.gov.vn bằng mã số thuế người bán',
    'và mã cơ quan thuế ở trên)',
    '',
    '==================================================',
    ' HÓA ĐƠN ĐIỆN TỬ KHỞI TẠO TỪ MÁY TÍNH TIỀN',
    '      {footer}',
  ].join('\n');
}

function defaultBcmBillTemplate(bill = DEFAULT_PRINT_CONFIG.bill) {
  const widthMm = Number(bill.widthMm) || 72;
  const requestedHeight = Number(bill.heightMm) || DEFAULT_PRINT_CONFIG.bill.heightMm;
  const heightMm = requestedHeight > 260 ? DEFAULT_PRINT_CONFIG.bill.heightMm : requestedHeight;
  return {
    kind: 'bill',
    version: 3,
    standard: 'bcm_fiscal_receipt',
    paper: bill.paper || 'K80',
    widthMm,
    heightMm,
    printerName: bill.printerName || 'Máy in Bill',
    copies: bill.copies || '1',
    printScale: Number(bill.printScale) || 100,
    selectedId: 'bill_body',
    elements: [
      { id: 'bill_body', type: 'text', x: 4, y: 3, w: 92, h: 94, text: defaultBcmBillText(), fontSize: 3.8, bold: false, align: 'left' },
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
    qrProvider: 'vietqr',
    transferPrefix: 'DANBILL',
    posTerminalName: 'POS May 1',
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
  return ['sandbox', 'production'].includes(v) ? v : 'sandbox';
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
  const legacyName = !bill.storeName || ['District 1 - HCMC', 'CONG TY TNHH DICH VU TIEP THI BCM'].includes(String(bill.storeName));
  const legacyAddress = !bill.address || String(bill.address).startsWith('Branch:') || String(bill.address).includes('00.08 Thap A1');
  const legacyFooter = !bill.footer || String(bill.footer).includes('CAM ON QUY KHACH') || String(bill.footer).includes('Cam on quy khach');
  return {
    ...bill,
    storeName: legacyName ? DEFAULT_PRINT_CONFIG.bill.storeName : bill.storeName,
    storeSubtitle: !bill.storeSubtitle || String(bill.storeSubtitle).includes('He thong') ? DEFAULT_PRINT_CONFIG.bill.storeSubtitle : bill.storeSubtitle,
    address: legacyAddress ? DEFAULT_PRINT_CONFIG.bill.address : bill.address,
    taxCode: bill.taxCode || DEFAULT_PRINT_CONFIG.bill.taxCode,
    phone: bill.phone || DEFAULT_PRINT_CONFIG.bill.phone,
    email: bill.email || DEFAULT_PRINT_CONFIG.bill.email,
    heightMm: Number(bill.heightMm) > 260 ? DEFAULT_PRINT_CONFIG.bill.heightMm : (Number(bill.heightMm) || DEFAULT_PRINT_CONFIG.bill.heightMm),
    footer: legacyFooter ? DEFAULT_PRINT_CONFIG.bill.footer : bill.footer,
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
  if (!clean || clean.kind !== 'bill' || Number(clean.version || 0) < 3) return defaultBcmBillTemplate(bill);
  const legacyBcm = clean.standard === 'bcm_fiscal_receipt'
    && (
      Number(clean.heightMm || 0) > 260
      || clean.elements.some(el => String(el.text || '').includes('HOA DON BAN HANG'))
    );
  if (legacyBcm) return defaultBcmBillTemplate(bill);
  return clean;
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
    bill,
    printers: printers.map((p, i) => ({
      id: str(p?.id || `printer_${i + 1}`, 80) || `printer_${i + 1}`,
      name: str(p?.name || `Printer ${i + 1}`, 200),
      type: str(p?.type || '', 120),
      active: bool(p?.active, true),
      auto: bool(p?.auto, false),
    })),
    templates: {
      label: sanitizePrintTemplate(input.templates?.label || input.label_template),
      bill: sanitizeBillTemplate(input.templates?.bill || input.bill_template, bill),
    },
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
    },
  };
}

export function getSettings(branch_id = 'br1') {
  const rows = db.prepare(`SELECT key,value FROM app_settings WHERE branch_id=?`).all(branch_id);
  const out = { ...DEFAULTS, ...Object.fromEntries(rows.map(r => [r.key, r.value])) };
  out.print_config = getPrintConfig(branch_id);
  out.operations_config = getOperationsConfig(branch_id);
  return out;
}

export function updateSettings(body = {}, branch_id = 'br1') {
  const current = getSettings(branch_id);
  const next = {};
  if (body.ipad_staff_pin !== undefined) {
    const pin = String(body.ipad_staff_pin || '').trim();
    if (!/^\d{4,8}$/.test(pin)) throw new Error('Mật khẩu iPad phải từ 4 đến 8 chữ số');
    next.ipad_staff_pin = pin;
  }
  if (body.print_config !== undefined) {
    next.print_config = sanitizePrintConfig({ ...body.print_config, updated_at: now() });
  }
  if (body.operations_config !== undefined) {
    next.operations_config = sanitizeOperationsConfig({ ...body.operations_config, updated_at: now() });
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

export function updateIntegrations(body = {}, branch_id = 'br1') {
  const clean = sanitizeIntegrations({ ...body, updated_at: now() });
  db.prepare(`INSERT OR REPLACE INTO app_settings (branch_id,key,value,updated_at) VALUES (?,?,?,?)`)
    .run(branch_id, INTEGRATIONS_KEY, JSON.stringify(clean), now());
  const enabled = Object.entries(clean.channels).filter(([, c]) => c.enabled).map(([k]) => k);
  audit('settings.update', { keys: [INTEGRATIONS_KEY], enabled_integrations: enabled }, branch_id);
  return clean;
}
