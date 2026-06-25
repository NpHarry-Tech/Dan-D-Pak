// Import the REAL KiotViet warehouse export as the source of truth for Kho BCM.
//
// Why this exists: the older import-bcm-products.js scrapes bcmarketing.vn (guesses).
// The KiotViet export has the real codes, barcodes, prices, VAT, stock, lots and units.
//
// Usage:
//   1. Save the KiotViet export at:
//        server/scripts/data/kiotviet-products.md   (Markdown table — e.g. tableConvert.com)
//      or  server/scripts/data/kiotviet-products.csv  (CSV / TSV, UTF-8)
//      (or pass a path:  node server/scripts/import-kiotviet-products.js path/to/file.md)
//   2. Dry-run (prints a summary, writes nothing):
//        node server/scripts/import-kiotviet-products.js
//   3. Commit to the database (and deactivate stale SKUs not in the file):
//        node server/scripts/import-kiotviet-products.js --commit
//
// Accepts a Markdown pipe-table OR comma/semicolon/tab CSV, and auto-repairs
// mojibake (UTF-8 that got decoded as Latin-1, e.g. "HÃ ng hÃ³a" -> "Hàng hóa").

import { readFileSync, existsSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';
import { db, migrate, now, audit } from '../db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BRANCH_ID = 'br1';
const WAREHOUSE_ID = 'wh_retail';

const args = process.argv.slice(2);
const COMMIT = args.includes('--commit');

function findLocalImage(skuId) {
  const destDir = resolve(__dirname, '..', '..', 'web', 'assets', 'product-images');
  if (!existsSync(destDir)) return null;
  try {
    const files = readdirSync(destDir);
    const match = files.find(f => f.startsWith(skuId + '.'));
    return match ? `/assets/product-images/${match}` : null;
  } catch {
    return null;
  }
}

async function downloadProductImage(skuId, url) {
  if (!url || !url.startsWith('http')) return url || null;
  const local = findLocalImage(skuId);
  if (local) return local;

  const destDir = resolve(__dirname, '..', '..', 'web', 'assets', 'product-images');
  try {
    const res = await fetch(url);
    if (!res.ok) return url;
    const contentType = res.headers.get('content-type') || '';
    let ext = extname(new URL(url).pathname);
    if (!ext) {
      if (contentType.includes('png')) ext = '.png';
      else if (contentType.includes('webp')) ext = '.webp';
      else if (contentType.includes('gif')) ext = '.gif';
      else ext = '.jpg';
    }
    const filename = `${skuId}${ext}`;
    const destPath = join(destDir, filename);
    const arrayBuffer = await res.arrayBuffer();
    mkdirSync(destDir, { recursive: true });
    writeFileSync(destPath, Buffer.from(arrayBuffer));
    return `/assets/product-images/${filename}`;
  } catch (err) {
    console.warn(`⚠️  Không tải được ảnh cho ${skuId}: ${err.message}`);
    return url;
  }
}
function defaultFile() {
  const dir = (f) => resolve(__dirname, 'data', f);
  for (const f of ['kiotviet-products.xlsx', 'kiotviet-products.md', 'kiotviet-products.csv']) {
    if (existsSync(dir(f))) return dir(f);
  }
  return dir('kiotviet-products.md');
}
const FILE = args.find(a => !a.startsWith('--')) || defaultFile();

// ---- encoding + text helpers -------------------------------------------------
function fixMojibake(s) {
  if (!s || !/[ÃÂÄÅáºá»Æ°]/.test(s)) return s;      // only touch strings that look mangled
  try {
    const recovered = Buffer.from(s, 'latin1').toString('utf8');
    return recovered.includes('�') ? s : recovered; // keep original if recovery is lossy
  } catch { return s; }
}
function clean(v, fallback = '') { return String(v ?? fallback).replace(/\s+/g, ' ').trim(); }
function moneyToInt(v) {
  const n = parseFloat(String(v ?? '0').replace(/[^\d.]/g, ''));
  return Number.isFinite(n) ? Math.round(n) : 0;
}
function numOr(v, d = 0) { const n = parseFloat(String(v ?? '').replace(/[^\d.-]/g, '')); return Number.isFinite(n) ? n : d; }
function truthy(v) { const s = clean(v).toLowerCase(); return s === '1' || s === 'true' || s === 'có' || s === 'co' || s === 'x'; }
function normHeader(h) {
  return fixMojibake(clean(h)).toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd')
    .replace(/[^a-z0-9]+/g, ' ').trim();
}

// ---- CSV parser (handles quotes, commas/semicolons/tabs, CRLF) ----------------
function detectDelimiter(headerLine) {
  const counts = { ',': 0, ';': 0, '\t': 0 };
  let q = false;
  for (const ch of headerLine) { if (ch === '"') q = !q; else if (!q && ch in counts) counts[ch]++; }
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
}
function parseCsv(text) {
  const firstLine = text.slice(0, text.indexOf('\n') >= 0 ? text.indexOf('\n') : text.length);
  const delim = detectDelimiter(firstLine);
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += ch;
    } else if (ch === '"') q = true;
    else if (ch === delim) { row.push(field); field = ''; }
    else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (ch === '\r') { /* skip */ }
    else field += ch;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(c => clean(c)));
}

