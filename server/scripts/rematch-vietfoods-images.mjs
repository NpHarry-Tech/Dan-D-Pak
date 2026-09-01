// ============================================================
// rematch-vietfoods-images.mjs — Gán lại ảnh với thuật toán nghiêm ngặt
// Yêu cầu khớp ĐÚNG từ khóa variant (salted, honey, raw, truffle, ...)
// Chạy: node server/scripts/rematch-vietfoods-images.mjs
//        node server/scripts/rematch-vietfoods-images.mjs --commit
// ============================================================
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';

const BASE     = 'https://api.dandpakpos.io.vn/api';
const TOKEN    = 'tk_729e57390b0d19fa60a2c2b942ea4fc79cc725ea9b8b4dfd';
const BRANCH   = 'br_vietfoods';
const IMG_ROOT = 'D:\\DTrash\\OneDrive_2026-08-04\\04 Product';
const COMMIT   = process.argv.includes('--commit');

const H = {
  'Authorization': `Bearer ${TOKEN}`,
  'x-branch-id': BRANCH,
  'Content-Type': 'application/json',
};

// ── API ─────────────────────────────────────────────────────
async function apiFetch(path, method = 'GET', body = null) {
  const opts = { method, headers: { ...H }, ...(body ? { body: JSON.stringify(body) } : {}) };
  const r = await fetch(`${BASE}${path}`, opts);
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status}: ${await r.text()}`);
  return r.json();
}

async function uploadImage(filePath) {
  const buf  = readFileSync(filePath);
  const mime = /\.png$/i.test(filePath) ? 'image/png' : /\.webp$/i.test(filePath) ? 'image/webp' : 'image/jpeg';
  const data = buf.toString('base64');
  const r    = await apiFetch('/skus/image-upload', 'POST', {
    data, mime_type: mime, original_name: basename(filePath)
  });
  return r.url;
}

// ── Image scanner ──────────────────────────────────────────
function scanImages(root) {
  if (!existsSync(root)) return [];
  const out = [];
  const walk = dir => {
    try {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.(png|jpe?g|webp)$/i.test(e.name) && !/(Thumbs|\.DS_Store)/i.test(e.name)) {
          const rel = p.replace(root + '\\', '').replace(/\\/g, '/');
          out.push({ path: p, rel, nameLower: basename(p).toLowerCase().replace(/\.[^.]+$/, '') });
        }
      }
    } catch {}
  };
  walk(root);
  return out;
}

// ── Strict image matching ──────────────────────────────────
// "Variant" keywords that MUST match between product name and image filename.
// If the product name contains any of these, the image filename must also contain it.
const VARIANT_GROUPS = [
  // Flavor variants — each array is mutually exclusive alternatives
  ['truffle'],
  ['hickory', 'smoke', 'smoked', 'smoky'],
  ['honey', 'mat ong'],
  ['caramel', 'salted caramel'],
  ['coffee', 'ca phe'],
  ['sesame', 'me'],
  ['wasabi'],
  ['chili', 'chile', 'chi li', 'chili lime'],
  ['mala'],
  ['bagel'],
  ['garlic'],
  ['butter'],
  ['maple'],
  ['spicy', 'hot', 'cay'],
  ['pepper', 'salt & pepper', 'salt and pepper', 'muoi tieu'],
  ['coconut', 'dua'],
  ['cinnamon', 'que'],
  ['mustard', 'wasabi', 'mu tac'],
  ['berry', 'blueberry', 'strawberry', 'cranberry'],
  // Salt/unsalt is the most critical — they are often confused
  ['unsalted', 'n/s', 'natural', 'khong muoi', 'not salted'],
  ['salted', 'r/s', 'co muoi'],  // after unsalted so that "unsalted" takes priority
  ['raw', 'song'],
  ['dark', 'den'],
  ['milk', 'sua'],
  ['matcha'],
  ['yogurt'],
  ['cluster'],
  ['creamy', 'smooth'],
  ['crunchy', 'crunche'],
  ['volcano'],
  ['pistachio', 'dẻ cười'],
];

function norm(s) {
  return String(s)
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// Extract which variant group tags the product name has
function getVariantTags(name) {
  const n = norm(name);
  const tags = [];
  for (const group of VARIANT_GROUPS) {
    if (group.some(kw => n.includes(kw))) {
      tags.push(group[0]); // canonical tag
    }
  }
  return tags;
}

// Check if the image filename is compatible with the product's variant tags
function imageCompatible(imgName, productVariants, productNorm) {
  const img = norm(imgName);

  // Hard exclusions: specific product-image category mismatches
  // Pepper SPICE products must NOT use cashew/almond images
  if ((productNorm.includes('pepper white') || productNorm.includes('pepper black') ||
       productNorm.includes('pepper coarse') || productNorm.includes('pepper ground') ||
       productNorm.includes('pepper whole')) &&
      (img.includes('cashew') || img.includes('almond') || img.includes('pistachio'))) {
    return false;
  }
  // Oat variants must match exact type
  if (productNorm.includes('rolled oat') && !img.includes('rolled')) return false;
  if (productNorm.includes('quick oat') && img.includes('instant')) {
    // Allow Quick oat to match instant only as fallback (handled by score)
  }
  if (productNorm.includes('instant oat') && img.includes('rolled')) return false;
  // Seasoned peanuts should NOT use nori image
  if (productNorm.includes('seasoned') && img.includes('nori')) return false;
  // Pistachios must come from Pistachios folder
  if (productNorm.includes('pistachio') && 
      !img.includes('pistachio') && !img.includes('dẻ') && !img.includes('de')) return false;

  // Every variant tag in the product MUST appear (via group synonym) in the image name
  for (const tag of productVariants) {
    const group = VARIANT_GROUPS.find(g => g[0] === tag);
    const found = group.some(kw => img.includes(kw));
    if (!found) return false; // image missing required variant
  }

  // Conversely: if image has a variant NOT present in product, reject
  for (const group of VARIANT_GROUPS) {
    const imgHasVariant = group.some(kw => img.includes(kw));
    if (!imgHasVariant) continue;
    const prodHasVariant = group.some(kw => productNorm.includes(kw));
    if (!prodHasVariant) return false; // image has a different variant than product
  }

  return true;
}

// Extract numeric weight from string: "84x26g" → null (pack), "450g" → 450, "1.36kg" → 1360
function extractWeight(s) {
  const norm_s = String(s).toLowerCase().replace(/\s/g, '');
  // Skip pack formats like 12x50g, 84x26g — these are pack sizes not weights
  if (/\d+x\d/.test(norm_s)) return null;
  const kg = norm_s.match(/(\d+\.?\d*)kg/);
  if (kg) return Math.round(parseFloat(kg[1]) * 1000);
  const g = norm_s.match(/(\d+\.?\d*)g/);
  if (g) return Math.round(parseFloat(g[1]));
  return null;
}

// Extract product category / base word (first meaningful word)
function baseCategory(name) {
  const n = norm(name);
  // Common base product words in order of specificity
  const cats = ['pistachio', 'cashew', 'almond', 'walnut', 'pecan', 'hazelnut',
    'macadamia', 'peanut', 'granola', 'oat', 'popcorn', 'raisin', 'mango',
    'cranberry', 'blueberry', 'apricot', 'prune', 'ginger', 'fancy nut mix',
    'mixed nut', 'daily nut', 'beanies', 'cluster', 'pepper', 'turmeric',
    'cinnamon', 'garlic', 'onion', 'cumin', 'oregano', 'thyme', 'parsley',
    'rosemary', 'mustard', 'chili', 'cayenne', 'paprika', 'chocolate'];
  for (const c of cats) {
    if (n.includes(c)) return c;
  }
  return n.split(' ')[0];
}

// Main matching function — strict
function matchImageStrict(skuName, skuPackSize, candidates) {
  const prodNorm = norm(skuName);
  const prodVariants = getVariantTags(skuName);
  const prodCat = baseCategory(skuName);

  // Extract product weight from packSize (prefer single-unit size)
  const prodWeight = extractWeight(skuPackSize);

  const matches = [];
  for (const img of candidates) {
    const imgName = img.nameLower;

    // 1. Must share the same base category
    if (!imgName.includes(prodCat) && !norm(img.rel).includes(prodCat)) continue;

    // 2. Check variant compatibility (strict)
    if (!imageCompatible(imgName, prodVariants, prodNorm)) continue;

    // Compute score based on weight match
    let score = 1.0;
    const imgWeight = extractWeight(imgName);
    if (prodWeight && imgWeight) {
      if (prodWeight === imgWeight) score += 2.0; // exact weight match
      else {
        const diff = Math.abs(prodWeight - imgWeight) / Math.max(prodWeight, imgWeight);
        if (diff < 0.05) score += 1.5;       // within 5%
        else if (diff < 0.2) score += 0.5;   // within 20%
        else score -= 0.5;                    // wrong weight, penalise
      }
    } else if (prodWeight && !imgWeight) {
      score += 0;  // no weight in img, neutral
    }

    // Bonus: folder name matches product category
    const folder = norm(img.rel.split('/')[0]);
    if (folder.includes(prodCat)) score += 0.5;

    matches.push({ img, score });
  }

  if (!matches.length) return null;
  matches.sort((a, b) => b.score - a.score);
  return matches[0].img.path;
}

// ── MAIN ────────────────────────────────────────────────────
async function main() {
  console.log('\n🔍 Lấy danh sách SKU Vietfoods...');
  const skus = await apiFetch('/skus?branch_id=br_vietfoods&limit=1000');
  const noImg = skus.filter(s => !s.image);
  console.log(`   Tổng SKU: ${skus.length}, chưa có ảnh: ${noImg.length}`);

  console.log('\n🖼️  Quét ảnh...');
  const imgs = scanImages(IMG_ROOT);
  console.log(`   Tìm thấy ${imgs.length} ảnh`);

  const results = { matched: [], noMatch: [], skipped: [] };

  for (const sku of noImg) {
    const packSize = sku.name.match(/\(([^)]+)\)$/)?.[1] || ''; // extract from name
    const match = matchImageStrict(sku.name, packSize, imgs);

    if (match) {
      const rel = match.replace(IMG_ROOT + '\\', '').replace(/\\/g, '/');
      results.matched.push({ sku, imgPath: match, rel });
      console.log(`   ✅ [${sku.code}] "${sku.name}"\n       → ${rel}`);
    } else {
      results.noMatch.push(sku);
      console.log(`   ❓ [${sku.code}] "${sku.name}" — không khớp ảnh`);
    }
  }

  console.log(`\n📊 Kết quả:`);
  console.log(`   ✅ Khớp ảnh: ${results.matched.length}`);
  console.log(`   ❓ Không khớp: ${results.noMatch.length}`);

  if (!COMMIT) {
    console.log('\nDRY-RUN — thêm --commit để upload và gán ảnh thật.\n');
    return;
  }

  console.log('\n⬆️  Đang upload và gán ảnh...');
  let ok = 0, fail = 0;
  for (const { sku, imgPath, rel } of results.matched) {
    try {
      const url = await uploadImage(imgPath);
      await apiFetch(`/skus/${sku.id}/update`, 'POST', { image: url });
      console.log(`   ✅ Gán: [${sku.code}] ${sku.name}`);
      ok++;
    } catch (e) {
      console.error(`   ❌ Lỗi: [${sku.code}] ${sku.name}: ${e.message}`);
      fail++;
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log(`✅ HOÀN THÀNH:`);
  console.log(`   Gán ảnh thành công: ${ok}`);
  console.log(`   Lỗi: ${fail}`);
  console.log(`   Không tìm được ảnh: ${results.noMatch.length}`);
  if (results.noMatch.length) {
    console.log('\n📷 Sản phẩm KHÔNG CÓ ẢNH (cần thêm thủ công):');
    results.noMatch.forEach((s, i) => console.log(`   ${i + 1}. [${s.code}] ${s.name}`));
  }
  console.log('='.repeat(60));
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
