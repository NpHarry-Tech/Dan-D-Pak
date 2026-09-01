import Database from 'node:sqlite';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, extname, resolve } from 'node:path';

const dbPath = process.env.SQLITE_PATH || resolve('runtime/server-data/store.db');
const db = new Database.DatabaseSync(dbPath);
const destDir = resolve('server/assets/product-images');

mkdirSync(destDir, { recursive: true });

const skus = db.prepare("SELECT id, name, image FROM skus WHERE active = 1 AND image LIKE 'http%'").all();
console.log(`Found ${skus.length} active SKUs with external images.`);

const updateStmt = db.prepare("UPDATE skus SET image = ? WHERE id = ?");

let successCount = 0;
let failCount = 0;

for (let i = 0; i < skus.length; i++) {
  const s = skus[i];
  const url = s.image;
  console.log(`[${i + 1}/${skus.length}] Fetching image for: ${s.name} (${s.id})`);
  try {
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`HTTP error! status: ${res.status}`);
    }
    const contentType = res.headers.get('content-type') || '';
    let ext = extname(new URL(url).pathname);
    if (!ext) {
      if (contentType.includes('png')) ext = '.png';
      else if (contentType.includes('webp')) ext = '.webp';
      else if (contentType.includes('gif')) ext = '.gif';
      else ext = '.jpg';
    }
    
    const filename = `${s.id}${ext}`;
    const destPath = join(destDir, filename);
    const arrayBuffer = await res.arrayBuffer();
    writeFileSync(destPath, Buffer.from(arrayBuffer));
    
    const localPath = `/assets/product-images/${filename}`;
    updateStmt.run(localPath, s.id);
    successCount++;
  } catch (error) {
    console.error(`Failed to download ${url}:`, error.message);
    failCount++;
  }
}

console.log(`Done! Success: ${successCount}, Failed: ${failCount}`);
