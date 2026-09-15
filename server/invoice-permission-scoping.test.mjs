// Tách quyền HĐĐT chi tiết (view/retry/cancel/technical_logs) — cấp riêng lẻ,
// KHÔNG phá quyền cũ ('invoice'/'pay' vẫn thấy đủ mọi thứ như trước, đúng
// khuôn mẫu warehouse.* đã có trong auth.js). redactTechnicalFields() là hàm
// THUẦN nên test được logic ẩn/hiện mà không cần dựng HTTP/Express thật.
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const temp = mkdtempSync(join(tmpdir(), 'dandpak-invperm-'));
process.env.SQLITE_PATH = join(temp, 'store.db');
process.env.STORAGE_PATH = join(temp, 'storage');
process.env.DATA_ENCRYPTION_KEY = process.env.DATA_ENCRYPTION_KEY
  || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

const { migrate } = await import('./db.js');
migrate();
const Auth = await import('./services/auth.js');
const Invoices = await import('./services/invoices.js');

test('quyen HDDT chi tiet ton tai trong catalog va tach biet voi quyen invoice/pay cu', () => {
  for (const key of ['invoice.view', 'invoice.retry', 'invoice.cancel', 'invoice.technical_logs']) {
    assert.ok(Auth.ALL_PERMS.includes(key), `thieu quyen ${key} trong catalog`);
  }
});

test('owner va nguoi co quyen invoice cu (pay) van thay day du nhu truoc', () => {
  assert.equal(Auth.canUser({ role: 'owner' }, 'invoice.technical_logs'), true);
});

const sampleDetail = {
  bill: { order_id: 'o1', bill_no: 'Dan1', error_code: 'MISA_TIMEOUT', error_message: 'MISA khong phan hoi trong 30s' },
  timeline: [
    { action: 'CREATE_REQUEST', old_status: 'NOT_CREATED', new_status: 'QUEUED', reason: 'Tao yeu cau tu dong', created_at: '2026-09-15T00:00:00Z' },
    { action: 'ISSUE_FAILED', old_status: 'SENDING', new_status: 'FAILED', reason: 'MISA tra loi: Sai ma so thue', created_at: '2026-09-15T00:01:00Z' },
  ],
  totals: { gross: 100000 },
};

test('redactTechnicalFields: an error_code/error_message va reason, GIU NGUYEN trang thai/thoi diem/totals', () => {
  const redacted = Invoices.redactTechnicalFields(sampleDetail);
  assert.equal(redacted.bill.error_code, undefined);
  assert.equal(redacted.bill.error_message, undefined);
  assert.equal(redacted.bill.bill_no, 'Dan1', 'khong duoc lam mat cac truong khac cua bill');
  assert.equal(redacted.timeline.length, 2, 'khong duoc lam mat dong nao cua timeline');
  for (const row of redacted.timeline) {
    assert.equal(row.reason, undefined);
    assert.ok(row.action && row.new_status && row.created_at, 'van giu action/trang thai/thoi diem');
  }
  assert.deepEqual(redacted.totals, sampleDetail.totals, 'phan khong lien quan ky thuat giu nguyen');
  // Khong lam bien dang du lieu goc (immutable).
  assert.equal(sampleDetail.bill.error_code, 'MISA_TIMEOUT');
  assert.equal(sampleDetail.timeline[1].reason, 'MISA tra loi: Sai ma so thue');
});

test('redactTechnicalFields: null/undefined khong throw', () => {
  assert.equal(Invoices.redactTechnicalFields(null), null);
  assert.equal(Invoices.redactTechnicalFields(undefined), undefined);
});
