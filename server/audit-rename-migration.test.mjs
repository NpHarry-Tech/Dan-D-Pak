// Đổi tên định danh sự kiện audit "triệt để" → migrate cả hàng CŨ, không chỉ ghi
// tên mới cho hàng MỚI. Kiểm tra: seed hàng tên cũ rồi chạy lại migrate() phải
// đổi hết sang tên mới; canonicalizeAction idempotent + không đụng tên đã sạch.
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const temp = mkdtempSync(join(tmpdir(), 'dandpak-rename-'));
process.env.SQLITE_PATH = join(temp, 'store.db');
process.env.STORAGE_PATH = join(temp, 'storage');
process.env.DATA_ENCRYPTION_KEY = process.env.DATA_ENCRYPTION_KEY
  || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

const { migrate, db } = await import('./db.js');
const { AUDIT_ACTION_RENAMES, canonicalizeAction } = await import('./db/auditRenames.js');

migrate();

test('boot migration đổi tên hàng audit CŨ sang taxonomy mới (idempotent)', () => {
  const stamp = '2026-01-01T00:00:00.000Z';
  for (const oldA of Object.keys(AUDIT_ACTION_RENAMES)) {
    db.prepare(`INSERT INTO audit_log (id,branch_id,actor,action,detail,created_at) VALUES (?,?,?,?,?,?)`)
      .run(`a_legacy_${oldA}`, 'sala', 'tester', oldA, '{}', stamp);
  }
  migrate(); // chạy lại — migration phải quét được cả hàng vừa seed
  for (const [oldA, newA] of Object.entries(AUDIT_ACTION_RENAMES)) {
    assert.equal(db.prepare(`SELECT COUNT(*) c FROM audit_log WHERE action=?`).get(oldA).c, 0, `${oldA} phải hết`);
    assert.ok(db.prepare(`SELECT COUNT(*) c FROM audit_log WHERE action=?`).get(newA).c >= 1, `${newA} phải có`);
  }
});

test('canonicalizeAction: đổi tên cũ, giữ nguyên tên đã sạch, idempotent', () => {
  assert.equal(canonicalizeAction('item.status'), 'order.item.status');
  assert.equal(canonicalizeAction('order.item.status'), 'order.item.status'); // idempotent
  assert.equal(canonicalizeAction('bill.split'), 'order.split');
  assert.equal(canonicalizeAction('perms.update'), 'role.perms.update');
  assert.equal(canonicalizeAction('auth.login.failed'), 'auth.login.failed'); // đã sạch → giữ nguyên
});
