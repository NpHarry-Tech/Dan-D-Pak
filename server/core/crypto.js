import crypto from 'node:crypto';

const V1_PREFIX = 'enc:v1:';
const V2_PREFIX = 'enc:v2:';
const FILE_V1 = Buffer.from('DDPENC01', 'ascii');
const FILE_V2 = Buffer.from('DDPENC02', 'ascii');

function parseKey(raw, label) {
  const value = String(raw || '').trim();
  if (/^[0-9a-f]{64}$/i.test(value)) return Buffer.from(value, 'hex');
  let decoded = Buffer.alloc(0);
  try { decoded = Buffer.from(value, 'base64'); } catch { /* invalid below */ }
  if (decoded.length === 32) return decoded;
  throw new Error(`${label} must be 32 bytes encoded as hex or base64`);
}

function parseRegistry(name) {
  const raw = String(process.env[name] || '').trim();
  if (!raw) return {};
  let parsed;
  try { parsed = JSON.parse(raw); } catch { throw new Error(`${name} must be a JSON object`); }
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
    throw new Error(`${name} must be a JSON object`);
  }
  return parsed;
}

function keyRing() {
  const activeId = String(
    process.env.DATA_ENCRYPTION_ACTIVE_KEY_ID ||
    process.env.DATA_ENCRYPTION_KEY_ID ||
    'primary',
  ).trim();
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(activeId)) {
    throw new Error('DATA_ENCRYPTION_ACTIVE_KEY_ID is invalid');
  }
  const registry = {
    ...parseRegistry('DATA_ENCRYPTION_PREVIOUS_KEYS'),
    ...parseRegistry('DATA_ENCRYPTION_KEYS'),
  };
  const activeRaw = registry[activeId] || process.env.DATA_ENCRYPTION_KEY;
  if (!activeRaw) throw new Error('DATA_ENCRYPTION_KEY is required');
  registry[activeId] = activeRaw;
  const keys = new Map(Object.entries(registry).map(([id, raw]) => [id, parseKey(raw, `encryption key ${id}`)]));
  return { activeId, activeKey: keys.get(activeId), keys };
}

function aad(context, version) {
  const selected = Array.isArray(context) ? context[0] : context;
  const value = String(selected || '').trim();
  if (!value) throw new Error('Secret encryption context (AAD) is required');
  return Buffer.from(version === 2 ? `dandpak-vault:v2|${value}` : value, 'utf8');
}

function contexts(context) {
  return (Array.isArray(context) ? context : [context])
    .map(value => String(value || '').trim()).filter(Boolean);
}

function decodePart(text, label) {
  if (!text || !/^[A-Za-z0-9_-]+$/.test(text)) throw new Error(`Invalid encrypted secret ${label}`);
  return Buffer.from(text, 'base64url');
}

export function secretContext({ tenant, provider, record, field, version = 2 }) {
  const values = { tenant, provider, record, field };
  for (const [name, value] of Object.entries(values)) {
    if (!String(value || '').trim()) throw new Error(`Secret context missing ${name}`);
  }
  return `tenant:${tenant}|provider:${provider}|record:${record}|field:${field}|v${version}`;
}

export function isEncrypted(value) {
  return typeof value === 'string' && /^enc:v\d+:/.test(value);
}

export function envelopeInfo(value) {
  if (typeof value !== 'string') return { encrypted: false, version: 0, keyId: '' };
  if (value.startsWith(V1_PREFIX)) return { encrypted: true, version: 1, keyId: '' };
  if (value.startsWith(V2_PREFIX)) {
    const keyText = value.slice(V2_PREFIX.length).split('.')[0];
    let keyId = '';
    try { keyId = decodePart(keyText, 'key id').toString('utf8'); } catch { /* decrypt gives canonical error */ }
    return { encrypted: true, version: 2, keyId };
  }
  if (/^enc:v\d+:/.test(value)) {
    const version = Number((/^enc:v(\d+):/.exec(value) || [])[1] || 0);
    return { encrypted: true, version, keyId: '' };
  }
  return { encrypted: false, version: 0, keyId: '' };
}

function encryptWith(value, context, keyId, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(aad(context, 2));
  const ciphertext = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  const encodedId = Buffer.from(keyId, 'utf8').toString('base64url');
  return V2_PREFIX + [encodedId, iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ciphertext.toString('base64url')].join('.');
}

export function encryptSecret(value, context = '') {
  if (value == null || value === '') return value;
  if (isEncrypted(value)) return value;
  const ring = keyRing();
  return encryptWith(value, context, ring.activeId, ring.activeKey);
}

