// clear-vietfoods-images.mjs — Xóa toàn bộ ảnh sai đã gán trong lần import trước
// Chạy: node server/scripts/clear-vietfoods-images.mjs --commit
import { readFileSync } from 'node:fs';

const BASE   = 'https://api.dandpakpos.io.vn/api';
const TOKEN  = 'tk_729e57390b0d19fa60a2c2b942ea4fc79cc725ea9b8b4dfd';
const BRANCH = 'br_vietfoods';
const COMMIT = process.argv.includes('--commit');

const H = {
  'Authorization': `Bearer ${TOKEN}`,
  'x-branch-id': BRANCH,
  'Content-Type': 'application/json',
};

async function apiFetch(path, method = 'GET', body = null) {
  const opts = { method, headers: { ...H }, ...(body ? { body: JSON.stringify(body) } : {}) };
  const r = await fetch(`${BASE}${path}`, opts);
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status}: ${await r.text()}`);
  return r.json();
}

async function main() {
  const skus = await apiFetch('/skus?branch_id=br_vietfoods&limit=1000');
  const withImage = skus.filter(s => s.image && s.image.startsWith('/uploads/'));
  console.log(`\n📷 SKUs có ảnh: ${withImage.length}/${skus.length}`);
  withImage.forEach(s => console.log(`  [${s.code}] "${s.name}" → ${s.image}`));

  if (!COMMIT) {
    console.log('\nDRY-RUN — thêm --commit để xóa ảnh. Sẽ xóa:', withImage.length, 'ảnh');
    return;
  }

  let cleared = 0;
  for (const s of withImage) {
    await apiFetch(`/skus/${s.id}/update`, 'POST', { image: null });
    console.log(`  🗑️  Cleared: [${s.code}] ${s.name}`);
    cleared++;
  }
  console.log(`\n✅ Đã xóa ảnh: ${cleared} SKU`);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
