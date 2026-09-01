import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const temp = mkdtempSync(join(tmpdir(), 'dandpak-social-'));
process.env.SQLITE_PATH = join(temp, 'store.db');
process.env.STORAGE_PATH = join(temp, 'storage');
process.env.DATA_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

const { migrate } = await import('./db.js');
migrate();
const Settings = await import('./services/settings.js');
const Tiktok = await import('./services/tiktokConnector.js');
const Meta = await import('./services/metaConnector.js');
const Zalo = await import('./services/zaloConnector.js');

// ── TikTok ────────────────────────────────────────────────────────────────
test('TikTok ky: secret + path + sorted(key+value) + body + secret, HMAC-SHA256', () => {
  const secret = 'ttk-secret';
  const path = '/order/202309/orders/search';
  const query = { app_key: 'AK', timestamp: '1700', shop_cipher: 'CIPHER', access_token: 'AT', sign: 'x' };
  const body = '{"create_time_ge":1699}';
  const keys = Object.keys(query).filter(k => k !== 'sign' && k !== 'access_token').sort();
  let base = path; for (const k of keys) base += k + query[k]; base += body; base = secret + base + secret;
  const expect = crypto.createHmac('sha256', secret).update(base, 'utf8').digest('hex');
  assert.equal(Tiktok.tiktokSign(secret, path, query, body), expect);
});

test('TikTok webhook: Authorization = HMAC(app_secret, app_key+body) accept/reject', async () => {
  Settings.updateIntegrations({ channels: { tiktokshop: { enabled: true, appId: 'AK1', secretKey: 'S1', shopId: 'SHOP1' } } }, 'sala');
  const body = JSON.stringify({ shop_id: 'SHOP1', type: 2, data: {} }); // type != 1 → không gọi mạng
  const good = crypto.createHmac('sha256', 'S1').update('AK1' + body).digest('hex');
  const ok = await Tiktok.handleTiktokWebhook(Buffer.from(body), { authorization: good });
  assert.equal(ok.handled, true);
  await assert.rejects(() => Tiktok.handleTiktokWebhook(Buffer.from(body), { authorization: 'bad' }), (e) => e.status === 401);
});

// ── Meta (Facebook/Instagram) ───────────────────────────────────────────────
test('Meta GET verify tra hub.challenge khi verify_token khop', () => {
  Settings.updateIntegrations({ channels: { facebook: { enabled: true, pageId: 'PAGE1', clientSecret: 'APPSEC', verifyToken: 'VTOK', accessToken: 'PAT' } } }, 'sala');
  const ch = Meta.verifyMetaSubscribe({ 'hub.mode': 'subscribe', 'hub.verify_token': 'VTOK', 'hub.challenge': '12345' }, 'sala');
  assert.equal(ch, '12345');
  assert.throws(() => Meta.verifyMetaSubscribe({ 'hub.mode': 'subscribe', 'hub.verify_token': 'WRONG', 'hub.challenge': 'x' }, 'sala'), (e) => e.status === 403);
});

test('Meta webhook: X-Hub-Signature-256 hop le → ingest vao Omni; sai → 401', () => {
  const body = JSON.stringify({ object: 'page', entry: [{ id: 'PAGE1', time: 1700, messaging: [
    { sender: { id: 'USER9' }, recipient: { id: 'PAGE1' }, timestamp: 1700000, message: { mid: 'mid_1', text: 'chao shop' } },
  ] }] });
  const sig = 'sha256=' + crypto.createHmac('sha256', 'APPSEC').update(body).digest('hex');
  const out = Meta.handleMetaWebhook(Buffer.from(body), { 'x-hub-signature-256': sig });
  assert.equal(out.ingested, 1);
  assert.throws(() => Meta.handleMetaWebhook(Buffer.from(body), { 'x-hub-signature-256': 'sha256=bad' }), (e) => e.status === 401);
});

// ── Zalo OA ─────────────────────────────────────────────────────────────────
test('Zalo webhook: mac=SHA256(appId+body+timestamp+OASecret) → ingest; sai → 401', () => {
  Settings.updateIntegrations({ channels: { zalooa: { enabled: true, appId: 'ZAPP', oaId: 'OA1', webhookSecret: 'OASECRET', accessToken: 'ZAT' } } }, 'sala');
  const body = JSON.stringify({ app_id: 'ZAPP', oa_id: 'OA1', event_name: 'user_send_text', sender: { id: 'U7' }, recipient: { id: 'OA1' }, message: { msg_id: 'zm1', text: 'alo' }, timestamp: '1700' });
  const mac = crypto.createHash('sha256').update('ZAPP' + body + '1700' + 'OASECRET').digest('hex');
  const out = Zalo.handleZaloWebhook(Buffer.from(body), { 'x-zevent-signature': 'mac=' + mac });
  assert.equal(out.ingested, 1);
  assert.throws(() => Zalo.handleZaloWebhook(Buffer.from(body), { 'x-zevent-signature': 'mac=bad' }), (e) => e.status === 401);
});

test('capability 3 connector khong gia vo da ket noi', () => {
  assert.equal(Tiktok.tiktokCapabilities('br9').status, 'pending_credentials');
  assert.equal(Zalo.zaloCapabilities('br9').status, 'pending_credentials');
  assert.equal(Meta.metaCapabilities('br9').facebook.status, 'pending_credentials');
});
