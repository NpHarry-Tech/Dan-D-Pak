// ============================================================
// SYNC VIETFOODS FULL & CLEAN
// Node script to clean names, set stock, set VAT=8%, clear images, set P4 price
// ============================================================
import { readFileSync } from 'node:fs';

const BASE     = 'https://api.dandpakpos.io.vn/api';
const TOKEN    = 'tk_729e57390b0d19fa60a2c2b942ea4fc79cc725ea9b8b4dfd';
const BRANCH   = 'br_vietfoods';
const WH       = 'br_vietfoods_wh_vf';
const PB_P4    = 'pb_8cf237a1c53d69c55a';
const MD_FILE  = 'D:\\DTrash\\san_pham_vietfoods_2026.md';
const COMMIT   = process.argv.includes('--commit');

const H = {
  'Authorization': `Bearer ${TOKEN}`,
  'x-branch-id': BRANCH,
  'Content-Type': 'application/json',
};

function clean(v) { return String(v ?? '').replace(/\s+/g, ' ').trim(); }

function parsePrice(v) {
  if (!v) return 0;
  const s = clean(v).replace(/[^\d.]/g, '');
  const n = parseFloat(s);
  return Number.isFinite(n) ? Math.round(n) : 0;
}

function parseQty(v) {
  if (!v) return 0;
  // Handle formats like "1 túi (28 gói)", "240", "84", "0"
  const s = clean(v);
  const matchTuiGoi = s.match(/(\d+)\s*túi\s*\((\d+)\s*gói\)/i);
  if (matchTuiGoi) {
    return parseInt(matchTuiGoi[1]) * parseInt(matchTuiGoi[2]);
  }
  const matchNum = s.match(/(\d+)/);
  return matchNum ? parseInt(matchNum[1]) : 0;
}

function parseMdTable(text) {
  const rows = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line.startsWith('|')) continue;
    const cells = line.slice(1, line.endsWith('|') ? -1 : undefined)
      .split('|').map(c => c.replace(/<br>/gi, ' ').trim());
    if (cells.every(c => /^[-:]+$/.test(c))) continue;
    rows.push(cells);
  }
  return rows;
}

async function apiFetch(path, method = 'GET', body = null) {
  const opts = { method, headers: { ...H }, ...(body ? { body: JSON.stringify(body) } : {}) };
  const r = await fetch(`${BASE}${path}`, opts);
  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`${method} ${path} → ${r.status}: ${txt.slice(0, 200)}`);
  }
  return r.json();
}

