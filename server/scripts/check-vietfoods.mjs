import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync('D:/Dan D Pak/runtime/server-data/store.db');

const branches = db.prepare("SELECT id, name FROM branches").all();
console.log('BRANCHES:', JSON.stringify(branches, null, 2));

const whs = db.prepare("SELECT id, branch_id, name, code, type FROM warehouses").all();
console.log('WAREHOUSES:', JSON.stringify(whs, null, 2));

// All SKUs grouped by branch
const byBranch = db.prepare("SELECT branch_id, COUNT(*) as cnt FROM skus GROUP BY branch_id").all();
console.log('SKUs per branch:', JSON.stringify(byBranch, null, 2));

// Price books
const pbs = db.prepare("SELECT * FROM price_books").all();
console.log('PRICE_BOOKS:', JSON.stringify(pbs, null, 2));

// Sample SKUs from all branches
const allSkus = db.prepare("SELECT id, code, barcode, name, warehouse_id, branch_id FROM skus ORDER BY branch_id, name LIMIT 30").all();
console.log('SAMPLE SKUs:');
for (const s of allSkus) {
  console.log(`  branch=${s.branch_id} wh=${s.warehouse_id} [${s.code}] barcode=${s.barcode} "${s.name}"`);
}
