// Route ownership: Printing — cấu hình in, máy in, cash drawer, print jobs.
// Nghiệp vụ ở services/printing.js (+ settings.getPrintConfig); giữ NGUYÊN hành vi.
import * as Print from '../../services/printing.js';
import * as AppSettings from '../../services/settings.js';
import { notImplemented } from '../../core/http.js';

export function registerPrintingRoutes(api, { wrap, guardAny, branch, actor }) {
// --- Printing ---
const printGuard = guardAny('module.printing', 'settings.printers', 'settings.print', 'pay');
api.get('/print/config', printGuard, wrap((req) => AppSettings.getPrintConfig(branch(req))));
api.get('/print/printers', printGuard, wrap((req) => Print.listPrinters(branch(req), { live: req.query.live === '1', force: req.query.force === '1' })));
api.post('/print/printers/:id/test', printGuard, wrap((req) => Print.testPrinter(req.params.id, branch(req))));
api.post('/print/cash-drawer/open', printGuard, wrap((req) => Print.openCashDrawer(branch(req), req.body.printer || req.body.printer_id || '')));
// In tem mã sản phẩm (Kho hàng → panel chi tiết SKU → "In tem mã").
// Nhân viên kho có quyền inventory cũng in được, không cần quyền máy in.
api.post('/print/product-label',
  guardAny('module.printing', 'settings.printers', 'inventory.adjust', 'warehouse.manage', 'pay'),
  wrap((req) => Print.printProductLabel(branch(req), {
    sku_id: req.body.sku_id || '',
    copies: req.body.copies || 1,
  })));
api.get('/print/jobs', printGuard, wrap((req) => Print.listJobs(branch(req), req.query)));
api.get('/print/jobs/:id', printGuard, wrap((req) => Print.getJobForBranch(req.params.id, branch(req))));
api.get('/print/jobs/:id/text', printGuard, wrap((req) => ({ text: Print.renderJobText(Print.getJobForBranch(req.params.id, branch(req)) || {}) })));
api.post('/print/reprint', printGuard, wrap(() => notImplemented('Generic print reprint endpoint is planned. Current app uses /api/print/jobs/:id/reprint.')));
api.post('/print/jobs/:id/print', printGuard, wrap((req) => Print.dispatchJob(req.params.id, branch(req), { force: true })));
api.post('/print/jobs/:id/printed', printGuard, wrap((req) => Print.markPrinted(req.params.id, branch(req), actor(req))));
api.post('/print/jobs/:id/reprint', printGuard, wrap((req) => Print.reprint(req.params.id, branch(req))));
}
