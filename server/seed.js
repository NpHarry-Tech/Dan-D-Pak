// Demo seed for one realistic mixed FnB + retail branch.
// Re-runnable: clears operational demo data and rebuilds catalog/stock.
import { db, migrate, bootstrapWarehouseDefaults } from './db.js';

migrate();

const BR = 'br1';
const WH_KITCHEN = 'wh_kitchen';
const WH_RETAIL = 'wh_retail';
const ALWAYS = JSON.stringify({ mode: 'always' });

function reset() {
  for (const t of [
    'stocktake_lines', 'stocktake_sessions',
    'inventory_document_lines', 'inventory_documents',
    'stock_lots', 'stock_movements',
    'payment_lines', 'payments',
    'order_items', 'orders',
    'vouchers',
    'staff_calls', 'print_jobs', 'audit_log', 'auth_sessions',
    'recipes', 'menu_items', 'categories',
    'inventory_items', 'skus', 'tables', 'users', 'warehouses', 'branches',
  ]) {
    db.exec(`DELETE FROM ${t};`);
  }
}

reset();

db.prepare(`INSERT INTO branches (id,name,address) VALUES (?,?,?)`)
  .run(BR, 'District 1 - HCMC', '12 Nguyễn Huệ, Q1, TP.HCM');
bootstrapWarehouseDefaults(BR);

// ---- Users / roles (PIN login) ----
const users = [
  { id: 'u_admin', username: 'admin', name: 'Admin', pin: '1234', role: 'owner' },
  { id: 'u_tan', username: 'tanbv', name: 'Bùi Văn Tân', pin: '1111', role: 'owner' },
  { id: 'u_vinh', username: 'vinhlq', name: 'Lê Quốc Vinh', pin: '2222', role: 'manager' },
  { id: 'u_phat', username: 'phatnt', name: 'Nguyễn Tấn Phát', pin: '3333', role: 'cashier' },
  { id: 'u_kitchen', username: 'kitchen', name: 'Bếp trưởng', pin: '4444', role: 'kitchen' },
  { id: 'u_wh', username: 'warehouse', name: 'Thủ kho', pin: '5555', role: 'warehouse' },
];
const insUser = db.prepare(`INSERT INTO users (id,branch_id,username,name,pin,role,active) VALUES (?,?,?,?,?,?,1)`);
users.forEach(u => insUser.run(u.id, BR, u.username, u.name, u.pin, u.role));

// ---- Tables ----
const tables = [];
for (const [zone, codes] of [
  ['Khu A', ['A01', 'A02', 'A03', 'A04', 'A05', 'A06']],
  ['Khu B', ['B01', 'B02', 'B03', 'B04']],
  ['VIP', ['V01', 'V02']],
]) codes.forEach(code => tables.push({ id: 't_' + code, zone, code }));
const insTable = db.prepare(`INSERT INTO tables (id,branch_id,zone,code,seats,status) VALUES (?,?,?,?,?,'free')`);
tables.forEach(t => insTable.run(t.id, BR, t.zone, t.code, 4));

// ---- Categories ----
const cats = [
  { id: 'c_main', name: 'Món chính', icon: '🍜', sort: 1 },
  { id: 'c_rice', name: 'Cơm', icon: '🍚', sort: 2 },
  { id: 'c_appe', name: 'Khai vị', icon: '🥗', sort: 3 },
  { id: 'c_drink', name: 'Đồ uống', icon: '🥤', sort: 4 },
  { id: 'c_dessert', name: 'Tráng miệng', icon: '🍮', sort: 5 },
];
const insCat = db.prepare(`INSERT INTO categories (id,name,icon,sort) VALUES (?,?,?,?)`);
cats.forEach(c => insCat.run(c.id, c.name, c.icon, c.sort));

