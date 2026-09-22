// Lazada IM Open API (Chat) → Dan-D Pak Omni inbox ("Chat đa kênh").
//
// App "In-house IM Chat" là App RIÊNG trên ISV Console (App Key/Secret khác
// app bán hàng ở lazadaConnector.js), dù chung một seller — nên dùng chung
// ánh xạ seller→branch của lazadaConnector (branchForSeller) nhưng đọc
// credential ở kênh 'lazadachat' riêng.
//
// CHỮ KÝ + PAYLOAD: open.lazada.com yêu cầu đăng nhập, không fetch được tài
// liệu chính thức cho IM Open API. Tạm dùng CÙNG scheme HMAC-SHA256(app_secret)
// trên raw body như push đơn hàng Lazada (cùng nền tảng Alibaba TOP). Tên field
// message/conversation cũng là suy đoán tốt nhất theo quy ước IM phổ biến —
// LUÔN giữ `raw: payload` trong message Omni để không mất dữ liệu nếu đoán sai.
// Khi có push thật đầu tiên, đối chiếu `raw` trong bảng omni_events/messages
// rồi chỉnh lại phần trích field bên dưới cho khớp.
import crypto from 'node:crypto';
import { audit } from '../db.js';
import { getIntegrationChannel } from './settings.js';
import { branchForSeller } from './lazadaConnector.js';
import { ingestMessage } from './omni/core.js';

const cleanId = (v) => String(v ?? '').trim();

export function lazadaChatConfig(branchId = 'sala') {
  const c = getIntegrationChannel('lazadachat', branchId) || {};
  const envAppId = String(process.env.LAZADA_CHAT_APP_KEY || '').trim();
  const envSecret = String(process.env.LAZADA_CHAT_APP_SECRET || '').trim();
  const secretKey = envSecret || cleanId(c.secretKey);
  return {
    enabled: c.enabled === true,
    appId: envAppId || cleanId(c.appId),
    secretKey,
    webhookSecret: cleanId(process.env.LAZADA_CHAT_WEBHOOK_SECRET) || secretKey || cleanId(c.webhookSecret),
  };
}

