// §1/§21 — Central ManagerApprovalService: authorize + one-shot token (scope/TTL/
// anti-replay). Xác thực theo QUYỀN thật của người duyệt; sai PIN/branch/perm → DENY.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const temp = mkdtempSync(join(tmpdir(), 'dandpak-approval-'));
process.env.SQLITE_PATH = join(temp, 'store.db');
process.env.STORAGE_PATH = join(temp, 'storage');
process.env.DATA_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.NODE_ENV = 'development';

const { db, migrate } = await import('./db.js');
const { hashPin } = await import('./services/pin.js');
await import('./services/auth.js'); // seed role_perms (manager có 'refund', không có 'kds')
const Approval = await import('./services/approval.js');
migrate();

// Manager ở sala (branch_access sala), PIN 7777.
db.prepare(`INSERT INTO users (id,branch_id,username,name,pin,role,active,branch_access_json)
  VALUES ('u_mgr','sala','mgr','Manager',?, 'manager',1,'["sala"]')`).run(hashPin('7777'));

const scope = { branch_id: 'sala', action: 'return', target_id: 'o1', required_perm: 'refund' };

test('authorize: đúng PIN + branch + perm → approver', () => {
  const a = Approval.authorize({ ...scope, pin: '7777', requested_by: 'cashier' });
  assert.equal(a.username, 'mgr');
});

test('authorize: SAI PIN → APPROVAL_DENIED', () => {
  assert.throws(() => Approval.authorize({ ...scope, pin: '0000' }), (e) => e.code === 'APPROVAL_DENIED');
});

test('authorize: SAI branch (không có access) → DENY', () => {
  assert.throws(() => Approval.authorize({ ...scope, branch_id: 'other', pin: '7777' }), (e) => e.code === 'APPROVAL_DENIED');
});

test('authorize: THIẾU quyền yêu cầu (kds) → DENY', () => {
  assert.throws(() => Approval.authorize({ ...scope, required_perm: 'kds', pin: '7777' }), (e) => e.code === 'APPROVAL_DENIED');
});

test('one-shot token: grant → consume PASS → replay DENY', () => {
  const g = Approval.grantApproval({ ...scope, pin: '7777', requested_by: 'cashier' });
  assert.ok(g.token.startsWith('appr_'));
  const who = Approval.consumeApproval(g.token, { branch_id: 'sala', action: 'return', target_id: 'o1' });
  assert.equal(who, 'mgr');
  assert.throws(() => Approval.consumeApproval(g.token, { branch_id: 'sala', action: 'return', target_id: 'o1' }),
    (e) => e.code === 'APPROVAL_REPLAY');
});

test('token scope mismatch → DENY', () => {
  const g = Approval.grantApproval({ ...scope, pin: '7777' });
  assert.throws(() => Approval.consumeApproval(g.token, { branch_id: 'sala', action: 'refund', target_id: 'o1' }),
    (e) => e.code === 'APPROVAL_SCOPE_MISMATCH');
});

test('token expired → DENY', () => {
  const g = Approval.grantApproval({ ...scope, pin: '7777' });
  db.prepare(`UPDATE manager_approvals SET expires_at=? WHERE id=?`)
    .run('2000-01-01T00:00:00.000Z', g.token);
  assert.throws(() => Approval.consumeApproval(g.token, { branch_id: 'sala', action: 'return', target_id: 'o1' }),
    (e) => e.code === 'APPROVAL_EXPIRED');
});

test('không lưu PIN plaintext trong manager_approvals', () => {
  const rows = db.prepare(`SELECT * FROM manager_approvals`).all();
  for (const r of rows) {
    for (const v of Object.values(r)) {
      assert.ok(!(typeof v === 'string' && v.includes('7777')), 'không được chứa PIN');
    }
  }
});
