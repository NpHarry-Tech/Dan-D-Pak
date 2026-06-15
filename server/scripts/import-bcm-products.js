import { db, migrate, now, audit } from '../db.js';

const BASE = 'https://bcmarketing.vn';
const COLLECTION = `${BASE}/collections/all/products.json`;
const BRANCH_ID = 'br1';
const WAREHOUSE_ID = 'wh_retail';
const USER_AGENT = 'Mozilla/5.0 (POS/ERP BCM importer)';

function cleanText(v, fallback = '') {
  return String(v ?? fallback).trim();
}

function moneyToInt(v) {
  const n = parseFloat(String(v ?? '0').replace(/[^\d.]/g, ''));
  return Number.isFinite(n) ? Math.round(n) : 0;
}

function imageFor(product, variant) {
  const images = Array.isArray(product.images) ? product.images : [];
  const byVariant = variant?.image_id ? images.find(img => String(img.id) === String(variant.image_id)) : null;
  return byVariant?.src || product.image?.src || images[0]?.src || null;
}

function productUrl(product) {
  return product.handle ? `${BASE}/products/${product.handle}` : BASE;
}

function skuId(product, variant) {
  return `bcm_${variant?.id || product.id}`;
}

function skuName(product, variant) {
  const title = cleanText(product.title, 'BCM product');
  const variantTitle = cleanText(variant?.title);
  if (!variantTitle || variantTitle === 'Default Title') return title;
  return `${title} - ${variantTitle}`;
}

async function fetchProducts() {
  const products = [];
  const seen = new Set();
  for (let page = 1; page <= 100; page++) {
    const url = `${COLLECTION}?limit=250&page=${page}`;
    const res = await fetch(url, { headers: { 'user-agent': USER_AGENT, accept: 'application/json' } });
    if (!res.ok) throw new Error(`BCM fetch failed page ${page}: HTTP ${res.status}`);
    const data = await res.json();
    const rows = Array.isArray(data.products) ? data.products : [];
    if (!rows.length) break;
    for (const product of rows) {
      if (!product?.id || seen.has(product.id)) continue;
      seen.add(product.id);
      products.push(product);
    }
    if (rows.length < 50) break;
  }
  return products;
}

function upsertSku(product, variant) {
  const id = skuId(product, variant);
  const barcode = cleanText(variant?.barcode) || cleanText(variant?.sku) || `BCM-${variant?.id || product.id}`;
  const name = skuName(product, variant);
  const price = moneyToInt(variant?.price);
  const category = cleanText(product.product_type, 'BCM');
  const supplier = cleanText(product.vendor, 'BC Marketing');
  const image = imageFor(product, variant);
  const sourceUrl = productUrl(product);

  db.prepare(`
    INSERT INTO skus
      (id,branch_id,barcode,name,emoji,image,price,cost,stock,min_stock,unit,warehouse_id,category,supplier,source_url,track_lot,expiry_required,active,units_json)
    VALUES
      (?,?,?,?,?,?,?,?,0,0,?,?,?,?,?,1,0,1,'[]')
    ON CONFLICT(id) DO UPDATE SET
      barcode=excluded.barcode,
      name=excluded.name,
      emoji=excluded.emoji,
      image=excluded.image,
      price=excluded.price,
      unit=excluded.unit,
      warehouse_id=excluded.warehouse_id,
      category=excluded.category,
      supplier=excluded.supplier,
      source_url=excluded.source_url,
      active=1
  `).run(
    id,
    BRANCH_ID,
    barcode,
    name,
    '🛍️',
    image,
    price,
    0,
    'cái',
    WAREHOUSE_ID,
    category,
    supplier,
    sourceUrl,
  );
  return { id, name, price, image, sourceUrl };
}

async function main() {
  migrate();
  const products = await fetchProducts();
  let imported = 0;
  for (const product of products) {
    const variants = Array.isArray(product.variants) && product.variants.length ? product.variants : [null];
    for (const variant of variants) {
      upsertSku(product, variant);
      imported++;
    }
  }
  audit('bcm.import', { products: products.length, skus: imported, source: COLLECTION, at: now() }, BRANCH_ID);
  console.log(`Imported ${imported} BCM SKUs from ${products.length} products into Kho BCM (${WAREHOUSE_ID}).`);
}

main().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
