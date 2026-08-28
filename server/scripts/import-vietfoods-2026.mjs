// ============================================================
// IMPORT VIETFOODS 2026 — đầy đủ: SKU + ảnh + bảng giá P4
// Chạy: node server/scripts/import-vietfoods-2026.mjs
//        node server/scripts/import-vietfoods-2026.mjs --commit
// ============================================================
import { readFileSync, readdirSync, existsSync, readFileSync as rf, mkdirSync } from 'node:fs';
import { join, extname, basename } from 'node:path';

const BASE     = 'https://api.dandpakpos.io.vn/api';
const TOKEN    = 'tk_729e57390b0d19fa60a2c2b942ea4fc79cc725ea9b8b4dfd';
const BRANCH   = 'br_vietfoods';
const WH       = 'br_vietfoods_wh_vf';
const PB_P4    = 'pb_8cf237a1c53d69c55a';
const IMG_ROOT = 'D:\\DTrash\\OneDrive_2026-08-04\\04 Product';
const MD_FILE  = 'D:\\DTrash\\san_pham_vietfoods_2026.md';
const COMMIT   = process.argv.includes('--commit');

const H = {
  'Authorization': `Bearer ${TOKEN}`,
  'x-branch-id': BRANCH,
  'Content-Type': 'application/json',
};

// ── helpers ────────────────────────────────────────────────
function clean(v) { return String(v ?? '').replace(/\s+/g, ' ').trim(); }
function moneyToInt(v) {
  const n = parseFloat(clean(v).replace(/[^\d.]/g, ''));
  return Number.isFinite(n) ? Math.round(n) : 0;
}

// Parse markdown table rows
function parseMdTable(text) {
  const rows = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line.startsWith('|')) continue;
    const cells = line.slice(1, line.endsWith('|') ? -1 : undefined)
      .split('|').map(c => c.replace(/<br>/gi, ' ').trim());
    if (cells.every(c => /^[-:]+$/.test(c))) continue; // separator
    rows.push(cells);
  }
  return rows;
}

