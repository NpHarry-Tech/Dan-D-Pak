// Route ownership: Hardware Agent (in vật lý + mở két tại cửa hàng khi server ở VPS).
// Nghiệp vụ ở services/printing.js + system.js. Giữ NGUYÊN hành vi.
import * as Print from '../../services/printing.js';
import * as System from '../../services/system.js';

export function registerAgentRoutes(api, { wrap, guardAny, branch }) {
const printGuard = guardAny('module.printing', 'settings.printers', 'settings.print', 'pay');
// device_id để server GIỮ CHỖ job cho đúng một máy và chỉ phát job của máy in
// cắm-thẳng cho chính máy đang cắm nó — nếu không, nhiều agent cùng in một phiếu.
api.get('/agent/print/pending', printGuard, wrap((req) => ({
  jobs: Print.pendingAgentJobs(branch(req), {
    limit: parseInt(req.query.limit) || 40,
    deviceId: req.query.device_id || req.headers['x-device-id'] || '',
  }),
  serverTime: Date.now(),
})));
api.get('/agent/print/jobs/:id', printGuard, wrap((req) => {
  const j = Print.agentJob(req.params.id, branch(req));
  if (!j) throw new Error('Job không cần agent in (browser/không tồn tại)');
  return j;
}));
api.post('/agent/print/jobs/:id/result', printGuard, wrap((req) =>
  Print.agentReportResult(req.params.id, branch(req), {
    ok: req.body.ok === true || req.body.ok === 'true',
    error: req.body.error,
  })));
// Agent gửi kèm định danh MÁY của nó — server lưu máy in theo từng máy thay vì
// theo chi nhánh, nếu không nhiều máy chạy agent sẽ ghi đè danh sách của nhau.
// Agent bản cũ không gửi 2 trường này thì vẫn nhận, gom vào một khoá chung.
api.post('/agent/printers/report', printGuard, wrap((req) => ({
  ok: true,
  count: System.setAgentPrinters(branch(req), req.body.printers || [], {
    deviceId: req.body.device_id || req.headers['x-device-id'] || '',
    deviceName: req.body.device_name || req.headers['x-device-name'] || '',
  }).length,
})));
// Máy in thấy được, nhóm theo MÁY đang cắm — cho màn Cài đặt → Kết nối.
api.get('/agent/devices', printGuard, wrap((req) => ({
  devices: System.getAgentDevices(branch(req)),
})));
}