// ---- Kitchen warehouse: ingredients + supplies ----
const inv = [
  { id: 'i_beef', name: 'Thịt bò', unit: 'g', stock: 20000, min: 3000, type: 'ingredient', category: 'Protein', cost: 260 },
  { id: 'i_noodle', name: 'Bánh phở/mì', unit: 'g', stock: 30000, min: 4000, type: 'ingredient', category: 'Tinh bột', cost: 35 },
  { id: 'i_bread', name: 'Bánh mì', unit: 'cái', stock: 120, min: 20, type: 'ingredient', category: 'Tinh bột', cost: 2500 },
  { id: 'i_rice', name: 'Gạo', unit: 'g', stock: 50000, min: 5000, type: 'ingredient', category: 'Tinh bột', cost: 22 },
  { id: 'i_chicken', name: 'Thịt gà', unit: 'g', stock: 15000, min: 2500, type: 'ingredient', category: 'Protein', cost: 95 },
  { id: 'i_veggie', name: 'Rau xà lách', unit: 'g', stock: 8000, min: 1500, type: 'ingredient', category: 'Rau', cost: 38, track_lot: 1, expiry_required: 1 },
  { id: 'i_milktea', name: 'Trà + nguyên liệu', unit: 'ml', stock: 18000, min: 3000, type: 'ingredient', category: 'Bar', cost: 18 },
  { id: 'i_coffee', name: 'Cà phê', unit: 'g', stock: 6000, min: 1000, type: 'ingredient', category: 'Bar', cost: 160 },
  { id: 'i_milk', name: 'Sữa', unit: 'ml', stock: 12000, min: 2000, type: 'ingredient', category: 'Bar', cost: 25, track_lot: 1, expiry_required: 1 },
  { id: 'i_fruit', name: 'Trái cây', unit: 'g', stock: 9000, min: 1500, type: 'ingredient', category: 'Bar', cost: 55, track_lot: 1, expiry_required: 1 },
  { id: 'i_sugar', name: 'Đường', unit: 'g', stock: 10000, min: 1500, type: 'ingredient', category: 'Gia vị', cost: 18 },
  { id: 'i_flan', name: 'Bánh flan', unit: 'cái', stock: 60, min: 10, type: 'ingredient', category: 'Tráng miệng', cost: 9000, track_lot: 1, expiry_required: 1 },
  { id: 'i_bowl', name: 'Tô sứ', unit: 'cái', stock: 90, min: 20, type: 'supply', category: 'Dụng cụ', cost: 18000 },
  { id: 'i_chopstick', name: 'Đũa', unit: 'đôi', stock: 260, min: 60, type: 'supply', category: 'Dụng cụ', cost: 2500 },
  { id: 'i_spoon', name: 'Muỗng inox', unit: 'cái', stock: 180, min: 40, type: 'supply', category: 'Dụng cụ', cost: 5000 },
];
const insInv = db.prepare(`INSERT INTO inventory_items
  (id,branch_id,name,unit,stock,min_stock,warehouse_id,item_type,category,cost,track_lot,expiry_required,active)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,1)`);
inv.forEach(i => insInv.run(i.id, BR, i.name, i.unit, i.stock, i.min, WH_KITCHEN, i.type, i.category, i.cost || 0, i.track_lot || 0, i.expiry_required || 0));

// ---- Menu items ----
const sizeMod = { group: 'Size', required: false, multi: false, options: [
  { name: 'Nhỏ', price: 0 }, { name: 'Vừa', price: 5000 }, { name: 'Lớn', price: 10000 },
] };
const iceSugar = [
  { group: 'Đường', required: false, multi: false, options: [
    { name: '100%', price: 0 }, { name: '70%', price: 0 }, { name: '50%', price: 0 }, { name: '0%', price: 0 },
  ] },
  { group: 'Đá', required: false, multi: false, options: [
    { name: 'Bình thường', price: 0 }, { name: 'Ít đá', price: 0 }, { name: 'Không đá', price: 0 },
  ] },
  { group: 'Topping', required: false, multi: true, options: [
    { name: 'Trân châu', price: 7000 }, { name: 'Pudding', price: 7000 }, { name: 'Thạch', price: 5000 },
  ] },
];

