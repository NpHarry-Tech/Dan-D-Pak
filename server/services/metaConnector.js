// Meta connector — Facebook Page Messenger + Instagram messaging → Dan-D Pak
// Omni inbox. KHÔNG phải kênh đơn hàng; đây là hội thoại.
//
// Webhook GET: xác thực hub.verify_token → trả hub.challenge.
// Webhook POST: X-Hub-Signature-256 = 'sha256='+HMAC-SHA256(app_secret, rawBody).
// Chuẩn hoá payload Meta → Omni.ingestMessage (idempotent theo provider+event_key).
// Gửi: Graph API /me/messages với Page access token.
import crypto from 'node:crypto';
import { audit } from '../db.js';
import { getIntegrationChannel } from './settings.js';
import { listBranches } from './branches.js';
import { ingestMessage } from './omni/core.js';

const GRAPH = 'https://graph.facebook.com/v21.0';
const cleanId = (v) => String(v ?? '').trim();

function metaChannel(provider, branchId) {
  const c = getIntegrationChannel(provider, branchId) || {};
  return {
    enabled: c.enabled === true,
    appId: cleanId(c.appId),
    pageId: cleanId(c.pageId),
    igUserId: cleanId(c.igUserId),
    clientSecret: cleanId(c.clientSecret), // Meta App Secret
    accessToken: cleanId(c.accessToken),   // Page/IG token
    verifyToken: cleanId(c.verifyToken),
    apiBase: (cleanId(c.apiBase) || GRAPH).replace(/\/+$/, ''),
  };
}

// App Secret / verify token dùng chung Meta App: ưu tiên facebook, fallback instagram.
function metaSecret(branchId) {
  for (const p of ['facebook', 'instagram']) {
    const s = cleanId(metaChannel(p, branchId).clientSecret);
    if (s) return s;
  }
  return '';
}
function metaVerifyToken(branchId) {
  for (const p of ['facebook', 'instagram']) {
    const v = cleanId(metaChannel(p, branchId).verifyToken);
    if (v) return v;
  }
  return '';
}

// GET verify handshake — Meta gọi khi đăng ký webhook.
export function verifyMetaSubscribe(query = {}, branchId = 'sala') {
  const mode = cleanId(query['hub.mode']);
  const token = cleanId(query['hub.verify_token']);
  const challenge = cleanId(query['hub.challenge']);
  const expected = metaVerifyToken(branchId);
  if (mode === 'subscribe' && expected && token === expected) return challenge;
  const e = new Error('Meta verify_token không khớp.'); e.status = 403; throw e;
}

function verifySignature(secret, rawBody, header) {
  const sig = cleanId(header).replace(/^sha256=/i, '');
  if (!sig || !secret) return false;
  const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody || ''), 'utf8');
  const expect = crypto.createHmac('sha256', secret).update(body).digest('hex');
  const a = Buffer.from(sig, 'utf8'); const b = Buffer.from(expect, 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Tìm chi nhánh theo page_id (FB) / ig_user_id (IG) trong entry.
function resolveBranchAndProvider(entryId, objectType) {
  const wanted = String(entryId);
  for (const b of listBranches({ all: true })) {
    if (objectType === 'instagram') {
      if (metaChannel('instagram', b.id).igUserId === wanted || metaChannel('instagram', b.id).pageId === wanted) return { branchId: b.id, provider: 'instagram' };
    } else {
      if (metaChannel('facebook', b.id).pageId === wanted) return { branchId: b.id, provider: 'facebook' };
    }
  }
  return { branchId: 'sala', provider: objectType === 'instagram' ? 'instagram' : 'facebook' };
}

export function handleMetaWebhook(rawBody, headers = {}) {
  let payload = {};
  try { payload = JSON.parse(Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody || '{}')); }
  catch { const e = new Error('Meta webhook body không hợp lệ.'); e.status = 400; throw e; }
  const objectType = cleanId(payload.object); // 'page' | 'instagram'
  const results = [];
  for (const entry of Array.isArray(payload.entry) ? payload.entry : []) {
    const { branchId, provider } = resolveBranchAndProvider(entry.id, objectType);
    // Xác thực chữ ký theo app secret của chi nhánh giải được.
    const sig = headers['x-hub-signature-256'] || headers['X-Hub-Signature-256'];
    if (!verifySignature(metaSecret(branchId), rawBody, sig)) {
      audit('meta.webhook.rejected', { object: objectType, entry: entry.id, reason: 'bad_signature' }, branchId, provider);
      const e = new Error('Sai chữ ký X-Hub-Signature-256.'); e.status = 401; throw e;
    }
    const pageId = cleanId(entry.id);
    for (const m of Array.isArray(entry.messaging) ? entry.messaging : []) {
      const senderId = cleanId(m.sender?.id);
      const recipientId = cleanId(m.recipient?.id);
      const msg = m.message;
      if (!msg || msg.is_echo) continue; // bỏ echo tin do mình gửi
      const external = cleanId(msg.mid) || `${senderId}:${m.timestamp}`;
      const inbound = senderId && senderId !== pageId;
      const conversationUser = inbound ? senderId : recipientId;
      const res = ingestMessage({
        provider,
        event_key: `${provider}:${pageId}:${external}`,
        channel: { external_account_id: pageId, name: provider === 'instagram' ? 'Instagram' : 'Facebook Page' },
        identity: { external_user_id: conversationUser, display_name: '' },
        conversation: { external_conversation_id: conversationUser },
        message: {
          external_message_id: external,
          direction: inbound ? 'inbound' : 'outbound',
          sender_type: inbound ? 'customer' : 'agent',
          message_type: msg.attachments?.length ? 'attachment' : 'text',
          body: cleanId(msg.text),
          attachments: msg.attachments || [],
          sent_at: m.timestamp ? new Date(Number(m.timestamp)).toISOString() : undefined,
          raw: m,
        },
      }, branchId);
      results.push(res);
    }
  }
  return { handled: true, ingested: results.length };
}

// Gửi tin ra Messenger/IG (khi có Page token + Advanced Access).
export async function sendMetaMessage(branchId, provider, recipientId, text) {
  const cfg = metaChannel(provider, branchId);
  if (!cfg.accessToken) throw new Error(`${provider} chưa có Page access token.`);
  const res = await fetch(`${cfg.apiBase}/me/messages?access_token=${encodeURIComponent(cfg.accessToken)}`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ recipient: { id: cleanId(recipientId) }, messaging_type: 'RESPONSE', message: { text: cleanId(text) } }),
  });
  const data = await res.json().catch(() => ({}));
  if (data.error) throw new Error(`${provider} gửi tin lỗi: ${data.error.message}`);
  audit('meta.message.sent', { provider, recipient: recipientId }, branchId, provider);
  return { message_id: data.message_id };
}

export function metaCapabilities(branchId = 'sala') {
  const out = {};
  for (const provider of ['facebook', 'instagram']) {
    const cfg = metaChannel(provider, branchId);
    const configured = !!(cfg.clientSecret && cfg.verifyToken);
    const authorized = configured && !!cfg.accessToken;
    out[provider] = {
      provider, enabled: cfg.enabled, configured, authorized,
      status: authorized ? 'active' : configured ? 'pending_advanced_access' : 'pending_credentials',
      capabilities: { inbound_messages: configured, send: authorized },
    };
  }
  return out;
}
