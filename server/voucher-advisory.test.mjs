// §9 ADVISORY wiring vào tạo/sửa voucher: trả cờ advisory cho UI + audit metadata,
// nhưng KHÔNG đổi value/type, KHÔNG chặn lưu, audit KHÔNG kết luận legal=true.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmp = mkdtempSync(join(tmpdir(), 'ddp-vadv-'));
process.env.SQLITE_PATH = join(tmp, 'store.db');
process.env.STORAGE_PATH = join(tmp, 'storage');
process.env.DISABLE_DEMO_SEED = 'true';

const { migrate, db } = await import('./db.js');
migrate();
const V = await import('./services/vouchers.js');

test('CHƯA cấu hình ngưỡng → lưu CTKM 80% vẫn KHÔNG cảnh báo, value giữ nguyên', () => {
  delete process.env.PROMOTION_ADVISORY_THRESHOLD_PCT;
  const r = V.createVoucher(
    { name: 'Giảm sâu', code: 'DEEP80', scope: 'order', type: 'pct', value: 80, active: true }, 'sala');
  assert.equal(r.value, 80, 'value KHÔNG bị clamp/sửa');
  assert.equal(r.advisory.advise, false, 'không ngưỡng → không cảnh báo');
});

test('có ngưỡng 50% → CTKM 80% được cờ advise=true nhưng VẪN lưu (không chặn)', () => {
  process.env.PROMOTION_ADVISORY_THRESHOLD_PCT = '50';
  const r = V.createVoucher(
    { name: 'Giảm sâu 2', code: 'DEEP80B', scope: 'order', type: 'pct', value: 80, active: true }, 'sala');
  assert.equal(r.value, 80);
  assert.equal(r.advisory.advise, true);
  assert.equal(r.advisory.threshold_pct, 50);
  // Voucher THẬT được lưu (đọc lại được) → advisory không chặn nghiệp vụ.
  const saved = V.getVoucher(r.id, 'sala');
  assert.ok(saved && saved.value === 80);
  delete process.env.PROMOTION_ADVISORY_THRESHOLD_PCT;
});

test('type amount (không %) → không cảnh báo theo ngưỡng, vẫn lưu', () => {
  process.env.PROMOTION_ADVISORY_THRESHOLD_PCT = '50';
  const r = V.createVoucher(
    { name: 'Giảm tiền', code: 'AMT', scope: 'order', type: 'amount', value: 999999, active: true }, 'sala');
  assert.equal(r.advisory.advise, false, 'amount không có % → không cảnh báo theo ngưỡng');
  assert.equal(r.value, 999999);
  delete process.env.PROMOTION_ADVISORY_THRESHOLD_PCT;
});

test('audit CTKM ghi compliance metadata nhưng KHÔNG có legal=true/legal_exempt', () => {
  const r = V.createVoucher({
    name: 'CT nội bộ bếp', code: 'KITCHEN', scope: 'order', type: 'pct', value: 100,
    is_internal_use: true, program_type: 'KITCHEN_USE',
    compliance_note: 'Dùng nội bộ bếp', approval_reference: 'QD-9',
  }, 'sala');
  // advisory là object trả ra; compliance đi vào audit → kiểm qua row audit_log.
  const row = db.prepare(`SELECT detail FROM audit_log WHERE action='voucher.create' ORDER BY rowid DESC LIMIT 1`).get();
  const detail = JSON.parse(row.detail);
  assert.equal(detail.compliance.is_internal_use, true);
  assert.equal(detail.compliance.program_type, 'KITCHEN_USE');
  assert.equal(detail.compliance.approval_reference, 'QD-9');
  assert.ok(!('legal' in detail.compliance), 'KHÔNG legal=true');
  assert.ok(!('legal_exempt' in detail.compliance));
  assert.equal(r.value, 100, 'value 100% vẫn giữ, không chặn');
});
