import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { backup } from 'node:sqlite';
import { encryptBytes } from '../core/crypto.js';

export async function runBackupDatabase(db, root, retentionDays = 14) {
  try {
    const dir = join(root, 'backups');
    mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const today = stamp.slice(0, 10); // yyyy-mm-dd
    const plain = join(dir, `store-${stamp}.db`);
    const dest = `${plain}.enc`;
    // VACUUM INTO + đọc lại toàn bộ file + mã hoá là công việc ĐỒNG BỘ, chặn
    // toàn bộ event loop ~15-20s cho DB vài trăm MB. Trước đây chỉ chặn trùng
    // giây (gần như không bao giờ khớp giữa 2 lần khởi động khác nhau) nên MỖI
    // lần restart/deploy đều chạy lại toàn bộ, dù interval đặt 24h. Giờ chặn
    // theo NGÀY: đã có bản sao lưu hôm nay thì bỏ qua, để restart/deploy không
    // còn phải trả giá tạm-đứng-server mỗi lần.
    const existingToday = existsSync(dir)
      ? readdirSync(dir).find(f => f.startsWith(`store-${today}`) && f.endsWith('.db.enc'))
      : null;
    const alreadyBackedUpToday = !!existingToday;
    if (!existsSync(dest) && !alreadyBackedUpToday) {
      // Online Backup API sao chép theo từng page và nhường event loop, không dùng
      // VACUUM INTO đồng bộ làm API đứng 15–20 giây khi DB production lớn.
      await backup(db, plain, { rate: 256 });
      await writeFile(dest,
        encryptBytes(await readFile(plain), `database-backup:${stamp}`),
        { mode: 0o600 });
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
    const actualPath = existingToday ? join(dir, existingToday) : dest;
    return {
      ok: true, skipped: alreadyBackedUpToday, path: actualPath,
      bytes: existsSync(actualPath) ? statSync(actualPath).size : 0, pruned,
    };
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
