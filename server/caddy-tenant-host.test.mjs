// CADDY REGRESSION — Production hotfix 2026-08-26: Caddy phải giữ đúng Host của
// tenant (header_up Host) để TenantContext không trả 421. Đồng thời tenant guard
// PHẢI fail-closed với internal Docker host (KHÔNG whitelist company-server-app-1).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

process.env.TENANT_ALLOWED_HOSTS = 'api.dandpakpos.io.vn';
const { assertHostAllowed, allowedHosts } = await import('./services/tenantContext.js');

const HERE = dirname(fileURLToPath(import.meta.url));
const CADDY = join(HERE, '..', 'deploy', 'company-server', 'Caddyfile');

const withHost = (h) => ({ headers: { host: h } });

test('Host tenant hợp lệ → PASS tenant guard', () => {
  assert.doesNotThrow(() => assertHostAllowed(withHost('api.dandpakpos.io.vn')));
});

test('internal Docker host → 421 (fail-closed, KHÔNG whitelist)', () => {
  assert.throws(() => assertHostAllowed(withHost('company-server-app-1')), (e) => e.status === 421);
  assert.throws(() => assertHostAllowed(withHost('app')), (e) => e.status === 421);
  assert.throws(() => assertHostAllowed(withHost('review-api')), (e) => e.status === 421);
});

test('localhost / 127.0.0.1 (healthcheck+LAN) vẫn PASS', () => {
  assert.doesNotThrow(() => assertHostAllowed(withHost('localhost')));
  assert.doesNotThrow(() => assertHostAllowed(withHost('127.0.0.1:3000')));
});

test('allowlist KHÔNG chứa internal Docker host', () => {
  const allow = allowedHosts();
  assert.ok(allow.has('api.dandpakpos.io.vn'));
  assert.ok(!allow.has('company-server-app-1'));
  assert.ok(!allow.has('app'));
});

test('Caddyfile PERSIST header_up Host cho cả prod và review', () => {
  const cf = readFileSync(CADDY, 'utf8');
  // Prod: giữ Host = domain tenant (env APP_DOMAIN), cả socket.io handle + reverse_proxy.
  assert.ok((cf.match(/header_up Host \{\$APP_DOMAIN\}/g) || []).length >= 2,
    'prod: header_up Host {$APP_DOMAIN} phải có ở socket.io handle + reverse_proxy');
  // Review: giữ Host = api-review domain.
  assert.ok((cf.match(/header_up Host api-review\.dandpakpos\.io\.vn/g) || []).length >= 2,
    'review: header_up Host cũng phải có ở cả hai chỗ');
  // KHÔNG whitelist internal Docker host trong file cấu hình.
  assert.doesNotMatch(cf, /TENANT_ALLOWED_HOSTS.*company-server-app-1/i);
});
