import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const temp = mkdtempSync(join(tmpdir(), 'dandpak-firebase-'));
process.env.SQLITE_PATH = join(temp, 'store.db');
process.env.STORAGE_PATH = join(temp, 'storage');
process.env.DATA_ENCRYPTION_KEY =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

const { db, migrate } = await import('./db.js');
const Settings = await import('./services/settings.js');
const Push = await import('./services/push.js');

migrate();

const FAKE_SERVICE_ACCOUNT = {
  type: 'service_account',
  project_id: 'dan-d-pak-pos',
  private_key: '-----BEGIN PRIVATE KEY-----\nFAKEKEYFORTEST\n-----END PRIVATE KEY-----\n',
  client_email: 'firebase-adminsdk@dan-d-pak-pos.iam.gserviceaccount.com',
};

// Người dùng hỏi đúng: khoá Firebase phải nằm MÃ HOÁ trong DB (giống Haravan
// token/secret), KHÔNG phải file .json thô trên đĩa máy chủ.
test('Firebase service-account is stored encrypted, never leaks plaintext via getSettings', () => {
  assert.throws(() => Settings.setFirebaseServiceAccount('not json'),
    /không phải JSON hợp lệ/);
  assert.throws(() => Settings.setFirebaseServiceAccount({ project_id: 'x' }),
    /Thiếu trường/);

  const saved = Settings.setFirebaseServiceAccount(FAKE_SERVICE_ACCOUNT, 'br1');
  assert.equal(saved.project_id, 'dan-d-pak-pos');

  const row = db.prepare(
    `SELECT value FROM app_settings WHERE branch_id='br1' AND key='firebase_service_account'`
  ).get();
  assert.ok(row.value.startsWith('enc:v1:'), 'must be encrypted at rest');
  assert.equal(row.value.includes('FAKEKEYFORTEST'), false, 'ciphertext must not contain the raw key');

  const decoded = Settings.getFirebaseServiceAccount('br1');
  assert.deepEqual(decoded, FAKE_SERVICE_ACCOUNT);
  assert.equal(Settings.firebaseConfigured('br1'), true);

  const publicSettings = Settings.getSettings('br1');
  assert.equal(publicSettings.firebase_configured, true);
  assert.equal(publicSettings.firebase_service_account, undefined,
    'raw/encrypted secret must never appear in the settings payload sent to clients');

  // Chi nhánh khác chưa cấu hình → không nhìn thấy khoá của br1.
  assert.equal(Settings.firebaseConfigured('br2'), false);
  assert.equal(Settings.getFirebaseServiceAccount('br2'), null);
});

test('device token registration upserts by device_id, and push never throws when unconfigured', async () => {
  const first = Push.registerDeviceToken(
    { device_id: 'dev_tablet_1', fcm_token: 'token-A', platform: 'android' }, 'br1');
  assert.ok(first.ok);
  const rowsAfterFirst = db.prepare(`SELECT * FROM device_tokens WHERE device_id='dev_tablet_1'`).all();
  assert.equal(rowsAfterFirst.length, 1);
  assert.equal(rowsAfterFirst[0].fcm_token, 'token-A');

  // Token đổi (cài lại app) → UPSERT, không tích luỹ dòng thứ 2.
  Push.registerDeviceToken(
    { device_id: 'dev_tablet_1', fcm_token: 'token-B', platform: 'android' }, 'br1');
  const rowsAfterUpdate = db.prepare(`SELECT * FROM device_tokens WHERE device_id='dev_tablet_1'`).all();
  assert.equal(rowsAfterUpdate.length, 1);
  assert.equal(rowsAfterUpdate[0].fcm_token, 'token-B');

  assert.throws(() => Push.registerDeviceToken({ device_id: '', fcm_token: 'x' }, 'br1'),
    /Thiếu device_id hoặc fcm_token/);

  // Chi nhánh 'br2' chưa cấu hình Firebase → gửi push phải trả về gọn gàng,
  // KHÔNG BAO GIỜ throw (nguyên tắc sắt: không được phá nghiệp vụ chính).
  const result = await Push.sendPushToBranch('br2', { title: 't', body: 'b' });
  assert.equal(result.sent, 0);
  assert.equal(result.reason, 'not_configured');
});

// Regression thật đã xảy ra: setFirebaseServiceAccount() lưu đúng, nhưng route
// POST /settings/app (dùng updateSettings, KHÔNG phải setFirebaseServiceAccount
// trực tiếp) trả về firebase_configured=false vì `current` được chụp TRƯỚC khi
// khoá được lưu. Test trước chỉ gọi thẳng setFirebaseServiceAccount nên không
// bắt được — phải test đúng đường đi của route thì mới lộ ra.
test('updateSettings (the actual route path) reports firebase_configured=true right after saving the key', () => {
  const before = Settings.updateSettings({}, 'br3');
  assert.equal(before.firebase_configured, false);

  const after = Settings.updateSettings({ firebase_service_account: FAKE_SERVICE_ACCOUNT }, 'br3');
  assert.equal(after.firebase_configured, true,
    'the very response of the save call must already reflect the new state');
  assert.equal(Settings.getSettings('br3').firebase_configured, true);
});