// ── Product descriptions from DanOn ────────────────────────
const DESCRIPTIONS = {
  // Cashews
  'Cashew Truffle': 'Hạt điều rang vị nấm truffle thơm lừng, kết hợp giữa cái béo tự nhiên của hạt điều và hương truffle sang trọng. Lý tưởng cho những ai yêu thích vị umami đặc trưng.',
  'Cashew Smoke hickory': 'Hạt điều hun khói Hickory đậm đà, được chế biến bằng phương pháp hun khói truyền thống tạo nên lớp vỏ ngoài giòn tan với hương khói đặc trưng.',
  'Cashew Spicy': 'Hạt điều cay xé, dành cho người yêu thích vị cay nồng. Được ướp các gia vị cay tự nhiên, mang lại trải nghiệm ăn uống đầy kích thích.',
  'Cashew Coffee': 'Hạt điều cà phê thơm ngon, kết hợp hoàn hảo giữa vị béo ngậy của điều và hương thơm đặc trưng của cà phê rang xay tươi.',
  'Cashews Honey': 'Hạt điều mật ong vàng óng, được phủ một lớp mật ong tự nhiên ngọt ngào, mang lại cảm giác thư giãn dễ chịu mỗi khi thưởng thức.',
  'Cashews Salted': 'Hạt điều muối cao cấp Dan D Pak, được rang với lượng muối vừa phải giúp tôn lên vị ngọt béo tự nhiên của hạt điều. Không chất bảo quản.',
  'Cashews Unsalted': 'Hạt điều không muối, giữ nguyên vị béo ngậy thuần khiết của hạt điều. Lựa chọn lý tưởng cho người ăn kiêng và sức khỏe.',
  'Cashew Raw': 'Hạt điều sống nguyên chất, chưa qua chế biến nhiệt. Giàu chất béo không bão hòa, protein và khoáng chất thiết yếu.',
  'Cashew salted & pepper': 'Hạt điều muối tiêu đặc trưng, kết hợp vị mặn của muối biển và cay nhẹ của tiêu đen xay, tạo nên hương vị cân bằng hoàn hảo.',
  'Cashew chili': 'Hạt điều ớt cay, ướp ớt tự nhiên cho vị cay nồng đặc trưng. Snack lý tưởng cho những buổi tụ tập bạn bè.',
  'Bagel cashew': 'Bánh Bagel hạt điều độc đáo, kết hợp giữa hương vị truyền thống của bánh Bagel và sự béo ngậy của hạt điều rang. Giòn tan, thơm ngon.',
  // Almonds
  'Almond Raw': 'Hạnh nhân sống nguyên chất, nguồn dinh dưỡng tuyệt vời giàu vitamin E, magie và chất béo lành mạnh. Không qua chế biến, giữ nguyên dưỡng chất.',
  'Almond Salted': 'Hạnh nhân muối rang vừa, kết hợp vị mặn nhẹ nhàng với độ giòn tự nhiên của hạt. Phù hợp làm đồ ăn vặt lành mạnh mỗi ngày.',
  'Almonds, N/S': 'Hạnh nhân rang không muối, bảo toàn hương vị tự nhiên thuần khiết của hạt hạnh nhân. Không chất phụ gia, không chất bảo quản.',
  'Almonds Dark': 'Bơ hạnh nhân Dark tối màu, chứa hàm lượng chất béo cao và hương vị đậm đà đặc trưng của hạt nướng kỹ.',
  // Pistachios
  'Pistachios salted': 'Hạt dẻ cười rang muối - đặc sản của vùng Trung Đông. Được rang với muối biển tự nhiên, tạo nên vị mặn nhẹ và thơm ngon khó cưỡng.',
  'Pistachios chili': 'Hạt dẻ cười vị ớt cay, kết hợp hoàn hảo giữa vị béo của dẻ cười và hương cay nồng của ớt đỏ. Thách thức cho những ai thích đồ ăn cay.',
  'Pistachios Truffle': 'Hạt dẻ cười vị nấm truffle sang trọng. Sự kết hợp đặc biệt giữa dẻ cười và truffle tạo nên hương vị thượng hạng.',
  'Pistachios Salt & Pepper': 'Hạt dẻ cười muối tiêu, được ướp muối biển và tiêu đen xay thô cho vị đậm đà, phù hợp làm khai vị hoặc nhân bánh.',
  'Pistachios butter': 'Bơ hạt dẻ cười mịn mượt, được xay nhuyễn từ hạt dẻ cười rang tự nhiên. Giàu protein và chất béo không bão hòa đơn tốt cho tim mạch.',
  // Walnuts
  'Walnut Raw': 'Óc chó sống tươi, giàu omega-3, axit béo thiết yếu và chất chống oxy hóa. Hỗ trợ sức khỏe não bộ và tim mạch hiệu quả.',
  // Pecans
  'Pecan Raw': 'Hồ đào sống nguyên chất từ Bắc Mỹ, giàu chất béo đơn không bão hòa và polyphenols. Vị bơ đặc trưng và ngọt tự nhiên.',
  // Hazelnuts
  'Hazelnut Raw': 'Hạt phỉ sống nguyên chất, giàu vitamin E và axit folic. Hương vị thơm ngọt nhẹ, thường được dùng trong sô-cô-la và bánh kẹo cao cấp.',
  // Mixed & Granola
  'Fancy Nut Mix, R/S': 'Hỗn hợp hạt cao cấp Fancy - kết hợp điều, hạnh nhân, óc chó và hạt dẻ cười rang muối. Bữa ăn nhẹ đa dạng, giàu dinh dưỡng.',
  'Fancy Nut Mix, N/S': 'Hỗn hợp hạt cao cấp Fancy không muối - hỗn hợp các loại hạt tự nhiên không qua ướp muối, phù hợp cho người ăn kiêng.',
  'Granola Bar Cashews': 'Thanh granola hạt điều thơm ngon, được làm từ yến mạch, mật ong và hạt điều rang. Bữa sáng tiện lợi và bổ dưỡng.',
  'Granola Bar Almonds': 'Thanh granola hạnh nhân giòn rụm, giàu chất xơ và protein. Lý tưởng cho bữa ăn nhẹ năng động và đang chạy.',
  'Granola Bar Fruit and Nuts': 'Thanh granola trái cây hạt hỗn hợp, sự kết hợp hoàn hảo của yến mạch, trái cây sấy khô và các loại hạt tự nhiên.',
  'Rolled Oat': 'Yến mạch cán dẹt truyền thống, nguyên liệu tuyệt vời cho bữa sáng lành mạnh. Giàu chất xơ beta-glucan, hỗ trợ tiêu hóa và kiểm soát đường huyết.',
  'Instant Oat': 'Yến mạch hòa tan siêu tốc, chín ngay trong vài phút. Tiện lợi cho người bận rộn mà vẫn muốn bữa sáng lành mạnh.',
  'Quick Oat': 'Yến mạch nhanh, giữ nguyên giá trị dinh dưỡng của oat truyền thống với thời gian nấu ngắn hơn. Phù hợp cho cả ăn nóng lẫn làm overnight oats.',
  // Popcorn
  'Popcorn Cheese': 'Bắp rang phô mai thơm lừng, được phủ một lớp phô mai cheddar tan chảy. Giòn rụm, béo ngậy - snack không thể dừng ăn.',
  'Popcorn Caramel': 'Bắp rang caramel ngọt ngào, được áo một lớp caramel vàng bóng tinh tế. Kết hợp hoàn hảo giữa vị ngọt và giòn tan.',
  // Dried Fruits
  'Raisin Thompson': 'Nho khô Thompson seedless từ Mỹ, ngọt tự nhiên không thêm đường. Giàu sắt, kali và chất chống oxy hóa resveratrol.',
  'Raisin Golden': 'Nho khô vàng Golden, được sấy khô bằng lưu huỳnh tự nhiên để giữ màu vàng đẹp và vị ngọt đặc trưng. Ngon hơn nho khô thường.',
  'Dried Cranberries': 'Việt quất khô ngọt dịu, giàu anthocyanin và proanthocyanidin giúp hỗ trợ sức khỏe đường tiết niệu. Chua ngọt tự nhiên.',
  'Dried Blueberries': 'Blueberry khô từ Bắc Mỹ, đậm đặc chất chống oxy hóa. Vị ngọt chua dịu, thích hợp ăn trực tiếp hoặc thêm vào salad, granola.',
  'Dried Prunes': 'Mận sấy khô giàu chất xơ và kali, hỗ trợ hệ tiêu hóa lành mạnh. Ngọt tự nhiên, không thêm đường hay chất bảo quản.',
  'Dried Apricot': 'Mơ sấy khô màu cam rực rỡ, giàu beta-carotene và vitamin A. Vị ngọt chua đặc trưng, là thành phần hoàn hảo cho granola và salad.',
  'Mango Sweet': 'Xoài sấy ngọt từ Thái Lan, giữ nguyên hương vị tươi của xoài chín với độ ngọt tự nhiên. Không thêm đường hay chất tạo màu.',
  'Mango Spicy': 'Xoài sấy vị cay, kết hợp độ ngọt của xoài Thái với gia vị cay đặc trưng. Trải nghiệm vị giác độc đáo của Đông Nam Á.',
  'Cranberry': 'Việt quất đỏ (cranberry) sấy khô đóng hộp cao cấp, giàu vitamin C và chất chống oxy hóa. Chua ngọt dịu, dùng cho granola và salad.',
  'Ginger': 'Gừng sấy khô giòn tan, giữ nguyên tinh dầu gừng và vị cay nồng. Hỗ trợ tiêu hóa, chống buồn nôn và tăng cường miễn dịch.',
  // Chocolate
  'Milk Chocolate Almonds': 'Hạnh nhân phủ sô-cô-la sữa nguyên chất, kết hợp hoàn hảo giữa độ giòn tự nhiên của hạnh nhân và vị ngọt mịn của sô-cô-la sữa cao cấp.',
  'Dark Chocolate Almonds': 'Hạnh nhân phủ sô-cô-la đen cao cấp, dành cho người yêu thích vị đắng đặc trưng của dark chocolate kết hợp với giòn ngon của hạnh nhân.',
  'Strawberry Chocolate Almonds': 'Hạnh nhân phủ sô-cô-la dâu tây tươi mát, sự kết hợp phá cách giữa vị chua ngọt của dâu và sô-cô-la trắng mịn.',
  'Yogurt Chocolate Almonds': 'Hạnh nhân phủ sô-cô-la sữa chua, mang vị béo ngậy đặc trưng của yogurt kết hợp hạnh nhân giòn. Nhẹ nhàng và tinh tế.',
  'Matcha Chocolate Almonds': 'Hạnh nhân phủ sô-cô-la trà xanh matcha, hương vị Nhật Bản đặc trưng với vị đắng nhẹ và thơm của trà xanh hòa quyện sô-cô-la.',
  'Chocolate Blueberry Milk': 'Blueberry phủ sô-cô-la sữa, trái cây và sô-cô-la kết hợp hoàn hảo. Vị ngọt của blueberry khô được bọc trong lớp sô-cô-la mịn.',
  'Milk Chocolate Macadamia Caramel': 'Macadamia caramel phủ sô-cô-la sữa, ba lớp hương vị sang trọng: sô-cô-la mịn, caramel ngọt và mắc ca giòn béo.',
  // Butter
  'Peanut Creamy': 'Bơ đậu phộng mịn mượt, được xay từ 100% đậu phộng rang vàng không thêm đường hay muối. Nguồn protein và chất béo tốt cho sức khỏe.',
  'Peanut Crunchy': 'Bơ đậu phộng hạt, giữ lại những mảnh đậu phộng rang giòn trong bơ mịn. Texture độc đáo và hương vị đậm đà hơn bơ thường.',
  'Peanut Creamy Natural': 'Bơ đậu phộng mịn tự nhiên không thêm dầu hydro hóa hay phụ gia. Chỉ đậu phộng và muối - thuần khiết, lành mạnh.',
  'Peanut Crunchy Natural': 'Bơ đậu phộng hạt tự nhiên không phụ gia, kết hợp bơ mịn với mảnh đậu phộng rang giòn. Đơn giản, tự nhiên và dinh dưỡng.',
  'Pistachios butter': 'Bơ hạt dẻ cười thượng hạng, được xay từ hạt dẻ cười rang tự nhiên. Màu xanh đặc trưng và hương vị béo ngậy sang trọng.',
  // Spices
  'Cinnamon, Pure Ground': 'Quế xay thuần khiết từ quế Sri Lanka (Ceylon), ghi nhận là loại quế tốt nhất thế giới. Hương thơm ấm áp, vị ngọt nhẹ.',
  'Aniseeds, Whole Star': 'Hoa hồi nguyên hạt, gia vị không thể thiếu trong ẩm thực Á Đông và phương Tây. Hương thơm ngọt đặc trưng.',
  'Oregano, Rubbed, Whole': 'Oregano sấy khô nguyên lá, gia vị Mediterranean không thể thiếu trong pizza, pasta. Hương thơm đặc trưng của ẩm thực Ý.',
  'Thyme, Whole': 'Lá thyme sấy khô nguyên lá, thảo dược phổ biến trong ẩm thực Địa Trung Hải. Hương thơm mộc nhẹ nhàng, dùng cho thịt và súp.',
  'Cumin Seeds, Whole': 'Hạt thì là (cumin) nguyên hạt, gia vị thiết yếu của ẩm thực Ấn Độ, Trung Đông và Mexico. Rang hoặc giã nhuyễn khi dùng.',
  'Garlic, Powder': 'Tỏi bột xay mịn từ tỏi sấy khô nguyên chất. Tiện lợi, không nước mắt và có thể tích trữ lâu trong bếp.',
  'Garlic Granules': 'Tỏi hạt thô hơn bột tỏi, giữ được nhiều hương vị tự nhiên hơn. Dùng ướp thịt, xào hoặc nêm súp rất tiện.',
  'Onion Powder': 'Hành tây bột xay mịn, bổ sung ngay vị ngọt và hương của hành vào món ăn mà không cần thái hành. Tiết kiệm thời gian.',
  'Turmeric, Powder': 'Nghệ bột (turmeric) vàng rực, chứa curcumin - chất chống viêm và chống oxy hóa mạnh. Gia vị vàng của ẩm thực Ấn Độ.',
  'Ginger Ground': 'Gừng xay mịn từ gừng sấy, tiện dụng cho nấu nướng và làm bánh. Hương vị cay nồng ấm áp, hỗ trợ tiêu hóa.',
  'Pepper, Whole Black': 'Tiêu đen nguyên hạt loại cao cấp, xay tươi ngay khi dùng để có hương vị và tinh dầu tốt nhất. Cần thiết trong mọi căn bếp.',
  'Garlic Powder': 'Tỏi bột mịn đóng hủ lớn, tiện dụng cho bếp nhà hàng và gia đình. Hương vị tỏi đậm đà, không bị bay hơi nhanh.',
  'Onion Powder 12/500g': 'Bột hành tây đóng hủ 500g cho bếp chuyên nghiệp. Nguyên chất từ hành tây sấy khô, không phụ gia.',
  // Granola
  'Granola cashew cranberry': 'Granola hạt điều việt quất đỏ, kết hợp yến mạch rang vàng, hạt điều béo ngậy và việt quất khô chua ngọt. Một bữa sáng hoàn hảo.',
  'Granola fruity berry': 'Granola trái cây rừng, hỗn hợp yến mạch với các loại berry sấy khô đa màu sắc. Ngọt tự nhiên, không thêm đường.',
  'Granola Multygrain': 'Granola đa ngũ cốc cao cấp, kết hợp nhiều loại ngũ cốc nguyên hạt với hạt và mật ong. Bổ dưỡng và đa dạng hương vị.',
  'Fruit Granola': 'Granola trái cây đóng túi lớn, hỗn hợp yến mạch rang và trái cây sấy đa dạng. Dùng với kem, sữa chua hoặc ăn thẳng.',
  // Peanuts
  'Spicy Peanuts': 'Đậu phộng cay rang vàng, được ướp ớt và gia vị cay tự nhiên. Snack không thể thiếu khi xem phim hay tụ tập bạn bè.',
  'Butter Caramel Peanuts': 'Đậu phộng caramel bơ ngọt ngào, được phủ lớp caramel vàng mịn. Vị ngọt đặc trưng và giòn tan thú vị.',
  'Seasoned Peanuts': 'Đậu phộng gia vị đặc biệt, được ướp hỗn hợp gia vị độc quyền tạo nên hương vị phức tạp và hấp dẫn.',
  'Honey Peanuts': 'Đậu phộng mật ong ngọt thơm, phủ lớp mật ong vàng óng. Kết hợp giữa vị ngọt thanh của mật ong và béo ngậy của đậu phộng.',
  // misc
  'Harvest Tyme Dried Fruit & Nuts': 'Hỗn hợp trái cây sấy và hạt Harvest Tyme, kết hợp phong phú các loại trái cây sấy khô và hạt dinh dưỡng. Bổ sung nhiều loại vitamin.',
  'Cookies Cashews With Chocolate Chips': 'Bánh quy hạt điều socola chip, mềm và giòn với mảnh sô-cô-la đen trong từng miếng. Thưởng thức cùng cà phê hoặc trà sẽ tuyệt vời.',
  'Cashew And Almond Vegan Cookies': 'Bánh quy thuần chay hạt điều và hạnh nhân, không trứng không sữa. Giòn tan và thơm ngon, phù hợp với người ăn chay.',
  'Plant Protein Bites Cashew Chocolate Chip': 'Snack protein thực vật vị hạt điều sô-cô-la chip, giàu protein thực vật từ hạt đậu và hạt điều. Phù hợp cho người tập gym.',
  'Plant Protein Bites Cashews And Almonds': 'Snack protein thực vật hạt điều và hạnh nhân, nguồn protein tự nhiên từ thực vật. Không gluten, không đường tinh luyện.',
};

