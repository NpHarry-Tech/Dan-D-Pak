import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const temp = mkdtempSync(join(tmpdir(), 'dandpak-lazada-chat-'));
process.env.SQLITE_PATH = join(temp, 'store.db');
process.env.STORAGE_PATH = join(temp, 'storage');
process.env.DATA_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

const { db, migrate } = await import('./db.js');
migrate();
const Settings = await import('./services/settings.js');
const LazadaChat = await import('./services/lazadaChatConnector.js');

const SECRET = 'im-chat-app-secret';

test('push khong chu ky bi TU CHOI (fail-closed); dung chu ky thi ingest vao Omni', () => {
  Settings.updateIntegrations({ channels: {
    lazada: { enabled: true, sellerId: 'seller-42' },
    lazadachat: { enabled: true, appId: 'IMAPP1', secretKey: SECRET },
  } }, 'chat-branch');

  const body = JSON.stringify({
    seller_id: 'seller-42',
    message: { buyer_id: 'buyer-9', session_id: 'sess-1', msg_id: 'm1', content: 'Còn hàng không shop?', sender_type: 'buyer' },
  });

  assert.throws(
    () => LazadaChat.handleLazadaChatPush(body, {}),
    (err) => { assert.equal(err.status, 401); return true; },
  );

  const validSig = crypto.createHmac('sha256', SECRET).update(body).digest('hex');
  const result = LazadaChat.handleLazadaChatPush(body, { authorization: validSig });
  assert.equal(result.handled, true);
  assert.equal(result.ingested, 1);
});

test('seller_id khong anh xa duoc branch nao thi tu choi 404', () => {
  const body = JSON.stringify({ seller_id: 'no-such-seller', message: { buyer_id: 'b1', content: 'hi' } });
  assert.throws(() => LazadaChat.handleLazadaChatPush(body, { authorization: 'whatever' }), (e) => e.status === 404);
});

test('thieu buyer_id trong payload bi tu choi 400 (khong doan bua danh tinh)', () => {
  Settings.updateIntegrations({ channels: {
    lazada: { enabled: true, sellerId: 'seller-43' },
    lazadachat: { enabled: true, appId: 'IMAPP1', secretKey: SECRET },
  } }, 'chat-branch-2');
  const body = JSON.stringify({ seller_id: 'seller-43', message: { content: 'hi' } });
  const validSig = crypto.createHmac('sha256', SECRET).update(body).digest('hex');
  assert.throws(() => LazadaChat.handleLazadaChatPush(body, { authorization: validSig }), (e) => e.status === 400);
});

test('kenh bi tat (enabled=false) thi bo qua, khong ingest, khong throw', () => {
  Settings.updateIntegrations({ channels: {
    lazada: { enabled: true, sellerId: 'seller-44' },
    lazadachat: { enabled: false, appId: 'IMAPP1', secretKey: SECRET },
  } }, 'chat-branch-off');
  const body = JSON.stringify({ seller_id: 'seller-44', message: { buyer_id: 'buyer-1', content: 'hi' } });
  const validSig = crypto.createHmac('sha256', SECRET).update(body).digest('hex');
  const before = db.prepare(`SELECT COUNT(*) n FROM omni_messages`).get().n;
  const result = LazadaChat.handleLazadaChatPush(body, { authorization: validSig });
  assert.equal(result.handled, false);
  assert.equal(result.reason, 'disabled');
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM omni_messages`).get().n, before);
});

test('payload khong co content/attachments (sai schema) bi bo qua, khong tao message rac', () => {
  Settings.updateIntegrations({ channels: {
    lazada: { enabled: true, sellerId: 'seller-45' },
    lazadachat: { enabled: true, appId: 'IMAPP1', secretKey: SECRET },
  } }, 'chat-branch-mismatch');
  const body = JSON.stringify({ seller_id: 'seller-45', message: { buyer_id: 'buyer-2', some_unknown_field: 'x' } });
  const validSig = crypto.createHmac('sha256', SECRET).update(body).digest('hex');
  const before = db.prepare(`SELECT COUNT(*) n FROM omni_messages`).get().n;
  const result = LazadaChat.handleLazadaChatPush(body, { authorization: validSig });
  assert.equal(result.handled, false);
  assert.equal(result.reason, 'empty_body_schema_mismatch');
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM omni_messages`).get().n, before);
});

test('retry cung mot push (khong co msg_id) khong tao trung message (dedupe bang hash body)', () => {
  Settings.updateIntegrations({ channels: {
    lazada: { enabled: true, sellerId: 'seller-46' },
    lazadachat: { enabled: true, appId: 'IMAPP1', secretKey: SECRET },
  } }, 'chat-branch-retry');
  const body = JSON.stringify({
    seller_id: 'seller-46',
    message: { buyer_id: 'buyer-3', session_id: 'sess-9', content: 'ship khi nao vay shop', sender_type: 'buyer' },
  });
  const validSig = crypto.createHmac('sha256', SECRET).update(body).digest('hex');
  const first = LazadaChat.handleLazadaChatPush(body, { authorization: validSig });
  const retry = LazadaChat.handleLazadaChatPush(body, { authorization: validSig });
  assert.equal(first.handled, true);
  assert.equal(retry.handled, true);
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM omni_messages WHERE conversation_id IN
    (SELECT id FROM omni_conversations WHERE external_conversation_id='sess-9')`).get().n, 1);
});
