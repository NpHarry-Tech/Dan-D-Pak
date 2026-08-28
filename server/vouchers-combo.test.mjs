// COMBO — mua đủ N món BẤT KỲ trong tập (skus[] + groups[]) → ưu đãi.
// Kiểm chứng logic tính tiền (fixed / amount / pct), không đủ N, và nhiều combo.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const temp = mkdtempSync(join(tmpdir(), 'dandpak-combo-'));
process.env.SQLITE_PATH = join(temp, 'store.db');
process.env.STORAGE_PATH = join(temp, 'storage');
process.env.DATA_ENCRYPTION_KEY =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

const { migrate } = await import('./db.js');
migrate();
const V = await import('./services/vouchers.js');

const B = 'sala';
const cheese = { sku_id: 'sku_cheese', qty: 1, price: 80000, name: 'Popcorn Cheese' };
const caramel = { sku_id: 'sku_caramel', qty: 1, price: 80000, name: 'Popcorn Caramel' };

test('pricing preload SKU/lot metadata once, never query inside combo-line loops', () => {
  const source = readFileSync(new URL('./services/vouchers.js', import.meta.url), 'utf8');
  const start = source.indexOf('export function calculateRetailDiscount');
  const end = source.indexOf('export function buildDiscountPlan');
  const body = source.slice(start, end);
  assert.equal((body.match(/db\.prepare\(/g) || []).length, 2,
    'at most one page-wide SKU query and one page-wide lot query');
  assert.match(body, /id IN \(\$\{slots\}\)/);
  assert.doesNotMatch(body, /FROM skus WHERE id=\?|FROM stock_lots WHERE id=\?/);
});

test('combo fixed: 2 bắp bất kỳ = 100k → giảm 60k', () => {
  const v = V.createVoucher({
    name: 'Mua 2 bắp 100k', code: 'C_FIXED', scope: 'combo', type: 'fixed', value: 100000,
    scope_config: { skus: ['sku_cheese', 'sku_caramel'], qty: 2 },
  }, B);
  const r = V.calculateRetailDiscount([{ ...cheese }, { ...caramel }], null, B, {});
  assert.equal(r.discount, 60000, 'giảm phải = 160k - 100k');
  assert.equal(r.total, 100000);
  V.deleteVoucher(v.id, B);
});

test('gating: selected_combos=[] → KHÔNG áp combo (Option B tắt auto)', () => {
  const v = V.createVoucher({
    name: 'Mua 2 bắp 100k', code: 'C_GATE0', scope: 'combo', type: 'fixed', value: 100000,
    scope_config: { skus: ['sku_cheese', 'sku_caramel'], qty: 2 },
  }, B);
  const off = V.calculateRetailDiscount([{ ...cheese }, { ...caramel }], null, B, { selectedCombos: [] });
  assert.equal(off.discount, 0, 'mảng rỗng = không combo nào được chọn → giảm 0');
  const on = V.calculateRetailDiscount([{ ...cheese }, { ...caramel }], null, B, { selectedCombos: [v.id] });
  assert.equal(on.discount, 60000, 'chọn đúng id → áp combo');
  V.deleteVoucher(v.id, B);
});

test('combo fixed TĂNG GIÁ: 2 món lẻ 160k, combo=200k → thu 200k (bán kèm)', () => {
  const v = V.createVoucher({
    name: 'Combo bán kèm 200k', code: 'C_UP', scope: 'combo', type: 'fixed', value: 200000,
    scope_config: { skus: ['sku_cheese', 'sku_caramel'], qty: 2 },
  }, B);
  const r = V.calculateRetailDiscount([{ ...cheese }, { ...caramel }], null, B, {});
  assert.equal(r.total, 200000, 'combo giá cao hơn tổng lẻ vẫn phải thu ĐÚNG giá combo');
  assert.equal(r.discount, -40000, 'chênh âm = phụ thu 40k');
  V.deleteVoucher(v.id, B);
});

test('giảm tay áp CẢ BILL có combo: combo 100k + giảm tay 40k → total 60k', () => {
  const v = V.createVoucher({
    name: 'C', code: 'C_MANUAL', scope: 'combo', type: 'fixed', value: 100000,
    scope_config: { skus: ['sku_cheese', 'sku_caramel'], qty: 2 },
  }, B);
  const plan = V.buildDiscountPlan([{ ...cheese }, { ...caramel }], { manual_discount: 40000, selected_combos: [v.id], branch_id: B });
  assert.equal(plan.total, 60000, 'combo 160k→100k rồi giảm tay 40k → 60k (giảm tay áp cả dòng combo)');
  V.deleteVoucher(v.id, B);
});

test('giảm 100% (giảm tay = tổng) → total 0', () => {
  const plan = V.buildDiscountPlan([{ ...cheese }, { ...caramel }], { manual_discount: 160000, branch_id: B });
  assert.equal(plan.total, 0, 'giảm tay = tổng → 0đ');
});

test('combo amount: giảm 30k khi đủ 2 món', () => {
  const v = V.createVoucher({
    name: 'Combo giảm 30k', code: 'C_AMT', scope: 'combo', type: 'amount', value: 30000,
    scope_config: { skus: ['sku_cheese', 'sku_caramel'], qty: 2 },
  }, B);
  const r = V.calculateRetailDiscount([{ ...cheese }, { ...caramel }], null, B, {});
  assert.equal(r.discount, 30000);
  V.toggleVoucher(v.id, false, B);
});

test('combo pct: giảm 20% của 2 món (160k) = 32k', () => {
  const v = V.createVoucher({
    name: 'Combo -20%', code: 'C_PCT', scope: 'combo', type: 'pct', value: 20,
    scope_config: { skus: ['sku_cheese', 'sku_caramel'], qty: 2 },
  }, B);
  const r = V.calculateRetailDiscount([{ ...cheese }, { ...caramel }], null, B, {});
  assert.equal(r.discount, 32000);
  V.toggleVoucher(v.id, false, B);
});

test('chưa đủ N (chỉ 1 món) → không giảm', () => {
  const v = V.createVoucher({
    name: 'Combo cần 2', code: 'C_NONE', scope: 'combo', type: 'fixed', value: 100000,
    scope_config: { skus: ['sku_cheese'], qty: 2 },
  }, B);
  const r = V.calculateRetailDiscount([{ ...cheese }], null, B, {});
  assert.equal(r.discount, 0);
  V.toggleVoucher(v.id, false, B);
});

test('nhiều combo: mua 4 bắp (fixed 2=100k) → giảm 2×60k=120k', () => {
  const v = V.createVoucher({
    name: 'Combo x2', code: 'C_MULTI', scope: 'combo', type: 'fixed', value: 100000,
    scope_config: { skus: ['sku_cheese', 'sku_caramel'], qty: 2 },
  }, B);
  const r = V.calculateRetailDiscount(
    [{ ...cheese, qty: 2 }, { ...caramel, qty: 2 }], null, B, {});
  assert.equal(r.discount, 120000, '2 combo × 60k');
  V.toggleVoucher(v.id, false, B);
});

test('lẻ 3 món (fixed 2=100k) → 1 combo, giảm 60k, dư 1 món nguyên giá', () => {
  const v = V.createVoucher({
    name: 'Combo lẻ', code: 'C_ODD', scope: 'combo', type: 'fixed', value: 100000,
    scope_config: { skus: ['sku_cheese'], qty: 2 },
  }, B);
  const r = V.calculateRetailDiscount([{ ...cheese, qty: 3 }], null, B, {});
  assert.equal(r.discount, 60000);
  assert.equal(r.total, 240000 - 60000);
  V.toggleVoucher(v.id, false, B);
});

test('reject: combo không chọn SKU/nhóm', () => {
  assert.throws(() => V.createVoucher({
    name: 'x', code: 'C_BAD', scope: 'combo', type: 'fixed', value: 100000,
    scope_config: { skus: [], groups: [], qty: 2 },
  }, B), /it nhat 1 SKU hoac 1 nhom/);
});

test('ma trận 1.200 case: fixed combo là giá authoritative và total không âm', () => {
  const v = V.createVoucher({
    name: 'Matrix fixed 100k', code: 'C_MATRIX_1200', scope: 'combo', type: 'fixed', value: 100000,
    scope_config: { skus: ['sku_cheese', 'sku_caramel'], qty: 2 },
  }, B);

  let cases = 0;
  // 40 × 30 = 1.200 trường hợp deterministic. Tổng giá lẻ chạy từ thấp hơn,
  // bằng đến cao hơn fixed total; manual discount chạy qua cả biên vượt total.
  for (let priceStep = 1; priceStep <= 40; priceStep++) {
    const componentPrice = priceStep * 5000;
    for (let discountStep = 0; discountStep < 30; discountStep++) {
      const manual = discountStep * 5000;
      const plan = V.buildDiscountPlan([
        { ...cheese, price: componentPrice },
        { ...caramel, price: componentPrice },
      ], {
        manual_discount: manual,
        selected_combos: [v.id],
        branch_id: B,
      });
      const expected = Math.max(0, 100000 - manual);
      assert.equal(plan.total, expected,
        `case ${priceStep}/${discountStep}: fixed 100k rồi mới giảm tay`);
      assert.ok(plan.total >= 0, 'final_total không được âm');
      cases++;
    }
  }
  assert.equal(cases, 1200);
  V.deleteVoucher(v.id, B);
});