// ── Image matching ──────────────────────────────────────────
function imgKey(s) {
  return s.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim();
}

function scanImages(root) {
  if (!existsSync(root)) return [];
  const out = [];
  const walk = dir => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (/\.(png|jpe?g|webp)$/i.test(entry.name) && !/(Thumbs|\.DS_Store)/i.test(entry.name)) {
        out.push({ path: p, key: imgKey(entry.name.replace(/\.[^.]+$/, '')) });
      }
    }
  };
  walk(root);
  return out;
}

function matchImage(name, packSize, candidates) {
  // Build search key from product name + relevant size tokens
  const baseKey = imgKey(name);
  // Extract numeric weight from packSize e.g. "12/50g" → "50g", "8/800g" → "800g", "170g" → "170g"
  const sizeMatch = String(packSize).match(/(?:\d+\/)?(\d+\.?\d*\s*(?:kg|g))/i);
  const sizeToken = sizeMatch ? imgKey(sizeMatch[1]) : '';

  let best = null, bestScore = -1;
  for (const c of candidates) {
    const ck = c.key;
    // Prefer candidates that contain both name key AND size
    let score = 0;
    const nameWords = baseKey.split(' ').filter(w => w.length >= 4);
    const matchedWords = nameWords.filter(w => ck.includes(w));
    score = matchedWords.length / Math.max(nameWords.length, 1);
    if (sizeToken && ck.includes(sizeToken)) score += 0.5;
    // Penalise very different length
    const lenDiff = Math.abs(ck.length - baseKey.length) / Math.max(ck.length, baseKey.length);
    score -= lenDiff * 0.2;
    if (score > bestScore && score > 0.5) {
      bestScore = score;
      best = c.path;
    }
  }
  return best;
}

