// Cấu hình LIÊN KẾT ĐỐI TÁC — màn "Cài đặt → Liên kết".
//
// Toàn bộ vòng đời của một kênh liên kết nằm trong file này, theo thứ tự:
//   1. Mã hoá secret     — mapIntegrationSecrets / hasPlaintextIntegrationSecret
//   2. Schema mặc định   — DEFAULT_INTEGRATIONS (nguồn sự thật của mọi field)
//   3. Che secret        — isSecretField / maskSecretValue / maskIntegrations
//   4. Chuẩn hoá & merge — mergeChannel / sanitizeIntegrations / merge*ForSave
//   5. Đọc / ghi         — getIntegrations / getPublicIntegrations / updateIntegrations
//
// Nguyên tắc: secret KHÔNG BAO GIỜ rời server ở dạng nguyên văn. API luôn trả
// bản đã che ("********1234"); khi client lưu lại bản che đó thì giá trị cũ
// trong DB được giữ nguyên (xem mergeIntegrationsForSave).
import { db, now, audit } from '../../db.js';
import { emit } from '../../realtime.js';
import { decryptSecret, encryptSecret, isEncrypted } from '../../core/crypto.js';
import {
  INTEGRATIONS_KEY, bool, str, plainObject, writeJsonSetting,
} from './shared.js';

// ── 1. Mã hoá secret khi lưu xuống DB ───────────────────────────────────────
const SECRET_SETTING_KEYS = /^(password|secretKey|apiKey|checksumKey|clientSecret|accessToken|refreshToken|webhookSecret|verifyToken)$/i;

/** Duyệt đệ quy config, mã hoá (encrypt=true) hoặc giải mã (false) mọi field
 *  bí mật. Context gắn theo đường dẫn field nên secret của kênh này không thể
 *  bị dùng lại ở kênh khác. */
function mapIntegrationSecrets(value, branchId, encrypt, path = []) {
  if (Array.isArray(value)) {
    return value.map((item, index) =>
      mapIntegrationSecrets(item, branchId, encrypt, [...path, String(index)]));
  }
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    const nextPath = [...path, key];
    const context = `settings:${branchId}:${nextPath.join('.')}`;
    if (SECRET_SETTING_KEYS.test(key) && typeof item === 'string' && item) {
      if (encrypt) {
        out[key] = encryptSecret(item, context);
      } else {
        try {
          out[key] = decryptSecret(item, context);
        } catch (error) {
          if (branchId !== 'sala') throw error;
          out[key] = decryptSecret(item, `settings:br1:${nextPath.join('.')}`);
        }
      }
    } else {
      out[key] = mapIntegrationSecrets(item, branchId, encrypt, nextPath);
    }
  }
  return out;
}

function hasPlaintextIntegrationSecret(value) {
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).some(([key, item]) =>
    (SECRET_SETTING_KEYS.test(key) && typeof item === 'string' && item && !isEncrypted(item)) ||
    hasPlaintextIntegrationSecret(item));
}

