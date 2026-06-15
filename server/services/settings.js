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
    taxCode: '0312345678',
    company: 'District 1 - HCMC',
    address: 'HCMC',
    series: '1C26TAA',
    template: '1/001',
    environment: 'demo',
    autoIssue: '0',
  },
  labels: {
    paper: '50x30',
    widthMm: 50,
    heightMm: 30,
    printerName: 'May in tem ly',
    copies: '1',
    printScale: 100,
    autoPrint: '1',
    templateKind: 'cup',
  },
  bill: {
    storeName: 'District 1 - HCMC',
    address: 'Branch: District 1 - HCMC',
    phone: '',
    paper: 'K80',
    widthMm: 72,
    heightMm: 180,
    printerName: 'May in Bill',
    copies: '1',
    printScale: 100,
    footer: 'Cam on quy khach',
    showQr: '1',
    autoPrint: '1',
  },
  printers: [
    { id: 'kitchen', name: 'May in Bep', type: 'Phieu bep', active: true, auto: true },
    { id: 'bar', name: 'May in Bar', type: 'Phieu bar', active: true, auto: true },
    { id: 'bill', name: 'May in Bill', type: 'Hoa don', active: true, auto: true },
    { id: 'label', name: 'May in Tem nhan', type: 'Tem nhan', active: true, auto: false },
  ],
  templates: {
    label: null,
    bill: null,
  },
};
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
function sanitizePrintTemplate(tpl) {
  if (!tpl || typeof tpl !== 'object') return null;
  return {
    ...tpl,
    elements: Array.isArray(tpl.elements) ? tpl.elements.map(el => plainObject(el)) : [],
  };
}
function sanitizePrintConfig(raw = {}) {
  const input = plainObject(raw);
  const printers = Array.isArray(input.printers) ? input.printers : DEFAULT_PRINT_CONFIG.printers;
  return {
    version: 1,
    updated_at: input.updated_at || null,
    einvoice: mergePlain(DEFAULT_PRINT_CONFIG.einvoice, input.einvoice),
    labels: mergePlain(DEFAULT_PRINT_CONFIG.labels, input.labels),
    bill: mergePlain(DEFAULT_PRINT_CONFIG.bill, input.bill),
    printers: printers.map((p, i) => ({
      id: str(p?.id || `printer_${i + 1}`, 80) || `printer_${i + 1}`,
      name: str(p?.name || `Printer ${i + 1}`, 200),
      type: str(p?.type || '', 120),
      active: bool(p?.active, true),
      auto: bool(p?.auto, false),
    })),
    templates: {
      label: sanitizePrintTemplate(input.templates?.label || input.label_template),
      bill: sanitizePrintTemplate(input.templates?.bill || input.bill_template),
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
