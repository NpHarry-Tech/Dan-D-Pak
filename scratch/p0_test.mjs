// Throwaway smoke test for P0 auth hardening. Uses a temp DB, never touches store.db.
process.env.SQLITE_PATH = 'scratch/p0_test.db';
process.env.DISABLE_DEMO_SEED = 'false';
process.env.NODE_ENV = 'development';
import { rmSync } from 'node:fs';
for (const f of ['scratch/p0_test.db', 'scratch/p0_test.db-wal', 'scratch/p0_test.db-shm']) {
  try { rmSync(f, { force: true }); } catch {}
}

const { migrate, db } = await import('../server/db.js');
migrate();
await import('../server/seed.js'); // creates demo users with plaintext PINs
const { migratePlaintextPins } = await import('../server/services/pin.js');
const migrated = migratePlaintextPins(db);
const { bootstrapDefaultAdmin } = await import('../server/services/bootstrapAdmin.js');
const boot = bootstrapDefaultAdmin();
const { login, verifyManagerOwnerPin } = await import('../server/services/auth.js');

const pass = [];
const fail = [];
const check = (name, cond) => (cond ? pass : fail).push(name);

console.log('migrated PINs:', migrated, '| bootstrap:', JSON.stringify(boot));
const adminRow = db.prepare(`SELECT username,pin FROM users WHERE username='admin'`).get();
check('admin PIN is hashed (scrypt$)', !!adminRow && adminRow.pin.startsWith('scrypt$'));
check('no plaintext PIN left', db.prepare(`SELECT COUNT(*) n FROM users WHERE pin NOT LIKE 'scrypt$%'`).get().n === 0);

try {
  const r = login('admin', '1234');
  check('login admin/1234 succeeds', !!r.token);
  check('token is crypto (tk_ + 48 hex)', /^tk_[0-9a-f]{48}$/.test(r.token));
} catch (e) { check('login admin/1234 succeeds', false); console.log('  login err:', e.message); }

try { login('admin', '9999'); check('wrong PIN rejected', false); }
catch { check('wrong PIN rejected', true); }

check('verifyManagerOwnerPin(1234) -> owner', !!verifyManagerOwnerPin('1234'));
check('verifyManagerOwnerPin(0000) -> null', !verifyManagerOwnerPin('0000'));
check('verifyManagerOwnerPin(2222) -> manager', !!verifyManagerOwnerPin('2222'));

// brute-force lockout: 5 wrong attempts then a correct one should still be locked
for (let i = 0; i < 5; i++) { try { login('cashier', '0000'); } catch {} }
try { login('cashier', '1111'); check('lockout blocks after 5 fails', false); }
catch (e) { check('lockout blocks after 5 fails', /tạm khóa/.test(e.message)); }

console.log('\nPASS (' + pass.length + '):', pass.join(' | '));
console.log('FAIL (' + fail.length + '):', fail.join(' | ') || '(none)');
for (const f of ['scratch/p0_test.db', 'scratch/p0_test.db-wal', 'scratch/p0_test.db-shm']) {
  try { rmSync(f, { force: true }); } catch {}
}
process.exit(fail.length ? 1 : 0);
