import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const temp = mkdtempSync(join(tmpdir(), 'dandpak-haravan-oauth-'));
process.env.SQLITE_PATH = join(temp, 'store.db');
process.env.STORAGE_PATH = join(temp, 'storage');
process.env.DATA_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.HARAVAN_CLIENT_ID = 'client-test';
process.env.HARAVAN_CLIENT_SECRET = 'secret-test';
process.env.APP_URL = 'https://pos.example.test';

const { db, migrate } = await import('./db.js');
const { encryptSecret, decryptSecret, secretContext } = await import('./core/crypto.js');
const Haravan = await import('./services/haravanConnector.js');
migrate();

function tokenContext(shop, field) {
  return [secretContext({ tenant: 'sala', provider: 'haravan', record: shop, field: `${field}_token` }), `haravan:${shop}:${field}`];
}

function unsignedJwt(claims) {
  const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${header}.${payload}.`;
}

function statePayload(state) {
  return JSON.parse(Buffer.from(String(state).split('.')[0], 'base64url').toString('utf8'));
}

test('install starts with a signed, short-lived login step and requests offline refresh', () => {
  const result = Haravan.installUrl({ branch_id: 'sala' });
  const url = new URL(result.url);
  const scopes = new Set(url.searchParams.get('scope').split(' '));
  assert.equal(url.searchParams.get('response_mode'), 'form_post');
  assert.equal(url.searchParams.get('response_type'), 'code id_token');
  assert.ok(scopes.has('offline_access'));
  assert.ok(!scopes.has('wh_api'), 'owner-only scopes belong to the second install step');
  assert.match(url.searchParams.get('state'), /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
});

test('owner login continues to install scope and persists a subscribed shop', async () => {
  const started = Haravan.installUrl({ branch_id: 'sala' });
  let callbackNonce = statePayload(started.state).nonce;
  let tokenCalls = 0;
  globalThis.fetch = async (url, init = {}) => {
    if (String(url).endsWith('/connect/token')) {
      tokenCalls++;
      const body = new URLSearchParams(String(init.body));
      assert.equal(body.get('grant_type'), 'authorization_code');
      return {
        ok: true,
        status: 200,
        json: async () => tokenCalls === 1
          ? { access_token: 'login-access', id_token: unsignedJwt({ role: 'admin', org_id: 'org-1', org_name: 'owner.myharavan.com', nonce: callbackNonce }) }
          : { access_token: 'shop-access', refresh_token: 'shop-refresh', scope: 'openid offline_access grant_service wh_api', token_type: 'Bearer', expires_in: 3600, id_token: unsignedJwt({ role: 'admin', org_id: 'org-1', org_name: 'owner.myharavan.com', nonce: callbackNonce }) },
      };
    }
    assert.equal(String(url), 'https://webhook.haravan.com/api/subscribe');
    assert.equal(init.headers.Authorization, 'Bearer shop-access');
    return { ok: true, status: 200, json: async () => ({ error: false }) };
  };

  const login = await Haravan.oauthCallback({ code: 'login-code', state: started.state });
  const installUrl = new URL(login.continue_url);
  const scopes = new Set(installUrl.searchParams.get('scope').split(' '));
  assert.ok(scopes.has('grant_service'));
  assert.ok(scopes.has('wh_api'));
  assert.equal(installUrl.searchParams.get('orgid'), 'org-1');
  callbackNonce = statePayload(installUrl.searchParams.get('state')).nonce;

  const installed = await Haravan.oauthCallback({
    code: 'install-code',
    state: installUrl.searchParams.get('state'),
  });
  assert.equal(installed.webhook_status, 'subscribed');
  const row = db.prepare(`SELECT branch_id,scope,webhook_status,access_token,refresh_token
    FROM haravan_shops WHERE shop_domain='owner.myharavan.com'`).get();
  assert.equal(row.branch_id, 'sala');
  assert.match(row.scope, /wh_api/);
  assert.equal(row.webhook_status, 'subscribed');
  assert.equal(decryptSecret(row.access_token, tokenContext('owner.myharavan.com', 'access')), 'shop-access');
  assert.equal(decryptSecret(row.refresh_token, tokenContext('owner.myharavan.com', 'refresh')), 'shop-refresh');
});

test('webhook 401 refreshes the token once and retries without leaking credentials', async () => {
  const shop = 'recovery.myharavan.com';
  const timestamp = new Date().toISOString();
  db.prepare(`INSERT INTO haravan_shops
    (id,shop_domain,branch_id,access_token,refresh_token,scope,token_type,api_base,installed_at,updated_at,active)
    VALUES (?,?,?,?,?,'openid grant_service wh_api offline_access','Bearer','https://apis.haravan.com',?,?,1)`)
    .run('hshop_recovery', shop, 'sala', encryptSecret('old-access', tokenContext(shop, 'access')),
      encryptSecret('old-refresh', tokenContext(shop, 'refresh')), timestamp, timestamp);
  let webhookCalls = 0;
  globalThis.fetch = async (url, init = {}) => {
    if (String(url).endsWith('/connect/token')) {
      assert.equal(String(init.body).includes('grant_type=refresh_token'), true);
      return { ok: true, status: 200, json: async () => ({ access_token: 'new-access', refresh_token: 'new-refresh', scope: 'openid grant_service wh_api offline_access', token_type: 'Bearer', expires_in: 3600 }) };
    }
    webhookCalls++;
    assert.equal(init.headers.Authorization, `Bearer ${webhookCalls === 1 ? 'old-access' : 'new-access'}`);
    return webhookCalls === 1
      ? { ok: false, status: 401, json: async () => ({ error: true }) }
      : { ok: true, status: 200, json: async () => ({ error: false }) };
  };
  await Haravan.subscribeWebhook(shop, 'sala');
  assert.equal(webhookCalls, 2);
  const row = db.prepare(`SELECT access_token,refresh_token,webhook_status,webhook_error FROM haravan_shops WHERE id='hshop_recovery'`).get();
  assert.equal(decryptSecret(row.access_token, tokenContext(shop, 'access')), 'new-access');
  assert.equal(decryptSecret(row.refresh_token, tokenContext(shop, 'refresh')), 'new-refresh');
  assert.equal(row.webhook_status, 'subscribed');
  assert.equal(row.webhook_error, null);
});

test('missing wh_api fails before network with an actionable per-shop state', async () => {
  const shop = 'missing-scope.myharavan.com';
  const timestamp = new Date().toISOString();
  db.prepare(`INSERT INTO haravan_shops
    (id,shop_domain,branch_id,access_token,scope,token_type,api_base,installed_at,updated_at,active)
    VALUES (?,?,?,?,?,'Bearer','https://apis.haravan.com',?,?,1)`)
    .run('hshop_missing', shop, 'sala', encryptSecret('access', tokenContext(shop, 'access')),
      'openid grant_service', timestamp, timestamp);
  globalThis.fetch = async () => { throw new Error('network must not be called'); };
  await assert.rejects(Haravan.subscribeWebhook(shop, 'sala'), error =>
    error.code === 'HARAVAN_WEBHOOK_SCOPE_MISSING' && error.status === 403);
  const row = db.prepare(`SELECT webhook_status,webhook_error FROM haravan_shops WHERE id='hshop_missing'`).get();
  assert.equal(row.webhook_status, 'error');
  assert.match(row.webhook_error, /wh_api/);
});

test.after(() => {
  db.close();
  rmSync(temp, { recursive: true, force: true });
});
