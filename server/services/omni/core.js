import crypto from 'node:crypto';
import { db, uid, now, audit } from '../../db.js';
import { emit } from '../../realtime.js';

const CONVERSATION_STATUSES = new Set(['open', 'pending', 'resolved', 'closed']);
const PRIORITIES = new Set(['low', 'normal', 'high', 'urgent']);

function text(value, max = 500) { return String(value ?? '').trim().slice(0, max); }
function json(value) { return JSON.stringify(value ?? null); }
function parse(value, fallback) { try { return value ? JSON.parse(value) : fallback; } catch { return fallback; } }
function hash(value) { return crypto.createHash('sha256').update(json(value)).digest('hex'); }
function requireConversation(id, branchId) {
  const row = db.prepare(`SELECT * FROM omni_conversations WHERE id=? AND branch_id=?`).get(id, branchId);
  if (!row) throw Object.assign(new Error('Không tìm thấy hội thoại Omni.'), { status: 404 });
  return row;
}

export function capabilities() {
  return {
    product: 'Dan D Pak Omni',
    inbox: { conversations: true, assignment: true, tags: true, notes: true, canned_replies: true },
    commerce: { customer_link: true, order_link: true, create_order_with_existing_pos: true },
    connectors: {
      haravan_web_order: { inbound: true, outbound_status: true },
      harasocial_chat: { inbound: false, outbound: false, reason: 'Chờ Haravan cấp Harasocial Partner API.' },
      facebook_messenger: { inbound: false, outbound: false, status: 'pending_credentials_and_review', reason: 'Cần Meta App, App Secret, Page token và pages_messaging Advanced Access.' },
      instagram_messaging: { inbound: false, outbound: false, status: 'pending_credentials_and_review', reason: 'Cần tài khoản Professional, Meta App và Advanced Access.' },
      zalo_oa: { inbound: false, outbound: false, status: 'pending_credentials_and_review', reason: 'Cần OA App, webhook secret và OA access token được cấp.' },
      shopee_shop: { inbound_orders: false, inbound_chat: false, status: 'pending_partner_approval', reason: 'Cần Shopee Open Platform Partner approval và thông tin ứng dụng; chat scope cấp riêng.' },
      tiktok_shop: { inbound_orders: false, inbound_chat: false, status: 'pending_partner_approval', reason: 'Cần TikTok Shop Partner authorization; Business Messaging là scope riêng.' },
    },
  };
}

export function upsertChannel(input, branchId = 'sala') {
  const provider = text(input.provider, 40).toLowerCase();
  const externalId = text(input.external_account_id, 160);
  if (!provider || !externalId) throw new Error('Kênh Omni thiếu provider hoặc mã tài khoản ngoài.');
  const existing = db.prepare(`SELECT id FROM omni_channels WHERE branch_id=? AND provider=? AND external_account_id=?`)
    .get(branchId, provider, externalId);
  const id = existing?.id || uid('omch_');
  db.prepare(`INSERT INTO omni_channels(id,branch_id,provider,external_account_id,name,status,capabilities_json,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(branch_id,provider,external_account_id) DO UPDATE SET
      name=excluded.name,status=excluded.status,capabilities_json=excluded.capabilities_json,updated_at=excluded.updated_at`)
    .run(id, branchId, provider, externalId, text(input.name, 160) || provider,
      text(input.status, 30) || 'connected', json(input.capabilities || {}), now(), now());
  return db.prepare(`SELECT * FROM omni_channels WHERE id=?`).get(id);
}

