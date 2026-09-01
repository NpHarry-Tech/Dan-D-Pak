// Zalo OA connector — Official Account messaging → Dan D Pak Omni inbox.
//
// Webhook verify: header X-ZEvent-Signature = 'mac=' + SHA256(appId + rawBody +
// timestamp + OASecretKey)  (SHA256 THƯỜNG, không phải HMAC — theo Zalo docs).
// Chuẩn hoá event → Omni.ingestMessage (idempotent). Gửi: openapi.zalo.me v3.0
// /oa/message với header access_token. Refresh token: oauth.zaloapp.com v4.
import crypto from 'node:crypto';
import { audit } from '../db.js';
import { getIntegrationChannel, updateIntegrations } from './settings.js';
import { listBranches } from './branches.js';
import { ingestMessage } from './omni/core.js';

const API_BASE = 'https://openapi.zalo.me/v3.0';
const OAUTH_BASE = 'https://oauth.zaloapp.com/v4';
const cleanId = (v) => String(v ?? '').trim();

export function zaloConfig(branchId = 'sala') {
  const c = getIntegrationChannel('zalooa', branchId) || {};
  return {
    enabled: c.enabled === true,
    oaId: cleanId(c.oaId),
    appId: cleanId(c.appId),
    secretKey: cleanId(c.secretKey),      // Zalo app secret
    accessToken: cleanId(c.accessToken),  // OA access token
    refreshToken: cleanId(c.refreshToken),
    // OA Secret Key (khai ở OA → webhook) dùng ký X-ZEvent-Signature.
    oaSecret: cleanId(c.webhookSecret) || cleanId(c.secretKey),
    apiBase: (cleanId(c.apiBase) || API_BASE).replace(/\/+$/, ''),
  };
}

function branchForOa(oaId) {
  const wanted = String(oaId);
  for (const b of listBranches({ all: true })) if (zaloConfig(b.id).oaId === wanted) return b.id;
  return 'sala';
}

// mac = SHA256(appId + data + timestamp + OASecretKey) — data là raw body string.
function verifyZaloSignature(cfg, rawBody, headers, timestamp) {
  const provided = cleanId(headers['x-zevent-signature'] || headers['X-ZEvent-Signature']).replace(/^mac=/i, '');
  if (!provided || !cfg.oaSecret) return false;
  const body = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody || '');
  const expect = crypto.createHash('sha256').update(cfg.appId + body + String(timestamp) + cfg.oaSecret).digest('hex');
  const a = Buffer.from(provided, 'utf8'); const b = Buffer.from(expect, 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const INBOUND_EVENTS = new Set(['user_send_text', 'user_send_image', 'user_send_link', 'user_send_sticker', 'user_send_file', 'user_send_audio', 'user_send_video', 'user_send_location']);

export function handleZaloWebhook(rawBody, headers = {}) {
  let payload = {};
  try { payload = JSON.parse(Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody || '{}')); }
  catch { const e = new Error('Zalo webhook body không hợp lệ.'); e.status = 400; throw e; }
  const oaId = cleanId(payload.oa_id || payload.recipient?.id);
  const branchId = branchForOa(oaId);
  const cfg = zaloConfig(branchId);
  if (!verifyZaloSignature(cfg, rawBody, headers, payload.timestamp)) {
    audit('zalo.webhook.rejected', { oa_id: oaId, reason: 'bad_signature' }, branchId, 'zalo');
    const e = new Error('Sai chữ ký X-ZEvent-Signature.'); e.status = 401; throw e;
  }
  const eventName = cleanId(payload.event_name);
  const userId = cleanId(payload.sender?.id || payload.user_id_by_app);
  const inbound = INBOUND_EVENTS.has(eventName) || eventName.startsWith('user_');
  if (!userId) { audit('zalo.webhook', { oa_id: oaId, event: eventName }, branchId, 'zalo'); return { handled: true }; }
  const msg = payload.message || {};
  const external = cleanId(msg.msg_id) || `${userId}:${payload.timestamp}`;
  const res = ingestMessage({
    provider: 'zalooa',
    event_key: `zalooa:${oaId}:${external}`,
    channel: { external_account_id: oaId, name: 'Zalo OA' },
    identity: { external_user_id: userId, display_name: cleanId(payload.sender?.name) },
    conversation: { external_conversation_id: userId },
    message: {
      external_message_id: external,
      direction: inbound ? 'inbound' : 'outbound',
      sender_type: inbound ? 'customer' : 'agent',
      message_type: eventName.includes('text') ? 'text' : (eventName.replace('user_send_', '') || 'text'),
      body: cleanId(msg.text),
      attachments: msg.attachments || (msg.url ? [{ url: msg.url }] : []),
      sent_at: payload.timestamp ? new Date(Number(payload.timestamp)).toISOString() : undefined,
      raw: payload,
    },
  }, branchId);
  return { handled: true, ingested: 1, conversation: res?.conversation?.id };
}

export async function sendZaloMessage(branchId, userId, text) {
  const cfg = zaloConfig(branchId);
  if (!cfg.accessToken) throw new Error('Zalo OA chưa có access token.');
  const res = await fetch(`${cfg.apiBase}/oa/message`, {
    method: 'POST', headers: { 'content-type': 'application/json', access_token: cfg.accessToken },
    body: JSON.stringify({ recipient: { user_id: cleanId(userId) }, message: { text: cleanId(text) } }),
  });
  const data = await res.json().catch(() => ({}));
  if (data.error && Number(data.error) !== 0) throw new Error(`Zalo gửi tin lỗi: ${data.message || data.error}`);
  audit('zalo.message.sent', { user_id: userId }, branchId, 'zalo');
  return { message_id: data.data?.message_id };
}

export async function zaloRefreshToken(branchId) {
  const cfg = zaloConfig(branchId);
  if (!cfg.appId || !cfg.secretKey) throw new Error('Zalo thiếu App ID / App Secret.');
  if (!cfg.refreshToken) throw new Error('Zalo thiếu refresh_token.');
  const body = new URLSearchParams({ app_id: cfg.appId, grant_type: 'refresh_token', refresh_token: cfg.refreshToken });
  const res = await fetch(`${OAUTH_BASE}/oa/access_token`, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', secret_key: cfg.secretKey }, body: body.toString(),
  });
  const data = await res.json().catch(() => ({}));
  if (!data.access_token) throw new Error(`Zalo refresh token thất bại: ${data.error_description || data.error || 'unknown'}`);
  updateIntegrations({ channels: { zalooa: { accessToken: data.access_token, refreshToken: data.refresh_token || cfg.refreshToken } } }, branchId);
  audit('zalo.oauth.refresh', { oa_id: cfg.oaId }, branchId, 'zalo');
  return { expires_in: data.expires_in };
}

export function zaloCapabilities(branchId = 'sala') {
  const cfg = zaloConfig(branchId);
  const configured = !!(cfg.appId && cfg.oaSecret);
  const authorized = configured && !!cfg.accessToken;
  return {
    provider: 'zalooa', enabled: cfg.enabled, configured, authorized,
    status: authorized ? 'active' : configured ? 'pending_authorization' : 'pending_credentials',
    capabilities: { inbound_messages: configured, send: authorized },
  };
}
