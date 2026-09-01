import crypto from 'node:crypto';

const PREFIX = 'enc:v1:';

function keyMaterial() {
  const raw = String(process.env.DATA_ENCRYPTION_KEY || '').trim();
  if (!raw) throw new Error('DATA_ENCRYPTION_KEY is required');
  if (/^[0-9a-f]{64}$/i.test(raw)) return Buffer.from(raw, 'hex');
  const decoded = Buffer.from(raw, 'base64');
  if (decoded.length === 32) return decoded;
  throw new Error('DATA_ENCRYPTION_KEY must be 32 bytes encoded as hex or base64');
}

export function isEncrypted(value) {
  return typeof value === 'string' && value.startsWith(PREFIX);
}

export function encryptSecret(value, context = '') {
  if (value == null || value === '' || isEncrypted(value)) return value;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', keyMaterial(), iv);
  cipher.setAAD(Buffer.from(String(context), 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  return PREFIX + [iv, cipher.getAuthTag(), ciphertext]
    .map(v => v.toString('base64url')).join('.');
}

export function decryptSecret(value, context = '') {
  if (value == null || value === '' || !isEncrypted(value)) return value;
  const [ivText, tagText, cipherText] = value.slice(PREFIX.length).split('.');
  if (!ivText || !tagText || !cipherText) throw new Error('Invalid encrypted secret');
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm', keyMaterial(), Buffer.from(ivText, 'base64url'));
  decipher.setAAD(Buffer.from(String(context), 'utf8'));
  decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(cipherText, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

export function encryptBytes(buffer, context = '') {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', keyMaterial(), iv);
  cipher.setAAD(Buffer.from(String(context), 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(buffer), cipher.final()]);
  return Buffer.concat([
    Buffer.from('DDPENC01', 'ascii'), iv, cipher.getAuthTag(), ciphertext,
  ]);
}

export function decryptBytes(buffer, context = '') {
  if (buffer.length < 36 || buffer.subarray(0, 8).toString('ascii') !== 'DDPENC01') {
    throw new Error('Invalid encrypted file header');
  }
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm', keyMaterial(), buffer.subarray(8, 20));
  decipher.setAAD(Buffer.from(String(context), 'utf8'));
  decipher.setAuthTag(buffer.subarray(20, 36));
  return Buffer.concat([decipher.update(buffer.subarray(36)), decipher.final()]);
}
