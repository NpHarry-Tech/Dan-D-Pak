// Cấu hình tích hợp ERP — Microsoft Dynamics 365 Business Central.
//
// Lưu trong app_settings (key 'erp_config'). clientSecret MÃ HOÁ bằng
// core/crypto (AES-256-GCM) — không bao giờ trả secret thô ra API (chỉ masked).
// Mặc định enabled=false → không đụng gì hệ thống cho tới khi cửa hàng cấu hình.
import { audit } from '../../db.js';
import { emit } from '../../realtime.js';
import { decryptSecret, encryptSecret, isEncrypted, secretContext } from '../../core/crypto.js';
import { readJsonSetting, writeJsonSetting } from './shared.js';

export const ERP_CONFIG_KEY = 'erp_config';

const DEFAULTS = {
  provider: 'business_central',
  enabled: false,
  environment: 'production',       // tên môi trường BC (production/sandbox)
  tenantId: '',
  clientId: '',
  clientSecret: '',                // lưu ĐÃ MÃ HOÁ
  companyId: '',                   // GUID company trong BC
  baseUrl: 'https://api.businesscentral.dynamics.com',
  apiVersion: 'v2.0',
  // Endpoint nhận chứng từ bán hàng. Mặc định 'salesInvoices' (API chuẩn); nếu
  // dựng extension "DDP Integration Inbox" (mission #22) thì đổi sang tên đó.
  salesEndpoint: 'salesInvoices',
  defaultLocationCode: '',
  defaultCustomerNo: '',           // số khách lẻ mặc định trong BC
  postAutomatically: true,         // gọi action Post sau khi tạo document
};

function erpSecretContext(branchId) {
  return [secretContext({ tenant: branchId, provider: 'business_central', record: ERP_CONFIG_KEY, field: 'clientSecret' }), `erp:${branchId}:secret`];
}

function str(v, max = 400) { return String(v ?? '').trim().slice(0, max); }

function sanitize(raw = {}) {
  const r = raw || {};
  return {
    provider: 'business_central',
    enabled: r.enabled === true,
    environment: str(r.environment) || 'production',
    tenantId: str(r.tenantId, 100),
    clientId: str(r.clientId, 100),
    clientSecret: str(r.clientSecret, 4000),   // giữ nguyên (đã mã hoá) khi đọc
    companyId: str(r.companyId, 100),
    baseUrl: str(r.baseUrl, 200) || DEFAULTS.baseUrl,
    apiVersion: str(r.apiVersion, 20) || 'v2.0',
    salesEndpoint: str(r.salesEndpoint, 100) || 'salesInvoices',
    defaultLocationCode: str(r.defaultLocationCode, 40),
    defaultCustomerNo: str(r.defaultCustomerNo, 40),
    postAutomatically: r.postAutomatically !== false,
  };
}

/** Config THÔ (clientSecret vẫn mã hoá). Dùng để hiển thị/masked. */
export function getErpConfig(branch_id = 'sala') {
  const stored = readJsonSetting(branch_id, ERP_CONFIG_KEY, sanitize, null);
  return stored ? { ...DEFAULTS, ...stored } : { ...DEFAULTS };
}

/** Config RUNTIME cho adapter (clientSecret đã GIẢI MÃ). Không lộ ra API. */
export function getErpRuntimeConfig(branch_id = 'sala') {
  const cfg = getErpConfig(branch_id);
  let secret = cfg.clientSecret || '';
  try { if (isEncrypted(secret)) secret = decryptSecret(secret, erpSecretContext(branch_id)); } catch { secret = ''; }
  return { ...cfg, clientSecret: secret, branch_id };
}

/** Config PUBLIC cho API — che secret. */
export function publicErpConfig(branch_id = 'sala') {
  const cfg = getErpConfig(branch_id);
  return { ...cfg, clientSecret: cfg.clientSecret ? '********' : '', hasSecret: !!cfg.clientSecret };
}

export function updateErpConfig(body = {}, branch_id = 'sala') {
  const cur = getErpConfig(branch_id);
  const next = sanitize({ ...cur, ...body });
  // clientSecret: chỉ đổi khi client gửi giá trị MỚI thật (không phải mask). Mã
  // hoá trước khi lưu; gửi rỗng/mask thì giữ secret cũ.
  const incoming = str(body.clientSecret, 4000);
  if (!incoming || incoming === '********') {
    next.clientSecret = cur.clientSecret;          // giữ nguyên
  } else if (!isEncrypted(incoming)) {
    next.clientSecret = encryptSecret(incoming, erpSecretContext(branch_id));
  } else {
    next.clientSecret = incoming;
  }
  writeJsonSetting(branch_id, ERP_CONFIG_KEY, next);
  audit('settings.update', { keys: [ERP_CONFIG_KEY], enabled: next.enabled }, branch_id);
  emit('settings:updated', { keys: [ERP_CONFIG_KEY] }, branch_id);
  return publicErpConfig(branch_id);
}
