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
const cats = [];
const insCat = db.prepare(`INSERT INTO categories (id,name,icon,sort) VALUES (?,?,?,?)`);
cats.forEach(c => insCat.run(c.id, c.name, c.icon, c.sort));

// ---- Kitchen warehouse: ingredients + supplies ----
const inv = [];
const insInv = db.prepare(`INSERT INTO inventory_items
  (id,branch_id,name,unit,stock,min_stock,warehouse_id,item_type,category,cost,track_lot,expiry_required,active)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,1)`);
inv.forEach(i => insInv.run(i.id, BR, i.name, i.unit, i.stock, i.min, WH_KITCHEN, i.type, i.category, i.cost || 0, i.track_lot || 0, i.expiry_required || 0));

// ---- Menu items ----
const menu = [];
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
const skus = [];
const insSku = db.prepare(`INSERT INTO skus
  (id,branch_id,barcode,name,emoji,price,cost,stock,min_stock,unit,warehouse_id,category,supplier,track_lot,expiry_required,active)
  VALUES (?,?,?,?,?,?,?,?,?,'cái',?,?,?,?,?,1)`);
skus.forEach(s => insSku.run(s.id, BR, s.barcode, s.name, s.emoji, s.price, s.cost, s.stock, s.min, WH_RETAIL, s.cat, 'Demo Supplier', s.track_lot || 0, s.expiry_required || 0));

// ---- Retail promotions / vouchers ----
const insVoucher = db.prepare(`INSERT INTO vouchers
  (id,branch_id,code,name,type,value,scope,sku_id,lot_no,min_total,active,note,created_at,updated_at)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
const vouchers = [];
vouchers.forEach(v => insVoucher.run(v.id, BR, v.code, v.name, v.type, v.value, v.scope, v.sku_id || null, v.lot_no || null, v.min_total || 0, 1, v.note || null, new Date().toISOString(), new Date().toISOString()));

bootstrapWarehouseDefaults(BR);

console.log(`Seeded branch ${BR}: ${tables.length} tables, ${cats.length} categories, ${menu.length} menu items, ${inv.length} kitchen items, ${skus.length} retail SKUs.`);
