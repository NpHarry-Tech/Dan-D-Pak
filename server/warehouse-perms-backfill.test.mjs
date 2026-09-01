// QUYỀN MỚI PHẢI TỚI ĐƯỢC CỬA HÀNG ĐANG CHẠY, KHÔNG CHỈ CỬA HÀNG CÀI MỚI.
//
// SỰ CỐ THẬT (04/08/2026): nút "Tạo mới" trong Tồn kho gác bằng quyền
// 'warehouse.item'. Code đã viết, bản build đã ra, nhưng quản lý ở cửa hàng
// BCM vẫn KHÔNG THẤY NÚT — người dùng báo "vẫn chưa có nút thêm item".
//
// Nguyên nhân: seedRolePerms() chỉ chạy khi bảng role_perms còn TRỐNG, tức đúng
// một lần lúc cài đặt đầu tiên. Cửa hàng chạy từ 2025 thì mọi quyền thêm vào
// DEFAULT_ROLE_PERMS sau đó không bao giờ tới được vai trò nào. Các nhóm quyền
// trước (module.*, settings.*, contacts.*, vận hành) đều đã có hàm backfill
// riêng — nhóm warehouse.* thì bị bỏ quên.
//
// Test dựng lại ĐÚNG cảnh đó: seed một bảng role_perms KIỂU CŨ (không có
// warehouse.*), rồi nạp auth.js và kiểm tra quyền đã được bù.
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const temp = mkdtempSync(join(tmpdir(), 'dandpak-perms-'));
process.env.SQLITE_PATH = join(temp, 'store.db');
process.env.STORAGE_PATH = join(temp, 'storage');
process.env.DATA_ENCRYPTION_KEY = process.env.DATA_ENCRYPTION_KEY
  || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

const { migrate, db } = await import('./db.js');
migrate();

// ── Cửa hàng CŨ: role_perms đã có dữ liệu nhưng thiếu hẳn nhóm warehouse.* ──
db.exec(`CREATE TABLE IF NOT EXISTS role_perms (role TEXT NOT NULL, perm TEXT NOT NULL, PRIMARY KEY(role,perm));`);
const them = db.prepare(`INSERT OR IGNORE INTO role_perms (role,perm) VALUES (?,?)`);
for (const p of ['sell', 'pay', 'inventory.adjust', 'warehouse.manage', 'module.warehouse']) {
  them.run('manager', p);
  them.run('warehouse', p);
}
them.run('cashier', 'sell');
them.run('cashier', 'pay');
them.run('kitchen', 'kds');

// Nạp auth.js SAU khi đã dựng cảnh — các hàm seed chạy lúc import.
const Auth = await import('./services/auth.js');

const quyenCua = (role) => new Set(
  db.prepare(`SELECT perm FROM role_perms WHERE role=?`).all(role).map(r => r.perm));

test('quan ly va thu kho duoc bu quyen warehouse.item o cua hang cai tu truoc', () => {
  for (const role of ['manager', 'warehouse']) {
    assert.ok(quyenCua(role).has('warehouse.item'),
      `${role} phai co 'warehouse.item' — thieu la nut "Tao moi" khong hien ra`);
  }
});

test('bu ca cac nghiep vu kho con lai, khong chi rieng warehouse.item', () => {
  const canCo = ['warehouse.receive', 'warehouse.issue', 'warehouse.transfer',
    'warehouse.stocktake', 'warehouse.pricebook'];
  for (const p of canCo) {
    assert.ok(quyenCua('warehouse').has(p), `thu kho thieu '${p}'`);
  }
});

test('KHONG noi quyen cho thu ngan va bep', () => {
  for (const role of ['cashier', 'kitchen']) {
    const co = [...quyenCua(role)].filter(p => p.startsWith('warehouse.'));
    assert.deepEqual(co, [],
      `${role} khong duoc tu nhien co quyen kho: ${co.join(', ')}`);
  }
});

test('quyen XOA khong duoc phat bua cho vai tro tuy bien', () => {
  // 'warehouse.delete' xoa han mat hang khoi danh muc. Chi vai tro mac dinh von
  // co no moi duoc bu lai; vai tro do chu cua hang tu tao thi khong.
  them.run('kho_phu', 'warehouse.manage');
  const laiLan2 = quyenCua('kho_phu');
  assert.ok(!laiLan2.has('warehouse.delete'),
    'vai tro tuy bien khong duoc tu nhien co quyen xoa mat hang');
});

test('danh sach quyen co mo ta cho man Phan quyen', () => {
  const item = Auth.PERMISSIONS.find(p => p.key === 'warehouse.item');
  assert.ok(item, "'warehouse.item' phai nam trong danh sach PERMISSIONS");
  assert.ok(String(item.label || '').trim().length > 0,
    'quyen phai co nhan tieng Viet de chu cua hang biet minh dang bat cai gi');
});