// ---- Markdown pipe-table parser ----------------------------------------------
// Handles tableConvert.com style:  | a | b | c |  with a "| --- | --- |" divider.
function isDividerRow(cells) {
  return cells.length > 0 && cells.every(c => /^:?-{2,}:?$/.test(clean(c)));
}
function splitMdRow(line) {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  // split on unescaped pipes
  const out = []; let cur = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '\\' && s[i + 1] === '|') { cur += '|'; i++; }
    else if (ch === '|') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out.map(c => c.trim());
}
function parseMarkdownTable(text) {
  const rows = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line.includes('|')) continue;          // skip prose / blank lines
    const cells = splitMdRow(line);
    if (isDividerRow(cells)) continue;          // skip the |---|---| separator
    if (cells.some(c => clean(c))) rows.push(cells);
  }
  return rows;
}

// ---- Native .xlsx reader (zero-dependency: an .xlsx is a ZIP of XML) ----------
// Reads the ZIP central directory, inflates the needed parts with zlib, and
// parses the first worksheet using the shared-strings table.
function unzipEntries(buf) {
  // Locate End Of Central Directory record (scan backwards for sig 0x06054b50)
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) { if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; } }
  if (eocd < 0) throw new Error('File .xlsx không hợp lệ (không thấy EOCD).');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);          // offset of central directory
  const entries = {};
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    // Read the LOCAL header to find where data actually starts (its name/extra lens can differ)
    const lNameLen = buf.readUInt16LE(localOff + 26);
    const lExtraLen = buf.readUInt16LE(localOff + 28);
    const dataStart = localOff + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(dataStart, dataStart + compSize);
    entries[name] = () => (method === 0 ? raw : inflateRawSync(raw)).toString('utf8');
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}
function xmlDecode(s) {
  return String(s)
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}
function colIndex(ref) { // "C5" -> 2 ; "AA1" -> 26
  const m = /^([A-Z]+)/.exec(ref || ''); if (!m) return 0;
  let n = 0; for (const ch of m[1]) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}
function parseSharedStrings(xml) {
  if (!xml) return [];
  return [...xml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m => {
    const parts = [...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(t => xmlDecode(t[1]));
    return parts.join('');
  });
}
function parseXlsx(buf) {
  const entries = unzipEntries(buf);
  const shared = parseSharedStrings(entries['xl/sharedStrings.xml']?.());
  // Resolve the first worksheet via workbook → relationships (attribute order
  // and a leading "/" in Target both vary between exporters), then normalize
  // the path. Fall back to any xl/worksheets/sheet*.xml entry.
  const normSheet = (t) => 'xl/' + clean(t).replace(/^\/?(xl\/)?/, '');
  let sheetName = null;
  const wb = entries['xl/workbook.xml']?.();
  const rels = entries['xl/_rels/workbook.xml.rels']?.();
  if (wb && rels) {
    const firstRid = /<sheet\b[^>]*\br:id="([^"]+)"/.exec(wb)?.[1];
    if (firstRid) {
      const relRe = new RegExp(`<Relationship\\b[^>]*\\bId="${firstRid}"[^>]*>`, 'i');
      const rel = relRe.exec(rels)?.[0];
      const target = rel && /\bTarget="([^"]+)"/.exec(rel)?.[1];
      if (target) sheetName = normSheet(target);
    }
  }
  let sheet = sheetName && entries[sheetName]?.();
  if (!sheet) {
    const anySheet = Object.keys(entries).find(k => /^xl\/worksheets\/sheet\d+\.xml$/.test(k));
    sheet = anySheet && entries[anySheet]?.();
  }
  if (!sheet) throw new Error('Không tìm thấy worksheet trong .xlsx');
  const rows = [];
  for (const rm of sheet.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells = [];
    // Match BOTH self-closing empty cells (<c r="Q2"/>) and filled cells
    // (<c r="..">..</c>). KiotViet writes empties self-closed; missing this
    // makes the regex swallow the next cell and shift every column.
    for (const cm of rm[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1], inner = cm[2] || '';
      const ref = /r="([^"]+)"/.exec(attrs)?.[1] || '';
      const type = /t="([^"]+)"/.exec(attrs)?.[1] || 'n';
      const ci = colIndex(ref);
      let val = '';
      if (type === 's') { const v = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1]; val = shared[Number(v)] ?? ''; }
      else if (type === 'inlineStr') { val = [...inner.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(t => xmlDecode(t[1])).join(''); }
      else { val = xmlDecode(/<v>([\s\S]*?)<\/v>/.exec(inner)?.[1] ?? ''); }
      cells[ci] = val;
    }
    for (let i = 0; i < cells.length; i++) if (cells[i] == null) cells[i] = '';
    rows.push(cells);
  }
  return rows.filter(r => r.some(c => clean(c)));
}

