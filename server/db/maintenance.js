import { ROOT, rawDatabase } from './connection.js';
import { listBackupFiles, runBackupDatabase } from './backup.js';
// Sao lưu THẬT cơ sở dữ liệu: online backup API sao chép theo page vào thư mục
// backups/. Đây là bản sao có thể copy ra ổ ngoài/VPS. Giữ `retentionDays`.
// Dùng rawDatabase (KHÔNG dùng Proxy db) — backup() gốc đọc internal field trực
// tiếp, truyền Proxy sẽ làm process abort (V8 fatal).
export async function backupDatabase(retentionDays = 14) {
  return runBackupDatabase(rawDatabase, ROOT, retentionDays);
}

// Liệt kê các bản sao lưu hiện có (cho /database/status báo cáo TRUNG THỰC).
export function listBackups() {
  return listBackupFiles(ROOT);
}