async function toBase64(filePath) {
  const buf = readFileSync(filePath);
  const mime = /\.png$/i.test(filePath) ? 'image/png' : /\.webp$/i.test(filePath) ? 'image/webp' : 'image/jpeg';
  return { data: buf.toString('base64'), mime_type: mime, original_name: basename(filePath) };
}

// ── API helpers ─────────────────────────────────────────────
async function apiFetch(path, method = 'GET', body = null) {
  const opts = { method, headers: { ...H }, ...(body ? { body: JSON.stringify(body) } : {}) };
  const r = await fetch(`${BASE}${path}`, opts);
  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`${method} ${path} → ${r.status}: ${txt.slice(0, 200)}`);
  }
  return r.json();
}

async function uploadImage(filePath) {
  const { data, mime_type, original_name } = await toBase64(filePath);
  const r = await apiFetch('/skus/image-upload', 'POST', { data, mime_type, original_name });
  return r.url;
}

async function createSku(payload) {
  return apiFetch('/skus', 'POST', payload);
}

async function updateSku(id, payload) {
  return apiFetch(`/skus/${id}/update`, 'POST', payload);
}

async function setPriceBookEntry(skuId, price) {
  return apiFetch('/warehouse/price-book/entry', 'POST', {
    book_id: PB_P4,
    sku_id: skuId,
    price,
  });
}