function parseTable(file) {
  if (/\.xlsx$/i.test(file)) return parseXlsx(readFileSync(file));
  const text = readFileSync(file, 'utf8');
  return /\.md$|\.markdown$/i.test(file) ? parseMarkdownTable(text) : parseCsv(text);
}

// ---- column mapping (KiotViet headers, mojibake-tolerant) ---------------------
const FIELD_ALIASES = {
  type:       ['loai hang'],
  group:      ['nhom hang 3 cap', 'nhom hang'],
  code:       ['ma hang'],
  barcode:    ['ma vach'],
  name:       ['ten hang'],
  brand:      ['thuong hieu'],
  pricePre:   ['gia ban truoc thue'],
  vatSell:    ['vat hang ban'],
  priceAfter: ['gia ban sau thue'],
  stock:      ['ton kho'],
  minStock:   ['ton nho nhat'],
  unit:       ['dvt'],
  baseUnit:   ['ma dvt co ban'],
  conv:       ['quy doi'],
  images:     ['hinh anh url1 url2'],
  trackLot:   ['quan ly lo han su dung'],
  weight:     ['trong luong'],
  active:     ['dang kinh doanh'],
  sellable:   ['duoc ban truc tiep'],
  desc:       ['mo ta'],
};
function buildHeaderIndex(headerRow) {
  const norm = headerRow.map(normHeader);
  const idx = {};
  for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
    for (const a of aliases) { const at = norm.indexOf(a); if (at >= 0) { idx[field] = at; break; } }
  }
  return idx;
}
function cell(row, idx, field) { const i = idx[field]; return i == null ? '' : fixMojibake(clean(row[i])); }

// ---- id + category derivation ------------------------------------------------
function categoryOf(group) {
  const g = clean(group);
  if (!g) return 'BCM';
  const parts = g.split('>>').map(s => clean(s)).filter(Boolean);
  return parts[parts.length - 1] || 'BCM';
}
function skuIdFor(code, used) {
  const base = 'kv_' + clean(code).replace(/[^a-zA-Z0-9]+/g, '').toLowerCase() || 'kv_' + Math.random().toString(36).slice(2, 8);
  let id = base, n = 2;
  while (used.has(id)) id = `${base}_${n++}`;
  used.add(id);
  return id;
}

