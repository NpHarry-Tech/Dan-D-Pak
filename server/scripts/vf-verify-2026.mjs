// ============================================================
// VIETFOODS 2026 — verify & fix (authoritative)
//   node server/scripts/vf-verify-2026.mjs            → dry-run + report
//   node server/scripts/vf-verify-2026.mjs --commit   → apply changes
// Rules (per owner instructions):
//   • name  = "<clean name> (<pack size>)"; strip "nội địa", leading "N-"
//   • code / barcode exact from file; blank if none / mockup / "-"
//   • stock = qty from file (blank qty → leave/0)
//   • unit  = ĐVT column
//   • vat   = 8 ; price_includes_vat = 1 ; brand = "Dan D Pak"
//   • P4 price = "Giá niêm yết" (VAT-inclusive retail); only set when > 0
//   • image matched by nut-type + flavor + per-unit weight
//   • description from DanOn reference map
//   • skip non-products (display items, bulk HCK, sets, mockups, no-id rows)
// ============================================================
import { readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs';
import { join, basename } from 'node:path';

const BASE   = 'https://api.dandpakpos.io.vn/api';
const TOKEN  = 'tk_729e57390b0d19fa60a2c2b942ea4fc79cc725ea9b8b4dfd';
const BRANCH = 'br_vietfoods';
const WH     = 'br_vietfoods_wh_vf';
const PB_P4  = 'pb_8cf237a1c53d69c55a';
const IMG_ROOT = 'D:\\DTrash\\OneDrive_2026-08-04\\04 Product';
const MD_FILE  = 'D:\\DTrash\\san_pham_vietfoods_2026.md';
const COMMIT   = process.argv.includes('--commit');
const REPORT   = 'D:\\Dan D Pak\\server\\scripts\\vf-2026-report.txt';

const H = { Authorization: `Bearer ${TOKEN}`, 'x-branch-id': BRANCH, 'Content-Type': 'application/json' };

// ── helpers ───────────────────────────────────────────────
const clean = v => String(v ?? '').replace(/\s+/g, ' ').trim();
const money = v => { const n = parseFloat(clean(v).replace(/[^\d.]/g, '')); return Number.isFinite(n) ? Math.round(n) : 0; };
const norm  = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
function parseQty(v) {
  if (!v) return null;
  const s = clean(v);
  const tg = s.match(/(\d+)\s*túi\s*\((\d+)\s*gói\)/i);
  if (tg) return parseInt(tg[1]) * parseInt(tg[2]);
  const m = s.match(/(\d+)/);
  return m ? parseInt(m[1]) : null;
}
function normBarcode(v) {
  const s = clean(v);
  if (!s || s === '-' || s === '0') return '';
  if (/mockup/i.test(s)) return '';
  return s.replace(/\s+/g, '');   // "770795 148316" → "770795148316", "DDPK 091307" → "DDPK091307"
}

function parseMdTable(text) {
  const rows = [];
  text.split('\n').forEach((raw, idx) => {
    const line = raw.trim();
    if (!line.startsWith('|')) return;
    const cells = line.slice(1, line.endsWith('|') ? -1 : undefined).split('|').map(c => c.replace(/<br>/gi, ' ').trim());
    if (cells.every(c => /^[-:]+$/.test(c))) return;
    rows.push({ line: idx + 1, cells });
  });
  return rows;
}

// ── skip rules ────────────────────────────────────────────
// Genuine non-products (display boxes, empty containers, bulk industrial
// ingredients, raw material) — skipped even though they have a name.
const SKIP_NAMES = new Set([
  'Hộp Thiếc', 'Hộp Bánh Trưng Bày', 'Điều Tươi Còn Vỏ',
  'Cookies (Pecan, Cashew Chocola, Pistachios) 8x3x24g',
  'Box_Pistachios Cookies (25x18 thanh)', 'Bag Puck 12 túi mix',
  'Sliced Almonds Natural / Balanched', 'Silved Almonds Natural / Balanched',
  'Diced Almonds 4 - 5mm; 2-4mm, 5- 8mm', 'Diced Pistacshios 4 - 5mm; 2-4mm, 5- 8mm',
  'Butter Almonds Diced', 'Butter Pecan Diced', 'Butter Pistachios Diced',
  'Butter Walnuts Diced', 'Butter Cashews Diced',
  'All Day Breakfast Oatmeal 12/7/50g',
  'Set Oval Cam',
]);

function classify(cells) {
  // cols: Cat|Code|Barcode|Name|Pack|ĐVT|Niêm yết|Thùng|P3|Qty|Note
  const [, rawCode, rawBarcode, rawName, rawPack, rawDvt, rawNiem, , rawP3, rawQty, note] = cells;
  const name = clean(rawName);
  const code = clean(rawCode);
  const barcode = normBarcode(rawBarcode);
  let pack = clean(rawPack);
  // when the pack column is empty, recover the size from the name (e.g.
  // "Cashew salted 450g", "Pistachios 380g") so the quy-cách isn't lost.
  if (!pack) {
    const w = [...name.matchAll(/\d+\.?\d*\s*(?:kg|g)r?(?![a-z])/gi)];
    if (w.length) pack = clean(w[w.length - 1][0]);
  }
  const niem = money(rawNiem);
  const qty = parseQty(rawQty);

  if (!name || name === 'SKU' || name === 'Cat.') return { skip: 'header/empty' };
  if (code === 'Code' || rawBarcode === 'Barcode') return { skip: 'header' };
  if (SKIP_NAMES.has(name)) return { skip: 'display/non-product' };
  if (/HCK/i.test(name) || /HCK/i.test(note || '')) return { skip: 'bulk HCK (internal grade)' };
  if (note && /Set \d/i.test(note)) return { skip: 'Hermes set reference (dup code)' };
  if (/mockup/i.test(code)) return { skip: 'mockup code' };
  if (code === '-') return { skip: 'placeholder code "-"' };
  // Owner decision: create no-ID rows too — but a bare name with no pack, no
  // price, no qty and no ids is a section label, not a product.
  if (!code && !barcode && !pack && !niem && qty == null)
    return { skip: 'insufficient info (name only)' };

  // clean name
  let cn = name
    .replace(/^\d+\s*[-–]\s*/, '')
    .replace(/\s*\(nội địa\)/i, '')
    .replace(/\s*nội địa\s*/i, ' ')
    .replace(/\s+\d+\s*\/\s*\d+\.?\d*\s*(?:kg|g)r?\.?\s*$/i, '') // "12/100g"
    .replace(/\s+\d+\s*x\s*\d+\.?\d*\s*(?:kg|g)r?\.?\s*$/i, '')  // "84x40g"
    .replace(/\s+\(?\d+\.?\d*\s*(?:kg|g)r?\)?\s*$/i, '')         // trailing "454g"
    .replace(/\s+/g, ' ').trim();

  const cnl = norm(cn);
  const packInName = pack && cnl.includes(norm(pack));
  const displayName = pack && !packInName ? `${cn} (${pack})` : cn;

  return {
    line: cells.__line,
    code, barcode,
    name: displayName,
    cleanName: cn,
    pack,
    unit: clean(rawDvt) || '',
    qty: parseQty(rawQty),
    niemYet: money(rawNiem),
    p3: money(rawP3),
  };
}

function parseProducts(text) {
  const rows = parseMdTable(text);
  const products = [], skipped = [];
  for (const r of rows) {
    r.cells.__line = r.line;
    const c = classify(r.cells);
    if (c.skip) { skipped.push({ line: r.line, name: clean(r.cells[3]), reason: c.skip, code: clean(r.cells[1]), barcode: clean(r.cells[2]) }); continue; }
    c.line = r.line;
    products.push(c);
  }
  // dedupe: coded rows by code, else by barcode, else by display name
  const map = new Map();
  for (const p of products) {
    const key = p.code ? 'c:' + p.code.toLowerCase() : p.barcode ? 'b:' + p.barcode.toLowerCase() : 'n:' + norm(p.name);
    if (!map.has(key)) { map.set(key, { ...p, lines: [p.line] }); }
    else {
      const e = map.get(key);
      e.lines.push(p.line);
      if (p.qty != null) e.qty = (e.qty || 0) + p.qty;
      if (!e.niemYet && p.niemYet) e.niemYet = p.niemYet;
      if (!e.unit && p.unit) e.unit = p.unit;
    }
  }
  return { products: [...map.values()], skipped };
}

// ── image scan + match ────────────────────────────────────
// weight token as compact key: "12/50g"→"50g", "12x510g"→"510g", "8/1.13kg"→"1.13kg"
function weightKey(s) {
  // ends on any non-letter so "500g_Square", "170gr", "1kg (Jar)" all parse
  const m = [...String(s).matchAll(/(\d+\.?\d*)\s*(kg|g)r?(?![a-z])/gi)];
  if (!m.length) return '';
  const last = m[m.length - 1];
  return (last[1] + last[2]).toLowerCase().replace(/\s/g, '');
}
const NUTS = new Set(['almond', 'cashew', 'pistachio', 'pistachios', 'walnut', 'pecan', 'hazelnut',
  'macadamia', 'peanut', 'pea', 'raisin', 'cranberry', 'blueberry', 'mango', 'ginger', 'oat',
  'popcorn', 'granola', 'coconut', 'sesame', 'pumpkin', 'apricot', 'prune']);
const STOP = new Set(['jar', 'round', 'square', 'bag', 'box', 'can', 'tin', 'pack', 'the', 'and',
  'of', 'with', 'no', 'colouring', 'coloring', 'natural', 'nut', 'nuts', 'mix', 'kg', 'g',
  // variety/packaging descriptors — not distinguishing flavours
  'green', 'coating', 'skin', 'premium', 'fresh', 'crunchy']);
const stem = w => (w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w);
function meaningTokens(s) {
  return new Set(norm(s).split(' ')
    .filter(w => w.length >= 2 && !/^\d/.test(w) && !STOP.has(w))
    .map(stem));
}
function saltState(tokens) {
  for (const t of tokens) { if (/^un?sal/.test(t) && /un/.test(t)) return 'un'; }
  if ([...tokens].some(t => /unsal|unsat|unslt|unsl/.test(t))) return 'un';
  if ([...tokens].some(t => /^salt|^sal$/.test(t) || t === 'salted' || t === 'salt')) return 'salt';
  return null;
}
function nutsOf(tokens) { return new Set([...tokens].map(stem).filter(t => NUTS.has(t))); }
const eqSet = (a, b) => a.size === b.size && [...a].every(x => b.has(x));

function scanImages(root) {
  if (!existsSync(root)) return [];
  const out = [];
  (function walk(dir) {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(png|jpe?g|webp)$/i.test(e.name) && !/thumbs|\.ds_store/i.test(e.name)) {
        const rel = p.slice(root.length + 1).replace(/\\/g, '/');
        const base = e.name.replace(/\.[^.]+$/, '');
        out.push({ path: p, rel, tok: meaningTokens(base), wt: weightKey(base) });
      }
    }
  })(root);
  return out;
}
// Precision-first: same nut-type set, no salt-state conflict, weight must match.
function matchImage(cleanName, pack, imgs) {
  const pTok = meaningTokens(cleanName);
  const pNuts = nutsOf(pTok);
  const pWt = weightKey(pack);
  const pSalt = saltState(pTok);
  if (!pNuts.size) return null;               // no identifiable nut/category → skip
  let best = null, bestScore = -1;
  for (const img of imgs) {
    if (!eqSet(pNuts, nutsOf(img.tok))) continue;         // exact same nut set
    if (pWt) { if (img.wt !== pWt) continue; }            // weight must match
    else if (img.wt) continue;                            // product has no weight → avoid weighted img
    const iSalt = saltState(img.tok);
    if (pSalt && iSalt && pSalt !== iSalt) continue;      // salted vs unsalted conflict
    // coverage of product flavour words + no foreign flavour words in candidate
    const pFlav = [...pTok].filter(t => !pNuts.has(t));
    const iFlav = [...img.tok].filter(t => !nutsOf(img.tok).has(t));
    const covered = pFlav.filter(t => img.tok.has(t)).length;
    const foreign = iFlav.filter(t => !pTok.has(t)).length;
    if (pFlav.length && covered / pFlav.length < 0.6) continue;
    if (foreign > 1) continue;                            // candidate is a different, more-specific product
    const score = covered - foreign + (img.wt === pWt ? 1 : 0);
    if (score > bestScore) { bestScore = score; best = img; }
  }
  return best;
}