function parseProducts(mdText) {
  const rows = parseMdTable(mdText);
  const skipLog = [];
  const rawProducts = [];

  const SKIP_EXACT_NAMES = new Set([
    'Cat.', 'SKU', 'Code', 'Barcode',
    'Hộp Thiếc', 'Hộp Bánh Trưng Bày', 'Điều Tươi Còn Vỏ',
    'Cookies (Pecan, Cashew Chocola, Pistachios) 8x3x24g',
    'Box_Pistachios Cookies (25x18 thanh)', 'Bag Puck 12 túi mix',
    'Pistachios Beverage', 'Sliced Almonds Natural / Balanched', 'Silved Almonds Natural / Balanched',
    'Diced Almonds 4 - 5mm; 2-4mm, 5- 8mm', 'Diced Pistacshios 4 - 5mm; 2-4mm, 5- 8mm',
    'Butter Almonds Diced', 'Butter Pecan Diced', 'Butter Pistachios Diced',
    'Butter Walnuts Diced', 'Butter Cashews Diced',
    'All Day Breakfast Oatmeal 12/7/50g',
    'Pancake almond', 'Pancake macadamia', 'Pancake pistachios',
    'Set Oval Cam', 'Cashew W 180 unsalted', 'Almond unsalted', 'Pistachios', 'Peanut snax mix 650g',
    'Cluster almond cashew & cranberry 170g', 'Beanis 200g',
    'Cashew truffle 180g', 'Cluster pumpkin 130g',
  ]);

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (row.length < 5) continue;
    const [cat, rawCode, rawBarcode, rawName, rawPackSize, dvt, rawGiaNiemYet, rawGiaThung, rawGiaP3, rawQty, note] = row;
    
    const code = clean(rawCode);
    const barcode = clean(rawBarcode);
    const name = clean(rawName);
    const packSize = clean(rawPackSize);
    const unit = clean(dvt) || 'Gói';
    const qty = parseQty(rawQty);
    const priceNiemYet = parsePrice(rawGiaNiemYet);
    const priceP3 = parsePrice(rawGiaP3);
    const price = priceNiemYet > 0 ? priceNiemYet : priceP3;

    // Filter criteria
    if (!name || SKIP_EXACT_NAMES.has(name)) {
      if (name && name !== 'Cat.' && name !== 'SKU') skipLog.push(`Dòng ${i+1}: "${name}" -> Tên không hợp lệ hoặc thuộc danh sách bỏ qua`);
      continue;
    }

    if (code === 'Code' || barcode === 'Barcode' || name === 'SKU') continue;

    // Skip section headers or empty code & barcode rows
    if (!code && !barcode) {
      skipLog.push(`Dòng ${i+1}: "${name}" -> Không có mã sp (Code) lẫn mã vạch (Barcode)`);
      continue;
    }

    if (code === '-' || barcode === '-' || /mockup/i.test(code) || /mockup/i.test(barcode)) {
      skipLog.push(`Dòng ${i+1}: "${name}" [code=${code}, barcode=${barcode}] -> Hàng Mockup / mã tạm`);
      continue;
    }

    if (note && /Set \d/i.test(note)) {
      skipLog.push(`Dòng ${i+1}: "${name}" [${code}] -> Set Hermes bag tham chiếu`);
      continue;
    }

    if (/HCK/i.test(note || '') || /HCK/i.test(name)) {
      skipLog.push(`Dòng ${i+1}: "${name}" [${code}] -> Hàng xả kho HCK nội bộ`);
      continue;
    }

    // Standardize Name: "Name (PackSize)"
    let cleanName = name
      .replace(/^\d+[-\s]+/, '')         // strip leading "1- ", "2- "
      .replace(/\s*\(nội địa\)/i, '')    // strip (nội địa)
      .replace(/\s*nội địa\s*/i, '')
      .replace(/\s+\(?\d+\.?\d*\s*(?:kg|g)\)?\s*$/i, '') 
      .replace(/\s+\d+\/\d+\.?\d*\s*(?:kg|g)r?\s*$/i, '')
      .trim();

    let finalName = cleanName;
    if (packSize) {
      const psNorm = packSize.toLowerCase();
      const cnNorm = cleanName.toLowerCase();
      if (!cnNorm.includes(psNorm)) {
        finalName = `${cleanName} (${packSize})`;
      }
    }

    rawProducts.push({
      line: i + 1,
      code,
      barcode: barcode === '0' ? '' : barcode,
      name: finalName,
      rawName: name,
      packSize,
      unit,
      qty,
      price,
    });
  }

  // Aggregate stock & deduplicate products by code / barcode
  const aggregated = new Map();
  for (const p of rawProducts) {
    const key = (p.code || '') + '|' + (p.barcode || '');
    if (!aggregated.has(key)) {
      aggregated.set(key, { ...p });
    } else {
      const existing = aggregated.get(key);
      existing.qty += p.qty; // sum stock
      if (p.price > 0 && existing.price === 0) existing.price = p.price;
      if (p.unit && !existing.unit) existing.unit = p.unit;
    }
  }

  return { products: Array.from(aggregated.values()), skipLog };
}

