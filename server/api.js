// REST API: thin HTTP layer over the Local Store Server services.
import { Router } from 'express';
import { db, uid, audit } from './db.js';
import * as Orders from './services/orders.js';
import * as Inv from './services/inventory.js';
import * as Pay from './services/payments.js';
import * as Reports from './services/reports.js';
import * as Retail from './services/retail.js';
import * as Auth from './services/auth.js';
import * as Print from './services/printing.js';
import * as Online from './services/online.js';
import * as Invoices from './services/invoices.js';
import * as Sync from './services/sync.js';
import * as Catalog from './services/catalog.js';
import * as Vouchers from './services/vouchers.js';
import * as Customers from './services/customers.js';
import * as Modules from './services/modules.js';
import * as AppSettings from './services/settings.js';
import * as BookMenu from './services/bookMenu.js';
import * as Shifts from './services/shifts.js';
import * as History from './services/history.js';
import * as Misa from './services/misa.js';
import * as Archive from './services/archive.js';
import * as System from './services/system.js';
import * as ReportCenter from './services/reportCenter.js';
import * as CashDrawer from './services/cashDrawer.js';
import { emit, getActiveConnections } from './realtime.js';

export const api = Router();
const guard = Auth.requireAuth;

const guardAny = (...perms) => (req, res, next) => {
  const user = req.user;
  if (!user) return res.status(401).json({ error: 'Cần đăng nhập' });
  if (user.role === 'owner') return next();
  const hasAccess = perms.some(p => Auth.canUser(user, p)) || Auth.canUser(user, 'settings.manage');
  if (!hasAccess) return res.status(403).json({ error: 'Không đủ quyền truy cập các mục này' });
  next();
};
api.use(Auth.attachUser()); // gắn req.user (nếu có token) cho mọi route, kể cả route không bắt buộc đăng nhập
const actor = Auth.actorName; // người phụ trách thao tác cho nhật ký hoạt động
const wrap = (fn) => (req, res) => {
  try {
    const out = fn(req, res);
    if (out && typeof out.then === 'function') out.then(v => res.json(v ?? { ok: true })).catch(e => res.status(400).json({ error: e.message }));
    else res.json(out ?? { ok: true });
  }
  catch (e) { res.status(400).json({ error: e.message }); }
};

// --- Auth ---
api.post('/login', wrap((req) => Auth.login(req.body.username, req.body.pin)));
api.post('/logout', wrap((req) => {
  Auth.logout((req.headers.authorization || '').slice(7) || req.headers['x-auth-token']);
  return { ok: true };
}));
api.get('/me', guard(), wrap((req) => ({ ...req.user, perms: Auth.effectivePermsForUser(req.user.id) })));
api.post('/me/lang', guard(), wrap((req) => Auth.updateOwnLang(req.user.id, req.body.lang, req.user.branch_id || 'br1')));
api.get('/users', wrap(() => Auth.listUsers()));
api.get('/ping', wrap(() => ({ ok: true, serverTime: Date.now() })));

// --- ERP module registry ---
api.get('/modules', guard(), wrap((req) => ({ groups: Modules.MODULE_GROUPS, modules: Modules.visibleModules(Auth.effectivePermsForUser(req.user.id)) })));
api.get('/modules/all', guardAny('settings.perms'), wrap(() => ({ groups: Modules.MODULE_GROUPS, modules: Modules.listModules(Auth.ALL_PERMS) })));

