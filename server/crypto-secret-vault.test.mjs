import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';

const KEY_A = 'a1'.repeat(32);
const KEY_B = 'b2'.repeat(32);

function useKey(id, key, previous = {}) {
  process.env.DATA_ENCRYPTION_ACTIVE_KEY_ID = id;
  process.env.DATA_ENCRYPTION_KEY = key;
  process.env.DATA_ENCRYPTION_PREVIOUS_KEYS = JSON.stringify(previous);
  delete process.env.DATA_ENCRYPTION_KEYS;
}
useKey('key-a', KEY_A);

const {
  decryptBytes, decryptSecret, encryptBytes, encryptSecret, envelopeInfo,
  isEncrypted, needsReencryption, reencryptSecret, secretContext,
} = await import('./core/crypto.js');
const { migrateSecretRecords, planSecretMigration } = await import('./core/secretMigration.js');

const ctx = (overrides = {}) => secretContext({
  tenant: 'tenant-a', provider: 'haravan', record: 'shop-a', field: 'access_token',
  ...overrides,
});

test.afterEach(() => useKey('key-a', KEY_A));

test('v2 round-trip has key_id, random 96-bit nonce and 128-bit tag', () => {
  const one = encryptSecret('super-token', ctx());
  const two = encryptSecret('super-token', ctx());
  assert.notEqual(one, two);
  assert.deepEqual(envelopeInfo(one), { encrypted: true, version: 2, keyId: 'key-a' });
  const [, iv, tag, ciphertext] = one.slice('enc:v2:'.length).split('.').map(v => Buffer.from(v, 'base64url'));
  assert.equal(iv.length, 12);
  assert.equal(tag.length, 16);
  assert.ok(ciphertext.length > 0);
  assert.equal(decryptSecret(one, ctx()), 'super-token');
});

test('same ciphertext cannot move across tenant/provider/record/field', () => {
  const encrypted = encryptSecret('secret', ctx());
  for (const altered of [
    ctx({ tenant: 'tenant-b' }), ctx({ provider: 'shopee' }),
    ctx({ record: 'shop-b' }), ctx({ field: 'refresh_token' }),
  ]) assert.throws(() => decryptSecret(encrypted, altered));
});

test('wrong/missing key and missing AAD fail closed', () => {
  const encrypted = encryptSecret('secret', ctx());
  useKey('key-a', KEY_B);
  assert.throws(() => decryptSecret(encrypted, ctx()));
  delete process.env.DATA_ENCRYPTION_KEY;
  assert.throws(() => decryptSecret(encrypted, ctx()), /DATA_ENCRYPTION_KEY is required/);
  useKey('key-a', KEY_A);
  assert.throws(() => encryptSecret('secret', ''), /context/);
});

test('tamper key_id/nonce/tag/ciphertext is rejected', () => {
  const encrypted = encryptSecret('secret', ctx());
  const parts = encrypted.slice('enc:v2:'.length).split('.');
  for (let index = 0; index < parts.length; index++) {
    const bytes = Buffer.from(parts[index], 'base64url');
    bytes[0] ^= 0xff;
    const tampered = 'enc:v2:' + parts.map((part, i) => i === index ? bytes.toString('base64url') : part).join('.');
    assert.throws(() => decryptSecret(tampered, ctx()));
  }
});

test('malformed, unsupported and plaintext values are rejected', () => {
  for (const value of ['enc:v2:x', 'enc:v2:....', 'enc:v99:anything', 'legacy-plaintext']) {
    assert.throws(() => decryptSecret(value, ctx()));
  }
  assert.equal(isEncrypted('enc:v99:anything'), true);
  assert.equal(isEncrypted('legacy-plaintext'), false);
});

test('rotation decrypts previous key and re-encrypts to active key id', () => {
  useKey('old', KEY_A);
  const oldEnvelope = encryptSecret('rotate-me', ctx());
  useKey('new', KEY_B, { old: KEY_A });
  assert.equal(decryptSecret(oldEnvelope, ctx()), 'rotate-me');
  assert.equal(needsReencryption(oldEnvelope), true);
  const rotated = reencryptSecret(oldEnvelope, ctx());
  assert.equal(envelopeInfo(rotated).keyId, 'new');
  assert.equal(decryptSecret(rotated, ctx()), 'rotate-me');
});

test('legacy v1 decrypts through previous key without plaintext fallback', () => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(KEY_A, 'hex'), iv);
  cipher.setAAD(Buffer.from('legacy-context'));
  const ciphertext = Buffer.concat([cipher.update('legacy-value'), cipher.final()]);
  const legacy = 'enc:v1:' + [iv, cipher.getAuthTag(), ciphertext].map(v => v.toString('base64url')).join('.');
  useKey('new', KEY_B, { old: KEY_A });
  assert.equal(decryptSecret(legacy, [ctx(), 'legacy-context']), 'legacy-value');
  assert.equal(needsReencryption(legacy), true);
});

test('binary v2 round-trip, key id, AAD and tamper', () => {
  const source = Buffer.from([0, 1, 2, 255, 10]);
  const encrypted = encryptBytes(source, ctx({ field: 'file' }));
  assert.equal(encrypted.subarray(0, 8).toString('ascii'), 'DDPENC02');
  assert.deepEqual(decryptBytes(encrypted, ctx({ field: 'file' })), source);
  assert.throws(() => decryptBytes(encrypted, ctx({ field: 'other' })));
  const tampered = Buffer.from(encrypted);
  tampered[tampered.length - 1] ^= 0xff;
  assert.throws(() => decryptBytes(tampered, ctx({ field: 'file' })));
});

test('migration dry-run is redacted; apply is idempotent and transactional', () => {
  const records = [
    { id: '1', field: 'access_token', value: 'cleartext-value', context: ctx() },
    { id: '2', field: 'empty', value: '', context: ctx({ field: 'empty' }) },
  ];
  const dry = migrateSecretRecords({ records, dryRun: true, write: () => assert.fail() });
  assert.equal(dry.changed, 0);
  assert.equal(dry.plan[0].state, 'legacy-plaintext');
  assert.ok(!JSON.stringify(dry).includes('cleartext-value'));

  const stored = new Map(records.map(row => [row.id, row.value]));
  const write = (record, value) => stored.set(record.id, value);
  const first = migrateSecretRecords({ records, dryRun: false, write, transaction: fn => fn() });
  assert.equal(first.changed, 1);
  assert.equal(decryptSecret(stored.get('1'), ctx()), 'cleartext-value');
  records[0].value = stored.get('1');
  assert.equal(migrateSecretRecords({ records, dryRun: false, write }).changed, 0);

  assert.throws(() => planSecretMigration([{ id: 'bad', field: 'x', value: 'enc:v2:bad', context: ctx() }]));
});