function safeEqualHex(a, b) {
  const x = Buffer.from(cleanId(a), 'utf8'); const y = Buffer.from(cleanId(b), 'utf8');
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// BẢO MẬT (fail-closed, cùng quy ước handleLazadaPush/handleTiktokWebhook):
// App IM Chat dùng MỘT bí mật cho toàn hệ thống (không theo chi nhánh), nên xác
// thực được trên byte thô TRƯỚC khi JSON.parse hay đụng tới bất kỳ field nào
// (kể cả seller_id) — tấn công không thể ép server parse/route bằng payload giả.
export function handleLazadaChatPush(rawBody, headers = {}) {
  const body = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody || '');
  const provided = cleanId(headers['authorization'] || headers['x-lazada-signature'] || headers['sha256']);
  const platformSecret = cleanId(process.env.LAZADA_CHAT_WEBHOOK_SECRET) || cleanId(process.env.LAZADA_CHAT_APP_SECRET);
  if (platformSecret) {
    const expected = crypto.createHmac('sha256', platformSecret).update(body).digest('hex');
    if (!provided || (!safeEqualHex(expected, provided) && !safeEqualHex(expected.toUpperCase(), provided))) {
      audit('lazada.chat.rejected', { reason: provided ? 'bad_signature' : 'missing_signature' }, '', 'lazadachat');
      const e = new Error(provided ? 'Sai chữ ký push Lazada Chat.' : 'Thiếu chữ ký push Lazada Chat.'); e.status = 401; throw e;
    }
  }

  let payload = {};
  try { payload = JSON.parse(body || '{}'); }
  catch { const e = new Error('Lazada chat webhook body không hợp lệ.'); e.status = 400; throw e; }

  const sellerId = cleanId(payload.seller_id || payload.sellerId || payload.seller?.id);
  let branchId;
  try { branchId = branchForSeller(sellerId); }
  catch (error) {
    audit('lazada.chat.rejected', { reason: 'unmapped_seller' }, '', 'lazadachat');
    throw error;
  }

  const cfg = lazadaChatConfig(branchId);
  if (!cfg.enabled) {
    // Cơ chế tắt riêng: mặc định false (DEFAULT_INTEGRATIONS.lazadachat) cho tới
    // khi bật ở Cài đặt → Kết nối — không âm thầm ingest khi chưa ai bật.
    audit('lazada.chat.skipped', { seller_id: sellerId, reason: 'disabled' }, branchId, 'lazadachat');
    return { handled: false, reason: 'disabled' };
  }
  if (!platformSecret) {
    // Không có bí mật toàn app — chỉ còn cách verify SAU khi biết chi nhánh
    // (bí mật riêng theo chi nhánh, không xác thực được trước khi biết seller_id).
    if (!cfg.webhookSecret || !provided) {
      audit('lazada.chat.rejected', { seller_id: sellerId, reason: 'missing_signature' }, branchId, 'lazadachat');
      const e = new Error('Thiếu chữ ký push Lazada Chat.'); e.status = 401; throw e;
    }
    const expected = crypto.createHmac('sha256', cfg.webhookSecret).update(body).digest('hex');
    if (!safeEqualHex(expected, provided) && !safeEqualHex(expected.toUpperCase(), provided)) {
      audit('lazada.chat.rejected', { seller_id: sellerId, reason: 'bad_signature' }, branchId, 'lazadachat');
      const e = new Error('Sai chữ ký push Lazada Chat.'); e.status = 401; throw e;
    }
  }

  const msg = payload.message || payload.data || payload;
  const buyerId = cleanId(msg.buyer_id || msg.from_id || payload.buyer_id || payload.from_account_id);
  if (!buyerId) {
    audit('lazada.chat.rejected', { seller_id: sellerId, reason: 'missing_buyer_id' }, branchId, 'lazadachat');
    const e = new Error('Lazada chat push thiếu buyer_id.'); e.status = 400; throw e;
  }
  const bodyText = cleanId(msg.content || msg.text || msg.msg);
  const attachments = msg.attachments || (msg.image_url ? [{ url: msg.image_url }] : []);
  if (!bodyText && (!Array.isArray(attachments) || attachments.length === 0)) {
    // Fail-closed: tên field suy đoán không khớp payload thật (event khác loại
    // tin nhắn, hoặc Lazada đặt tên khác) — TỪ CHỐI tạo message/conversation
    // rỗng thay vì đoán bừa. Đối chiếu `raw` đã lưu ở omni_events khi cần fix schema.
    audit('lazada.chat.skipped', { seller_id: sellerId, reason: 'empty_body_schema_mismatch' }, branchId, 'lazadachat');
    return { handled: false, reason: 'empty_body_schema_mismatch' };
  }
  const conversationId = cleanId(msg.session_id || msg.conversation_id || payload.session_id) || `${sellerId}:${buyerId}`;
  // Dedupe đáng tin cậy: hash body thô làm fallback (ổn định qua các lần Lazada
  // retry webhook — CÙNG byte thì CÙNG hash), không dùng Date.now() (khác mỗi
  // lần gọi → mất khả năng chống trùng khi provider gửi lại).
  const fallbackMessageId = crypto.createHash('sha256').update(body).digest('hex').slice(0, 32);
  const messageId = cleanId(msg.msg_id || msg.message_id || payload.msg_id) || fallbackMessageId;
  const fromSeller = cleanId(msg.sender_type || msg.from_role).toLowerCase() === 'seller';
  const sendTimeRaw = Number(msg.send_time || msg.create_time || 0);

  const res = ingestMessage({
    provider: 'lazadachat',
    event_key: `lazadachat:${sellerId}:${messageId}`,
    channel: { external_account_id: sellerId, name: 'Lazada Chat' },
    identity: { external_user_id: buyerId, display_name: cleanId(msg.buyer_name || msg.from_name) },
    conversation: { external_conversation_id: conversationId },
    message: {
      external_message_id: messageId,
      direction: fromSeller ? 'outbound' : 'inbound',
      sender_type: fromSeller ? 'agent' : 'customer',
      message_type: cleanId(msg.msg_type || msg.type) || 'text',
      body: bodyText,
      attachments,
      sent_at: sendTimeRaw ? new Date(sendTimeRaw > 1e12 ? sendTimeRaw : sendTimeRaw * 1000).toISOString() : undefined,
      raw: payload,
    },
  }, branchId);
  audit('lazada.chat.accepted', { seller_id: sellerId, conversation: res?.conversation?.id }, branchId, 'lazadachat');
  return { handled: true, ingested: 1, conversation: res?.conversation?.id };
}