// --- Settings: user & permission management (settings.manage) ---
api.get('/settings/permissions', guardAny('settings.perms', 'settings.users'), wrap(() => ({ catalog: Auth.PERMISSIONS, roles: Auth.permMatrix() })));
api.post('/settings/roles/:role/permissions', guardAny('settings.perms'), wrap((req) => Auth.setRolePerms(req.params.role, req.body.perms)));
api.get('/settings/users', guardAny('settings.users'), wrap(() => Auth.listAllUsers()));
api.post('/settings/users', guardAny('settings.users'), wrap((req) => Auth.createUser(req.body)));
api.post('/settings/users/:id/update', guardAny('settings.users'), wrap((req) => Auth.updateUser(req.params.id, req.body)));
api.post('/settings/users/:id/delete', guardAny('settings.users'), wrap((req) => Auth.deleteUser(req.params.id)));
api.get('/settings/users/:id/permissions', guardAny('settings.users', 'settings.perms'), wrap((req) => Auth.userPermDetails(req.params.id)));
api.post('/settings/users/:id/permissions', guardAny('settings.users', 'settings.perms'), wrap((req) => Auth.setUserPerms(req.params.id, req.body.perms)));
api.get('/settings/app', guardAny('settings.sync', 'settings.operations', 'settings.einvoice', 'settings.print', 'settings.printers', 'settings.devices', 'settings.invoices'), wrap(() => AppSettings.getSettings()));
api.post('/settings/app', guardAny('settings.sync', 'settings.operations', 'settings.einvoice', 'settings.print', 'settings.printers', 'settings.devices', 'settings.invoices'), wrap((req) => AppSettings.updateSettings(req.body)));
api.post('/templates/auto-save', guardAny('settings.print'), wrap((req) => AppSettings.autoSaveTemplate(req.body)));
api.get('/settings/integrations', guardAny('settings.integrations'), wrap(() => AppSettings.getIntegrations()));
api.post('/settings/integrations', guardAny('settings.integrations'), wrap((req) => AppSettings.updateIntegrations(req.body)));
// Test a single integration channel. MISA does a real auth call when live;
// delivery channels return the webhook URL to paste into the partner portal.
api.post('/settings/integrations/:channel/test', guardAny('settings.integrations'), wrap(async (req) => {
  const channel = req.params.channel;
  const cfg = AppSettings.getIntegrations().channels?.[channel];
  if (!cfg) throw new Error('Kênh không hợp lệ: ' + channel);
  const base = `${req.protocol}://${req.get('host')}`;
  if (channel === 'misa') return { channel, ...(await Misa.testConnection(cfg)) };
  if (channel === 'payos') {
    const payosWebhook = `${base}/api/payos/webhook`;
    if (!cfg.enabled) return { channel, ok: false, mode: 'disabled', message: 'payOS đang tắt. Bật kết nối trước khi kiểm tra.', webhookUrl: payosWebhook };
    const ok = !!(cfg.clientId && cfg.apiKey && cfg.checksumKey);
    return {
      channel, ok, mode: ok ? 'ready' : 'partial', webhookUrl: payosWebhook,
      message: ok
        ? 'Đã đủ Client ID / API Key / Checksum Key. Dán Webhook URL ở trên vào payOS Dashboard. Khi backend payOS bật, hệ thống sẽ tạo link thanh toán và nhận xác nhận tại URL này.'
        : 'Thiếu Client ID / API Key / Checksum Key (lấy ở payOS Dashboard → Cài đặt → Thông tin xác thực).',
    };
  }
  // Delivery / website channels: orders arrive at our webhook → Kênh online module.
  const webhookUrl = `${base}/api/online/webhook`;
  if (!cfg.enabled) return { channel, ok: false, mode: 'disabled', message: 'Kênh đang tắt. Bật để xuất hiện trong module Kênh online.', webhookUrl };
  const haveCreds = !!(cfg.clientId && cfg.clientSecret) || !!cfg.apiKey;
  return {
    channel, ok: true, mode: haveCreds ? 'ready' : 'partial', webhookUrl,
    message: haveCreds
      ? `Đã bật. Dán Webhook URL này vào cổng đối tác để đẩy đơn về "Kênh online". Đẩy đơn realtime cần đối tác bật API cho cửa hàng (B2B onboarding).`
      : `Đã bật nhưng chưa có Client ID/Secret. Đơn vẫn nhận được qua Webhook URL, nhưng đồng bộ menu/tồn kho 2 chiều cần khai báo credential từ cổng đối tác.`,
  };
}));
api.get('/settings/connections/status', guardAny('settings.connections'), wrap(async (req) => {
  const started = Date.now();
  const os = await import('os');
  const interfaces = os.networkInterfaces();
  const serverIps = [];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        serverIps.push(iface.address);
      }
    }
  }
  const socketConnections = getActiveConnections(req.user?.branch_id || 'br1');
  const [internetCheck, systemPrinters] = await Promise.all([
    System.checkInternet({ force: req.query.force === '1' }),
    System.listSystemPrinters({ force: req.query.force === '1' }),
  ]);
  return {
    serverIps,
    connections: socketConnections,
    internet: !!internetCheck.ok,
    internetCheck,
    systemPrinters,
    serverElapsedMs: Date.now() - started,
    checkedAt: new Date().toISOString(),
  };
}));
api.get('/settings/system/printers', guardAny('settings.connections', 'settings.printers', 'settings.print'), wrap(async (req) => ({
  printers: await System.listSystemPrinters({ force: req.query.force === '1' }),
  checkedAt: new Date().toISOString(),
})));
api.get('/operations/config', wrap(() => AppSettings.getOperationsConfig()));
api.get('/book-menu', wrap(() => BookMenu.getPublicBookConfig()));
api.get('/settings/book-menu', guardAny('settings.bookmenu'), wrap(() => BookMenu.getBookConfig()));
api.post('/settings/book-menu', guardAny('settings.bookmenu'), wrap((req) => {
  const out = BookMenu.saveBookConfig(req.body);
  emit('book-menu:updated', { activeBookId: out.activeBookId });
  return out;
}));
api.post('/settings/book-menu/import-pubhtml5', guardAny('settings.bookmenu'), wrap(async (req) => {
  const out = await BookMenu.importPubhtml5(req.body.url, req.body.title);
  emit('book-menu:updated', { activeBookId: out.activeBookId });
  return out;
}));
api.post('/device/ipad/unlock', wrap((req) => {
  if (!AppSettings.verifyIpadStaffPin(req.body.pin)) throw new Error('Mật khẩu không đúng');
  return { ok: true };
}));

