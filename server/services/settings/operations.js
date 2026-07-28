// Cấu hình VẬN HÀNH — màn "Cài đặt → Vận hành": tài khoản nhận chuyển khoản,
// máy POS thẻ, phương thức thanh toán và ca làm việc.
//
// Thứ tự trong file:
//   1. Phần cứng máy POS thẻ — CARD_TERMINAL_MODELS / CARD_TERMINAL_PROVIDERS
//   2. Schema mặc định        — DEFAULT_OPERATIONS_CONFIG
//   3. Gom phương thức TT     — canonicalMethodKey / consolidatePaymentMethods
//   4. Chuẩn hoá + đọc        — sanitizeOperationsConfig / getOperationsConfig
import {
  OPERATIONS_CONFIG_KEY, bool, str, plainObject, mergePlain, readJsonSetting,
} from './shared.js';

// ── 1. Phần cứng máy POS thẻ ────────────────────────────────────────────────
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

// ── 2. Schema mặc định ──────────────────────────────────────────────────────
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

// ── 3. Gom phương thức thanh toán về 4 chuẩn ────────────────────────────────
// Internet Banking / QR Code / bank_transfer → bank ("Chuyển khoản");
// Máy POS (card) / Visa → visa. Config đã lưu trong DB được canonicalize mỗi
// lần đọc, nên client luôn thấy đúng 4 tab dù chi nhánh chưa lưu lại settings.
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

// ── 4. Chuẩn hoá + đọc ──────────────────────────────────────────────────────
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

export function sanitizeOperationsConfig(raw = {}) {
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

export function getOperationsConfig(branch_id = 'br1') {
  return readJsonSetting(branch_id, OPERATIONS_CONFIG_KEY, sanitizeOperationsConfig, DEFAULT_OPERATIONS_CONFIG);
}
