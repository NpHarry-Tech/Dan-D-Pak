import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

// 1. Truncate SQLite audit_log table
const dbPath = path.join(ROOT, 'server', 'store.db');
if (fs.existsSync(dbPath)) {
  console.log(`Clearing SQLite audit_log in ${dbPath}...`);
  try {
    const db = new DatabaseSync(dbPath);
    db.exec('DELETE FROM audit_log;');
    console.log('Successfully cleared audit_log table.');
  } catch (e) {
    console.error('Failed to clear audit_log table:', e.message);
  }
} else {
  console.log('SQLite store.db not found at', dbPath);
}

// 2. Clear permanent storage audit NDJSON files
const auditDir = path.join(ROOT, 'server', 'permanent-storage', 'audit');
if (fs.existsSync(auditDir)) {
  console.log(`Clearing permanent audit logs in ${auditDir}...`);
  const deleteNdjsonFiles = (dir) => {
    const files = fs.readdirSync(dir);
    for (const file of files) {
      const fullPath = path.join(dir, file);
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        deleteNdjsonFiles(fullPath);
      } else if (file.endsWith('.ndjson')) {
        try {
          fs.unlinkSync(fullPath);
          console.log(`Deleted: ${fullPath}`);
        } catch (err) {
          console.error(`Failed to delete ${fullPath}:`, err.message);
        }
      }
    }
  };
  deleteNdjsonFiles(auditDir);
}

// 3. Clear/truncate server output log files
const logsToClear = [
  path.join(ROOT, 'server', '_out.log'),
  path.join(ROOT, 'server', '_err.log'),
  path.join(ROOT, 'tmp_server_run.log'),
  path.join(ROOT, 'tmp_server_err.log'),
  path.join(ROOT, 'tmp_p.log'),
];

for (const logPath of logsToClear) {
  if (fs.existsSync(logPath)) {
    try {
      fs.writeFileSync(logPath, '', 'utf8');
      console.log(`Truncated log file: ${logPath}`);
    } catch (err) {
      console.error(`Failed to clear log file ${logPath}:`, err.message);
    }
  }
}

console.log('All logs reset successfully.');
