// Báo cáo bán hàng hiển thị tên khách: vãng lai → "Bán cho người tiêu dùng";
// khách CÓ tài khoản hoặc có XUẤT hóa đơn → tên khách / tên công ty.
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const temp = mkdtempSync(join(tmpdir(), 'dandpak-rpt-cust-'));
process.env.SQLITE_PATH = join(temp, 'store.db');
process.env.STORAGE_PATH = join(temp, 'storage');
process.env.DATA_ENCRYPTION_KEY = process.env.DATA_ENCRYPTION_KEY
  || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

const { migrate } = await import('./db.js');
const { customerDisplayName } = await import('./services/reportCenter.js');
migrate();

const j = (o) => JSON.stringify(o);

test('khách vãng lai (không tài khoản, không hóa đơn) → Bán cho người tiêu dùng', () => {
  assert.equal(customerDisplayName(null, null, null), 'Bán cho người tiêu dùng');
  assert.equal(customerDisplayName('{}', null, 'declined'), 'Bán cho người tiêu dùng');
  // Có tên trong snapshot nhưng KHÔNG tài khoản, KHÔNG hóa đơn → vẫn vãng lai.
  assert.equal(customerDisplayName(j({ name: 'Khách lẻ' }), null, 'declined'), 'Bán cho người tiêu dùng');
});

test('khách CÓ tài khoản (customer_json.id) → tên khách', () => {
  assert.equal(customerDisplayName(j({ id: 'cus_1', name: 'Nguyễn Văn A' }), null, null), 'Nguyễn Văn A');
  // Không có tên nhưng có công ty → tên công ty.
  assert.equal(customerDisplayName(j({ id: 'cus_2', company: 'Công ty TNHH B' }), null, null), 'Công ty TNHH B');
});

test('khách XUẤT hóa đơn (invoice_id / invoice_choice / invoice_request) → tên khách', () => {
  assert.equal(customerDisplayName(j({ name: 'Chị C' }), 'inv_1', null), 'Chị C');
  assert.equal(customerDisplayName(j({ company: 'DN D' }), null, 'issued'), 'DN D');
  assert.equal(customerDisplayName(j({ name: 'Anh E', invoice_request: true }), null, null), 'Anh E');
});

test('snapshot hỏng không làm sập báo cáo', () => {
  assert.equal(customerDisplayName('{bad json', 'inv_x', null), 'Bán cho người tiêu dùng');
});
