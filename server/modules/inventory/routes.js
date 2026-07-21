import * as Inv from '../../services/inventory.js';
import * as Auth from '../../services/auth.js';
import { audit } from '../../db.js';
import { notImplemented } from '../../core/http.js';

function verifyWarehouseConfigAccess(req, branch) {
  const branch_id = branch(req);
  const pin = req.body.security_pin || req.body.warehouse_pin || req.body.manager_pin || req.body.owner_pin || req.body.password;
  const approvedBy = Auth.verifyWarehouseConfigPin(pin, branch_id);
  if (!approvedBy) throw new Error('Can nhap PIN cua Thu kho, Manager hoac Admin de tao/cau hinh kho.');
  delete req.body.security_pin;
  delete req.body.warehouse_pin;
  delete req.body.manager_pin;
  delete req.body.owner_pin;
  delete req.body.password;
  return { branch_id, approvedBy };
}

export function registerInventoryRoutes(api, { wrap, guard, guardAny, branch, visibleBranch }) {
  api.get('/warehouses', wrap((req) => Inv.listWarehouses(visibleBranch(req), req.query)));
  api.post('/warehouses', guardAny('warehouse.create', 'warehouse.manage'), wrap((req) => {
    const { branch_id, approvedBy } = verifyWarehouseConfigAccess(req, branch);
    audit('warehouse.config.reauth', { action: 'create', approved_by: approvedBy.username }, branch_id, approvedBy.username);
    return Inv.createWarehouse(req.body, branch_id);
  }));
  api.post('/warehouses/:id/update', guardAny('warehouse.create', 'warehouse.manage'), wrap((req) => {
    const { branch_id, approvedBy } = verifyWarehouseConfigAccess(req, branch);
    audit('warehouse.config.reauth', { action: 'update', warehouse_id: req.params.id, approved_by: approvedBy.username }, branch_id, approvedBy.username);
    return Inv.updateWarehouse(req.params.id, req.body, branch_id);
  }));

  api.get('/inventory', guard(), wrap((req) => Inv.listInventory(visibleBranch(req), req.query)));
  api.post('/inventory', guardAny('warehouse.item', 'inventory.adjust'), wrap((req) => Inv.createInventoryItem(req.body, branch(req))));
  api.post('/inventory/movements', guard('inventory.adjust'), wrap(() => notImplemented('Generic inventory movement endpoint is planned. Current app uses warehouse receive/issue/transfer/stocktake endpoints.')));
  api.post('/inventory/:id/update', guardAny('warehouse.item', 'inventory.adjust'), wrap((req) => Inv.updateInventoryItem(req.params.id, req.body, branch(req))));
  api.post('/inventory/:id/delete', guardAny('warehouse.delete', 'inventory.adjust'), wrap((req) => Inv.deleteInventoryItem(req.params.id, branch(req))));
  api.post('/inventory/:id/receive', guardAny('warehouse.receive', 'inventory.adjust'), wrap((req) => Inv.receiveStock(req.params.id, parseFloat(req.body.qty), visibleBranch(req), req.body)));
  api.post('/inventory/:id/adjust', guardAny('warehouse.item', 'inventory.adjust'), wrap((req) => Inv.adjustStock(req.params.id, parseFloat(req.body.stock), branch(req), req.body)));

  api.get('/skus', guard(), wrap((req) => Inv.listSkus(visibleBranch(req), req.query)));
  api.post('/skus', guardAny('warehouse.item', 'inventory.adjust'), wrap((req) => Inv.createSku(req.body, branch(req))));
  api.post('/skus/:id/update', guardAny('warehouse.item', 'inventory.adjust'), wrap((req) => Inv.updateSku(req.params.id, req.body, branch(req))));
  api.post('/skus/:id/delete', guardAny('warehouse.delete', 'inventory.adjust'), wrap((req) => Inv.deleteSku(req.params.id, branch(req))));
  api.get('/skus/barcode/:code', guard(), wrap((req) => {
    const s = Inv.findSkuByBarcode(req.params.code, visibleBranch(req), req.query);
    if (!s) throw new Error('Khong tim thay ma vach ' + req.params.code);
    return s;
  }));
  api.post('/skus/:id/receive', guardAny('warehouse.receive', 'inventory.adjust'), wrap((req) => Inv.receiveSku(req.params.id, parseFloat(req.body.qty), visibleBranch(req), req.body)));
  api.post('/skus/:id/adjust', guardAny('warehouse.item', 'inventory.adjust'), wrap((req) => Inv.adjustSku(req.params.id, parseFloat(req.body.stock), branch(req), req.body)));

  api.get('/movements', guardAny('inventory.adjust', 'warehouse.manage', 'reports'), wrap((req) => Inv.listMovements(visibleBranch(req), req.query)));
  api.get('/warehouse/lots', guard(), wrap((req) => Inv.listLots(visibleBranch(req), req.query)));
  api.post('/warehouse/receive', guardAny('warehouse.receive', 'inventory.adjust'), wrap((req) => {
    const branch_id = branch(req);
    const stockType = req.body.stock_type || req.body.item_type;
    return stockType === 'sku' || stockType === 'retail'
      ? Inv.receiveSku(req.body.item_id, parseFloat(req.body.qty), branch_id, req.body)
      : Inv.receiveStock(req.body.item_id, parseFloat(req.body.qty), branch_id, req.body);
  }));
  api.post('/warehouse/issue', guardAny('warehouse.issue', 'inventory.adjust'), wrap((req) => Inv.issueStock(req.body.stock_type || req.body.item_type, req.body.item_id, parseFloat(req.body.qty), branch(req), req.body)));
  api.post('/warehouse/transfer', guardAny('warehouse.transfer', 'inventory.adjust'), wrap((req) => Inv.transferStock({ ...req.body, created_by: req.user?.name || req.user?.username }, branch(req))));
  api.post('/warehouse/stocktake', guardAny('warehouse.stocktake', 'inventory.adjust'), wrap((req) => Inv.applyStocktake(req.body, branch(req))));
  // Kiểm kho theo phiếu (Phiếu tạm -> Cân bằng kho | Hủy) — KiotViet StockTakes.
  api.get('/warehouse/stocktakes', guardAny('warehouse.stocktake', 'inventory.adjust'), wrap((req) => Inv.listStocktakes(branch(req), req.query)));
  api.get('/warehouse/stocktakes/:id', guardAny('warehouse.stocktake', 'inventory.adjust'), wrap((req) => Inv.getStocktakeSession(req.params.id, branch(req))));
  api.post('/warehouse/stocktakes', guardAny('warehouse.stocktake', 'inventory.adjust'), wrap((req) => Inv.saveStocktakeSession(req.body, branch(req), req.user)));
  api.post('/warehouse/stocktakes/:id/update', guardAny('warehouse.stocktake', 'inventory.adjust'), wrap((req) => Inv.saveStocktakeSession({ ...req.body, id: req.params.id }, branch(req), req.user)));
  api.post('/warehouse/stocktakes/:id/approve', guardAny('warehouse.stocktake.balance', 'inventory.adjust'), wrap((req) => Inv.approveStocktakeSession(req.params.id, branch(req), req.user)));
  api.post('/warehouse/stocktakes/:id/cancel', guardAny('warehouse.stocktake', 'inventory.adjust'), wrap((req) => Inv.cancelStocktakeSession(req.params.id, branch(req), req.user)));
  // Xuất dùng nội bộ: một phiếu XDNB nhiều dòng.
  api.post('/warehouse/internal-use', guardAny('warehouse.issue', 'inventory.adjust'), wrap((req) => Inv.issueInternalUse(req.body, branch(req), req.user)));
  // Thiết lập giá: SKU + giá vốn + giá nhập cuối + giá bán trước/sau thuế.
  // ?book_id=pb_xxx → kèm cột book_price của bảng giá đó (NULL = dùng giá chung).
  api.get('/warehouse/price-book', guardAny('inventory.adjust', 'warehouse.manage'), wrap((req) => Inv.priceBook(visibleBranch(req), req.query)));
  // Bảng giá: danh sách + tạo/sửa/xóa (cấu hình trong Cài đặt → Kho & kênh bán)
  // + đặt giá riêng từng SKU trong một bảng giá.
  api.get('/warehouse/price-books', guardAny('inventory.adjust', 'warehouse.manage', 'settings.warehouse'), wrap((req) => Inv.listPriceBooks(visibleBranch(req))));
  api.post('/warehouse/price-books', guardAny('warehouse.pricebook', 'warehouse.manage', 'settings.warehouse'), wrap((req) => Inv.savePriceBookMeta(req.body, branch(req), req.user)));
  api.post('/warehouse/price-books/:id/delete', guardAny('warehouse.pricebook', 'warehouse.delete', 'warehouse.manage', 'settings.warehouse'), wrap((req) => Inv.deletePriceBookMeta(req.params.id, branch(req), req.user)));
  api.post('/warehouse/price-book/entry', guardAny('warehouse.pricebook', 'inventory.adjust', 'warehouse.manage'), wrap((req) => Inv.setPriceBookEntry(req.body, branch(req), req.user)));
  api.get('/warehouse/documents', guardAny('inventory.adjust', 'warehouse.manage'), wrap((req) => Inv.listDocuments(visibleBranch(req), req.query)));
  api.get('/warehouse/documents/:id', guardAny('inventory.adjust', 'warehouse.manage'), wrap((req) => Inv.getDocument(req.params.id, visibleBranch(req))));
}
