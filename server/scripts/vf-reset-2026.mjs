// ============================================================
// VIETFOODS RESET — xóa sạch (soft-delete) toàn bộ SKU cũ rồi tạo mới từ bảng.
//   node server/scripts/vf-reset-2026.mjs            → dry-run
//   node server/scripts/vf-reset-2026.mjs --commit   → thực thi
// Nguồn: D:\DTrash\vietfoods_reset_2026.md  (code|barcode|name|qty|price)
// Quy tắc: giữ TÊN/MÃ/GIÁ đúng bảng; VAT=8%, giá gồm VAT; giá vào bảng P4 + giá
// chung. Trùng mã → gộp qty (giữ dòng đầu). Trùng mã vạch (khác mã) → mã vạch
// để trống cho dòng sau. Mã vạch có dấu cách → bỏ dấu cách.
// ============================================================
import { readFileSync } from 'node:fs';

const BASE   = 'https://api.dandpakpos.io.vn/api';
const TOKEN  = 'tk_729e57390b0d19fa60a2c2b942ea4fc79cc725ea9b8b4dfd';
const BRANCH = 'br_vietfoods';
const WH     = 'br_vietfoods_wh_vf';
const PB_P4  = 'pb_8cf237a1c53d69c55a';
const FILE   = 'D:\\DTrash\\vietfoods_reset_2026.md';
const COMMIT = process.argv.includes('--commit');
const H = { Authorization: `Bearer ${TOKEN}`, 'x-branch-id': BRANCH, 'Content-Type': 'application/json' };

const clean = v => String(v ?? '').replace(/\s+/g, ' ').trim();
const normBc = v => { const s = clean(v).replace(/\s+/g, ''); return (!s || s === '-' || s === '0') ? '' : s; };
const money = v => { const n = parseInt(String(v).replace(/[^\d]/g, ''), 10); return Number.isFinite(n) ? n : 0; };

async function api(path, method = 'GET', body = null) {
  const r = await fetch(`${BASE}${path}`, { method, headers: H, ...(body ? { body: JSON.stringify(body) } : {}) });
  const t = await r.text();
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status}: ${t.slice(0, 160)}`);
  return t ? JSON.parse(t) : {};
}

function parseFile() {
  const lines = readFileSync(FILE, 'utf8').split('\n').map(l => l.trim()).filter(Boolean);
  lines.shift(); // header
  const rows = [];
  for (const l of lines) {
    const [code, barcode, name, qty, price] = l.split('|');
    if (!clean(name)) continue;
    rows.push({ code: clean(code), barcode: normBc(barcode), name: clean(name), qty: money(qty), price: money(price) });
  }
  return rows;
}

// KHÔNG gộp: giữ TẤT CẢ dòng làm SKU riêng. Mã hàng trùng thì bản sau thêm hậu
// tố -2/-3 (hệ thống không cho 2 SKU cùng mã). Ghi lại các mã bị đổi.
function dedupeByCode(rows) {
  const seen = new Map();       // code gốc -> số lần đã dùng
  const mergeLog = [];          // ở đây = log các mã bị thêm hậu tố
  const products = [];
  for (const r of rows) {
    let code = r.code;
    if (code) {
      const n = (seen.get(code) || 0) + 1;
      seen.set(code, n);
      if (n > 1) {
        const newCode = `${code}-${n}`;
        mergeLog.push(`[${code}] lặp lần ${n}: "${r.name}" → đổi mã thành ${newCode} (mã hàng phải duy nhất)`);
        code = newCode;
      }
    }
    products.push({ ...r, code });
  }
  return { products, mergeLog };
}

async function main() {
  const rows = parseFile();
  const { products, mergeLog } = dedupeByCode(rows);

  // Xử lý trùng mã vạch (khác mã): mã vạch đầu giữ, sau để trống.
  const usedBar = new Set();
  const barDropped = [];
  for (const p of products) {
    if (p.barcode) {
      if (usedBar.has(p.barcode)) { barDropped.push(`[${p.code}] "${p.name}" mã vạch ${p.barcode} (đã thuộc SP khác) → để trống`); p.barcode = ''; }
      else usedBar.add(p.barcode);
    }
  }

  const cur = (await api(`/skus?branch_id=${BRANCH}&limit=2000`)).filter(s => s.active);
  console.log(`\n📊 KẾ HOẠCH RESET (tạo hết, không gộp):`);
  console.log(`   Đọc từ bảng     : ${rows.length} dòng`);
  console.log(`   Sẽ TẠO MỚI      : ${products.length} SKU`);
  console.log(`   Mã đổi hậu tố   : ${mergeLog.length} (mã hàng lặp)`);
  console.log(`   Mã vạch để trống: ${barDropped.length}`);
  console.log(`   Sẽ XÓA (soft)   : ${cur.length} SKU đang có`);
  console.log(`\n--- MÃ HÀNG LẶP (đổi hậu tố) ---`); mergeLog.forEach(m => console.log('  ' + m));
  console.log(`\n--- MÃ VẠCH ĐỂ TRỐNG ---`); barDropped.forEach(b => console.log('  ' + b));

  if (!COMMIT) { console.log('\nDRY-RUN. Thêm --commit để xóa + tạo thật.\n'); return; }

  // 1) SOFT-DELETE toàn bộ SKU đang có
  console.log('\n🗑️  Đang xóa SKU cũ...');
  let del = 0, delFail = 0;
  for (const s of cur) {
    try { await api(`/skus/${s.id}/delete`, 'POST', {}); del++; }
    catch (e) { console.error(`   ❌ xóa ${s.code}: ${e.message}`); delFail++; }
  }
  console.log(`   Đã xóa: ${del} | lỗi: ${delFail}`);

  // 2) TẠO MỚI
  console.log('\n🆕 Đang tạo SKU mới...');
  let ok = 0, fail = 0;
  for (const p of products) {
    try {
      const res = await api('/skus', 'POST', {
        code: p.code || undefined, barcode: p.barcode || undefined, name: p.name,
        unit: 'cái', warehouse_id: WH, branch_id: BRANCH, stock: p.qty || 0,
        price: p.price || 0, cost: 0, active: 1, emoji: '🛍️',
        vat: 8, price_includes_vat: 1, brand: 'Dan D Pak',
      });
      const id = res.id || res.sku?.id;
      if (id && p.price > 0) await api('/warehouse/price-book/entry', 'POST', { book_id: PB_P4, sku_id: id, price: p.price });
      ok++;
    } catch (e) { console.error(`   ❌ tạo [${p.code}] ${p.name}: ${e.message}`); fail++; }
  }
  console.log(`\n🎉 XONG. Xóa=${del} | Tạo=${ok} | Lỗi tạo=${fail}`);
}
main().catch(e => { console.error('FATAL:', e); process.exit(1); });
