import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

export function runBackupDatabase(db, root, retentionDays = 14) {
  try {
    const dir = join(root, 'backups');
    mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const dest = join(dir, `store-${stamp}.db`);
    if (!existsSync(dest)) db.exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`);

    const cutoff = Date.now() - Math.max(1, retentionDays) * 24 * 60 * 60 * 1000;
    let pruned = 0;
    for (const f of readdirSync(dir)) {
      if (!/^store-.*\.db$/.test(f)) continue;
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
      .filter(f => /^store-.*\.db$/.test(f))
      .map(f => {
        const s = statSync(join(dir, f));
        return { file: f, bytes: s.size, mtime: new Date(s.mtimeMs).toISOString() };
      })
      .sort((a, b) => b.mtime.localeCompare(a.mtime));
  } catch {
    return [];
  }
}