// ---- main --------------------------------------------------------------------
async function run() {
  if (!existsSync(FILE)) {
    console.error(`\n❌ Không tìm thấy file export: ${FILE}\n`);
    console.error(`   Lưu file export vào server/scripts/data/kiotviet-products.{xlsx|md|csv}`);
    console.error(`   hoặc chạy:  node server/scripts/import-kiotviet-products.js đường-dẫn-file.xlsx\n`);
    process.exitCode = 1;
    return;
  }
  migrate();

  const rows = parseTable(FILE);
  if (rows.length < 2) { console.error('File rỗng hoặc không đọc được.'); process.exitCode = 1; return; }
  const idx = buildHeaderIndex(rows[0]);
  if (idx.name == null || idx.code == null) {
    console.error('Không nhận diện được cột "Tên hàng"/"Mã hàng". Header đọc được:');
    console.error(rows[0].map(normHeader).join(' | '));
    process.exitCode = 1; return;
  }

  const used = new Set();
  const records = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const code = cell(row, idx, 'code');
    const name = cell(row, idx, 'name');
    if (!name) continue;
    const trackLot = truthy(cell(row, idx, 'trackLot')) ? 1 : 0;
    records.push({
      id: skuIdFor(code, used),
      branch_id: BRANCH_ID,
      barcode: cell(row, idx, 'barcode') || code,
      name,
      emoji: '🛍️',
      image: clean(cell(row, idx, 'images').split(',')[0]) || null,
      price: moneyToInt(cell(row, idx, 'priceAfter')),
      cost: 0,
      stock: numOr(cell(row, idx, 'stock'), 0),
      min_stock: numOr(cell(row, idx, 'minStock'), 0),
      unit: cell(row, idx, 'unit') || 'cái',
      warehouse_id: WAREHOUSE_ID,
      category: categoryOf(cell(row, idx, 'group')),
      supplier: cell(row, idx, 'brand') || 'BCM',
      source_url: null,
      track_lot: trackLot,
      expiry_required: trackLot,
      active: cell(row, idx, 'active') === '0' ? 0 : 1,
    });
  }

  console.log(`\n📦 Đọc được ${records.length} dòng sản phẩm từ ${FILE}`);
  console.log(`   Ví dụ 3 dòng đầu:`);
  for (const s of records.slice(0, 3)) {
    console.log(`   • [${s.id}] ${s.name} — ${s.price.toLocaleString('vi-VN')}đ / ${s.unit} · tồn ${s.stock} · ${s.category}`);
  }

  if (!COMMIT) {
    console.log(`\n🔍 DRY-RUN — chưa ghi gì vào database.`);
    console.log(`   Chạy lại với --commit để nhập thật.\n`);
    return;
  }

  console.log(`\n📥 Đang kiểm tra và tải hình ảnh sản phẩm về thư mục local...`);
  for (let i = 0; i < records.length; i++) {
    const s = records[i];
    if (s.image && s.image.startsWith('http')) {
      s.image = await downloadProductImage(s.id, s.image);
    } else {
      const local = findLocalImage(s.id);
      if (local) s.image = local;
    }
  }

  // Positional params + explicit transaction (node:sqlite has no .transaction()).
  const upsert = db.prepare(`
    INSERT INTO skus (id,branch_id,barcode,name,emoji,image,price,cost,stock,min_stock,unit,warehouse_id,category,supplier,source_url,track_lot,expiry_required,active)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET
      barcode=excluded.barcode, name=excluded.name, image=excluded.image, price=excluded.price,
      stock=excluded.stock, min_stock=excluded.min_stock, unit=excluded.unit, category=excluded.category,
      supplier=excluded.supplier, track_lot=excluded.track_lot, expiry_required=excluded.expiry_required,
      active=excluded.active, warehouse_id=excluded.warehouse_id`);
  const deactivate = db.prepare(`UPDATE skus SET active=0 WHERE id=?`);
  const existingStmt = db.prepare(`SELECT id FROM skus WHERE warehouse_id=? AND branch_id=?`);

  let deactivated = 0;
  db.exec('BEGIN');
  try {
    for (const s of records) upsert.run(
      s.id, s.branch_id, s.barcode, s.name, s.emoji, s.image, s.price, s.cost,
      s.stock, s.min_stock, s.unit, s.warehouse_id, s.category, s.supplier,
      s.source_url, s.track_lot, s.expiry_required, s.active);
    // Deactivate stale SKUs in this warehouse that were NOT in the KiotViet file
    // (i.e. the old scraped bcm_* guesses) — KiotViet is now the source of truth.
    const keep = new Set(records.map(s => s.id));
    for (const e of existingStmt.all(WAREHOUSE_ID, BRANCH_ID)) {
      if (!keep.has(e.id)) { deactivate.run(e.id); deactivated++; }
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  audit('kiotviet.import', { skus: records.length, deactivated, file: FILE, at: now() }, BRANCH_ID);
  console.log(`\n✅ Đã nhập ${records.length} SKU vào Kho BCM (${WAREHOUSE_ID}).`);
  console.log(`   Vô hiệu hóa ${deactivated} SKU cũ không có trong file (nguồn scraped trước đây).\n`);
}

run();
