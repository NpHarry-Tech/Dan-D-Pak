// PIN hashing + secure token helpers.
// PINs were historically stored in plaintext. We now store scrypt hashes
// (format: "scrypt$<saltHex>$<hashHex>"). verifyPin() still accepts a legacy
// plaintext value so a half-migrated database keeps working; migratePlaintextPins()
// upgrades any remaining plaintext rows on startup.
import crypto from 'node:crypto';

const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEYLEN = 32;

export function isHashed(value) {
  return typeof value === 'string' && value.startsWith('scrypt$');
}

export function hashPin(pin) {
  const salt = crypto.randomBytes(16);
  const dk = crypto.scryptSync(String(pin ?? ''), salt, KEYLEN, SCRYPT);
  return `scrypt$${salt.toString('hex')}$${dk.toString('hex')}`;
}

export function verifyPin(pin, stored) {
  if (stored == null || stored === '') return false;
  // Legacy plaintext fallback (constant-ish; values are short PINs).
  if (!isHashed(stored)) return String(stored) === String(pin ?? '');
  const parts = String(stored).split('$');
  if (parts.length !== 3) return false;
  let salt, expected;
  try {
    salt = Buffer.from(parts[1], 'hex');
    expected = Buffer.from(parts[2], 'hex');
  } catch { return false; }
  if (!salt.length || !expected.length) return false;
  let dk;
  try { dk = crypto.scryptSync(String(pin ?? ''), salt, expected.length, SCRYPT); }
  catch { return false; }
  return dk.length === expected.length && crypto.timingSafeEqual(dk, expected);
}

// Cryptographically-strong opaque session token (replaces Math.random() ids).
export function newToken() {
  return 'tk_' + crypto.randomBytes(24).toString('hex');
}

// One-time upgrade: hash any user PIN still stored as plaintext. Idempotent.
export function migratePlaintextPins(db) {
  let migrated = 0;
  try {
    const rows = db.prepare(`SELECT id, pin FROM users WHERE pin IS NOT NULL AND pin <> '' AND pin NOT LIKE 'scrypt$%'`).all();
    if (!rows.length) return 0;
    const upd = db.prepare(`UPDATE users SET pin=? WHERE id=?`);
    for (const r of rows) { upd.run(hashPin(r.pin), r.id); migrated++; }
  } catch (e) {
    console.warn('[pin] plaintext migration failed:', e.message);
  }
  return migrated;
}