// ── Parse markdown file → product list ─────────────────────
function parseProducts(mdText) {
  const rows = parseMdTable(mdText);
  if (!rows.length) throw new Error('No rows parsed from MD');

  const products = [];
  const SKIP_NAMES = new Set([
    'Hộp Thiếc', 'Hộp Bánh Trưng Bày', 'Điều Tươi Còn Vỏ',
    'Cookies (Pecan, Cashew Chocola, Pistachios) 8x3x24g',
    'Box_Pistachios Cookies (25x18 thanh)', 'Bag Puck 12 túi mix',
    'Pistachios Beverage', // no barcode, mock
    'Sliced Almonds Natural / Balanched', 'Silved Almonds Natural / Balanched',
    'Diced Almonds 4 - 5mm; 2-4mm, 5- 8mm',
    'Diced Pistacshios 4 - 5mm; 2-4mm, 5- 8mm',
    'Butter Almonds Diced', 'Butter Pecan Diced', 'Butter Pistachios Diced',
    'Butter Walnuts Diced', 'Butter Cashews Diced',
    'All Day Breakfast Oatmeal 12/7/50g',
    'Pancake almond', 'Pancake macadamia', 'Pancake pistachios',
    // gift box / display items
    'Set Oval Cam',
    'Cashew W 180 unsalted', 'Almond unsalted', 'Pistachios', 'Peanut snax mix 650g',
    'Cluster almond cashew & cranberry 170g', 'Beanis 200g',
    'Cashew truffle 180g', 'Cluster pumpkin 130g',
    // bulk/internal codes
  ]);

  const SKIP_CODES = new Set([
    'Tem mockup', 'New item mockup', 'Greneric Cream',
  ]);

  // Items flagged as Hermes bag sets / bulk with no barcode that are set bundles
  const SET_NOTE_ITEMS = [
    '91040119', '91070077', '91040288', '91100043', '91080104_set',
    '91040342', '91240022_set', '91100055_set', '91020007',
    '91040342_s2', '91050017', '91080088_set', '91100040', '91020043',
    '91040201', '91020003',
  ];

  // Remove duplicate lines that differ only by note (Hermes bag set items)
  const setCodesSeen = new Set();

  for (const row of rows) {
    if (row.length < 5) continue;
    // cols: Cat | Code | Barcode | SKU/Name | Pack size | ĐVT | Giá NL | Giá Thùng| P3 | Qty | Note
    const [cat, rawCode, rawBarcode, rawName, packSize, dvt, , , rawP3, rawQty, note] = row;
    const code    = clean(rawCode);
    const barcode = clean(rawBarcode);
    const name    = clean(rawName);
    const qty     = rawQty ? parseFloat(clean(rawQty).replace(/[^\d]/g, '')) : NaN;
    const p3      = rawP3 ? moneyToInt(clean(rawP3)) : 0;

    if (!name || name === 'SKU' || name === 'Cat.' || name === '') continue;

    // Skip header-like rows
    if (name === 'Cat.' || code === 'Code' || barcode === 'Barcode') continue;

    // Skip display/set/no-info items
    if (SKIP_NAMES.has(name)) continue;
    if (SKIP_CODES.has(code)) continue;
    if (!code && !barcode) continue; // must have at least one identifier

    // Skip bulk HCK items (internal grading codes)
    if (/HCK/.test(note || '') || /HCK/.test(name)) continue;

    // Skip pure mockup/placeholder barcodes  
    if (barcode === '-' || code === '-') continue;
    if (/mockup/i.test(code) || /mockup/i.test(barcode)) continue;

    // Skip Hermes bag SET items (they are set items referencing same codes)
    if (note && /Set \d/i.test(note)) continue;

    // Skip Bin sub-items without code/barcode
    if (!code && !barcode) continue;

    // Build clean name: "Name (pack size)"
    // Remove "nội địa", cat prefix numbers like "1-", "2-" etc.
    // Also strip any trailing parenthetical that already contains size/weight
    let cleanName = name
      .replace(/^\d+[-\s]+/, '')         // remove "1- " prefix
      .replace(/\s*\(nội địa\)/i, '')    // remove (nội địa)
      .replace(/\s*nội địa\s*/i, '')
      .replace(/\s+\(?\d+\.?\d*\s*(?:kg|g)\)?\s*$/i, '') // strip trailing single weight "Raisin 454g"
      .replace(/\s+\d+\/\d+\.?\d*\s*(?:kg|g)r?\s*$/i, '')  // strip trailing pack "12/100g" or "12/100gr"
      .trim();

    // Don't double-append if packSize already in name or name ends with packSize content
    const displayName = packSize && !cleanName.toLowerCase().includes(clean(packSize).toLowerCase())
      ? `${cleanName} (${clean(packSize)})`
      : cleanName;

    products.push({
      code: code || '',
      barcode: barcode || '',
      name: displayName,
      cleanName,
      packSize: clean(packSize),
      unit: clean(dvt) || 'Gói',
      qty: Number.isFinite(qty) ? qty : null,
      p3Price: p3,
    });
  }

  // Deduplicate by code+barcode (keep first occurrence)
  const seen = new Map();
  const deduped = [];
  for (const p of products) {
    const key = (p.code || '') + '|' + (p.barcode || '');
    if (!seen.has(key)) {
      seen.set(key, true);
      deduped.push(p);
    }
  }

  return deduped;
}