async function main() {
  console.log('📖 Parsing Markdown Inventory File...');
  const mdText = readFileSync(MD_FILE, 'utf8');
  const { products, skipLog } = parseProducts(mdText);

  console.log(`\n============================================================`);
  console.log(`📊 ĐÃ PHÂN TÍCH: ${products.length} SẢN PHẨM HỢP LỆ TRONG FILE`);
  console.log(`⚠️ ĐÃ BỎ QUA: ${skipLog.length} DÒNG KHÔNG ĐỦ TIÊU CHUẨN SẢN PHẨM:`);
  skipLog.forEach(s => console.log(`   - ${s}`));
  console.log(`============================================================\n`);

  console.log('🔍 Fetching existing Vietfoods SKUs from DB...');
  const dbSkus = await apiFetch('/skus?branch_id=br_vietfoods&limit=1000');
  console.log(`   Có ${dbSkus.length} SKU trong DB chi nhánh Vietfoods.\n`);

  const dbByCode = new Map(dbSkus.filter(s => s.code).map(s => [clean(s.code).toLowerCase(), s]));
  const dbByBarcode = new Map(dbSkus.filter(s => s.barcode).map(s => [clean(s.barcode).replace(/\s/g, '').toLowerCase(), s]));

  let updatedCount = 0;
  let createdCount = 0;
  let clearedImageCount = 0;

  for (const p of products) {
    const codeKey = p.code.toLowerCase();
    const barcodeKey = p.barcode.replace(/\s/g, '').toLowerCase();
    const existing = (codeKey && dbByCode.get(codeKey)) || (barcodeKey && dbByBarcode.get(barcodeKey));

    if (existing) {
      updatedCount++;
      if (existing.image) clearedImageCount++;
      if (!COMMIT) {
        console.log(`   ✏️ [UPDATE] ${existing.code || existing.barcode}: "${existing.name}" -> "${p.name}" | Stock: ${existing.stock} -> ${p.qty} | Price: ${p.price} | VAT: 8% | Img: CLEARED`);
      }
    } else {
      createdCount++;
      if (!COMMIT) {
        console.log(`   🆕 [CREATE] ${p.code || p.barcode}: "${p.name}" | Stock: ${p.qty} | Price: ${p.price} | VAT: 8% | Brand: Dan D Pak`);
      }
    }
  }

  console.log(`\n============================================================`);
  console.log(`SUMMARY OF OPERATIONS (${COMMIT ? 'EXECUTING' : 'DRY-RUN'}):`);
  console.log(`   - Cập nhật: ${updatedCount} SKU`);
  console.log(`   - Tạo mới: ${createdCount} SKU`);
  console.log(`   - Xóa hình ảnh: ${clearedImageCount} SKU`);
  console.log(`   - Set VAT = 8% cho 100% sản phẩm`);
  console.log(`   - Set Brand = "Dan D Pak" cho 100% sản phẩm`);
  console.log(`============================================================\n`);

  if (!COMMIT) {
    console.log('📌 DRY-RUN hoàn tất. Chạy lại với --commit để thực hiện lưu vào Database.\n');
    return;
  }

  // EXECUTE
  console.log('🚀 EXECUTING DATABASE UPDATES...');
  for (const p of products) {
    const codeKey = p.code.toLowerCase();
    const barcodeKey = p.barcode.replace(/\s/g, '').toLowerCase();
    const existing = (codeKey && dbByCode.get(codeKey)) || (barcodeKey && dbByBarcode.get(barcodeKey));

    const payload = {
      name: p.name,
      code: p.code || undefined,
      barcode: p.barcode || undefined,
      unit: p.unit || 'Gói',
      stock: p.qty,
      price: p.price,
      vat: 8,
      price_includes_vat: 1,
      brand: 'Dan D Pak',
      image: null, // CLEAR IMAGE
      branch_id: BRANCH,
      warehouse_id: WH,
    };

    if (existing) {
      await apiFetch(`/skus/${existing.id}/update`, 'POST', payload);
      // Set P4 price book
      if (p.price > 0) {
        try {
          await apiFetch('/warehouse/price-book/entry', 'POST', {
            book_id: PB_P4,
            sku_id: existing.id,
            price: p.price,
          });
        } catch {}
      }
      console.log(`   ✅ Updated [${existing.code}]: ${p.name}`);
    } else {
      const res = await apiFetch('/skus', 'POST', {
        ...payload,
        active: 1,
        emoji: '🛍️',
        cost: 0,
      });
      const skuId = res.id || res.sku?.id;
      if (skuId && p.price > 0) {
        try {
          await apiFetch('/warehouse/price-book/entry', 'POST', {
            book_id: PB_P4,
            sku_id: skuId,
            price: p.price,
          });
        } catch {}
      }
      console.log(`   ✅ Created [${p.code}]: ${p.name}`);
    }
  }

  console.log('\n🎉 SYNC COMPLETED SUCCESSFULLY!');
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
