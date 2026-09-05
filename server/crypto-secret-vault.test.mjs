// SECRET VAULT AES-256-GCM — kiểm THẬT (round-trip/tamper/cross-tenant/sai-key/
// fail-closed), KHÔNG phải regex trên source. Không migrate DB thật; chỉ test hàm
// core/crypto.js. Chứng minh các bất biến bảo mật của gate AES-GCM.
import assert from 'node:assert/strict';
import test from 'node:test';

const KEY_A = 'a1'.repeat(32); // 64 hex = 32 byte (AES-256)
const KEY_B = 'b2'.repeat(32);
process.env.DATA_ENCRYPTION_KEY = KEY_A;

const PREFIX = 'enc:v1:';
const { encryptSecret, decryptSecret, isEncrypted, encryptBytes, decryptBytes } =
  await import('./core/crypto.js');

test('round-trip đúng ngữ cảnh trả về plaintext gốc', () => {
  const enc = encryptSecret('super-token', 'haravan:shopA:access');
  assert.ok(enc.startsWith(PREFIX), 'envelope có version prefix');
  assert.notEqual(enc, 'super-token', 'không được lưu plaintext');
  assert.equal(decryptSecret(enc, 'haravan:shopA:access'), 'super-token');
});

test('envelope AES-256-GCM: IV 12 byte, tag 16 byte, nonce NGẪU NHIÊN mỗi lần', () => {
  const e1 = encryptSecret('x', 'ctx');
  const e2 = encryptSecret('x', 'ctx');
  assert.notEqual(e1, e2, 'nonce ngẫu nhiên → hai lần mã hoá cùng plaintext KHÁC ciphertext');
  const [iv, tag, ct] = e1.slice(PREFIX.length).split('.').map(s => Buffer.from(s, 'base64url'));
  assert.equal(iv.length, 12, 'IV 96-bit');
  assert.equal(tag.length, 16, 'auth tag 128-bit');
  assert.ok(ct.length >= 1);
});

test('CROSS-TENANT SWAP: ciphertext tenant A không giải mã dưới context tenant B', () => {
  const enc = encryptSecret('tokenA', 'tenant:A|provider:haravan|field:access|v1');
  assert.throws(() => decryptSecret(enc, 'tenant:B|provider:haravan|field:access|v1'),
    /.*/, 'AAD khác (đổi tenant) phải làm xác thực GCM thất bại');
  // đúng context vẫn giải mã được
  assert.equal(decryptSecret(enc, 'tenant:A|provider:haravan|field:access|v1'), 'tokenA');
});

test('SAI KEY → decrypt FAIL, tuyệt đối không lộ plaintext', () => {
  const enc = encryptSecret('secret', 'ctx');
  process.env.DATA_ENCRYPTION_KEY = KEY_B;
  try {
    assert.throws(() => decryptSecret(enc, 'ctx'), /.*/, 'key khác phải fail (không trả plaintext)');
  } finally {
    process.env.DATA_ENCRYPTION_KEY = KEY_A;
  }
});

test('TAMPER iv / tag / ciphertext → FAIL (không fallback plaintext)', () => {
  const enc = encryptSecret('secret-value', 'ctx');
  const parts = enc.slice(PREFIX.length).split('.');
  for (let i = 0; i < 3; i++) {
    const b = Buffer.from(parts[i], 'base64url');
    b[0] ^= 0xff; // lật 1 byte
    const tampered = PREFIX + parts.map((p, j) => (j === i ? b.toString('base64url') : p)).join('.');
    assert.throws(() => decryptSecret(tampered, 'ctx'), /.*/, `sửa phần ${i} phải bị GCM chặn`);
  }
});

test('THIẾU KEY → fail-closed (không tự sinh key, không plaintext)', () => {
  const saved = process.env.DATA_ENCRYPTION_KEY;
  delete process.env.DATA_ENCRYPTION_KEY;
  try {
    assert.throws(() => encryptSecret('x', 'ctx'), /DATA_ENCRYPTION_KEY is required/);
  } finally {
    process.env.DATA_ENCRYPTION_KEY = saved;
  }
});

test('KEY sai độ dài → fail-closed', () => {
  const saved = process.env.DATA_ENCRYPTION_KEY;
  process.env.DATA_ENCRYPTION_KEY = 'tooshort';
  try {
    assert.throws(() => encryptSecret('x', 'ctx'), /must be 32 bytes/);
  } finally {
    process.env.DATA_ENCRYPTION_KEY = saved;
  }
});

test('encryptBytes/decryptBytes: round-trip + context + tamper', () => {
  const data = Buffer.from([0, 1, 2, 255, 254, 10, 13]);
  const enc = encryptBytes(data, 'file:doc1');
  assert.deepEqual(decryptBytes(enc, 'file:doc1'), data);
  assert.throws(() => decryptBytes(enc, 'file:doc2'), /.*/, 'context khác → fail');
  const t = Buffer.from(enc); t[t.length - 1] ^= 0xff; // sửa ciphertext cuối
  assert.throws(() => decryptBytes(t, 'file:doc1'), /.*/, 'tamper → fail');
});

test('KHÔNG double-encrypt; decrypt giá trị chưa mã hoá là passthrough di trú (KHÔNG fallback khi FAIL)', () => {
  const enc = encryptSecret('x', 'ctx');
  assert.equal(encryptSecret(enc, 'ctx'), enc, 'đã mã hoá thì không mã hoá lại');
  // passthrough CHỈ cho giá trị CHƯA từng mã hoá (di trú legacy) — KHÁC với việc
  // một enc: hợp lệ bị hỏng: cái đó phải THROW (đã kiểm ở test tamper/sai-key).
  assert.equal(decryptSecret('legacy-plaintext', 'ctx'), 'legacy-plaintext');
  assert.equal(isEncrypted(enc), true);
  assert.equal(isEncrypted('legacy-plaintext'), false);
});
