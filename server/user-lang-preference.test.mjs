// updateOwnLang() từng chỉ nhận 'en', mọi giá trị khác (kể cả 'zh' hợp lệ) bị
// âm thầm ép về 'vi' — khiến chọn tiếng Trung ở màn đăng nhập bị trả lại tiếng
// Việt ngay sau khi đăng nhập xong (server lưu 'vi' dù client gửi đúng 'zh').
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const temp = mkdtempSync(join(tmpdir(), 'ddp-userlang-'));
process.env.SQLITE_PATH = join(temp, 'store.db');
process.env.STORAGE_PATH = join(temp, 'storage');
process.env.DATA_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.DISABLE_DEMO_SEED = 'true';

const { db, migrate } = await import('./db.js');
const { hashPin } = await import('./services/pin.js');
const Auth = await import('./services/auth.js');
migrate();

db.prepare(`INSERT INTO users (id,branch_id,username,name,pin,role,active,branch_access_json)
  VALUES ('u_lang','sala','langtest','Lang Test',?, 'cashier',1,'["sala"]')`).run(hashPin('7777'));

test('updateOwnLang chap nhan vi/en/zh, khong ep nham ve vi', () => {
  const zh = Auth.updateOwnLang('u_lang', 'zh', 'sala');
  assert.equal(zh.lang, 'zh');
  assert.equal(db.prepare(`SELECT lang FROM users WHERE id='u_lang'`).get().lang, 'zh');

  const en = Auth.updateOwnLang('u_lang', 'en', 'sala');
  assert.equal(en.lang, 'en');

  const vi = Auth.updateOwnLang('u_lang', 'vi', 'sala');
  assert.equal(vi.lang, 'vi');
});

test('updateOwnLang: gia tri la bi ep ve vi (khong lam vo du lieu)', () => {
  const out = Auth.updateOwnLang('u_lang', 'fr', 'sala');
  assert.equal(out.lang, 'vi');
});
