// Chi phí (Chi từ két) receipt photo phải xuất hiện trong Cơ sở dữ liệu → Tài
// liệu ngay khi tạo. Trước đây createExpense() chỉ lập chỉ mục document_files cho
// khoản chi TRỰC TIẾP (source='direct') — khoản chi QUA KÉT (source='drawer', mặc
// định của màn Chi phí) đi qua CashDrawer.createEntry() vốn không tự lập chỉ mục,
// nên ảnh hóa đơn bị "mất tích" khỏi tab Tài liệu cho tới khi chạy backfill thủ công.
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const temp = mkdtempSync(join(tmpdir(), 'dandpak-expdocs-'));
process.env.SQLITE_PATH = join(temp, 'store.db');
process.env.STORAGE_PATH = join(temp, 'storage');
process.env.DATA_ENCRYPTION_KEY = process.env.DATA_ENCRYPTION_KEY
  || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

const { migrate, db } = await import('./db.js');
const Shifts = await import('./services/shifts.js');
const Expenses = await import('./services/expenses.js');
migrate();

const BR = 'sala';
const user = { username: 'thu-ngan', name: 'Thu Ngan' };
const dataUrl = (txt, mime = 'image/png') => `data:${mime};base64,` + Buffer.from(txt).toString('base64');

Shifts.openShift({ shift_key: 'sang', opening_cash: 500000 }, user, BR);

test('khoản chi TỪ KÉT có ảnh hóa đơn được lập chỉ mục vào Tài liệu ngay khi tạo', () => {
  const exp = Expenses.createExpense({
    source: 'drawer',
    amount: 50000,
    category_name: 'Marketing',
    payee_name: 'NCC B',
    note: 'Mua đá',
    invoice_image: dataUrl('receipt-drawer-1'),
  }, BR, user);

  assert.ok(exp.drawer_entry_id, 'khoản chi phải tạo bút toán két đi kèm');

  const doc = db.prepare(
    `SELECT * FROM document_files WHERE related_type='cash_drawer_expense' AND related_id=?`,
  ).get(exp.drawer_entry_id);
  assert.ok(doc, 'ảnh hóa đơn của khoản chi từ két phải có mặt trong document_files');
  assert.equal(doc.storage_kind, 'file');
  assert.equal(doc.category, 'receipt');
});

test('khoản chi TRỰC TIẾP vẫn được lập chỉ mục như cũ (không bị ảnh hưởng bởi thay đổi)', () => {
  const exp = Expenses.createExpense({
    source: 'direct',
    amount: 120000,
    category_name: 'Sửa chữa & bảo trì',
    payee_name: 'NCC C',
    note: 'Sửa máy in',
    invoice_image: dataUrl('receipt-direct-1'),
  }, BR, user);

  assert.equal(exp.drawer_entry_id ?? null, null);
  const doc = db.prepare(
    `SELECT * FROM document_files WHERE related_type='expense' AND related_id=?`,
  ).get(exp.id);
  assert.ok(doc, 'ảnh hóa đơn của khoản chi trực tiếp phải có mặt trong document_files');
  assert.equal(doc.storage_kind, 'reference');
});

test('khoản chi từ két KHÔNG có ảnh hóa đơn thì không tạo document_files nào', () => {
  const before = db.prepare(`SELECT COUNT(*) c FROM document_files`).get().c;
  Expenses.createExpense({
    source: 'drawer',
    amount: 20000,
    category_name: 'Khác',
    payee_name: 'NCC D',
    note: 'Không kèm ảnh',
  }, BR, user);
  const after = db.prepare(`SELECT COUNT(*) c FROM document_files`).get().c;
  assert.equal(after, before, 'không có ảnh thì không sinh document_files thừa');
});
