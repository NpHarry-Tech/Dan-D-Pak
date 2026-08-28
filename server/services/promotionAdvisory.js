// §9 PROMOTION COMPLIANCE ADVISORY (quyết định owner 2026-08-27: KHÔNG enforce
// cap cứng nào trong pricing engine).
//
// Engine tính giá CANONICAL như bình thường. Layer này CHỈ:
//   1. phát hiện tình huống cần lưu ý (ưu đãi rất lớn theo ngưỡng CẢNH BÁO);
//   2. trả cờ để UI hiển thị cảnh báo;
//   3. cung cấp metadata cho audit.
//
// TUYỆT ĐỐI KHÔNG: sửa discount, clamp %, đổi giá, từ chối checkout, disable
// promotion, silently ignore. Không suy đoán tính hợp pháp rồi block nghiệp vụ.

/**
 * Ngưỡng CẢNH BÁO (%) — CHỈ để NHẮC người dùng kiểm tra khi ưu đãi rất lớn. Đây
 * KHÔNG phải legal_cap: không ảnh hưởng pricing/checkout/invoice/stock/payment.
 * Chưa cấu hình (PROMOTION_ADVISORY_THRESHOLD_PCT) ⇒ null ⇒ KHÔNG cảnh báo theo %.
 */
export function advisoryThresholdPct() {
  const raw = Number(process.env.PROMOTION_ADVISORY_THRESHOLD_PCT);
  return Number.isFinite(raw) && raw > 0 ? raw : null;
}

/**
 * Đánh giá advisory cho một mức ưu đãi. KHÔNG THAY ĐỔI TIỀN — chỉ cho biết có nên
 * hiển thị cảnh báo hay không.
 * @returns {advise, discount_pct, threshold_pct}
 */
export function promotionAdvisory(discount, subtotal, { thresholdPct = advisoryThresholdPct() } = {}) {
  const d = Math.max(0, Number(discount) || 0);
  const sub = Math.max(0, Number(subtotal) || 0);
  const pct = sub > 0 ? (d / sub) * 100 : 0;
  const advise = thresholdPct != null && pct > thresholdPct;
  return { advise, discount_pct: Math.round(pct * 100) / 100, threshold_pct: thresholdPct };
}

/** Wording cảnh báo (KHÔNG dùng "vi phạm pháp luật" — hệ thống không đủ dữ kiện kết luận). */
export const ADVISORY_MESSAGE =
  'Chương trình này có mức ưu đãi cao. Vui lòng kiểm tra quy định khuyến mại hiện hành và hồ sơ chương trình trước khi áp dụng cho khách hàng.';

// ── TAXONOMY canonical (phân loại, KHÔNG enforce) ───────────────────────────
export const PROMOTION_TAXONOMY = Object.freeze({
  STANDARD_PROMOTION: 'STANDARD_PROMOTION',
  CONCENTRATED_PROMOTION: 'CONCENTRATED_PROMOTION',
  GIFT: 'GIFT',
  BUY_X_GET_Y: 'BUY_X_GET_Y',
  VOUCHER_PROMOTION: 'VOUCHER_PROMOTION',
  VOUCHER_PAYMENT: 'VOUCHER_PAYMENT',
});

// Nghiệp vụ nội bộ — KHÔNG phải CTKM bán cho khách. Phải TÁCH khỏi consumer
// promotion trong reporting/audit/accounting/analytics; KHÔNG ép qua cap consumer.
export const INTERNAL_USAGE = Object.freeze({
  QA_TESTING: 'QA_TESTING',
  KITCHEN_USE: 'KITCHEN_USE',
  PRODUCTION_USE: 'PRODUCTION_USE',
});
export function isInternalUsage(kind) {
  return Object.prototype.hasOwnProperty.call(INTERNAL_USAGE, String(kind || '').toUpperCase());
}

export function classifyPromotion({ type = '', scope = '' } = {}) {
  const t = String(type).toLowerCase();
  if (scope === 'combo') return PROMOTION_TAXONOMY.CONCENTRATED_PROMOTION;
  if (t === 'buy_x_get_1') return PROMOTION_TAXONOMY.BUY_X_GET_Y;
  if (t === 'gift') return PROMOTION_TAXONOMY.GIFT;
  if (scope === 'order' || scope === 'all' || t === 'voucher') return PROMOTION_TAXONOMY.VOUCHER_PROMOTION;
  return PROMOTION_TAXONOMY.STANDARD_PROMOTION;
}

// Metadata AUDIT cho chương trình lớn/special/internal (KHÔNG kết luận "legal=true").
// Chỉ giữ note/reference do người có quyền nhập, phục vụ truy vết.
export function complianceAuditMeta(promotion = {}, actor = {}) {
  return {
    promotion_id: promotion.id || null,
    name: promotion.name || '',
    type: promotion.type || '',
    scope: promotion.scope || '',
    taxonomy: classifyPromotion(promotion),
    configured_value: promotion.value ?? null,
    is_internal_use: !!promotion.is_internal_use || isInternalUsage(promotion.program_type),
    program_type: promotion.program_type || null,
    compliance_note: promotion.compliance_note || null,
    legal_basis_reference: promotion.legal_basis_reference || null,
    approval_reference: promotion.approval_reference || null,
    internal_reason: promotion.internal_reason || null,
    actor: actor.username || actor.id || null,
    branch_id: promotion.branch_id || null,
  };
}
