// Route ownership: Purchase (Mua hàng) — PO lifecycle + nhận hàng + công nợ NCC.
// Nghiệp vụ ở services/purchase.js; giữ NGUYÊN hành vi như khi ở api.js.
import * as Purchase from '../../services/purchase.js';

export function registerPurchaseRoutes(api, { wrap, guard, branch }) {
// --- Purchase (Mua hàng): PO lifecycle + nhận hàng vào kho + công nợ NCC ---
api.get('/purchase', guard('module.purchase'), wrap((req) => Purchase.listPurchaseOrders(branch(req), req.query)));
// Đặt TRƯỚC '/purchase/:id' để không bị bắt nhầm là id.
api.get('/purchase/last-prices', guard('module.purchase'), wrap((req) => Purchase.lastPurchasePrices(branch(req), { supplier_id: req.query.supplier_id || '', supplier_name: req.query.supplier_name || '' })));
api.get('/purchase/:id', guard('module.purchase'), wrap((req) => Purchase.getPurchaseOrder(req.params.id, branch(req))));
api.post('/purchase', guard('module.purchase'), wrap((req) => Purchase.savePurchaseOrder(req.body, branch(req), req.user)));
api.post('/purchase/:id/confirm', guard('module.purchase'), wrap((req) => Purchase.confirmPurchaseOrder(req.params.id, branch(req), req.user)));
api.post('/purchase/:id/receive', guard('module.purchase'), wrap((req) => Purchase.receivePurchaseOrder(req.params.id, req.body, branch(req), req.user)));
// "Hoàn thành" kiểu KiotViet: nháp -> xác nhận -> nhận đủ vào kho trong 1 bước.
api.post('/purchase/:id/complete', guard('module.purchase'), wrap((req) => Purchase.completePurchaseOrder(req.params.id, req.body, branch(req), req.user)));
api.post('/purchase/:id/pay', guard('module.purchase'), wrap((req) => Purchase.recordPurchasePayment(req.params.id, req.body, branch(req), req.user)));
api.post('/purchase/:id/cancel', guard('module.purchase'), wrap((req) => Purchase.cancelPurchaseOrder(req.params.id, branch(req), req.user)));
api.post('/purchase/:id/delete', guard('module.purchase'), wrap((req) => Purchase.deletePurchaseOrder(req.params.id, branch(req), req.user)));

// --- Trả hàng nhập (PurchaseReturns): phiếu tạm -> đã trả hàng | đã hủy ---
api.get('/purchase-returns', guard('module.purchase'), wrap((req) => Purchase.listPurchaseReturns(branch(req), req.query)));
api.get('/purchase-returns/:id', guard('module.purchase'), wrap((req) => Purchase.getPurchaseReturn(req.params.id, branch(req))));
api.post('/purchase-returns', guard('module.purchase'), wrap((req) => Purchase.savePurchaseReturn(req.body, branch(req), req.user)));
api.post('/purchase-returns/:id/complete', guard('module.purchase'), wrap((req) => Purchase.completePurchaseReturn(req.params.id, req.body, branch(req), req.user)));
api.post('/purchase-returns/:id/cancel', guard('module.purchase'), wrap((req) => Purchase.cancelPurchaseReturn(req.params.id, branch(req), req.user)));
api.post('/purchase-returns/:id/delete', guard('module.purchase'), wrap((req) => Purchase.deletePurchaseReturn(req.params.id, branch(req), req.user)));
}