// ── 2. Schema mặc định của từng kênh ────────────────────────────────────────
// Đây là NGUỒN SỰ THẬT: thêm field ở đây thì form Cài đặt → Liên kết mới nhận,
// vì sanitizeIntegrations chỉ giữ đúng những key có trong def.
const DEFAULT_INTEGRATIONS = {
  version: 1,
  channels: {
    misa: {
      enabled: false,
      environment: 'sandbox',
      integrationType: 'UNCONFIRMED',
      taxMethod: 'UNCONFIRMED',
      roundingPolicy: 'UNCONFIRMED',
      templateId: '',
      // Ký hiệu hóa đơn — LUÔN lấy theo mẫu đã chọn (đồng bộ từ MISA), không
      // gõ tay: sai ký hiệu là phát hành dưới ký hiệu chưa đăng ký với cơ quan
      // thuế.
      series: '',
      invoiceType: '',
      invoiceCodeType: '',
      defaultTaxRate: '8',
      priceIncludesVat: true,
      configurationTestPassed: false,
      lastTestedAt: '',
      // Kết quả lần kiểm tra kết nối gần nhất — để màn Cài đặt nói được đang
      // hỏng ở khâu nào thay vì chỉ "không kết nối được".
      lastTestError: '',
      lastTestStatus: '',
      // Danh sách mẫu MISA trả về ở lần kiểm tra gần nhất (JSON), để chọn mẫu
      // không phải gọi lại MISA.
      availableTemplates: '',
      // Ghi đè đường dẫn API theo hợp đồng riêng của doanh nghiệp. Để trống là
      // dùng mặc định API v3. Có ô này thì lệch hợp đồng chỉ cần sửa Cài đặt,
      // KHÔNG phải sửa code và build lại.
      endpointAuth: '',
      endpointCompany: '',
      endpointTemplates: '',
      endpointPublish: '',
      endpointStatus: '',
      endpointCancel: '',
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
      syncOrders: false,
      syncCustomers: true,
      syncProducts: true,
      syncInventory: true,
      printOnReceive: true,
      note: '',
    },
    // ── Sàn TMĐT — kết nối đơn/hàng/tồn qua Open Platform từng sàn ──────────────
    // Secret field name PHẢI khớp SECRET_SETTING_KEYS (anchored) để được mã hoá:
    // password|secretKey|apiKey|checksumKey|clientSecret|accessToken|refreshToken|
    // webhookSecret|verifyToken. Vì vậy "partner key/app secret" đều lưu ở secretKey.
    shopee: {
      enabled: false,
      environment: 'sandbox',
      region: 'VN',
      partnerId: '',
      shopId: '',
      secretKey: '',      // Shopee partner key
      accessToken: '',
      refreshToken: '',
      webhookSecret: '',
      // Để trống = connector chọn TEST/LIVE theo SHOPEE_ENV/environment.
      // Custom endpoint chỉ dùng khi có yêu cầu được xác minh.
      apiBase: '',
      orderMode: 'manual_confirm',
      syncOrders: true,
      syncProducts: true,
      syncInventory: true,
      printOnReceive: false,
      note: '',
    },
    tiktokshop: {
      enabled: false,
      environment: 'sandbox',
      region: 'VN',
      appId: '',          // TikTok Shop app_key
      serviceId: '',      // dùng cho link ủy quyền services.tiktokshop.com
      shopId: '',
      shopCipher: '',
      secretKey: '',      // app_secret
      accessToken: '',
      refreshToken: '',
      webhookSecret: '',
      apiBase: 'https://open-api.tiktokglobalshop.com',
      orderMode: 'manual_confirm',
      syncOrders: true,
      syncProducts: true,
      syncInventory: true,
      printOnReceive: false,
      note: '',
    },
    lazada: {
      enabled: false,
      environment: 'sandbox',
      region: 'VN',
      appId: '',          // Lazada app_key
      sellerId: '',
      secretKey: '',      // app_secret
      accessToken: '',
      refreshToken: '',
      webhookSecret: '',
      apiBase: 'https://api.lazada.vn/rest',
      orderMode: 'manual_confirm',
      syncOrders: true,
      syncProducts: true,
      syncInventory: true,
      printOnReceive: false,
      note: '',
    },
    tiki: {
      enabled: false,
      environment: 'sandbox',
      sellerId: '',
      clientId: '',
      clientSecret: '',
      accessToken: '',
      refreshToken: '',
      webhookSecret: '',
      apiBase: 'https://api.tiki.vn/integration',
      orderMode: 'manual_confirm',
      syncOrders: true,
      syncProducts: true,
      syncInventory: true,
      printOnReceive: false,
      note: '',
    },
    // ── Mạng xã hội — hội thoại đa kênh Dan D Pak Omni ─────────────────────────
    facebook: {
      enabled: false,
      environment: 'production',
      appId: '',
      pageId: '',
      clientSecret: '',   // Meta App Secret (ký X-Hub-Signature-256)
      accessToken: '',    // Page access token
      verifyToken: '',
      apiBase: 'https://graph.facebook.com/v21.0',
      note: '',
    },
    instagram: {
      enabled: false,
      environment: 'production',
      appId: '',
      igUserId: '',
      pageId: '',
      clientSecret: '',
      accessToken: '',
      verifyToken: '',
      apiBase: 'https://graph.facebook.com/v21.0',
      note: '',
    },
    zalooa: {
      enabled: false,
      environment: 'production',
      oaId: '',
      appId: '',
      secretKey: '',      // Zalo app secret (ký webhook mac)
      accessToken: '',    // OA access token
      refreshToken: '',
      webhookSecret: '',
      verifyToken: '',
      apiBase: 'https://openapi.zalo.me/v3.0',
      note: '',
    },
  },
};