// ── MAIN ────────────────────────────────────────────────────
async function main() {
  console.log('\n📦 Đang đọc file sản phẩm...');
  const mdText = readFileSync(MD_FILE, 'utf8');
  const allProducts = parseProducts(mdText);
  console.log(`   Đọc được ${allProducts.length} sản phẩm từ file (sau dedup)`);

  console.log('\n🔍 Lấy danh sách SKU hiện có từ Vietfoods...');
  const existingSkus = await apiFetch('/skus?branch_id=br_vietfoods&limit=1000');
  console.log(`   Hiện có ${existingSkus.length} SKUs trong kho`);

  // Build lookup maps
  const byCode    = new Map(existingSkus.filter(s => s.code).map(s => [clean(s.code).toLowerCase(), s]));
  const byBarcode = new Map(existingSkus.filter(s => s.barcode).map(s => [clean(s.barcode).replace(/\s/g, '').toLowerCase(), s]));

  // Scan local images
  console.log('\n🖼️  Khởi tạo danh sách ảnh cục bộ...');
  const imgCandidates = scanImages(IMG_ROOT);
  console.log(`   Tìm thấy ${imgCandidates.length} ảnh trong ${IMG_ROOT}`);

  // Classify
  const toCreate = [];
  const toUpdate = [];   // existing SKUs that need name fix or image
  const skipped  = [];
  const alreadyOk = [];

  for (const p of allProducts) {
    const codeKey    = p.code.toLowerCase();
    const barcodeKey = p.barcode.replace(/\s/g, '').toLowerCase();
    const existing   = byCode.get(codeKey) || byBarcode.get(barcodeKey);

    if (existing) {
      // Check if name needs updating or image is missing
      const needsNameFix = !existing.name.includes('(') ||
        existing.name.includes('\r') || existing.name.includes('  ');
      const needsImage   = !existing.image;
      if (needsNameFix || needsImage) {
        toUpdate.push({ product: p, existing, needsNameFix, needsImage });
      } else {
        alreadyOk.push(p);
      }
    } else {
      toCreate.push(p);
    }
  }

  console.log(`\n📊 Kết quả phân tích:`);
  console.log(`   ✅ Đã có: ${existingSkus.length - toUpdate.length} SKU`);
  console.log(`   🆕 Cần tạo mới: ${toCreate.length} SKU`);
  console.log(`   ✏️  Cần cập nhật (tên/ảnh): ${toUpdate.length} SKU`);
  console.log(`   ⏭️  Bỏ qua: ${allProducts.length - toCreate.length - toUpdate.length - (existingSkus.length - toUpdate.length)} SKU`);

  if (!COMMIT) {
    console.log('\n🔍 DRY-RUN — Danh sách sẽ tạo mới:');
    toCreate.forEach(p => console.log(`   + [${p.code}] ${p.name} | barcode=${p.barcode}`));
    console.log('\n🔍 DRY-RUN — Danh sách sẽ cập nhật:');
    toUpdate.forEach(({ existing, product, needsNameFix, needsImage }) =>
      console.log(`   ~ [${existing.code}] "${existing.name}" → "${product.name}" | img=${needsImage ? 'cần' : 'có rồi'}`));
    console.log('\nChạy lại với --commit để import thật.\n');
    return;
  }

  // ── CREATE new SKUs ──────────────────────────────────────
  let created = 0, failed = 0, imgsAdded = 0;
  const noImageList = [];

  for (const p of toCreate) {
    try {
      // Try matching image
      let imageUrl = null;
      const imgPath = matchImage(p.cleanName, p.packSize, imgCandidates);
      if (imgPath) {
        try {
          imageUrl = await uploadImage(imgPath);
          imgsAdded++;
          console.log(`   🖼️  Ảnh: ${p.cleanName} ← ${imgPath.split('\\').slice(-2).join('/')}`);
        } catch (e) {
          console.warn(`   ⚠️  Lỗi upload ảnh cho ${p.cleanName}: ${e.message}`);
        }
      } else {
        noImageList.push(p.name);
      }

      // Build description
      const desc = DESCRIPTIONS[p.cleanName] || DESCRIPTIONS[p.name] || null;

      const payload = {
        code:         p.code || undefined,
        barcode:      p.barcode || undefined,
        name:         p.name,
        unit:         p.unit || 'Gói',
        warehouse_id: WH,
        branch_id:    BRANCH,
        stock:        p.qty ?? 0,
        price:        0,
        cost:         0,
        active:       1,
        emoji:        '🛍️',
        image:        imageUrl,
        description:  desc,
      };

      const newSku = await createSku(payload);
      const skuId = newSku.id || newSku.sku?.id;

      // Add to P4 price book (price = 0, will be filled by user later unless p3 known)
      if (skuId) {
        try {
          await setPriceBookEntry(skuId, p.p3Price || 0);
        } catch (e) {
          console.warn(`   ⚠️  Lỗi gán P4 cho ${p.name}: ${e.message}`);
        }
      }

      console.log(`   ✅ Tạo: [${p.code}] ${p.name}`);
      created++;
    } catch (e) {
      console.error(`   ❌ Lỗi tạo ${p.name}: ${e.message}`);
      failed++;
    }
  }

  // ── UPDATE existing SKUs (name fix + image) ──────────────
  let updated = 0;
  for (const { existing, product, needsNameFix, needsImage } of toUpdate) {
    try {
      let imageUrl = existing.image;
      if (needsImage) {
        const imgPath = matchImage(product.cleanName, product.packSize, imgCandidates);
        if (imgPath) {
          try {
            imageUrl = await uploadImage(imgPath);
            imgsAdded++;
          } catch {}
        } else {
          noImageList.push(product.name);
        }
      }

      const desc = DESCRIPTIONS[product.cleanName] || DESCRIPTIONS[product.name] || null;

      await updateSku(existing.id, {
        name:        needsNameFix ? product.name : existing.name,
        image:       imageUrl,
        description: desc || existing.description,
      });

      // Ensure P4 entry exists
      try {
        await setPriceBookEntry(existing.id, product.p3Price || 0);
      } catch {}

      console.log(`   ✏️  Update: [${existing.code}] ${product.name}`);
      updated++;
    } catch (e) {
      console.error(`   ❌ Lỗi update ${existing.name}: ${e.message}`);
    }
  }

  // ── Report ───────────────────────────────────────────────
  console.log('\n' + '='.repeat(60));
  console.log(`✅ HOÀN THÀNH:`);
  console.log(`   Tạo mới: ${created} SKU`);
  console.log(`   Cập nhật: ${updated} SKU`);
  console.log(`   Lỗi: ${failed}`);
  console.log(`   Ảnh thêm được: ${imgsAdded}`);
  console.log(`   Không có ảnh: ${noImageList.length} sản phẩm`);
  if (noImageList.length) {
    console.log('\n📷 Danh sách sản phẩm KHÔNG CÓ ẢNH:');
    noImageList.forEach((n, i) => console.log(`   ${i+1}. ${n}`));
  }
  console.log('='.repeat(60));
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
