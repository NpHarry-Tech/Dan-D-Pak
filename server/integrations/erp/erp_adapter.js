// ─────────────────────────────────────────────────────────────────────────
// ERP ADAPTER — ranh giới giữa POS và ERP (mission #20). POS chỉ biết interface
// canonical này, KHÔNG biết protocol bên dưới (BC REST/OData). Đổi ERP = đổi
// adapter, không đụng POS.
//
// Interface (Promise):
//   getHealth()                       -> { ok, product, version?, company? }
//   getCompanies()                    -> [{ id, name }]
//   postSale(canonicalDoc)            -> { documentNo, entryNo? }
//   getPostingStatus(externalId)      -> { found, documentNo? }
//
// Implementation: BusinessCentralAdapter (business_central.js). Có thể thêm
// NavLegacyAdapter sau mà không đổi outbox/POS.
// ─────────────────────────────────────────────────────────────────────────

export const ERP_DOC_TYPES = Object.freeze({
  SALE: 'SALE',
  RETURN: 'RETURN',
  STOCK_ADJUST: 'STOCK_ADJUST',
  STOCK_TRANSFER: 'STOCK_TRANSFER',
});

// Phân loại lỗi để quyết định RETRY (mission #25). Chỉ lỗi TẠM THỜI mới retry;
// lỗi validation/mapping là VĨNH VIỄN → dead letter, không đấm mãi.
export const ERROR_CLASS = Object.freeze({
  AUTH: 'AUTH',
  TIMEOUT: 'TIMEOUT',
  NETWORK: 'NETWORK',
  RATE_LIMIT: 'RATE_LIMIT',
  VALIDATION: 'VALIDATION',
  MAPPING: 'MAPPING',
  NAV_POSTING: 'NAV_POSTING',
  DUPLICATE: 'DUPLICATE',
  UNKNOWN: 'UNKNOWN',
});

// Lỗi tạm thời → auto retry. VALIDATION/MAPPING/DUPLICATE → KHÔNG retry.
const TRANSIENT = new Set([
  ERROR_CLASS.AUTH, ERROR_CLASS.TIMEOUT, ERROR_CLASS.NETWORK,
  ERROR_CLASS.RATE_LIMIT, ERROR_CLASS.NAV_POSTING,
]);
export function isTransient(errorClass) { return TRANSIENT.has(errorClass); }

// DUPLICATE = BC đã có document với external_id này → coi như THÀNH CÔNG
// (idempotency). Không phải lỗi.
export function isDuplicate(errorClass) { return errorClass === ERROR_CLASS.DUPLICATE; }

export function classifyHttp(status, bodyText = '') {
  const b = String(bodyText || '').toLowerCase();
  if (status === 401 || status === 403) return ERROR_CLASS.AUTH;
  if (status === 408 || status === 504) return ERROR_CLASS.TIMEOUT;
  if (status === 429) return ERROR_CLASS.RATE_LIMIT;
  if (status >= 500) return ERROR_CLASS.NAV_POSTING;   // BC lỗi tạm thời phía server
  if (status === 409 || b.includes('already exists') || b.includes('duplicate')) return ERROR_CLASS.DUPLICATE;
  if (status === 400 || status === 422) {
    if (b.includes('does not exist') || b.includes('not found') || b.includes('mapping')) return ERROR_CLASS.MAPPING;
    return ERROR_CLASS.VALIDATION;
  }
  if (status === 404) return ERROR_CLASS.MAPPING;
  return ERROR_CLASS.UNKNOWN;
}

export function classifyNetworkError(err) {
  const m = String(err?.message || err || '').toLowerCase();
  if (m.includes('timeout') || m.includes('aborted')) return ERROR_CLASS.TIMEOUT;
  if (m.includes('econnrefused') || m.includes('enotfound') || m.includes('network') || m.includes('fetch failed'))
    return ERROR_CLASS.NETWORK;
  return ERROR_CLASS.UNKNOWN;
}

export class ErpError extends Error {
  constructor(message, errorClass = ERROR_CLASS.UNKNOWN, extra = {}) {
    super(message);
    this.name = 'ErpError';
    this.errorClass = errorClass;
    this.extra = extra;
  }
}

// external_id ỔN ĐỊNH cho idempotency (mission #24): DDP-SALE-<BRANCH>-<yyyymmdd>-<seq>.
export function buildExternalId(docType, branch, key) {
  const b = String(branch || 'SALA').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const k = String(key || '').toUpperCase().replace(/[^A-Z0-9-]/g, '');
  return `DDP-${docType}-${b}-${k}`;
}

// Chứng từ CANONICAL (mission #22) — POS mô tả nghiệp vụ, BC/adapter tự map sang
// document/dimension/posting group của nó.
export function canonicalSaleDoc(order, receipt, ctx = {}) {
  const items = Array.isArray(receipt?.items) ? receipt.items : (order?.items || []);
  return {
    external_id: ctx.externalId,
    event_id: ctx.eventId,
    branch: ctx.branch,
    document_type: ERP_DOC_TYPES.SALE,
    order_id: order?.id,
    bill_no: receipt?.bill_no || order?.bill_no || '',
    occurred_at: order?.paid_at || receipt?.paid_at || ctx.occurredAt,
    customer: {
      no: ctx.customerNo || '',
      name: receipt?.customer?.name || order?.customer?.name || '',
      tax_code: receipt?.customer?.tax_code || '',
    },
    location_code: ctx.locationCode || '',
    currency: 'VND',
    lines: items.map((i) => ({
      item_no: i.sku_code || i.code || i.item_no || '',
      description: i.name || '',
      quantity: Number(i.qty) || 1,
      unit_price: Number(i.unit_price ?? i.price) || 0,
      amount: Number(i.amount) || (Number(i.unit_price ?? i.price) || 0) * (Number(i.qty) || 1),
      vat_rate: Number(i.vat_rate) || 0,
      pos_ref: i.id || '',
    })),
    payments: (Array.isArray(receipt?.lines) ? receipt.lines : []).map((l) => ({
      method: l.method, amount: Number(l.amount) || 0,
    })),
    totals: {
      total: Number(receipt?.total ?? order?.total) || 0,
      vat_amount: Number(receipt?.vat_amount) || 0,
      goods_amount: Number(receipt?.goods_amount) || 0,
    },
  };
}
