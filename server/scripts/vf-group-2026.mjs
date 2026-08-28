// ============================================================
// VIETFOODS 2026 — gán Nhóm hàng (category) cho toàn bộ SKU
//   node server/scripts/vf-group-2026.mjs            → dry-run (xem phân bố)
//   node server/scripts/vf-group-2026.mjs --commit   → ghi vào server
// ============================================================
const BASE   = 'https://api.dandpakpos.io.vn/api';
const TOKEN  = 'tk_729e57390b0d19fa60a2c2b942ea4fc79cc725ea9b8b4dfd';
const BRANCH = 'br_vietfoods';
const COMMIT = process.argv.includes('--commit');
const H = { Authorization: `Bearer ${TOKEN}`, 'x-branch-id': BRANCH, 'Content-Type': 'application/json' };

const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const has = (s, ...w) => w.some(x => s.includes(x));

// Ưu tiên từ trên xuống: loại sản phẩm đặc thù trước, rồi tới loại hạt.
function categorize(rawName) {
  const n = norm(rawName);

  if (has(n, 'set ', 'ngua do', 'gift', 'hop qua')) return 'Hộp Quà';
  if (has(n, 'beverage', 'drink')) return 'Đồ Uống';

  // Gia vị
  if (has(n, 'pepper', 'garlic', 'onion', 'cinnamon', 'aniseed', 'oregano', 'thyme',
    'cumin', 'turmeric', 'ginger ground', 'parsley', 'rosemary', 'cayenne', 'mustard',
    'chili, ', 'chili crush', 'seasoning salt', 'granule', 'powder')) return 'Gia Vị';

  // Bơ hạt
  if (has(n, 'butter', ' bo ', 'creamy', 'crunchy natural', 'pastuerise')) return 'Bơ Hạt';

  // Socola
  if (has(n, 'chocolate', 'socola', 'matcha', 'yogurt')) return 'Socola';

  // Granola & yến mạch
  if (has(n, 'granola', 'oat', 'yen mach')) return 'Granola & Yến Mạch';

  // Bắp rang
  if (has(n, 'popcorn', 'bap rang', 'puck')) return 'Bắp Rang';

  // Bánh & Cookies
  if (has(n, 'cookie', 'protein bite', 'pancake', 'banh')) return 'Bánh & Cookies';

  // Cluster / thanh giòn
  if (has(n, 'cluster', 'cluser', 'brittle', 'cracker', 'crepe')) return 'Cluster & Thanh Giòn';

  // Trái cây sấy
  if (has(n, 'raisin', 'cranberry', 'blueberry', 'mango', 'apricot', 'prune',
    'ginger', 'dried', 'chuoi', 'nho kho', 'trai cay')) return 'Trái Cây Sấy';

  // Đậu & rau củ
  if (has(n, 'pea', 'vegetable', 'rau cu', 'dau ')) {
    if (has(n, 'peanut')) { /* peanut → xuống nhóm đậu phộng */ } else return 'Đậu & Rau Củ';
  }

  // Thập cẩm
  if (has(n, 'fancy', 'mixed', 'daily nut', 'trial mix', 'harvest', 'premium nut',
    'snax mix', 'thap cam', 'beanie', 'beanis')) return 'Thập Cẩm Hạt';

  // Loại hạt
  if (has(n, 'pistachio', 'pistaschio', 'pistacshio', 'de cuoi')) return 'Hạt Dẻ Cười';
  if (has(n, 'macadamia', 'mac ca')) return 'Hạt Mắc Ca';
  if (has(n, 'walnut', 'oc cho')) return 'Óc Chó';
  if (has(n, 'pecan', 'hazelnut', 'hat phi')) return 'Các Loại Hạt Khác';
  if (has(n, 'peanut', 'dau phong')) return 'Đậu Phộng';
  if (has(n, 'almond', 'hanh nhan')) return 'Hạnh Nhân';
  if (has(n, 'cashew', 'casahew', 'bagel', 'dieu', 'bo dieu', 'rm180', 'dvl rm', 'ww180', 'w240', 'w320')) return 'Hạt Điều';

  return 'Khác';
}

async function api(path, method = 'GET', body = null) {
  const r = await fetch(`${BASE}${path}`, { method, headers: H, ...(body ? { body: JSON.stringify(body) } : {}) });
  const t = await r.text();
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status}: ${t.slice(0, 150)}`);
  return t ? JSON.parse(t) : {};
}

async function main() {
  const skus = (await api(`/skus?branch_id=${BRANCH}&limit=2000`)).filter(s => s.active);
  const groups = {};
  const plan = [];
  for (const s of skus) {
    const cat = categorize(s.name);
    (groups[cat] ||= []).push(s.name);
    if (norm(s.category) !== norm(cat)) plan.push({ s, cat });
  }

  console.log(`\n📊 PHÂN BỐ NHÓM (${skus.length} SKU):`);
  for (const [g, arr] of Object.entries(groups).sort((a, b) => b[1].length - a[1].length))
    console.log(`   ${String(arr.length).padStart(3)}  ${g}`);

  const other = groups['Khác'] || [];
  if (other.length) { console.log(`\n⚠️  Chưa phân loại (${other.length}):`); other.forEach(n => console.log(`      · ${n}`)); }

  console.log(`\n✏️  Cần cập nhật category: ${plan.length}/${skus.length}`);
  if (!COMMIT) { console.log('\nDRY-RUN. Thêm --commit để ghi.\n'); return; }

  let ok = 0, fail = 0;
  for (const { s, cat } of plan) {
    try { await api(`/skus/${s.id}/update`, 'POST', { category: cat }); ok++; }
    catch (e) { console.error(`   ❌ ${s.name}: ${e.message}`); fail++; }
  }
  console.log(`\n🎉 DONE. updated=${ok} failed=${fail}`);
}
main().catch(e => { console.error('FATAL:', e); process.exit(1); });
