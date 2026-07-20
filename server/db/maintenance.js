import { ROOT, db } from './connection.js';
import { listBackupFiles, runBackupDatabase } from './backup.js';
// Sao lưu THẬT cơ sở dữ liệu: VACUUM INTO tạo một bản sao nhất quán (đã gộp WAL)
// vào thư mục backups/. Đây là bản sao có thể copy ra ổ ngoài/VPS. Giữ `retentionDays`.
export function backupDatabase(retentionDays = 14) {
  return runBackupDatabase(db, ROOT, retentionDays);
}

// Liệt kê các bản sao lưu hiện có (cho /database/status báo cáo TRUNG THỰC).
export function listBackups() {
  return listBackupFiles(ROOT);
}
