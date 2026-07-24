import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { encryptBytes } from '../core/crypto.js';

export function runBackupDatabase(db, root, retentionDays = 14) {
  try {
    const dir = join(root, 'backups');
    mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const plain = join(dir, `store-${stamp}.db`);
    const dest = `${plain}.enc`;
    if (!existsSync(dest)) {
      db.exec(`VACUUM INTO '${plain.replace(/'/g, "''")}'`);
      writeFileSync(dest, encryptBytes(readFileSync(plain), `database-backup:${stamp}`), { mode: 0o600 });
      rmSync(plain, { force: true });
    }

    const cutoff = Date.now() - Math.max(1, retentionDays) * 24 * 60 * 60 * 1000;
    let pruned = 0;
    for (const f of readdirSync(dir)) {
      if (!/^store-.*\.db\.enc$/.test(f)) continue;
      const full = join(dir, f);
      try {
        if (statSync(full).mtimeMs < cutoff) {
          rmSync(full, { force: true });
          pruned++;
        }
      } catch { /* ignore */ }
    }
    return { ok: true, path: dest, bytes: existsSync(dest) ? statSync(dest).size : 0, pruned };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

export function listBackupFiles(root) {
  try {
    const dir = join(root, 'backups');
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter(f => /^store-.*\.db\.enc$/.test(f))
      .map(f => {
        const s = statSync(join(dir, f));
        return { file: f, bytes: s.size, mtime: new Date(s.mtimeMs).toISOString() };
      })
      .sort((a, b) => b.mtime.localeCompare(a.mtime));
  } catch {
    return [];
  }
}
