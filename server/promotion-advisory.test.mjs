// §9 ADVISORY (owner: KHÔNG enforce cap). Chứng minh advisory KHÔNG đổi tiền,
// KHÔNG block; internal usage tách khỏi consumer promotion; audit metadata đúng.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  advisoryThresholdPct, promotionAdvisory, classifyPromotion, isInternalUsage,
  complianceAuditMeta, PROMOTION_TAXONOMY,
} from './services/promotionAdvisory.js';

test('CHƯA cấu hình ngưỡng → KHÔNG cảnh báo (kể cả ưu đãi 90%)', () => {
  delete process.env.PROMOTION_ADVISORY_THRESHOLD_PCT;
  assert.equal(advisoryThresholdPct(), null);
  const r = promotionAdvisory(9000, 10000);
  assert.equal(r.advise, false, 'không ngưỡng → không cảnh báo');
});

test('advisory KHÔNG trả về discount/total đã sửa (chỉ cờ + %)', () => {
  const r = promotionAdvisory(9000, 10000, { thresholdPct: 50 });
  // Không có field nào clamp/đổi tiền — chỉ advise + discount_pct + threshold_pct.
  assert.deepEqual(Object.keys(r).sort(), ['advise', 'discount_pct', 'threshold_pct']);
  assert.equal(r.advise, true, '90% > 50% → CẢNH BÁO');
  assert.equal(r.discount_pct, 90);
});

test('ưu đãi dưới ngưỡng → không cảnh báo', () => {
  const r = promotionAdvisory(3000, 10000, { thresholdPct: 50 });
  assert.equal(r.advise, false);
});

test('ngưỡng cấu hình qua ENV', () => {
  process.env.PROMOTION_ADVISORY_THRESHOLD_PCT = '50';
  assert.equal(advisoryThresholdPct(), 50);
  assert.equal(promotionAdvisory(6000, 10000).advise, true);
  assert.equal(promotionAdvisory(4000, 10000).advise, false);
  delete process.env.PROMOTION_ADVISORY_THRESHOLD_PCT;
});

test('internal usage tách khỏi consumer promotion (không sinh cảnh báo consumer sai)', () => {
  assert.equal(isInternalUsage('KITCHEN_USE'), true);
  assert.equal(isInternalUsage('PRODUCTION_USE'), true);
  assert.equal(isInternalUsage('STANDARD_PROMOTION'), false);
});

test('taxonomy classify', () => {
  assert.equal(classifyPromotion({ scope: 'combo', type: 'fixed' }), PROMOTION_TAXONOMY.CONCENTRATED_PROMOTION);
  assert.equal(classifyPromotion({ type: 'buy_x_get_1' }), PROMOTION_TAXONOMY.BUY_X_GET_Y);
  assert.equal(classifyPromotion({ type: 'gift' }), PROMOTION_TAXONOMY.GIFT);
  assert.equal(classifyPromotion({ type: 'pct' }), PROMOTION_TAXONOMY.STANDARD_PROMOTION);
});

test('audit metadata KHÔNG kết luận legal=true; giữ note/reference nhập tay', () => {
  const meta = complianceAuditMeta(
    { id: 'p1', name: 'CT tập trung', type: 'pct', value: 70, scope: 'order', branch_id: 'sala',
      is_internal_use: false, compliance_note: 'CT khai báo Sở CT', approval_reference: 'QD-123' },
    { username: 'mgr' });
  assert.equal(meta.promotion_id, 'p1');
  assert.equal(meta.compliance_note, 'CT khai báo Sở CT');
  assert.equal(meta.approval_reference, 'QD-123');
  assert.equal(meta.actor, 'mgr');
  assert.ok(!('legal' in meta), 'KHÔNG có field legal=true');
  assert.ok(!('legal_exempt' in meta));
});
