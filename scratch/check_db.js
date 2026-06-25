import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const dbPath = path.join(ROOT, 'server', 'store.db');

try {
  const db = new DatabaseSync(dbPath);
  const row = db.prepare("SELECT value FROM app_settings WHERE key = 'integrations_config'").get();
  if (row) {
    console.log("Current integrations_config:");
    console.log(JSON.stringify(JSON.parse(row.value), null, 2));
  } else {
    console.log("No integrations_config found in DB.");
  }
} catch (e) {
  console.error("Error checking db:", e.message);
}
