// §44 Phase 2 — TenantContext/Host validation (§8/§38) + RBAC settings.manage
// umbrella & KHÔNG bypass toàn hệ thống (§4/§20).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const temp = mkdtempSync(join(tmpdir(), 'dandpak-phase2-'));
process.env.SQLITE_PATH = join(temp, 'store.db');
process.env.STORAGE_PATH = join(temp, 'storage');
process.env.DATA_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.API_BASE_URL = 'https://api-test.dandpak.example';   // khai host tenant
process.env.NODE_ENV = 'development';
delete process.env.APP_ENV;

const { migrate } = await import('./db.js');
const Auth = await import('./services/auth.js');
const Tenant = await import('./services/tenantContext.js');
migrate();

// ── TenantContext / Host validation ─────────────────────────────────────────
test('allowedHosts gồm host đã cấu hình + localhost', () => {
  const hosts = Tenant.allowedHosts();
  assert.ok(hosts.has('api-test.dandpak.example'));
  assert.ok(hosts.has('localhost'));
  assert.ok(hosts.has('127.0.0.1'));
});

test('assertHostAllowed CHO PHÉP host đúng + localhost', () => {
  assert.doesNotThrow(() => Tenant.assertHostAllowed({ headers: { host: 'api-test.dandpak.example' } }));
  assert.doesNotThrow(() => Tenant.assertHostAllowed({ headers: { host: 'localhost:3000' } }));
});

test('assertHostAllowed TỪ CHỐI host giả mạo (421)', () => {
  try {
    Tenant.assertHostAllowed({ headers: { host: 'evil.attacker.com' } });
    assert.fail('phải ném lỗi cho host lạ');
  } catch (e) {
    assert.equal(e.status, 421);
  }
});

test('tenantId = production khi không review', () => {
  assert.equal(Tenant.tenantId(), 'production');
});

// ── RBAC: settings.manage = umbrella settings.* nhưng KHÔNG master key ───────
test('settings.manage phủ nhóm settings.* nhưng KHÔNG phủ quyền nghiệp vụ', () => {
  Auth.createCustomRole({ key: 'mgr_test', label: 'Mgr Test' }, null);
  Auth.setRolePerms('mgr_test', ['settings.manage'], 'sala', null);
  const mgr = { id: 'u_mgr_test', role: 'mgr_test' };
  // Umbrella: các quyền settings.* PASS
  for (const p of ['settings.users', 'settings.perms', 'settings.branches', 'settings.integrations']) {
    assert.equal(Auth.canUser(mgr, p), true, `settings.manage phải phủ ${p}`);
  }
  // KHÔNG phủ quyền nghiệp vụ (đây là bug over-grant đã sửa)
  for (const p of ['warehouse.delete', 'sell', 'refund', 'void', 'online.order.cancel']) {
    assert.equal(Auth.canUser(mgr, p), false, `settings.manage KHÔNG được tự cấp ${p}`);
  }
});

test('quyền cụ thể vẫn hoạt động độc lập', () => {
  Auth.createCustomRole({ key: 'ops_test', label: 'Ops Test' }, null);
  Auth.setRolePerms('ops_test', ['sell', 'pay'], 'sala', null);
  const ops = { id: 'u_ops_test', role: 'ops_test' };
  assert.equal(Auth.canUser(ops, 'sell'), true);
  assert.equal(Auth.canUser(ops, 'settings.users'), false, 'không có settings.manage thì không phủ settings.*');
});

test('owner = tenant admin: mọi quyền trong tenant', () => {
  const owner = { id: 'u_owner', role: 'owner' };
  for (const p of ['warehouse.delete', 'sell', 'settings.users', 'marketplace.connect']) {
    assert.equal(Auth.canUser(owner, p), true);
  }
});
