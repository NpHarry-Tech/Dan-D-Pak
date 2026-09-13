// 'money.manage' TACH RIENG khoi 'reports' (quyen XEM bao cao) — truoc day route
// sua/xoa rule phan loai, resolve doi soat bank, sua nghia vu dinh ky deu gac
// chung voi quyen XEM bao cao, nen mot vai tro "chi xem bao cao" trong tuong
// lai se vo tinh sua/xoa duoc du lieu Money.
//
// Nhu warehouse.item (xem warehouse-perms-backfill.test.mjs), quyen moi nay
// phai BU duoc cho cua hang da chay tu truoc (role_perms da co du lieu), khong
// chi cua hang cai moi.
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const temp = mkdtempSync(join(tmpdir(), 'dandpak-money-perms-'));
process.env.SQLITE_PATH = join(temp, 'store.db');
process.env.STORAGE_PATH = join(temp, 'storage');
process.env.DATA_ENCRYPTION_KEY = process.env.DATA_ENCRYPTION_KEY
  || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

const { migrate, db } = await import('./db.js');
migrate();

// Cua hang CU: da tung thay module Ke toan (module.accounting) nhung chua bao
// gio co 'money.manage' (quyen chua ton tai luc ho cai dat).
db.exec(`CREATE TABLE IF NOT EXISTS role_perms (role TEXT NOT NULL, perm TEXT NOT NULL, PRIMARY KEY(role,perm));`);
const them = db.prepare(`INSERT OR IGNORE INTO role_perms (role,perm) VALUES (?,?)`);
them.run('manager', 'reports');
them.run('manager', 'module.accounting');
them.run('cashier', 'sell');
them.run('kitchen', 'kds');

const Auth = await import('./services/auth.js');

const quyenCua = (role) => new Set(
  db.prepare(`SELECT perm FROM role_perms WHERE role=?`).all(role).map(r => r.perm));

test('quan ly da thay module Ke toan duoc bu money.manage', () => {
  assert.ok(quyenCua('manager').has('money.manage'),
    "manager phai co 'money.manage' — thieu la sua/xoa Money bi khoa oan");
});

test('KHONG phat money.manage cho vai tro chua tung thay module Ke toan', () => {
  for (const role of ['cashier', 'kitchen']) {
    assert.ok(!quyenCua(role).has('money.manage'),
      `${role} khong duoc tu nhien co quyen sua Money`);
  }
});

test("'money.manage' nam trong danh sach PERMISSIONS va co nhan tieng Viet", () => {
  const item = Auth.PERMISSIONS.find(p => p.key === 'money.manage');
  assert.ok(item, "'money.manage' phai nam trong danh sach PERMISSIONS");
  assert.ok(String(item.label || '').trim().length > 0);
});
