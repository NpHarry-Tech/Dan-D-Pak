// §31 — REVIEW BRANCH MIGRATION sala→review (idempotent, referential integrity,
// admin preserved). Dựng một review DB legacy (branch id='sala' name
// "Shopee Review Store") rồi chạy seed → phải thành 'review'.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DBP = resolve(REPO_ROOT, 'runtime/server-data/__review_migrate_test.db');
process.env.APP_ENV = 'review';
process.env.NODE_ENV = 'development';
process.env.DEPLOYMENT_TARGET = 'local';
process.env.SQLITE_PATH = DBP;
process.env.ALLOW_PRODUCTION_DATA = 'false';
process.env.SHOPEE_REVIEWER_PIN = '8421';
const clean = () => { for (const s of ['', '-wal', '-shm']) if (existsSync(DBP + s)) { try { rmSync(DBP + s); } catch {} } };
clean();

const { db, migrate } = await import('./db.js');
const { hashPin } = await import('./services/pin.js');
migrate();

// ── Dựng trạng thái LEGACY review (branch id='sala') ────────────────────────
db.prepare(`INSERT INTO branches (id,name,address,code,active,sort) VALUES ('sala','Shopee Review Store','X','SALA',1,1)`).run();
db.prepare(`INSERT INTO users (id,branch_id,username,name,pin,role,active,branch_access_json)
  VALUES ('u_shopee_reviewer','sala','shopee-reviewer','Shopee Reviewer',?, 'shopee_reviewer',1,'["sala"]')`)
  .run(hashPin('8421'));
db.prepare(`INSERT INTO users (id,branch_id,username,name,pin,role,active,branch_access_json)
  VALUES ('u_review_admin','sala','admin','Review Admin',?, 'owner',1,'["*"]')`)
  .run(hashPin('4729'));
const adminPinBeforeSeed = db.prepare(`SELECT pin FROM users WHERE username='admin'`).get().pin;
// Một business row branch-scoped để kiểm dời tham chiếu (bảng tables có branch_id).
db.prepare(`INSERT INTO tables (id,branch_id,zone,code,seats,status) VALUES ('t_leg','sala','Z','C1',4,'free')`).run();

const { seedShopeeReview, SHOPEE_REVIEWER_PERMS } = await import('./db/reviewSeed.js');
const { effectivePermsForUser, login } = await import('./services/auth.js');
const r1 = seedShopeeReview();

test('migration đã chạy (sala→review)', () => {
  assert.equal(r1.migration.migrated, true);
});

test('branch canonical review, KHÔNG còn sala', () => {
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM branches WHERE id='review'`).get().n, 1);
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM branches WHERE id='sala'`).get().n, 0);
  assert.equal(db.prepare(`SELECT name FROM branches WHERE id='review'`).get().name, 'Shopee Review Store');
});

test('reviewer dời sang branch review + access ["review"]', () => {
  const u = db.prepare(`SELECT branch_id,branch_access_json FROM users WHERE username='shopee-reviewer'`).get();
  assert.equal(u.branch_id, 'review');
  assert.equal(u.branch_access_json, JSON.stringify(['review']));
});

test('admin PERSIST: owner + active + ["*"] và không đổi PIN', () => {
  const a = db.prepare(`SELECT role,active,branch_access_json,pin FROM users WHERE username='admin'`).get();
  assert.equal(a.role, 'owner');
  assert.equal(a.active, 1);
  assert.equal(a.branch_access_json, '["*"]');
  assert.equal(a.pin, adminPinBeforeSeed);
});

test('business row (tables) dời branch_id sala→review, không orphan sala', () => {
  assert.equal(db.prepare(`SELECT branch_id FROM tables WHERE id='t_leg'`).get().branch_id, 'review');
  // không còn bất kỳ dòng nào branch_id='sala' ở các bảng có cột branch_id
  const tbls = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name!='branches'`).all();
  let orphans = 0;
  for (const { name } of tbls) {
    const cols = db.prepare(`PRAGMA table_info("${name}")`).all();
    if (!cols.some(c => c.name === 'branch_id')) continue;
    orphans += db.prepare(`SELECT COUNT(*) n FROM "${name}" WHERE branch_id='sala'`).get().n;
  }
  assert.equal(orphans, 0, 'không được còn tham chiếu branch_id=sala');
});

test('idempotent: rerun xóa stale role/user permissions và làm mới effective cache', () => {
  db.prepare(`INSERT OR IGNORE INTO role_perms (role,perm) VALUES ('shopee_reviewer','refund')`).run();
  db.prepare(`INSERT OR REPLACE INTO user_perms (user_id,perm,mode) VALUES ('u_shopee_reviewer','void','allow')`).run();
  const before = login('shopee-reviewer', '8421', 'review', { ip: '127.0.0.2' });
  assert.ok(before.perms.includes('refund'));
  assert.ok(before.perms.includes('void'));

  const r2 = seedShopeeReview();
  assert.equal(r2.migration.migrated, false, 'lần 2 không còn sala để migrate');
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM branches WHERE id='review'`).get().n, 1);
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM branches WHERE id='sala'`).get().n, 0);
  const rows = db.prepare(`SELECT perm FROM role_perms WHERE role='shopee_reviewer' ORDER BY perm`)
    .all().map(r => r.perm);
  assert.deepEqual(rows, [...SHOPEE_REVIEWER_PERMS].sort());
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM user_perms WHERE user_id='u_shopee_reviewer'`).get().n, 0);
  const reviewer = db.prepare(`SELECT id,role FROM users WHERE username='shopee-reviewer'`).get();
  assert.deepEqual(effectivePermsForUser(reviewer).sort(), [...SHOPEE_REVIEWER_PERMS].sort());
  const after = login('shopee-reviewer', '8421', 'review', { ip: '127.0.0.3' });
  assert.deepEqual(after.perms.sort(), [...SHOPEE_REVIEWER_PERMS].sort());
  assert.equal(db.prepare(`SELECT pin FROM users WHERE username='admin'`).get().pin, adminPinBeforeSeed);
});

test.after(() => { try { clean(); } catch {} });
