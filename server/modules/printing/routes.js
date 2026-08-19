// Route ownership: Printing — cấu hình in, máy in, cash drawer, print jobs.
// Nghiệp vụ ở services/printing.js (+ settings.getPrintConfig); giữ NGUYÊN hành vi.
import * as Print from '../../services/printing.js';
import * as AppSettings from '../../services/settings.js';
import * as Auth from '../../services/auth.js';

export function registerPrintingRoutes(api, { wrap, guardAny, branch, actor }) {
// --- Printing ---
const printGuard = guardAny('module.printing', 'settings.printers', 'settings.print', 'pay');
// Máy đang gọi (app gửi x-device-id trong MỌI request — xem api_client.dart).
const deviceOf = (req) => String(req.headers['x-device-id'] || req.query.device_id || '').trim();
// Quản lý máy in = thấy hết + thao tác mọi tuyến. Người còn lại (VD thu ngân chỉ
// có quyền 'pay') chỉ thấy và bấm được máy in cắm thẳng vào MÁY CỦA HỌ.
const privileged = (req) => Print.canManagePrinters(req.user, Auth.canUser);
api.get('/print/config', printGuard, wrap((req) => AppSettings.getPrintConfig(branch(req))));
api.get('/print/printers', printGuard, wrap((req) => Print.listPrinters(branch(req), {
  live: req.query.live === '1',
  force: req.query.force === '1',
  deviceId: deviceOf(req),
  scope: privileged(req) ? 'all' : 'device',
})));
api.post('/print/printers/:id/test', printGuard, wrap((req) => {
  Print.assertPrinterUsableBy(req.params.id, branch(req), {
    privileged: privileged(req), deviceId: deviceOf(req),
  });
  return Print.testPrinter(req.params.id, branch(req));
}));
api.post('/print/cash-drawer/open', printGuard, wrap((req) => {
  const requested = req.body.printer || req.body.printer_id || '';
  if (requested) {
    Print.assertPrinterUsableBy(requested, branch(req), {
      privileged: privileged(req), deviceId: deviceOf(req),
    });
  }
  return Print.openCashDrawer(branch(req), requested, { deviceId: deviceOf(req) });
}));
// In tem mã sản phẩm (Kho hàng → panel chi tiết SKU → "In tem mã").
// Nhân viên kho có quyền inventory cũng in được, không cần quyền máy in.
api.post('/print/product-label',
  guardAny('module.printing', 'settings.printers', 'inventory.adjust', 'warehouse.manage', 'pay'),
  wrap((req) => Print.printProductLabel(branch(req), {
    sku_id: req.body.sku_id || '',
    copies: req.body.copies || 1,
  })));
// In TEM VẬN ĐƠN (waybill 100×150/76×130) cho đơn Retail Online. Người xử lý đơn
// online (online.order.manage) in được mà không cần quyền quản lý máy in.
api.post('/print/shipping-label',
  guardAny('online.order.manage', 'online', 'module.printing', 'settings.printers', 'pay'),
  wrap((req) => Print.printShippingLabel(branch(req), {
    order_id: req.body.order_id || '',
    size: req.body.size || '100x150',
    copies: req.body.copies || 1,
    deviceId: deviceOf(req),
  })));
api.get('/print/jobs', printGuard, wrap((req) => Print.listJobs(branch(req), req.query)));
api.get('/print/jobs/:id', printGuard, wrap((req) => Print.getJobForBranch(req.params.id, branch(req))));
api.get('/print/jobs/:id/text', printGuard, wrap((req) => ({ text: Print.renderJobText(Print.getJobForBranch(req.params.id, branch(req)) || {}) })));
api.post('/print/jobs/:id/print', printGuard, wrap((req) => Print.dispatchJob(req.params.id, branch(req), { force: true })));
api.post('/print/jobs/:id/printed', printGuard, wrap((req) => Print.markPrinted(req.params.id, branch(req), actor(req))));
// In lại phải ra ở MÁY ĐANG BẤM — truyền định danh máy xuống để service phân
// giải lại tuyến, thay vì sao chép tuyến của bản in gốc (có thể là máy khác).
api.post('/print/jobs/:id/reprint', printGuard, wrap((req) => Print.reprint(req.params.id, branch(req), { deviceId: deviceOf(req) })));
}