// --- Catalog / Menu ---
api.get('/menu', wrap(() => Catalog.listMenu({ forCustomer: true })));
api.get('/menu/manage', guard('menu.manage'), wrap(() => Catalog.listMenu({ forCustomer: false })));

api.post('/menu', guard('menu.manage'), wrap((req) => {
  const b = req.body;
  if (!b.name || !b.category_id) throw new Error('Thiếu tên món hoặc nhóm');
  const id = uid('m_');
  const sort = (db.prepare(`SELECT COALESCE(MAX(sort),0)+1 n FROM menu_items`).get().n) || 1;
  db.prepare(`INSERT INTO menu_items
    (id,category_id,name,emoji,image,description,price,station,sla_minutes,available,hidden,ingredients_json,allergens_json,schedule_json,modifiers_json,addons_json,sort)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    id,
    b.category_id,
    b.name,
    b.emoji || '🍽️',
    b.image || null,
    b.description || null,
    parseInt(b.price) || 0,
    b.station || 'kitchen',
    parseInt(b.sla_minutes) || 10,
    b.available === false ? 0 : 1,
    b.hidden ? 1 : 0,
    JSON.stringify(Catalog.parseList(b.ingredients)),
    JSON.stringify(Catalog.parseList(b.allergens)),
    JSON.stringify(Catalog.normalizeSchedule(b.schedule)),
    JSON.stringify(Array.isArray(b.modifiers) ? b.modifiers : []),
    JSON.stringify(Catalog.normalizeAddons(b.addons)),
    sort);
  Catalog.replaceRecipe(id, b.recipe || []);
  audit('menu.create', { id, name: b.name });
  emit('menu:updated', { id, created: true });
  return Catalog.getMenuItem(id, { includeRecipe: true });
}));

api.post('/menu/:id/update', guard('menu.manage'), wrap((req) => {
  const b = req.body;
  const cur = db.prepare(`SELECT * FROM menu_items WHERE id=?`).get(req.params.id);
  if (!cur) throw new Error('Món không tồn tại');
  const v = (k, fallback) => (b[k] !== undefined && b[k] !== null && b[k] !== '') ? b[k] : fallback;
  db.prepare(`UPDATE menu_items SET
      name=?, emoji=?, image=?, description=?, price=?, category_id=?, station=?, sla_minutes=?,
      ingredients_json=?, allergens_json=?, schedule_json=?, hidden=?, addons_json=?
    WHERE id=?`).run(
    v('name', cur.name),
    v('emoji', cur.emoji),
    b.image !== undefined ? (b.image || null) : cur.image,
    b.description !== undefined ? (b.description || null) : cur.description,
    b.price !== undefined ? parseInt(b.price) : cur.price,
    v('category_id', cur.category_id),
    v('station', cur.station),
    b.sla_minutes !== undefined ? parseInt(b.sla_minutes) : cur.sla_minutes,
    b.ingredients !== undefined ? JSON.stringify(Catalog.parseList(b.ingredients)) : cur.ingredients_json,
    b.allergens !== undefined ? JSON.stringify(Catalog.parseList(b.allergens)) : cur.allergens_json,
    b.schedule !== undefined ? JSON.stringify(Catalog.normalizeSchedule(b.schedule)) : cur.schedule_json,
    b.hidden !== undefined ? (b.hidden ? 1 : 0) : cur.hidden,
    b.addons !== undefined ? JSON.stringify(Catalog.normalizeAddons(b.addons)) : (cur.addons_json || '[]'),
    req.params.id);
  if (Array.isArray(b.recipe)) Catalog.replaceRecipe(req.params.id, b.recipe || []);
  audit('menu.update', { id: req.params.id });
  emit('menu:updated', { id: req.params.id, updated: true });
  return Catalog.getMenuItem(req.params.id, { includeRecipe: true });
}));

api.post('/menu/:id/availability', wrap((req) => {
  const { available } = req.body;
  db.prepare(`UPDATE menu_items SET available=? WHERE id=?`).run(available ? 1 : 0, req.params.id);
  const item = Catalog.getMenuItem(req.params.id);
  emit('menu:updated', { id: item.id, available: !!item.available, name: item.name });
  return { id: item.id, available: !!item.available };
}));

api.post('/menu/:id/price', wrap((req) => {
  const price = parseInt(req.body.price);
  db.prepare(`UPDATE menu_items SET price=? WHERE id=?`).run(price, req.params.id);
  emit('menu:updated', { id: req.params.id, price });
  return { id: req.params.id, price };
}));

api.post('/menu/:id/hide', guard('menu.manage'), wrap((req) => {
  const item = Catalog.hideMenuItem(req.params.id, req.body.hidden !== false);
  emit('menu:updated', { id: req.params.id, hidden: item.hidden });
  return item;
}));

api.post('/menu/:id/delete', guard('menu.manage'), wrap((req) => {
  const r = Catalog.deleteMenuItem(req.params.id);
  emit('menu:updated', { id: req.params.id, deleted: true });
  return r;
}));

// --- Categories ---
api.get('/categories', wrap(() => Catalog.listCategories()));
api.post('/categories', guard('menu.manage'), wrap((req) => { const c = Catalog.createCategory(req.body); emit('menu:updated', { category: true }); return c; }));
api.post('/categories/:id/update', guard('menu.manage'), wrap((req) => { const c = Catalog.updateCategory(req.params.id, req.body); emit('menu:updated', { category: true }); return c; }));
api.post('/categories/:id/delete', guard('menu.manage'), wrap((req) => { const r = Catalog.deleteCategory(req.params.id); emit('menu:updated', { category: true }); return r; }));

// --- Tables ---
api.get('/tables', wrap(() => Orders.listTables()));
api.get('/tables/:id', wrap((req) => ({
  table: Orders.getTableState(req.params.id),
  order: Orders.getOrder(Orders.getOpenOrderForTable(req.params.id)?.id),
})));
api.post('/tables/:id/move', guard('sell'), wrap((req) => Orders.moveTable(req.params.id, req.body.to_table_id, 'br1', actor(req))));
api.post('/tables/:id/merge', guard('sell'), wrap((req) => Orders.mergeTables(req.params.id, req.body.target_table_id, 'br1', actor(req))));
api.post('/settings/tables', guardAny('settings.tables'), wrap((req) => Orders.createTable(req.body)));
api.post('/settings/tables/:id/update', guardAny('settings.tables'), wrap((req) => Orders.updateTable(req.params.id, req.body)));
api.post('/settings/tables/:id/delete', guardAny('settings.tables'), wrap((req) => Orders.deleteTable(req.params.id)));

// --- Orders ---
api.post('/orders', wrap((req) => Orders.createOrUpdateOrder({ ...req.body, actor: actor(req) })));
api.get('/orders/pending-confirmation', guard('sell'), wrap(() => Orders.listPendingConfirmations()));
api.get('/orders/history', guard('pay'), wrap((req) => History.listOrderHistory('br1', req.query)));
api.get('/orders/:id/receipt', guard('pay'), wrap((req) => History.orderReceipt(req.params.id)));
api.get('/orders/:id', wrap((req) => Orders.getOrder(req.params.id)));
api.post('/orders/:id/confirm', guard('sell'), wrap((req) => Orders.confirmPendingItems(req.params.id, req.body.item_ids, 'br1', actor(req))));
api.post('/orders/:id/reject', guard('sell'), wrap((req) => Orders.rejectPendingItems(req.params.id, req.body.item_ids, req.body.reason, 'br1', actor(req))));
api.post('/orders/:id/split', guard('pay'), wrap((req) => Orders.splitOrderItems(req.params.id, req.body.item_ids, 'br1', actor(req))));
api.post('/orders/items/:id/status', wrap((req) => Orders.setItemStatus(req.params.id, req.body.status, 'br1', actor(req))));
api.post('/orders/items/:id/cancel', wrap((req) => {
  const itemId = req.params.id;
  const item = db.prepare(`SELECT * FROM order_items WHERE id=?`).get(itemId);
  if (!item) throw new Error('Món không tồn tại');

  if (item.status === 'preparing' || item.status === 'ready' || item.status === 'served') {
    throw new Error('Bếp đã chế biến món này, không thể hủy!');
  }

  if (item.status !== 'pending_confirm') {
    const pin = req.body.pin;
    if (!pin) throw new Error('Yêu cầu nhập mã PIN Quản lý/Chủ quán để hủy món đã gửi.');
    const user = db.prepare(`SELECT * FROM users WHERE pin=? AND active=1`).get(String(pin));
    if (!user || (user.role !== 'owner' && user.role !== 'manager')) {
      throw new Error('Mã PIN không đúng hoặc không có quyền Quản lý/Chủ quán.');
    }
  }
  const res = Orders.cancelItem(itemId, req.body.reason || 'Nhân viên hủy', 'br1', actor(req));
  emit('kds:refresh', { station: item.station }, 'br1');
  return res;
}));

api.post('/orders/items/:id/kds-dismiss', wrap((req) => {
  const itemId = req.params.id;
  const item = db.prepare(`SELECT * FROM order_items WHERE id=?`).get(itemId);
  if (!item) throw new Error('Món không tồn tại');
  db.prepare(`UPDATE order_items SET kds_dismissed=1 WHERE id=?`).run(itemId);
  emit('kds:refresh', { station: item.station }, 'br1');
  return { ok: true };
}));

// --- KDS ---
api.get('/kds/:station', wrap((req) => Orders.getStationTickets(req.params.station)));

// --- Staff calls ---
api.post('/calls', wrap((req) => Orders.createStaffCall(req.body.table_id, req.body.reason)));
api.get('/calls', wrap(() => Orders.listStaffCalls()));
api.post('/calls/:table_id/resolve', wrap((req) => { Orders.resolveStaffCall(req.params.table_id); return { ok: true }; }));

// --- Payments ---
api.post('/orders/:id/request-payment', wrap((req) => { Pay.requestPayment(req.body.table_id); return { ok: true }; }));
api.post('/tables/:id/request-payment', wrap((req) => { Pay.requestPayment(req.params.id); return { ok: true }; }));
api.post('/orders/:id/customer-qr-pay', wrap((req) => Pay.customerQrPay(req.params.id, req.body || {})));
api.post('/orders/:id/pay', guard('pay'), wrap((req) => {
  const receipt = Pay.payOrder(req.params.id, req.body.lines, { discount: req.body.discount, customer: req.body.customer || null, cashier: req.user?.name || req.user?.username || '' });
  if (req.body.customer?.id) Customers.recordPurchase(req.body.customer.id, receipt.total, 'br1', req.params.id);
  return receipt;
}));
api.get('/shifts/current', guard('pay'), wrap(() => Shifts.currentShift()));
api.post('/shifts/open', guard('pay'), wrap((req) => Shifts.openShift(req.body, req.user)));
api.post('/shifts/close', guard('pay'), wrap((req) => Shifts.closeShift(req.body, req.user)));
api.get('/shifts', guard('reports'), wrap((req) => Shifts.listShifts('br1', parseInt(req.query.limit) || 40)));
api.get('/cash-drawer/current', guard('pay'), wrap(() => CashDrawer.currentDrawer('br1')));
api.get('/cash-drawer/entries', guardAny('reports', 'pay'), wrap((req) => CashDrawer.listEntries(req.user?.branch_id || 'br1', req.query)));
api.post('/cash-drawer/expense', guard('pay'), wrap((req) => {
  const entry = CashDrawer.createEntry('expense', req.body, req.user, req.user?.branch_id || 'br1');
  emit('shift:updated', { cash_drawer: true, entry }, req.user?.branch_id || 'br1');
  emit('cash-drawer:updated', { entry }, req.user?.branch_id || 'br1');
  return { entry, drawer: CashDrawer.currentDrawer(req.user?.branch_id || 'br1') };
}));
api.post('/cash-drawer/reimbursement', guard('pay'), wrap((req) => {
  const entry = CashDrawer.createEntry('reimbursement', req.body, req.user, req.user?.branch_id || 'br1');
  emit('shift:updated', { cash_drawer: true, entry }, req.user?.branch_id || 'br1');
  emit('cash-drawer:updated', { entry }, req.user?.branch_id || 'br1');
  return { entry, drawer: CashDrawer.currentDrawer(req.user?.branch_id || 'br1') };
}));

// --- Inventory / Warehouse ---
api.get('/warehouses', wrap((req) => Inv.listWarehouses('br1', req.query)));
api.post('/warehouses', guard('warehouse.manage'), wrap((req) => Inv.createWarehouse(req.body)));
api.post('/warehouses/:id/update', guard('warehouse.manage'), wrap((req) => Inv.updateWarehouse(req.params.id, req.body)));
api.get('/inventory', wrap((req) => Inv.listInventory('br1', req.query)));
api.post('/inventory', guard('inventory.adjust'), wrap((req) => Inv.createInventoryItem(req.body)));
api.post('/inventory/:id/update', guard('inventory.adjust'), wrap((req) => Inv.updateInventoryItem(req.params.id, req.body)));
api.post('/inventory/:id/delete', guard('inventory.adjust'), wrap((req) => Inv.deleteInventoryItem(req.params.id)));
api.post('/inventory/:id/receive', wrap((req) => Inv.receiveStock(req.params.id, parseFloat(req.body.qty), 'br1', req.body)));
api.post('/inventory/:id/adjust', guard('inventory.adjust'), wrap((req) => Inv.adjustStock(req.params.id, parseFloat(req.body.stock), 'br1', req.body)));

// --- Retail / SKU ---
api.get('/skus', wrap((req) => Inv.listSkus('br1', req.query)));
api.post('/skus', guard('inventory.adjust'), wrap((req) => Inv.createSku(req.body)));
api.post('/skus/:id/update', guard('inventory.adjust'), wrap((req) => Inv.updateSku(req.params.id, req.body)));
api.post('/skus/:id/delete', guard('inventory.adjust'), wrap((req) => Inv.deleteSku(req.params.id)));
api.get('/skus/barcode/:code', wrap((req) => {
  const s = Inv.findSkuByBarcode(req.params.code);
  if (!s) throw new Error('Không tìm thấy mã vạch ' + req.params.code);
  return s;
}));
api.post('/skus/:id/receive', wrap((req) => Inv.receiveSku(req.params.id, parseFloat(req.body.qty), 'br1', req.body)));
api.post('/skus/:id/adjust', guard('inventory.adjust'), wrap((req) => Inv.adjustSku(req.params.id, parseFloat(req.body.stock), 'br1', req.body)));
api.get('/vouchers', guard('discount'), wrap(() => Vouchers.listVouchers()));
api.get('/vouchers/active', wrap(() => Vouchers.listActiveVouchers()));
api.post('/vouchers', guard('discount'), wrap((req) => Vouchers.createVoucher(req.body)));
api.post('/vouchers/:id/update', guard('discount'), wrap((req) => Vouchers.updateVoucher(req.params.id, req.body)));
api.post('/vouchers/:id/toggle', guard('discount'), wrap((req) => Vouchers.toggleVoucher(req.params.id, req.body.active)));
api.post('/retail/checkout', guard('pay'), wrap((req) => Retail.checkout({ ...req.body, cashier: req.user?.name || req.user?.username || '' })));

// --- Customers (directory + perks + tax-code lookup) ---
api.get('/customers', guard(), wrap((req) => Customers.listCustomers('br1', req.query.q || '')));
api.get('/customers/:id', guard(), wrap((req) => Customers.getCustomer(req.params.id)));
api.post('/customers', guard(), wrap((req) => Customers.upsertCustomer(req.body)));
api.post('/customers/:id/delete', guard('settings.manage'), wrap((req) => Customers.deleteCustomer(req.params.id)));
api.get('/customers/lookup/tax/:mst', guard(), wrap((req) => Customers.lookupTaxCode(req.params.mst)));
api.get('/retail/sales', wrap(() => Retail.listRetailSales()));
api.post('/retail/:id/refund', guard('refund'), wrap((req) => Retail.refund(req.params.id, req.body.reason)));

// --- Warehouse documents / lots / counts ---
api.get('/movements', wrap((req) => Inv.listMovements('br1', parseInt(req.query.limit) || 80)));
api.get('/warehouse/lots', wrap((req) => Inv.listLots('br1', req.query)));
api.post('/warehouse/receive', guard('inventory.adjust'), wrap((req) => {
  const stockType = req.body.stock_type || req.body.item_type;
  return stockType === 'sku' || stockType === 'retail'
    ? Inv.receiveSku(req.body.item_id, parseFloat(req.body.qty), 'br1', req.body)
    : Inv.receiveStock(req.body.item_id, parseFloat(req.body.qty), 'br1', req.body);
}));
api.post('/warehouse/issue', guard('inventory.adjust'), wrap((req) => Inv.issueStock(req.body.stock_type || req.body.item_type, req.body.item_id, parseFloat(req.body.qty), 'br1', req.body)));
api.post('/warehouse/transfer', guard('inventory.adjust'), wrap((req) => Inv.transferStock(req.body)));
api.post('/warehouse/stocktake', guard('inventory.adjust'), wrap((req) => Inv.applyStocktake(req.body)));
api.get('/warehouse/stocktakes', guard('inventory.adjust'), wrap(() => Inv.listStocktakes()));
api.get('/warehouse/documents', wrap((req) => Inv.listDocuments('br1', req.query)));
api.get('/warehouse/documents/:id', wrap((req) => Inv.getDocument(req.params.id)));

// --- Online channels ---
api.post('/online/webhook', wrap((req) => Online.receive(req.body)));
api.get('/online/orders', wrap(() => Online.listOnline()));
api.get('/online/channels', wrap(() => Online.listChannels()));
api.post('/online/orders/:id/status', guard('online'), wrap((req) => Online.setStatus(req.params.id, req.body.status)));

// --- Printing ---
api.get('/print/config', wrap(() => AppSettings.getPrintConfig()));
api.get('/print/jobs', wrap(() => Print.listJobs()));
api.post('/print/jobs/:id/printed', wrap((req) => Print.markPrinted(req.params.id)));
api.post('/print/jobs/:id/reprint', wrap((req) => Print.reprint(req.params.id)));

// --- MISA e-invoice ---
api.post('/invoices/issue', guard('invoice'), wrap((req) => Invoices.issue(req.body.order_id, req.body.customer)));
api.get('/invoices', wrap(() => Invoices.list()));
api.get('/invoices/order/:id', wrap((req) => Invoices.byOrder(req.params.id)));
api.post('/invoices/:id/cancel', guard('invoice'), wrap((req) => Invoices.cancel(req.params.id, req.body.reason)));

// --- Cloud Sync / Offline ---
api.get('/sync/status', wrap(() => Sync.status()));
api.post('/sync/offline', guard('reports'), wrap((req) => Sync.setOffline(req.body.offline)));
api.post('/sync/now', guard('reports'), wrap(() => Sync.syncNow()));

// --- Reports ---
api.get('/dashboard', wrap(() => Reports.dashboard()));
api.get('/dashboard/trends', wrap(() => Reports.revenueTrends()));
api.get('/reports/catalog', guard('reports'), wrap((req) => ReportCenter.catalog(req.user?.branch_id || 'br1')));
api.get('/reports/preview', guard('reports'), wrap((req) => ReportCenter.buildReport(req.query.type || 'sales_overview', req.user?.branch_id || 'br1', req.query)));
api.get('/reports/export', guard('reports'), async (req, res) => {
  try {
    const report = ReportCenter.buildReport(req.query.type || 'sales_overview', req.user?.branch_id || 'br1', req.query);
    const format = String(req.query.format || 'html').toLowerCase();
    if (format === 'json') return res.json(report);
    if (format === 'html') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Content-Disposition', `inline; filename="${ReportCenter.reportFilename(report, 'html')}"`);
      return res.send(ReportCenter.renderReportHtml(report, { mode: 'preview' }));
    }
    if (format === 'doc' || format === 'word') {
      const file = ReportCenter.reportFilename(report, 'doc');
      res.setHeader('Content-Type', 'application/msword; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${file}"`);
      return res.send(ReportCenter.renderReportDoc(report));
    }
    if (format === 'xls' || format === 'xlsx' || format === 'sheet') {
      const file = ReportCenter.reportFilename(report, 'xls');
      res.setHeader('Content-Type', 'application/vnd.ms-excel; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${file}"`);
      return res.send(ReportCenter.renderReportXls(report));
    }
    if (format === 'pdf') {
      const file = ReportCenter.reportFilename(report, 'pdf');
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${file}"`);
      return res.send(await ReportCenter.renderReportPdf(report));
    }
    return res.status(400).json({ error: 'Định dạng báo cáo không hợp lệ' });
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
});
api.get('/audit', guard('audit.view'), wrap((req) => Reports.recentAudit('br1', parseInt(req.query.limit) || 40, req.query.before || null)));

// --- Permanent archive inspection ---
api.get('/archive/status', guard('reports'), wrap(() => Archive.storageStatus()));
api.get('/archive/reports/latest', guard('reports'), wrap(() => Archive.latestDashboardReport('br1')));
api.get('/archive/:kind/:id', guard('reports'), wrap((req) => Archive.readArchivedEntity(req.params.kind, req.params.id, 'br1')));