const menu = [
  { id: 'm_boko', cat: 'c_main', name: 'Bò kho', emoji: '🍲', price: 65000, station: 'kitchen', sla: 12,
    desc: 'Bò kho mềm hầm cà rốt, ăn kèm bánh mì giòn nóng.', ingredients: ['thịt bò', 'cà rốt', 'bánh mì', 'gia vị bò kho'], allergens: ['gluten'], mods: [sizeMod], recipe: [['i_beef', 180], ['i_bread', 1]] },
  { id: 'm_phobo', cat: 'c_main', name: 'Phở bò', emoji: '🍜', price: 60000, station: 'kitchen', sla: 10,
    desc: 'Phở bò tái nạm, nước dùng ninh xương 12 tiếng.', ingredients: ['thịt bò', 'bánh phở', 'hành', 'rau thơm'], allergens: [], mods: [sizeMod], recipe: [['i_beef', 150], ['i_noodle', 200]] },
  { id: 'm_miga', cat: 'c_main', name: 'Mì gà', emoji: '🍜', price: 55000, station: 'kitchen', sla: 10,
    desc: 'Mì trứng dai, gà xé, rau cải xanh tươi.', ingredients: ['mì', 'thịt gà', 'rau cải'], allergens: ['gluten', 'trứng'], mods: [sizeMod], recipe: [['i_chicken', 150], ['i_noodle', 200]] },
  { id: 'm_comga', cat: 'c_rice', name: 'Cơm gà', emoji: '🍚', price: 58000, station: 'kitchen', sla: 11,
    desc: 'Cơm gà Hội An, gà ta luộc, hành phi thơm.', ingredients: ['gạo', 'thịt gà', 'hành phi'], allergens: [], recipe: [['i_chicken', 180], ['i_rice', 250]] },
  { id: 'm_combo', cat: 'c_rice', name: 'Cơm bò xào', emoji: '🍛', price: 62000, station: 'kitchen', sla: 11,
    desc: 'Bò xào hành tây, ớt chuông trên cơm nóng.', ingredients: ['gạo', 'thịt bò', 'hành tây', 'ớt chuông'], allergens: [], recipe: [['i_beef', 160], ['i_rice', 250]] },
  { id: 'm_salad', cat: 'c_appe', name: 'Salad trộn', emoji: '🥗', price: 45000, station: 'salad', sla: 5,
    desc: 'Rau xà lách, cà chua bi, sốt mè rang.', ingredients: ['xà lách', 'cà chua', 'sốt mè'], allergens: ['mè'], recipe: [['i_veggie', 200]] },
  { id: 'm_goicuon', cat: 'c_appe', name: 'Gỏi cuốn', emoji: '🌯', price: 40000, station: 'salad', sla: 6,
    desc: 'Gỏi cuốn tôm thịt, bún, rau thơm, nước chấm.', ingredients: ['bánh tráng', 'rau', 'bún', 'nước chấm'], allergens: ['hải sản'], recipe: [['i_veggie', 120]] },
  { id: 'm_tradao', cat: 'c_drink', name: 'Trà đào', emoji: '🍑', price: 38000, station: 'bar', sla: 5,
    desc: 'Trà đào cam sả, đào miếng tươi giòn ngọt.', ingredients: ['trà', 'đào', 'cam', 'sả', 'đường'], allergens: [], mods: iceSugar, recipe: [['i_milktea', 350], ['i_fruit', 80], ['i_sugar', 30]] },
  { id: 'm_caphe', cat: 'c_drink', name: 'Cà phê sữa', emoji: '☕', price: 35000, station: 'bar', sla: 6,
    desc: 'Cà phê phin đậm đà pha sữa đặc.', ingredients: ['cà phê', 'sữa đặc'], allergens: ['sữa', 'caffeine'], mods: iceSugar, recipe: [['i_coffee', 25], ['i_milk', 120], ['i_sugar', 20]] },
  { id: 'm_sinhto', cat: 'c_drink', name: 'Sinh tố', emoji: '🥤', price: 42000, station: 'bar', sla: 8,
    desc: 'Sinh tố trái cây tươi xay cùng sữa tươi.', ingredients: ['trái cây', 'sữa', 'đường'], allergens: ['sữa'], mods: iceSugar, recipe: [['i_fruit', 200], ['i_milk', 100], ['i_sugar', 25]] },
  { id: 'm_nuocep', cat: 'c_drink', name: 'Nước ép', emoji: '🧃', price: 40000, station: 'bar', sla: 7,
    desc: 'Nước ép nguyên chất, ít đường.', ingredients: ['trái cây', 'đường'], allergens: [], mods: iceSugar, recipe: [['i_fruit', 250], ['i_sugar', 15]] },
  { id: 'm_flan', cat: 'c_dessert', name: 'Bánh flan', emoji: '🍮', price: 25000, station: 'salad', sla: 4,
    desc: 'Bánh flan mềm mịn, caramel đắng nhẹ.', ingredients: ['trứng', 'sữa', 'caramel'], allergens: ['trứng', 'sữa'], recipe: [['i_flan', 1]] },
];
const insMenu = db.prepare(`INSERT INTO menu_items
  (id,category_id,name,emoji,image,description,price,station,sla_minutes,available,hidden,ingredients_json,allergens_json,schedule_json,modifiers_json,sort)
  VALUES (?,?,?,?,?,?,?,?,?,1,0,?,?,?,?,?)`);
