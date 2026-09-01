// §44-N REVIEW BOOT + reviewer branch-full-access.
// Tenant review khởi động sạch: chỉ có branch "Shopee Review Store" + user
// shopee-reviewer; KHÔNG có nhân sự demo, kho BCM, bàn, máy in production-like.
// PHẢI set APP_ENV=review TRƯỚC khi import (env load 1 lần lúc import).
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, rmSync } from 'node:fs';

import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
// connection.js resolve SQLITE_PATH tương đối theo repo root → dùng path TUYỆT ĐỐI
// để clean khớp đúng file (tránh DB cũ sót lại làm DB_WAS_EMPTY sai).
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DBP = resolve(REPO_ROOT, 'runtime/server-data/__review_iso_test.db');
process.env.APP_ENV = 'review';
process.env.NODE_ENV = 'development';
process.env.DEPLOYMENT_TARGET = 'local';
process.env.SQLITE_PATH = DBP;
process.env.DISABLE_DEMO_SEED = 'false';       // như .env review thật
process.env.ALLOW_PRODUCTION_DATA = 'false';
process.env.SHOPEE_REVIEWER_PIN = '8421';       // 4 số kiểu POS PIN

const clean = () => {
  for (const s of ['', '-wal', '-shm']) {
    if (existsSync(DBP + s)) rmSync(DBP + s);
  }
};
clean();

const { db, migrate, DB_WAS_EMPTY } = await import('./db.js');
migrate();
// Mô phỏng đúng nhánh review trong index.js: KHÔNG chạy demo seed; chỉ reviewSeed.
const { seedShopeeReview } = await import('./db/reviewSeed.js');
const { branchFullAccessPerms, TENANT_ADMIN_PERMS, login } = await import('./services/auth.js');
const seedResult = seedShopeeReview();

test('review DB_WAS_EMPTY on fresh boot', () => {
  assert.equal(DB_WAS_EMPTY, true);
});

test('review branch: canonical id=review (KHÔNG còn sala), name "Shopee Review Store"', () => {
  const branches = db.prepare(`SELECT id,name FROM branches`).all();
  assert.equal(branches.length, 1, `branches: ${JSON.stringify(branches)}`);
  assert.equal(branches[0].id, 'review', 'branch id phải là review, không phải sala (§2)');
  assert.equal(branches[0].name, 'Shopee Review Store');
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM branches WHERE id='sala'`).get().n, 0, 'không được còn branch sala');
});

test('review KHÔNG có kho BCM / Showroom / Kho bếp (bootstrapWarehouseDefaults bị chặn)', () => {
  const n = db.prepare(`SELECT COUNT(*) n FROM warehouses`).get().n;
  assert.equal(n, 0, 'review phải 0 warehouse');
});

test('review KHÔNG có bàn (bootstrapTableDefaults bị chặn)', () => {
  const n = db.prepare(`SELECT COUNT(*) n FROM tables`).get().n;
  assert.equal(n, 0, 'review phải 0 table');
});

test('review KHÔNG có nhân sự demo (admin/tanbv/vinhlq/...) — chỉ shopee-reviewer', () => {
  const users = db.prepare(`SELECT username,active FROM users`).all();
  assert.equal(users.length, 1, `users: ${JSON.stringify(users)}`);
  assert.equal(users[0].username, 'shopee-reviewer');
  assert.equal(users[0].active, 1);
  for (const legacy of ['admin', 'tanbv', 'vinhlq', 'phatnt', 'kitchen', 'warehouse']) {
    assert.equal(db.prepare(`SELECT COUNT(*) n FROM users WHERE username=?`).get(legacy).n, 0,
      `không được có user demo '${legacy}'`);
  }
});

test('review KHÔNG có printer/device rows', () => {
  // Bảng máy in có thể mang tên khác nhau tuỳ schema; kiểm mọi bảng có "printer".
  const tbls = db.prepare(
    `SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%printer%'`).all();
  for (const t of tbls) {
    const n = db.prepare(`SELECT COUNT(*) n FROM ${t.name}`).get().n;
    assert.equal(n, 0, `bảng ${t.name} phải rỗng trong review`);
  }
});

test('reviewer = BRANCH FULL ACCESS (full functional, KHÔNG tenant admin, > 14 quyền)', () => {
  const perms = branchFullAccessPerms();
  assert.equal(seedResult.perms, perms.length);
  assert.ok(perms.length > 14, `phải nhiều hơn danh sách cứng 14: ${perms.length}`);
  // Có quyền nghiệp vụ chính
  for (const p of ['marketplace.view', 'marketplace.connect', 'online.product_mapping', 'order.view', 'sell']) {
    assert.ok(perms.includes(p), `thiếu quyền nghiệp vụ ${p}`);
  }
  // KHÔNG có quyền tenant-admin/secret
  for (const p of TENANT_ADMIN_PERMS) {
    assert.ok(!perms.includes(p), `rò quyền tenant-admin ${p}`);
  }
});

test('reviewer role trong DB khớp branchFullAccessPerms (không stale về 14)', () => {
  const rows = db.prepare(`SELECT perm FROM role_perms WHERE role='shopee_reviewer'`).all().map(r => r.perm).sort();
  const expect = branchFullAccessPerms().slice().sort();
  assert.deepEqual(rows, expect);
});

test('reviewer branch_access chỉ ["review"] (không "*" = không tenant admin)', () => {
  const u = db.prepare(`SELECT branch_id,branch_access_json FROM users WHERE username='shopee-reviewer'`).get();
  assert.equal(u.branch_id, 'review');
  assert.equal(u.branch_access_json, JSON.stringify(['review']));
});

test('reviewer RBAC (§29/§30): có channel/integration + marketplace, KHÔNG tenant-admin', () => {
  const perms = branchFullAccessPerms();
  for (const p of ['settings.integrations', 'settings.connections', 'marketplace.view', 'marketplace.connect']) {
    assert.ok(perms.includes(p), `reviewer phải có ${p} để thiết lập kênh Shopee`);
  }
  for (const p of ['settings.manage', 'settings.perms', 'settings.users', 'settings.branches', 'settings.sync']) {
    assert.ok(!perms.includes(p), `reviewer KHÔNG được có quyền tenant-admin ${p}`);
  }
});

test('reviewer login được bằng PIN từ ENV (branch review)', () => {
  const res = login('shopee-reviewer', '8421', 'review', { ip: '127.0.0.1' });
  assert.ok(res.token, 'login phải trả token');
  assert.ok(res.perms.includes('marketplace.connect'));
  assert.ok(res.perms.includes('settings.integrations'), 'reviewer cần settings.integrations (kênh)');
  assert.ok(!res.perms.includes('settings.manage'), 'không được có quyền tenant-admin');
});

test.after(() => { try { clean(); } catch { /* WAL còn khoá trên Windows — bỏ qua */ } });