// ── 3. Che secret trước khi trả ra API ──────────────────────────────────────
const MASKED_SECRET_PREFIX = '********';
const SECRET_FIELD_RE = /(password|secret|apikey|checksumkey|clientsecret|token)/i;

function isSecretField(key) {
  return SECRET_FIELD_RE.test(String(key || ''));
}

/** Client gửi lại đúng chuỗi đã che → hiểu là "không đổi", giữ giá trị cũ. */
export function isMaskedIntegrationSecret(v) {
  const s = String(v ?? '').trim();
  return s.startsWith(MASKED_SECRET_PREFIX) || /^•{4,}/u.test(s);
}

function maskSecretValue(v) {
  const s = str(v, 500);
  if (!s) return '';
  return `${MASKED_SECRET_PREFIX}${s.slice(-4)}`;
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

// ── 4. Chuẩn hoá & merge ────────────────────────────────────────────────────
function pickEnv(v) {
  return String(v).toLowerCase() === 'production' ? 'production' : 'sandbox';
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

/** Merge body client gửi lên với cấu hình đang lưu. Field bí mật bị bỏ trống
 *  hoặc còn ở dạng che sẽ lấy lại giá trị cũ — client không cần biết secret
 *  thật vẫn lưu được các field khác của cùng kênh. */
function mergeIntegrationsForSave(body = {}, branch_id = 'sala') {
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

/** Bản dùng cho MỘT kênh (nút "Kiểm tra cấu hình" gửi config chưa lưu). */
export function mergeIntegrationChannelSecrets(channel, input = {}, branch_id = 'sala') {
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

// ── 5. Đọc / ghi ────────────────────────────────────────────────────────────
/** Bản GIẢI MÃ, dùng NỘI BỘ (gọi API đối tác). Không trả thẳng ra client. */
export function getIntegrations(branch_id = 'sala') {
  const row = db.prepare(`SELECT value FROM app_settings WHERE branch_id=? AND key=?`)
    .get(branch_id, INTEGRATIONS_KEY);
  if (!row?.value) return sanitizeIntegrations(DEFAULT_INTEGRATIONS);
  try {
    const stored = JSON.parse(row.value);
    const clean = sanitizeIntegrations(mapIntegrationSecrets(stored, branch_id, false));
    // Dòng cũ còn secret nguyên văn (lưu từ trước khi bật mã hoá) → mã hoá tại chỗ.
    if (hasPlaintextIntegrationSecret(stored)) {
      db.prepare(`UPDATE app_settings SET value=?,updated_at=? WHERE branch_id=? AND key=?`)
        .run(JSON.stringify(mapIntegrationSecrets(clean, branch_id, true)), now(), branch_id, INTEGRATIONS_KEY);
    }
    return clean;
  }
  catch { return sanitizeIntegrations(DEFAULT_INTEGRATIONS); }
}

/** Bản ĐÃ CHE secret — đây là thứ API GET /settings/integrations trả về. */
export function getPublicIntegrations(branch_id = 'sala') {
  return maskIntegrations(getIntegrations(branch_id));
}

/** Lấy cấu hình MỘT kênh của đúng chi nhánh. Chi nhánh chưa cấu hình thì
 *  trả mặc định, tuyệt đối không mượn API key/secret từ chi nhánh khác. */
export function getIntegrationChannel(channel, branch_id = 'sala') {
  const key = String(channel || '').trim();
  return getIntegrations(branch_id).channels?.[key]
    || DEFAULT_INTEGRATIONS.channels[key]
    || {};
}

export function updateIntegrations(body = {}, branch_id = 'sala') {
  const clean = sanitizeIntegrations(mergeIntegrationsForSave(body, branch_id));
  writeJsonSetting(branch_id, INTEGRATIONS_KEY, mapIntegrationSecrets(clean, branch_id, true));
  const enabled = Object.entries(clean.channels).filter(([, c]) => c.enabled).map(([k]) => k);
  audit('settings.update', { keys: [INTEGRATIONS_KEY], enabled_integrations: enabled }, branch_id);
  emit('settings:updated', { keys: [INTEGRATIONS_KEY] }, branch_id);
  return maskIntegrations(clean);
}