const insRecipe = db.prepare(`INSERT INTO recipes (menu_item_id,inventory_item_id,qty) VALUES (?,?,?)`);
menu.forEach((m, idx) => {
  insMenu.run(m.id, m.cat, m.name, m.emoji, m.image || null, m.desc || null, m.price, m.station, m.sla,
    JSON.stringify(m.ingredients || []), JSON.stringify(m.allergens || []), ALWAYS, JSON.stringify(m.mods || []), idx);
  (m.recipe || []).forEach(([ing, qty]) => insRecipe.run(m.id, ing, qty));
});

// ---- Retail warehouse SKUs ----
const skus = [
  { id: 's_lavie', barcode: '8935001710016', name: 'Nước Lavie 500ml', emoji: '💧', price: 8000, cost: 5000, stock: 240, min: 48, cat: 'Nước đóng chai', track_lot: 1 },
  { id: 's_coke', barcode: '8934588063017', name: 'Coca-Cola lon', emoji: '🥤', price: 12000, cost: 8000, stock: 180, min: 36, cat: 'Nước giải khát', track_lot: 1 },
  { id: 's_pepsi', barcode: '8934588013010', name: 'Pepsi lon', emoji: '🥤', price: 12000, cost: 8000, stock: 150, min: 36, cat: 'Nước giải khát', track_lot: 1 },
  { id: 's_chip', barcode: '8936079120014', name: 'Snack khoai tây', emoji: '🍟', price: 15000, cost: 10000, stock: 90, min: 20, cat: 'Snack', track_lot: 1, expiry_required: 1 },
  { id: 's_choco', barcode: '8934563138017', name: 'Sô-cô-la thanh', emoji: '🍫', price: 22000, cost: 15000, stock: 60, min: 15, cat: 'Bánh kẹo', track_lot: 1, expiry_required: 1 },
  { id: 's_mi', barcode: '8934563201018', name: 'Mì gói Hảo Hảo', emoji: '🍜', price: 5000, cost: 3500, stock: 300, min: 60, cat: 'Thực phẩm khô', track_lot: 1, expiry_required: 1 },
  { id: 's_coffee3in1', barcode: '8935024140017', name: 'Cà phê G7 (hộp)', emoji: '☕', price: 45000, cost: 32000, stock: 40, min: 10, cat: 'Thực phẩm khô', track_lot: 1, expiry_required: 1 },
  { id: 's_milk', barcode: '8934673100015', name: 'Sữa tươi 1L', emoji: '🥛', price: 32000, cost: 24000, stock: 70, min: 18, cat: 'Sữa', track_lot: 1, expiry_required: 1 },
  { id: 's_tissue', barcode: '8936036020014', name: 'Khăn giấy', emoji: '🧻', price: 18000, cost: 12000, stock: 55, min: 12, cat: 'Tiện ích' },
  { id: 's_beer', barcode: '8934588233012', name: 'Bia Tiger lon', emoji: '🍺', price: 18000, cost: 13000, stock: 200, min: 48, cat: 'Bia', track_lot: 1 },
];
const insSku = db.prepare(`INSERT INTO skus
  (id,branch_id,barcode,name,emoji,price,cost,stock,min_stock,unit,warehouse_id,category,supplier,track_lot,expiry_required,active)
  VALUES (?,?,?,?,?,?,?,?,?,'cái',?,?,?,?,?,1)`);
skus.forEach(s => insSku.run(s.id, BR, s.barcode, s.name, s.emoji, s.price, s.cost, s.stock, s.min, WH_RETAIL, s.cat, 'Demo Supplier', s.track_lot || 0, s.expiry_required || 0));

// ---- Retail promotions / vouchers ----
const insVoucher = db.prepare(`INSERT INTO vouchers
  (id,branch_id,code,name,type,value,scope,sku_id,lot_no,min_total,active,note,created_at,updated_at)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
[
  { id: 'v_open10', code: 'OPEN10', name: 'Khai trương -10%', type: 'pct', value: 10, scope: 'order', min_total: 0, note: 'Voucher toàn bill' },
  { id: 'v_choco5', code: 'CHOCO5', name: 'Sô-cô-la giảm 5K', type: 'amount', value: 5000, scope: 'sku', sku_id: 's_choco', min_total: 0, note: 'Promo riêng cho SKU' },
].forEach(v => insVoucher.run(v.id, BR, v.code, v.name, v.type, v.value, v.scope, v.sku_id || null, v.lot_no || null, v.min_total || 0, 1, v.note || null, new Date().toISOString(), new Date().toISOString()));

bootstrapWarehouseDefaults(BR);

console.log(`Seeded branch ${BR}: ${tables.length} tables, ${cats.length} categories, ${menu.length} menu items, ${inv.length} kitchen items, ${skus.length} retail SKUs.`);