// ── descriptions (from DanOn danonfoods.com reference) ────
import { DESCRIPTIONS } from './vf-descriptions.mjs';

// ── API ───────────────────────────────────────────────────
async function api(path, method = 'GET', body = null) {
  const r = await fetch(`${BASE}${path}`, { method, headers: H, ...(body ? { body: JSON.stringify(body) } : {}) });
  const txt = await r.text();
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status}: ${txt.slice(0, 200)}`);
  return txt ? JSON.parse(txt) : {};
}
async function uploadImage(filePath) {
  const buf = readFileSync(filePath);
  const mime = /\.png$/i.test(filePath) ? 'image/png' : /\.webp$/i.test(filePath) ? 'image/webp' : 'image/jpeg';
  const r = await api('/skus/image-upload', 'POST', { data: buf.toString('base64'), mime_type: mime, original_name: basename(filePath) });
  return r.url;
}

// ── main ──────────────────────────────────────────────────
const log = [];
const out = (...a) => { const s = a.join(' '); console.log(s); log.push(s); };

async function main() {
  const md = readFileSync(MD_FILE, 'utf8');
  const { products, skipped } = parseProducts(md);
  out(`\n📦 File: ${products.length} valid products | ${skipped.length} skipped rows`);

  const skus = await api(`/skus?branch_id=${BRANCH}&limit=2000`);
  out(`🗄️  Production: ${skus.length} SKUs`);
  const p4 = await api(`/warehouse/price-book?book_id=${PB_P4}&warehouse_id=${WH}`);
  const p4Price = new Map(p4.map(r => [r.id, r.book_price]));

  const byCode = new Map(skus.filter(s => s.code).map(s => [clean(s.code).toLowerCase(), s]));
  const byBar  = new Map(skus.filter(s => s.barcode).map(s => [normBarcode(s.barcode).toLowerCase(), s]));
  const byName = new Map(skus.map(s => [norm(s.name), s]));   // for no-id products
  const usedBar = new Set(skus.filter(s => s.barcode).map(s => normBarcode(s.barcode).toLowerCase()));
  const imgs = scanImages(IMG_ROOT);
  out(`🖼️  Local images: ${imgs.length}`);

  const toCreate = [], toUpdate = [], noImage = [], noDesc = [], priceMissing = [], barDropped = [], nameDup = [];
  const matchedSkuIds = new Set();

  // Two passes: identified rows (code/barcode) claim their SKU first, then
  // no-id rows match by name against whatever SKUs are still unclaimed.
  const ordered = [...products.filter(p => p.code || p.barcode),
                   ...products.filter(p => !p.code && !p.barcode)];
  for (const p of ordered) {
    // Match: code first (identity); barcode only when no code; name only when neither.
    let ex = null, byNameHit = false;
    if (p.code) ex = byCode.get(p.code.toLowerCase()) || null;
    else if (p.barcode) ex = byBar.get(p.barcode.toLowerCase()) || null;
    else { ex = byName.get(norm(p.name)) || null; byNameHit = !!ex; }
    if (ex && matchedSkuIds.has(ex.id)) {
      // a no-id row whose name duplicates an already-claimed (usually coded)
      // SKU → don't spawn a confusing duplicate; report it.
      if (byNameHit) { nameDup.push(`${p.name} (trùng tên SKU đã có mã)`); continue; }
      ex = null;   // never let two rows claim one SKU
    }

    // barcode conflict: file barcode already used by a *different* SKU → drop it
    let barcode = p.barcode;
    if (barcode && (!ex || normBarcode(ex.barcode || '').toLowerCase() !== barcode.toLowerCase())
        && usedBar.has(barcode.toLowerCase())) {
      barDropped.push(`${p.name} [${p.code}] barcode ${barcode} (đã thuộc SKU khác)`);
      barcode = '';
    }
    const pp = { ...p, barcode };

    const img = matchImage(p.cleanName, p.pack, imgs);
    const desc = DESCRIPTIONS[p.cleanName] || DESCRIPTIONS[p.name] || null;
    if (!img) noImage.push(p.name);
    if (!desc) noDesc.push(p.name);
    if (!p.niemYet) priceMissing.push(`${p.name} [${p.code || '∅'}]`);

    if (ex) {
      matchedSkuIds.add(ex.id);
      const diffs = [];
      if (clean(ex.name) !== pp.name) diffs.push(`name "${ex.name}"→"${pp.name}"`);
      if (pp.barcode && normBarcode(ex.barcode || '') !== pp.barcode) diffs.push(`barcode "${ex.barcode}"→"${pp.barcode}"`);
      if (pp.unit && clean(ex.unit || '') !== pp.unit) diffs.push(`unit "${ex.unit}"→"${pp.unit}"`);
      if (Number(ex.vat) !== 8) diffs.push(`vat ${ex.vat}→8`);
      if (pp.qty != null && Number(ex.stock) !== pp.qty) diffs.push(`stock ${ex.stock}→${pp.qty}`);
      if (pp.niemYet && Number(p4Price.get(ex.id) || 0) !== pp.niemYet) diffs.push(`P4 ${p4Price.get(ex.id) ?? '∅'}→${pp.niemYet}`);
      if (img && !ex.image) diffs.push(`+image`);
      if (desc && !ex.description) diffs.push(`+desc`);
      if (diffs.length) toUpdate.push({ p: pp, ex, img, desc, diffs });
    } else {
      if (pp.barcode) usedBar.add(pp.barcode.toLowerCase());
      toCreate.push({ p: pp, img, desc });
    }
  }
  const extra = skus.filter(s => !matchedSkuIds.has(s.id));

  out(`\n===== ANALYSIS =====`);
  out(`🆕 to CREATE : ${toCreate.length}`);
  out(`✏️  to UPDATE : ${toUpdate.length}`);
  out(`➖ SKUs in prod NOT in file: ${extra.length}`);
  out(`📷 no image  : ${noImage.length}`);
  out(`📝 no desc   : ${noDesc.length}`);
  out(`💰 no niêm-yết price in file: ${priceMissing.length}`);
  out(`⚠️  barcode dropped (conflict): ${barDropped.length}`);
  out(`⚠️  no-id name duplicates (skipped): ${nameDup.length}`);
  nameDup.forEach(n => out(`     · ${n}`));

  out(`\n----- CREATE -----`);
  toCreate.forEach(({ p, img }) => out(`  + [${p.code || 'auto'}|${p.barcode || '∅'}] ${p.name} | stock=${p.qty ?? '∅'} unit=${p.unit || '∅'} P4=${p.niemYet || '∅'} img=${img ? img.rel : 'NONE'}`));
  out(`\n----- UPDATE -----`);
  toUpdate.forEach(({ p, diffs }) => out(`  ~ [${p.code}] ${p.name}: ${diffs.join(' ; ')}`));
  out(`\n----- EXTRA (prod not in file) -----`);
  extra.forEach(s => out(`  ? [${s.code}|${s.barcode}] ${s.name} stock=${s.stock}`));
  out(`\n----- BARCODE DROPPED (conflict → tạo với mã vạch trống) -----`);
  barDropped.forEach(b => out(`  ! ${b}`));
  out(`\n----- SKIPPED ROWS -----`);
  skipped.forEach(s => out(`  x L${s.line} "${s.name}" [${s.code}|${s.barcode}] — ${s.reason}`));

  writeFileSync(REPORT, log.join('\n'), 'utf8');
  console.log(`\n📄 Report → ${REPORT}`);

  if (!COMMIT) { console.log('\nDRY-RUN. Re-run with --commit to apply.\n'); return; }

  // ── COMMIT ──────────────────────────────────────────────
  console.log('\n🚀 COMMITTING...');
  let created = 0, updated = 0, imgUp = 0, failed = 0;
  const uploadCache = new Map();
  const doUpload = async (img) => {
    if (!img) return null;
    if (uploadCache.has(img.path)) return uploadCache.get(img.path);
    try { const u = await uploadImage(img.path); uploadCache.set(img.path, u); imgUp++; return u; }
    catch (e) { console.warn(`   ⚠️ img upload ${img.rel}: ${e.message}`); return null; }
  };

  for (const { p, img, desc } of toCreate) {
    try {
      const imageUrl = await doUpload(img);
      const res = await api('/skus', 'POST', {
        code: p.code || undefined, barcode: p.barcode || undefined, name: p.name,
        unit: p.unit || 'cái', warehouse_id: WH, branch_id: BRANCH,
        stock: p.qty ?? 0, price: 0, cost: 0, active: 1, emoji: '🛍️',
        vat: 8, price_includes_vat: 1, brand: 'Dan D Pak',
        image: imageUrl, description: desc || undefined,
      });
      const id = res.id || res.sku?.id;
      if (id && p.niemYet) await api('/warehouse/price-book/entry', 'POST', { book_id: PB_P4, sku_id: id, price: p.niemYet });
      console.log(`   ✅ create [${p.code}] ${p.name}`); created++;
    } catch (e) { console.error(`   ❌ create ${p.name}: ${e.message}`); failed++; }
  }

  for (const { p, ex, img, desc, diffs } of toUpdate) {
    try {
      let imageUrl = ex.image;
      if (img && !ex.image) imageUrl = await doUpload(img) || ex.image;
      await api(`/skus/${ex.id}/update`, 'POST', {
        name: p.name, code: p.code || undefined, barcode: p.barcode || undefined,
        unit: p.unit || ex.unit || 'cái', vat: 8, price_includes_vat: 1, brand: 'Dan D Pak',
        image: imageUrl, description: desc || ex.description || undefined, warehouse_id: WH,
      });
      if (p.qty != null && Number(ex.stock) !== p.qty)
        await api(`/skus/${ex.id}/adjust`, 'POST', { stock: p.qty, warehouse_id: WH, reason: 'vietfoods 2026 sync' });
      if (p.niemYet && Number(p4Price.get(ex.id) || 0) !== p.niemYet)
        await api('/warehouse/price-book/entry', 'POST', { book_id: PB_P4, sku_id: ex.id, price: p.niemYet });
      console.log(`   ✏️  update [${p.code}] ${p.name} (${diffs.length} fields)`); updated++;
    } catch (e) { console.error(`   ❌ update ${p.name}: ${e.message}`); failed++; }
  }

  console.log(`\n🎉 DONE. created=${created} updated=${updated} imagesUploaded=${imgUp} failed=${failed}`);
}
main().catch(e => { console.error('FATAL:', e); process.exit(1); });
