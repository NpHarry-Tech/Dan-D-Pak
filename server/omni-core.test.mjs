import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const temp = mkdtempSync(join(tmpdir(), 'dandpak-omni-core-'));
process.env.SQLITE_PATH = join(temp, 'store.db');
process.env.STORAGE_PATH = join(temp, 'storage');
process.env.DATA_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const { db, migrate } = await import('./db.js');
migrate();
const Omni = await import('./services/omni/core.js');

const event = {
  provider: 'facebook_messenger', event_key: 'page:1:message:m1',
  channel: { external_account_id: 'page-1', name: 'Dan D Pak' },
  identity: { external_user_id: 'psid-1', display_name: 'Khach A' },
  conversation: { external_conversation_id: 'psid-1' },
  message: { external_message_id: 'm1', direction: 'inbound', body: 'Xin chao', sent_at: '2026-08-18T03:00:00.000Z' },
};

test('webhook retry khong tao trung hoi thoai hay tin nhan', () => {
  const first = Omni.ingestMessage(event, 'sala');
  const replay = Omni.ingestMessage(event, 'sala');
  assert.equal(first.duplicate, false);
  assert.equal(replay.duplicate, true);
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM omni_messages`).get().n, 1);
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM omni_conversations`).get().n, 1);
});

test('event key giong nhau nhung payload khac bi chan', () => {
  assert.throws(() => Omni.ingestMessage({ ...event, message: { ...event.message, body: 'payload khac' } }, 'sala'), /payload/);
});

test('gan nhan va mau tra loi dung chung loi Omni', () => {
  const conversation = db.prepare(`SELECT id FROM omni_conversations`).get();
  const tag = Omni.saveTag({ name: 'Khach VIP', color_token: 'accent' }, 'sala', 'test');
  const updated = Omni.setConversationTags(conversation.id, [tag.id], 'sala', 'test');
  assert.equal(updated.tags[0].name, 'Khach VIP');
  const reply = Omni.saveCannedReply({ shortcut: 'camon', body: 'Cảm ơn quý khách.' }, 'sala', 'test');
  assert.equal(reply.shortcut, 'camon');
});

test.after(() => {
  db.close();
  rmSync(temp, { recursive: true, force: true });
});
