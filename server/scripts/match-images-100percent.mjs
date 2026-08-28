// match-images-100percent.mjs
// Strict 100% certainty matcher
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
          out.push({ path: p, rel, filename: basename(p).toLowerCase().replace(/\.[^.]+$/, '') });
        }
      }
    } catch {}
  };
  walk(root);
  return out;
}

function norm(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// Parse weight from string (in grams)
function parseWeightInGrams(str) {
  const s = norm(str);
  // Match e.g. 1.13kg, 1kg, 454g, 500g, 50g, 1.36kg
  // Ignore pack counts like 12/100g -> weight is 100g
  const matchKg = s.match(/(\d+\.?\d*)\s*kg/);
  if (matchKg) return Math.round(parseFloat(matchKg[1]) * 1000);
  const matchG = s.match(/(\d+)\s*g/);
  if (matchG) return parseInt(matchG[1], 10);
  return null;
}

// Get primary category of product
function getCategory(str) {
  const s = norm(str);
  if (s.includes('cashew') || s.includes('dieu')) return 'cashew';
  if (s.includes('almond') || s.includes('hanh nhan')) return 'almond';
  if (s.includes('pistachio') || s.includes('pistaschio') || s.includes('de cuoi')) return 'pistachio';
  if (s.includes('walnut') || s.includes('oc cho')) return 'walnut';
  if (s.includes('pecan') || s.includes('ho dao')) return 'pecan';
  if (s.includes('hazelnut') || s.includes('hat phi')) return 'hazelnut';
  if (s.includes('macadamia') || s.includes('mac ca')) return 'macadamia';
  if (s.includes('peanut') || s.includes('dau phong')) return 'peanut';
  if (s.includes('popcorn') || s.includes('bap rang')) return 'popcorn';
  if (s.includes('raisin') || s.includes('nho kho')) return 'raisin';
  if (s.includes('cranberr') || s.includes('blueberr') || s.includes('apricot') || s.includes('prune') || s.includes('mango') || s.includes('ginger')) return 'fruit';
  if (s.includes('granola') || s.includes('oat')) return 'granola_oat';
  if (s.includes('cookie') || s.includes('puck') || s.includes('protein bites')) return 'bakery';
  if (s.includes('fancy') || s.includes('mixed nut') || s.includes('daily nut') || s.includes('harvest tyme') || s.includes('snack mix') || s.includes('beanies')) return 'mix';
  
  // Spices - MUST match exact spice type!
  if (s.includes('rosemary')) return 'spice_rosemary';
  if (s.includes('thyme')) return 'spice_thyme';
  if (s.includes('oregano')) return 'spice_oregano';
  if (s.includes('parsley')) return 'spice_parsley';
  if (s.includes('cinnamon') || s.includes('que')) return 'spice_cinnamon';
  if (s.includes('turmeric') || s.includes('nghe')) return 'spice_turmeric';
  if (s.includes('garlic') && !s.includes('cashew') && !s.includes('peanut')) return 'spice_garlic';
  if (s.includes('onion')) return 'spice_onion';
  if (s.includes('cumin')) return 'spice_cumin';
  if (s.includes('ginger') && (s.includes('ground') || s.includes('powder'))) return 'spice_ginger';
  if (s.includes('pepper') && (s.includes('black') || s.includes('white') || s.includes('coarse') || s.includes('ground')) && !s.includes('cashew') && !s.includes('almond') && !s.includes('pistachio')) return 'spice_pepper';
  if (s.includes('mustard')) return 'spice_mustard';
  if (s.includes('aniseed') || s.includes('star')) return 'spice_aniseed';
  if (s.includes('cayenne')) return 'spice_cayenne';
  if (s.includes('chili') && (s.includes('crush') || s.includes('whole') || s.includes('extra hot'))) return 'spice_chili';

  return 'other';
}

// Get specific flavors/variants
const FLAVOR_LIST = [
  'unsalted', 'salted', 'raw', 'honey', 'spicy', 'chili', 'truffle', 'hickory', 'smoke',
  'caramel', 'cheese', 'coffee', 'sesame', 'wasabi', 'garlic', 'onion', 'pepper', 'coconut',
  'cinnamon', 'dark', 'milk', 'matcha', 'yogurt', 'strawberry', 'berry', 'creamy', 'crunchy',
  'sweet', 'salted caramel', 'salt pepper'
];

function getFlavors(str) {
  const s = norm(str);
  const found = [];
  if (s.includes('unsalted') || s.includes('n s') || s.includes('khong muoi')) found.push('unsalted');
  else if (s.includes('salted') || s.includes('r s') || s.includes('co muoi')) found.push('salted');
  
  if (s.includes('raw') || s.includes('song')) found.push('raw');
  if (s.includes('honey') || s.includes('mat ong')) found.push('honey');
  if (s.includes('truffle')) found.push('truffle');
  if (s.includes('smoke') || s.includes('hickory')) found.push('smoke');
  if (s.includes('spicy') || s.includes('chili') || s.includes('cay')) found.push('spicy');
  if (s.includes('caramel')) found.push('caramel');
  if (s.includes('cheese')) found.push('cheese');
  if (s.includes('coffee') || s.includes('ca phe')) found.push('coffee');
  if (s.includes('sesame') || s.includes('me')) found.push('sesame');
  if (s.includes('wasabi') || s.includes('mu tac')) found.push('wasabi');
  if (s.includes('garlic') || s.includes('toi')) found.push('garlic');
  if (s.includes('onion') || s.includes('hanh')) found.push('onion');
  if (s.includes('pepper') || s.includes('tieu')) found.push('pepper');
  if (s.includes('coconut') || s.includes('dua')) found.push('coconut');
  if (s.includes('dark')) found.push('dark');
  if (s.includes('milk')) found.push('milk');
  if (s.includes('matcha')) found.push('matcha');
  if (s.includes('creamy')) found.push('creamy');
  if (s.includes('crunchy')) found.push('crunchy');
  return found;
}

// Get specific sub-forms/types
function getForms(str) {
  const s = norm(str);
  const forms = [];
  if (s.includes('butter') || s.includes('bo')) forms.push('butter');
  if (s.includes('bagel')) forms.push('bagel');
  if (s.includes('cookie')) forms.push('cookie');
  if (s.includes('bar')) forms.push('bar');
  if (s.includes('puck')) forms.push('puck');
  if (s.includes('cluster')) forms.push('cluster');
  if (s.includes('bites') || s.includes('protein')) forms.push('bites');
  return forms;
}

// 100% strict match logic
function find100PercentMatch(sku, images) {
  const nameNorm = norm(sku.name);
  const category = getCategory(sku.name);
  const skuWeight = parseWeightInGrams(sku.name);
  const skuFlavors = getFlavors(sku.name);
  const skuForms = getForms(sku.name);

  // Filter candidates strictly
  const candidates = images.filter(img => {
    const imgNorm = norm(img.rel);
    const imgCat = getCategory(img.rel);

    // 1. Category MUST match 100%
    if (category !== imgCat) return false;

    // 1b. Specific product line tokens MUST match
    const lineTokens = ['multigrain', 'fruit', 'super mac', 'fancy', 'harvest tyme', 'daily nut', 'beanies', 'maple'];
    for (const t of lineTokens) {
      const skuHas = nameNorm.includes(t);
      const imgHas = imgNorm.includes(t);
      if (skuHas !== imgHas) return false;
    }

    // 2. Forms MUST match 100% (e.g. butter vs nut, bar vs nut, cookie vs nut)
    const imgForms = getForms(img.rel);
    for (const f of skuForms) {
      if (!imgForms.includes(f)) return false;
    }
    for (const f of imgForms) {
      if (!skuForms.includes(f)) return false;
    }

    // 3. Flavors MUST match 100%
    const imgFlavors = getFlavors(img.rel);
    for (const f of skuFlavors) {
      if (!imgFlavors.includes(f)) return false;
    }
    for (const f of imgFlavors) {
      if (!skuFlavors.includes(f)) return false;
    }

    // 4. Weight MUST match 100%
    if (skuWeight !== null) {
      const imgWeight = parseWeightInGrams(img.filename) || parseWeightInGrams(img.rel);
      if (imgWeight !== null) {
        const diff = Math.abs(skuWeight - imgWeight);
        // Strict weight match (max 5g diff for ~450g/454g)
        if (diff > 5 && !(skuWeight === 450 && imgWeight === 454) && !(skuWeight === 454 && imgWeight === 450) && !(skuWeight === 1130 && imgWeight === 1134)) {
          return false;
        }
      } else {
        return false;
      }
    } else {
      // If SKU has NO weight specified, image CANNOT have a specific weight
      const imgWeight = parseWeightInGrams(img.filename) || parseWeightInGrams(img.rel);
      if (imgWeight !== null) return false;
    }

    return true;
  });

  if (candidates.length === 1) {
    return candidates[0];
  } else if (candidates.length > 1) {
    // Exact name match
    const exact = candidates.find(c => norm(c.filename) === nameNorm);
    if (exact) return exact;
  }

  return null;
}

async function main() {
  console.log('\n🔍 Fetching all Vietfoods SKUs...');
  const skus = await apiFetch('/skus?branch_id=br_vietfoods&limit=1000');
  console.log(`Total SKUs: ${skus.length}`);

  console.log('\n🖼️ Scanning images in local folder...');
  const images = scanImages(IMG_ROOT);
  console.log(`Total local images: ${images.length}`);

  const matched = [];
  const unassigned = [];

  for (const sku of skus) {
    const match = find100PercentMatch(sku, images);
    if (match) {
      matched.push({ sku, match });
    } else {
      unassigned.push(sku);
    }
  }

  console.log('\n' + '='.repeat(80));
  console.log(`🎯 100% CERTAIN MATCHES (${matched.length} items):`);
  console.log('='.repeat(80));
  matched.forEach(({ sku, match }, idx) => {
    console.log(`${(idx + 1).toString().padStart(2)}. [${sku.code}] "${sku.name}"`);
    console.log(`    --> ${match.rel}`);
  });

  console.log('\n' + '='.repeat(80));
  console.log(`⚠️ UNASSIGNED / SKIPPED (${unassigned.length} items - No 100% match found):`);
  console.log('='.repeat(80));
  unassigned.forEach((sku, idx) => {
    console.log(`${(idx + 1).toString().padStart(2)}. [${sku.code}] "${sku.name}"`);
  });

  if (!COMMIT) {
    console.log('\nℹ️ DRY-RUN complete. Run with --commit to upload & update database.\n');
    return;
  }

  console.log('\n🚀 Uploading & assigning 100% matched images...');
  let successCount = 0;
  for (const { sku, match } of matched) {
    try {
      const imageUrl = await uploadImage(match.path);
      await apiFetch(`/skus/${sku.id}/update`, 'POST', { image: imageUrl });
      console.log(`✅ [${sku.code}] Updated image for ${sku.name}`);
      successCount++;
    } catch (err) {
      console.error(`❌ [${sku.code}] Failed to update image: ${err.message}`);
    }
  }

  console.log(`\n🎉 DONE! Successfully assigned ${successCount} images with 100% certainty.`);
}

main().catch(console.error);