// Connector-neutral ingestion contract. Adapters normalize provider payloads
// before entering here; the core never knows Haravan/Facebook/Zalo field names.
export function ingestMessage(event, branchId = 'sala') {
  const provider = text(event.provider, 40).toLowerCase();
  const eventKey = text(event.event_key, 240);
  if (!provider || !eventKey) throw new Error('Sự kiện Omni thiếu provider/event_key.');
  const payloadHash = hash(event);
  const prior = db.prepare(`SELECT payload_hash,status FROM omni_events WHERE provider=? AND event_key=?`).get(provider, eventKey);
  if (prior) {
    if (prior.payload_hash !== payloadHash) throw Object.assign(new Error('Event key Omni bị dùng lại với payload khác.'), { status: 409 });
    return { duplicate: true, status: prior.status };
  }
  db.prepare('BEGIN IMMEDIATE').run();
  try {
    db.prepare(`INSERT INTO omni_events(id,provider,event_key,payload_hash,status,received_at)
      VALUES (?,?,?,?, 'received',?)`).run(uid('omev_'), provider, eventKey, payloadHash, now());
    const channel = upsertChannel({ provider, external_account_id: event.channel?.external_account_id,
      name: event.channel?.name, status: 'connected', capabilities: event.channel?.capabilities }, branchId);
    const externalUserId = text(event.identity?.external_user_id, 240);
    if (!externalUserId) throw new Error('Tin nhắn thiếu định danh khách ngoài.');
    let identity = db.prepare(`SELECT * FROM omni_identities WHERE channel_id=? AND external_user_id=?`)
      .get(channel.id, externalUserId);
    if (!identity) {
      const id = uid('omid_');
      db.prepare(`INSERT INTO omni_identities(id,channel_id,external_user_id,customer_id,display_name,avatar_url,raw_json,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?)`).run(id, channel.id, externalUserId, event.identity?.customer_id || null,
        text(event.identity?.display_name, 240), text(event.identity?.avatar_url, 1000), json(event.identity?.raw || {}), now(), now());
      identity = db.prepare(`SELECT * FROM omni_identities WHERE id=?`).get(id);
    } else {
      db.prepare(`UPDATE omni_identities SET display_name=COALESCE(NULLIF(?,''),display_name),
        avatar_url=COALESCE(NULLIF(?,''),avatar_url),updated_at=? WHERE id=?`)
        .run(text(event.identity?.display_name, 240), text(event.identity?.avatar_url, 1000), now(), identity.id);
    }
    const externalConversationId = text(event.conversation?.external_conversation_id, 240);
    if (!externalConversationId) throw new Error('Tin nhắn thiếu mã hội thoại ngoài.');
    let conversation = db.prepare(`SELECT * FROM omni_conversations WHERE channel_id=? AND external_conversation_id=?`)
      .get(channel.id, externalConversationId);
    if (!conversation) {
      const id = uid('omcv_');
      db.prepare(`INSERT INTO omni_conversations(id,branch_id,channel_id,identity_id,external_conversation_id,status,priority,
        unread_count,last_message_at,created_at,updated_at) VALUES (?,?,?,?,?,'open','normal',0,?,?,?)`)
        .run(id, branchId, channel.id, identity.id, externalConversationId, event.message?.sent_at || now(), now(), now());
      conversation = db.prepare(`SELECT * FROM omni_conversations WHERE id=?`).get(id);
    }
    const externalMessageId = text(event.message?.external_message_id, 240);
    if (!externalMessageId) throw new Error('Tin nhắn thiếu mã ngoài.');
    const messageId = uid('omsg_');
    const direction = event.message?.direction === 'outbound' ? 'outbound' : 'inbound';
    db.prepare(`INSERT INTO omni_messages(id,conversation_id,external_message_id,direction,sender_type,message_type,body,
      attachments_json,delivery_status,sent_at,raw_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(messageId, conversation.id, externalMessageId, direction,
        text(event.message?.sender_type, 30) || (direction === 'inbound' ? 'customer' : 'agent'),
        text(event.message?.message_type, 30) || 'text', text(event.message?.body, 10000) || null,
        json(event.message?.attachments || []), text(event.message?.delivery_status, 30) || 'received',
        event.message?.sent_at || now(), json(event.message?.raw || {}), now());
    db.prepare(`UPDATE omni_conversations SET identity_id=?,status=CASE WHEN ?='inbound' THEN 'open' ELSE status END,
      unread_count=unread_count+CASE WHEN ?='inbound' THEN 1 ELSE 0 END,last_message_at=?,updated_at=? WHERE id=?`)
      .run(identity.id, direction, direction, event.message?.sent_at || now(), now(), conversation.id);
    db.prepare(`UPDATE omni_events SET status='processed',processed_at=? WHERE provider=? AND event_key=?`)
      .run(now(), provider, eventKey);
    db.prepare('COMMIT').run();
    const result = getConversation(conversation.id, branchId);
    emit('omni:conversation.updated', result, branchId);
    return { duplicate: false, conversation: result, message_id: messageId };
  } catch (error) {
    db.prepare('ROLLBACK').run();
    throw error;
  }
}

const INBOX_SELECT = `SELECT c.*,ch.provider,ch.name channel_name,ch.external_account_id,
  i.customer_id,i.external_user_id,i.display_name,i.avatar_url,u.name assignee_name,
  (SELECT body FROM omni_messages m WHERE m.conversation_id=c.id ORDER BY m.sent_at DESC,m.id DESC LIMIT 1) last_message
  FROM omni_conversations c JOIN omni_channels ch ON ch.id=c.channel_id
  LEFT JOIN omni_identities i ON i.id=c.identity_id LEFT JOIN users u ON u.id=c.assignee_user_id`;

function decorate(row) {
  if (!row) return null;
  return { ...row, unread_count: Number(row.unread_count || 0),
    tags: db.prepare(`SELECT t.id,t.name,t.color_token FROM omni_tags t JOIN omni_conversation_tags ct ON ct.tag_id=t.id
      WHERE ct.conversation_id=? ORDER BY t.name`).all(row.id) };
}

export function listConversations(branchId = 'sala', query = {}) {
  const where = ['c.branch_id=?'];
  const params = [branchId];
  const status = text(query.status, 30);
  if (status && status !== 'all') { where.push('c.status=?'); params.push(status); }
  const provider = text(query.provider, 40).toLowerCase();
  if (provider) { where.push('ch.provider=?'); params.push(provider); }
  if (query.unread === true || query.unread === 'true') where.push('c.unread_count>0');
  if (query.assignee_user_id) { where.push('c.assignee_user_id=?'); params.push(text(query.assignee_user_id, 100)); }
  const q = text(query.q, 200).toLowerCase();
  if (q) { where.push(`LOWER(COALESCE(i.display_name,'')||' '||COALESCE(i.external_user_id,'')||' '||COALESCE(c.note,'')) LIKE ?`); params.push(`%${q}%`); }
  const limit = Math.max(1, Math.min(100, Number(query.limit) || 30));
  const offset = Math.max(0, Number(query.offset) || 0);
  const sqlWhere = where.join(' AND ');
  const rows = db.prepare(`${INBOX_SELECT} WHERE ${sqlWhere} ORDER BY c.last_message_at DESC,c.updated_at DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, offset).map(decorate);
  const total = Number(db.prepare(`SELECT COUNT(*) n FROM omni_conversations c JOIN omni_channels ch ON ch.id=c.channel_id
    LEFT JOIN omni_identities i ON i.id=c.identity_id WHERE ${sqlWhere}`).get(...params)?.n || 0);
  return { rows, total, limit, offset };
}

export function getConversation(id, branchId = 'sala') {
  const row = db.prepare(`${INBOX_SELECT} WHERE c.id=? AND c.branch_id=?`).get(id, branchId);
  if (!row) return null;
  const out = decorate(row);
  out.customer = row.customer_id ? db.prepare(`SELECT * FROM customers WHERE id=? AND branch_id=?`).get(row.customer_id, branchId) || null : null;
  out.orders = db.prepare(`SELECT o.id,o.bill_no,o.status,o.total,o.created_at FROM orders o JOIN omni_conversation_orders x ON x.order_id=o.id
    WHERE x.conversation_id=? AND o.branch_id=? ORDER BY x.created_at DESC`).all(id, branchId);
  return out;
}

export function listMessages(id, branchId = 'sala', query = {}) {
  requireConversation(id, branchId);
  const limit = Math.max(1, Math.min(200, Number(query.limit) || 50));
  const before = text(query.before, 40);
  const rows = before
    ? db.prepare(`SELECT * FROM omni_messages WHERE conversation_id=? AND sent_at<? ORDER BY sent_at DESC,id DESC LIMIT ?`).all(id, before, limit)
    : db.prepare(`SELECT * FROM omni_messages WHERE conversation_id=? ORDER BY sent_at DESC,id DESC LIMIT ?`).all(id, limit);
  return rows.reverse().map(row => ({ ...row, attachments: parse(row.attachments_json, []) }));
}

export function updateConversation(id, changes = {}, branchId = 'sala', actor = 'system') {
  const current = requireConversation(id, branchId);
  const status = changes.status == null ? current.status : text(changes.status, 30);
  const priority = changes.priority == null ? current.priority : text(changes.priority, 30);
  if (!CONVERSATION_STATUSES.has(status)) throw new Error('Trạng thái hội thoại không hợp lệ.');
  if (!PRIORITIES.has(priority)) throw new Error('Mức ưu tiên hội thoại không hợp lệ.');
  let assignee = changes.assignee_user_id === undefined ? current.assignee_user_id : (text(changes.assignee_user_id, 100) || null);
  if (assignee && !db.prepare(`SELECT 1 FROM users WHERE id=? AND active=1`).get(assignee)) throw new Error('Nhân viên được phân công không hoạt động.');
  const note = changes.note === undefined ? current.note : (text(changes.note, 4000) || null);
  const unread = changes.mark_read === true ? 0 : current.unread_count;
  db.prepare(`UPDATE omni_conversations SET status=?,priority=?,assignee_user_id=?,note=?,unread_count=?,updated_at=? WHERE id=?`)
    .run(status, priority, assignee, note, unread, now(), id);
  audit('omni.conversation.updated', { conversation_id: id, status, priority, assignee_user_id: assignee }, branchId, actor);
  const result = getConversation(id, branchId);
  emit('omni:conversation.updated', result, branchId);
  return result;
}

export function linkCustomer(id, customerId, branchId = 'sala', actor = 'system') {
  const conversation = requireConversation(id, branchId);
  if (!conversation.identity_id) throw new Error('Hội thoại chưa có định danh khách.');
  const customer = db.prepare(`SELECT id FROM customers WHERE id=? AND branch_id=?`).get(customerId, branchId);
  if (!customer) throw new Error('Khách hàng không tồn tại trong chi nhánh.');
  db.prepare(`UPDATE omni_identities SET customer_id=?,updated_at=? WHERE id=?`).run(customerId, now(), conversation.identity_id);
  audit('omni.customer.linked', { conversation_id: id, customer_id: customerId }, branchId, actor);
  return getConversation(id, branchId);
}

export function linkOrder(id, orderId, branchId = 'sala', actor = 'system') {
  requireConversation(id, branchId);
  if (!db.prepare(`SELECT 1 FROM orders WHERE id=? AND branch_id=?`).get(orderId, branchId)) throw new Error('Đơn hàng không tồn tại trong chi nhánh.');
  db.prepare(`INSERT OR IGNORE INTO omni_conversation_orders(conversation_id,order_id,linked_by,created_at) VALUES (?,?,?,?)`)
    .run(id, orderId, actor, now());
  audit('omni.order.linked', { conversation_id: id, order_id: orderId }, branchId, actor);
  return getConversation(id, branchId);
}

export function listCannedReplies(branchId = 'sala', includeInactive = false) {
  return db.prepare(`SELECT * FROM omni_canned_replies WHERE branch_id=? ${includeInactive ? '' : 'AND active=1'} ORDER BY shortcut`)
    .all(branchId);
}

export function saveCannedReply(input, branchId = 'sala', actor = 'system') {
  const shortcut = text(input.shortcut, 60).replace(/^:/, '').toLowerCase();
  const body = text(input.body, 4000);
  if (!/^[a-z0-9_-]{1,60}$/i.test(shortcut) || !body) throw new Error('Mẫu trả lời cần shortcut hợp lệ và nội dung.');
  const id = text(input.id, 100) || uid('omqr_');
  db.prepare(`INSERT INTO omni_canned_replies(id,branch_id,shortcut,body,active,created_by,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(branch_id,shortcut) DO UPDATE SET body=excluded.body,active=excluded.active,updated_at=excluded.updated_at`)
    .run(id, branchId, shortcut, body, input.active === false ? 0 : 1, actor, now(), now());
  audit('omni.canned_reply.saved', { shortcut }, branchId, actor);
  return db.prepare(`SELECT * FROM omni_canned_replies WHERE branch_id=? AND shortcut=?`).get(branchId, shortcut);
}

export function listTags(branchId = 'sala') {
  return db.prepare(`SELECT t.*,(SELECT COUNT(*) FROM omni_conversation_tags x WHERE x.tag_id=t.id) usage_count
    FROM omni_tags t WHERE t.branch_id=? ORDER BY t.name`).all(branchId);
}

export function saveTag(input, branchId = 'sala', actor = 'system') {
  const name = text(input.name, 80);
  const color = text(input.color_token, 40) || 'neutral';
  if (!name) throw new Error('Nhãn Omni cần có tên.');
  const id = text(input.id, 100) || uid('omtag_');
  db.prepare(`INSERT INTO omni_tags(id,branch_id,name,color_token,created_at)
    VALUES (?,?,?,?,?) ON CONFLICT(branch_id,name) DO UPDATE SET color_token=excluded.color_token`)
    .run(id, branchId, name, color, now());
  audit('omni.tag.saved', { name, color_token: color }, branchId, actor);
  return db.prepare(`SELECT * FROM omni_tags WHERE branch_id=? AND name=?`).get(branchId, name);
}

export function setConversationTags(id, tagIds = [], branchId = 'sala', actor = 'system') {
  requireConversation(id, branchId);
  const unique = [...new Set((Array.isArray(tagIds) ? tagIds : []).map(x => text(x, 100)).filter(Boolean))];
  for (const tagId of unique) {
    if (!db.prepare(`SELECT 1 FROM omni_tags WHERE id=? AND branch_id=?`).get(tagId, branchId)) {
      throw new Error('Nhãn Omni không thuộc chi nhánh hiện tại.');
    }
  }
  db.prepare('BEGIN IMMEDIATE').run();
  try {
    db.prepare(`DELETE FROM omni_conversation_tags WHERE conversation_id=?`).run(id);
    const insert = db.prepare(`INSERT INTO omni_conversation_tags(conversation_id,tag_id) VALUES (?,?)`);
    for (const tagId of unique) insert.run(id, tagId);
    db.prepare('COMMIT').run();
  } catch (error) { db.prepare('ROLLBACK').run(); throw error; }
  audit('omni.conversation.tags_updated', { conversation_id: id, tag_ids: unique }, branchId, actor);
  return getConversation(id, branchId);
}