function decryptV2(value, context, ring) {
  const parts = value.slice(V2_PREFIX.length).split('.');
  if (parts.length !== 4) throw new Error('Invalid encrypted secret envelope');
  const keyId = decodePart(parts[0], 'key id').toString('utf8');
  const key = ring.keys.get(keyId);
  if (!key) throw new Error(`Encryption key id is unavailable: ${keyId}`);
  const iv = decodePart(parts[1], 'nonce');
  const tag = decodePart(parts[2], 'tag');
  const ciphertext = decodePart(parts[3], 'ciphertext');
  if (iv.length !== 12 || tag.length !== 16 || ciphertext.length < 1) {
    throw new Error('Invalid encrypted secret envelope');
  }
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAAD(aad(context, 2));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

function decryptV1(value, context, ring) {
  const parts = value.slice(V1_PREFIX.length).split('.');
  if (parts.length !== 3) throw new Error('Invalid encrypted secret envelope');
  const iv = decodePart(parts[0], 'nonce');
  const tag = decodePart(parts[1], 'tag');
  const ciphertext = decodePart(parts[2], 'ciphertext');
  if (iv.length !== 12 || tag.length !== 16 || ciphertext.length < 1) {
    throw new Error('Invalid encrypted secret envelope');
  }
  for (const candidate of contexts(context)) {
    for (const key of new Set(ring.keys.values())) {
      try {
        const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
        decipher.setAAD(aad(candidate, 1));
        decipher.setAuthTag(tag);
        return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
      } catch { /* try legacy context / previous key */ }
    }
  }
  throw new Error('Unable to decrypt legacy secret with configured keys');
}

export function decryptSecret(value, context = '') {
  if (value == null || value === '') return value;
  if (!isEncrypted(value)) throw new Error('Plaintext secret is not allowed');
  const ring = keyRing();
  if (value.startsWith(V2_PREFIX)) return decryptV2(value, context, ring);
  if (value.startsWith(V1_PREFIX)) return decryptV1(value, context, ring);
  throw new Error('Unsupported encrypted secret version');
}

export function reencryptSecret(value, context = '', { allowPlaintext = false } = {}) {
  if (value == null || value === '') return value;
  const ring = keyRing();
  let plaintext;
  if (isEncrypted(value)) plaintext = decryptSecret(value, context);
  else if (allowPlaintext) plaintext = String(value);
  else throw new Error('Plaintext secret is not allowed');
  return encryptWith(plaintext, context, ring.activeId, ring.activeKey);
}

export function needsReencryption(value) {
  const info = envelopeInfo(value);
  if (!info.encrypted) return true;
  const ring = keyRing();
  return info.version !== 2 || info.keyId !== ring.activeId;
}

export function encryptBytes(buffer, context = '') {
  const ring = keyRing();
  const keyId = Buffer.from(ring.activeId, 'utf8');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', ring.activeKey, iv);
  cipher.setAAD(aad(context, 2));
  const ciphertext = Buffer.concat([cipher.update(buffer), cipher.final()]);
  return Buffer.concat([FILE_V2, Buffer.from([keyId.length]), keyId, iv, cipher.getAuthTag(), ciphertext]);
}

export function decryptBytes(buffer, context = '') {
  const ring = keyRing();
  if (buffer.length >= 37 && buffer.subarray(0, 8).equals(FILE_V2)) {
    const idLength = buffer[8];
    const offset = 9 + idLength;
    if (!idLength || buffer.length <= offset + 28) throw new Error('Invalid encrypted file header');
    const keyId = buffer.subarray(9, offset).toString('utf8');
    const key = ring.keys.get(keyId);
    if (!key) throw new Error(`Encryption key id is unavailable: ${keyId}`);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, buffer.subarray(offset, offset + 12));
    decipher.setAAD(aad(context, 2));
    decipher.setAuthTag(buffer.subarray(offset + 12, offset + 28));
    return Buffer.concat([decipher.update(buffer.subarray(offset + 28)), decipher.final()]);
  }
  if (buffer.length >= 36 && buffer.subarray(0, 8).equals(FILE_V1)) {
    for (const key of new Set(ring.keys.values())) {
      try {
        const decipher = crypto.createDecipheriv('aes-256-gcm', key, buffer.subarray(8, 20));
        decipher.setAAD(aad(context, 1));
        decipher.setAuthTag(buffer.subarray(20, 36));
        return Buffer.concat([decipher.update(buffer.subarray(36)), decipher.final()]);
      } catch { /* try previous key */ }
    }
    throw new Error('Unable to decrypt legacy file with configured keys');
  }
  throw new Error('Invalid encrypted file header');
}
