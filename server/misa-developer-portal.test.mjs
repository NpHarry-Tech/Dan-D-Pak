// MISA meInvoice — LUỒNG DEVELOPER PORTAL (developer.misa.vn), cơ chế thay thế
// API v3 cũ. Máy chủ giả nói đúng contract đã xác nhận (token/templates/
// publish) + các mã lỗi nghiệp vụ MISA liệt kê trong yêu cầu bàn giao
// (InvoiceDuplicated/InvoiceNumberNotCotinuous/SystemError). Xem
// misa-end-to-end.test.mjs cho luồng API v3 cũ — file này KHÔNG lặp lại các
// kịch bản đã test ở đó (toán VAT, worker lease, cancel…), chỉ test phần khác
// biệt của provider mới + không phá vỡ luồng chung (queue/idempotency/in phiếu).
//
// GIẢ ĐỊNH CHƯA XÁC MINH VỚI MISA (xem services/misa/developerPortal.js và
// báo cáo bàn giao): tên khóa bọc mảng request publish ("Data"), field trong
// publishInvoiceResult ngoài các field đã nêu rõ trong yêu cầu bàn giao. Máy
// chủ giả ở đây PHẢN ÁNH ĐÚNG những gì code hiện tại gửi/đọc — không phải bằng
// chứng MISA thật sự dùng đúng những tên này.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { after } from 'node:test';

const temp = mkdtempSync(join(tmpdir(), 'dandpak-misa-portal-'));
process.env.SQLITE_PATH = join(temp, 'store.db');
process.env.STORAGE_PATH = join(temp, 'storage');
process.env.DATA_ENCRYPTION_KEY = process.env.DATA_ENCRYPTION_KEY
  || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.PRINT_DISPATCH = 'agent';
// Developer Portal chọn được (thay vì API v3) khi CẢ HAI biến này có mặt —
// xem providerKind() trong services/misa/config.js. KHÔNG set MISA_MEINVOICE_APP_ID.
process.env.MISA_MEINVOICE_CLIENT_ID = 'client-id-that';
process.env.MISA_MEINVOICE_CLIENT_SECRET = 'client-secret-CUC-KY-BI-MAT';

const BR = 'sala';
const TAX = '0312345678';
const SECRET_CANARY = process.env.MISA_MEINVOICE_CLIENT_SECRET;

// ── MÁY CHỦ DEVELOPER PORTAL GIẢ ─────────────────────────────────────────────
const state = {
  daPhatHanh: new Map(), // RefID -> invoice đã "phát hành"
  soLanGoiAuth: 0,
  soLanGoiPublish: 0,
  receivedHeaders: { token: null, templates: null, publish: null },
  publishMode: null, // null | 'timeout' | 'duplicate_elem' | 'not_continuous' | 'system_error' | 'request_level_fail'
  seq: 0,
};

function json(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function mkInvoice(ref) {
  state.seq += 1;
  return {
    RefID: ref,
    InvNo: String(5000 + state.seq),
    InvCode: 'CODE' + state.seq,
    InvSeries: 'C26MBM',
    InvTemplateNo: 'tpl-1',
    TransactionID: 'PORTAL-TX-' + state.seq,
    IsSuccess: true,
  };
}

const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const path = url.pathname;

  if (path === '/invoice/token') {
    state.soLanGoiAuth += 1;
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      state.receivedHeaders.token = {
        clientId: req.headers.clientid,
        clientSecret: req.headers.clientsecret,
      };
      const b = JSON.parse(raw || '{}');
      // Contract chuẩn: ClientID/ClientSecret ở HEADER, không phải body — nếu
      // adapter lỡ nhét vào body thì taxcode/username/password mới đúng field.
      // Shape lỗi {Success,ErrorCode,DescriptionErrorCode,Errors,Data,
      // CustomData} + HTTP 400 XÁC NHẬN THẬT từ MISA Developer Portan (2026-09-19,
      // không còn là giả định) — xem client.js::messageOf.
      if (req.headers.clientid !== 'client-id-that' || req.headers.clientsecret !== SECRET_CANARY) {
        return json(res, 400, {
          Success: false, ErrorCode: 'UnAuthorize', DescriptionErrorCode: 'Sai ClientID/ClientSecret',
          Errors: ['MisaIdError'], Data: '', CustomData: '',
        });
      }
      if (b.password !== 'dung-mat-khau') {
        return json(res, 400, {
          Success: false, ErrorCode: 'UnAuthorize', DescriptionErrorCode: 'Sai thông tin đăng nhập',
          Errors: ['MisaIdError'], Data: '', CustomData: '',
        });
      }
      // Shape thanh cong THAT: Data la JWT dang CHUOI TRUC TIEP (khong phai
      // {access_token}) — xac nhan tu response that (2026-09-19, HTTP 200).
      json(res, 200, { Success: true, ErrorCode: null, Data: 'portal-tok-' + Date.now(), CustomData: '' });
    });
    return;
  }

  if (!String(req.headers.authorization || '').startsWith('Bearer ')) {
    return json(res, 401, { message: 'Thiếu token' });
  }

  if (path === '/invoice/templates') {
    state.receivedHeaders.templates = { clientId: req.headers.clientid };
    return json(res, 200, {
      data: [
        { TemplateID: 'tpl-1', InvSeries: 'C26MBM', TemplateName: 'HD GTGT Developer Portal', IsInvoiceCalculatingMachine: true, IsActive: true },
        { TemplateID: 'tpl-cu', InvSeries: 'C25XXX', TemplateName: 'Mau ngung dung', IsActive: false },
      ],
    });
  }

  if (path === '/invoice/publishing') {
    state.soLanGoiPublish += 1;
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      state.receivedHeaders.publish = { clientId: req.headers.clientid };
      const b = JSON.parse(raw || '{}');
      const invoice = b.Data?.[0];
      const ref = invoice?.RefID;
      assert.equal(Array.isArray(b.Data), true, 'request publish phai la mang (Data)');
      assert.equal(b.Data.length, 1, 'Dan D Pak luon gui dung 1 hoa don/request');

      const respond = () => {
        if (state.publishMode === 'request_level_fail') {
          return json(res, 200, { IsSuccess: false, ErrorCode: 'SystemError', ErrorMessage: 'Loi he thong MISA (request-level)' });
        }
        if (state.publishMode === 'duplicate_elem') {
          return json(res, 200, {
            IsSuccess: true,
            publishInvoiceResult: [{ RefID: ref, IsSuccess: false, ErrorCode: 'InvoiceDuplicated', ErrorMessage: 'Hoa don da ton tai' }],
          });
        }
        if (state.publishMode === 'not_continuous') {
          return json(res, 200, {
            IsSuccess: true,
            publishInvoiceResult: [{ RefID: ref, IsSuccess: false, ErrorCode: 'InvoiceNumberNotCotinuous', ErrorMessage: 'So hoa don khong lien tuc' }],
          });
        }
        if (state.publishMode === 'system_error') {
          return json(res, 200, {
            IsSuccess: true,
            publishInvoiceResult: [{ RefID: ref, IsSuccess: false, ErrorCode: 'SystemError', ErrorMessage: 'Loi he thong MISA' }],
          });
        }
        if (state.publishMode === 'timeout') {
          // Nhận được rồi (ghi nhận đã "phát hành") nhưng KHÔNG trả lời — client
          // sẽ hết giờ, đúng tình huống nguy hiểm nhất cần tra trước khi retry.
          state.daPhatHanh.set(ref, mkInvoice(ref));
          return;
        }
        if (state.daPhatHanh.has(ref)) {
          return json(res, 200, {
            IsSuccess: true,
            publishInvoiceResult: [{ RefID: ref, IsSuccess: false, ErrorCode: 'InvoiceDuplicated', ErrorMessage: 'Hoa don da ton tai' }],
          });
        }
        const inv = mkInvoice(ref);
        state.daPhatHanh.set(ref, inv);
        json(res, 200, { IsSuccess: true, publishInvoiceResult: [inv] });
      };
      respond();
    });
    return;
  }

  if (path === '/invoice/status') {
    const ref = url.searchParams.get('refId');
    const inv = state.daPhatHanh.get(ref);
    if (!inv) return json(res, 404, { message: 'Chua co hoa don' });
    return json(res, 200, { data: inv });
  }

  json(res, 404, { message: 'not found in fake developer portal server' });
});

await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseURL = `http://127.0.0.1:${server.address().port}`;
// Credential ứng dụng đọc thẳng process.env, snapshot NGAY LÚC import
// config/env.js — phải set TRƯỚC dòng import đầu tiên bên dưới.
process.env.MISA_MEINVOICE_BASE_URL = baseURL;

after(() => new Promise((resolve) => server.close(resolve)));

const { migrate, db } = await import('./db.js');
const Misa = await import('./services/misa/index.js');
const AppSettings = await import('./services/settings.js');
const IntegrationsSvc = await import('./services/settings/integrations.js');
const Einvoices = await import('./services/einvoice.js');
const Inv = await import('./services/inventory.js');
const Retail = await import('./services/retail.js');
const Shifts = await import('./services/shifts.js');

migrate();

function cfgMau(extra = {}) {
  return Misa.resolveServerCredentials({
    enabled: true, environment: 'sandbox', taxCode: TAX,
    username: 'user', password: 'dung-mat-khau',
    invoiceType: 'CASH_REGISTER', defaultTaxRate: '8',
    ...extra,
  });
}

function batMisa(extra = {}) {
  AppSettings.updateIntegrations({
    channels: { misa: {
      enabled: true, environment: 'sandbox', taxCode: TAX, username: 'user', password: 'dung-mat-khau',
      invoiceType: 'CASH_REGISTER', defaultTaxRate: '8',
      templateId: 'tpl-1', series: 'C26MBM', configurationTestPassed: true,
      ...extra,
    } },
  }, BR);
}

function banMotDon(sku) {
  if (!Shifts.getActiveShift(BR)) {
    Shifts.openShift({ shift_key: 'morning', opening_cash: 0, cash_manual: true },
      { id: 'u1', username: 'test', name: 'Test' }, BR);
  }
  Inv.createSku({ id: sku, name: 'Hat dieu 500g', price: 108000, vat: 8, stock: 50 }, BR);
  return Retail.checkout({
    items: [{ sku_id: sku, qty: 1 }],
    payments: [{ method: 'cash', amount: 108000 }],
    branch_id: BR, cashier: 'test', device_id: 'dev_test',
  });
}

const einvOf = (orderId) => db.prepare(`SELECT * FROM e_invoices WHERE order_id=?`).get(orderId);

// ── 0. PROVIDER SELECTION ────────────────────────────────────────────────────

test('co ClientID+ClientSecret -> providerKind chon Developer Portal, khong phai API v3', () => {
  const resolved = Misa.resolveServerCredentials({});
  assert.equal(resolved.integrationType, 'MISA_DEVELOPER_PORTAL');
  assert.equal(resolved.clientId, 'client-id-that');
  assert.equal(resolved.appId, '', 'khong con dung AppID cu khi da chon Developer Portal');
});

// ── 1. TOKEN: đúng ClientID/ClientSecret, không rò rỉ ────────────────────────

test('TC-AUTH-01: dang nhap gui dung ClientID/ClientSecret o HEADER (khong phai body)', async () => {
  Misa.clearToken();
  await Misa.getToken(cfgMau(), { force: true });
  assert.equal(state.receivedHeaders.token.clientId, 'client-id-that');
  assert.equal(state.receivedHeaders.token.clientSecret, SECRET_CANARY);
});

test('TC-AUTH-02: sai mat khau -> tu choi, khong retry vo ich', async () => {
  Misa.clearToken();
  await assert.rejects(() => Misa.getToken(cfgMau({ password: 'sai' }), { force: true }));
});

test('TC-AUTH-02B: loi that tu MISA (Success/ErrorCode/DescriptionErrorCode/Errors) hien dung noi dung, KHONG con "HTTP 400" chung chung', async () => {
  Misa.clearToken();
  const kq = await Misa.testConnection(cfgMau({ password: 'sai' }));
  assert.equal(kq.ok, false);
  assert.equal(kq.step, 'auth');
  assert.equal(kq.message, 'Sai thông tin đăng nhập');
  assert.notEqual(kq.message, 'HTTP 400');
});

test('TC-AUTH-03: token duoc CACHE, khong dang nhap lai moi request nghiep vu', async () => {
  Misa.clearToken();
  const truoc = state.soLanGoiAuth;
  const cfg = cfgMau();
  await Promise.all([Misa.fetchTemplates(cfg), Misa.fetchTemplates(cfg), Misa.fetchTemplates(cfg)]);
  assert.equal(state.soLanGoiAuth - truoc, 1, '3 request song song chi dang nhap DUNG MOT lan (single-flight)');
});

test('TC-AUTH-04: token het han (14 ngay) -> tu xin lai, khong dung token cu', async () => {
  Misa.clearToken();
  await Misa.getToken(cfgMau(), { force: true });
  const lanDau = state.soLanGoiAuth;
  // force:true mo phong tinh huong token het han/bi tu choi giua chung.
  await Misa.getToken(cfgMau(), { force: true });
  assert.equal(state.soLanGoiAuth, lanDau + 1);
});

test('TC-SEC-01: ClientSecret KHONG BAO GIO xuat hien trong bat ky log/response nao he thong tra ra', () => {
  const dump = JSON.stringify(db.prepare(`SELECT * FROM e_invoices`).all())
    + JSON.stringify(db.prepare(`SELECT * FROM invoice_audit_logs`).all());
  assert.equal(dump.includes(SECRET_CANARY), false);
});

test('TC-SEC-02: getPublicIntegrations KHONG BAO GIO tra clientId/clientSecret cho kenh misa', () => {
  // Mo phong client cu tinh/vo y gui thua truong ky thuat — phai bi loc sach
  // giong het cach appId/apiBase/secretKey da bi loc (xem misa-connect-flow.test.mjs).
  IntegrationsSvc.updateIntegrations({
    channels: { misa: {
      enabled: true, taxCode: TAX, username: 'ketoan', password: 'matkhauthat',
      clientId: 'lo-ra-ngoai', clientSecret: SECRET_CANARY,
      templateId: 'tpl-1', series: 'C26MBM', configurationTestPassed: true,
    } },
  }, BR);
  const pub = IntegrationsSvc.getPublicIntegrations(BR);
  assert.equal(pub.channels.misa.clientId, undefined);
  assert.equal(pub.channels.misa.clientSecret, undefined);
  assert.ok(!JSON.stringify(pub).includes(SECRET_CANARY));
});

// ── 2. TEMPLATE MAPPING (2 bước: auth -> templates, KHÔNG có bước company) ───

test('TC-CONN-01: testConnection Developer Portal chi 2 buoc (auth+templates), bo qua company', async () => {
  const kq = await Misa.testConnection(cfgMau());
  assert.equal(kq.ok, true);
  assert.deepEqual(kq.templates.map((t) => t.id), ['tpl-1'], 'mau ngung dung bi loc, khong hien ra');
  assert.equal(kq.company.invoiceWithCode, null, 'khong co du lieu company o Developer Portal, khong duoc bia');
});

// ── 3. PHÁT HÀNH: thành công, lưu TransactionID/InvNo ────────────────────────

test('TC-ISSUE-01: phat hanh that qua Developer Portal, luu du InvNo + TransactionID (provider_invoice_id)', async () => {
  state.publishMode = null;
  batMisa();
  const receipt = banMotDon('sku_portal_1');
  const orderId = receipt.order_id || receipt.id;
  const before = einvOf(orderId);
  assert.equal(before.invoice_status, 'QUEUED');

  await Einvoices.processInvoiceQueue();

  const after1 = einvOf(orderId);
  assert.equal(after1.invoice_status, 'ISSUED');
  assert.ok(after1.invoice_no, 'phai luu InvNo');
  assert.ok(after1.provider_invoice_id, 'phai luu TransactionID vao provider_invoice_id de doi chieu/tra cuu');
  assert.match(after1.provider_invoice_id, /^PORTAL-TX-/);
});

test('TC-ISSUE-02: replay cung bill (processInvoiceQueue lan 2) KHONG tao hoa don thu hai', async () => {
  state.publishMode = null;
  batMisa();
  const receipt = banMotDon('sku_portal_2');
  const orderId = receipt.order_id || receipt.id;
  await Einvoices.processInvoiceQueue();
  const soLanPublishSauLan1 = state.soLanGoiPublish;
  const invoiceNoLan1 = einvOf(orderId).invoice_no;

  // Bill da ISSUED thi khong con nam trong QUEUED/RETRYING nua — processInvoiceQueue
  // khong dung lai vao no. Day la bat bien "khong phat hanh trung khi worker replay".
  await Einvoices.processInvoiceQueue();
  assert.equal(state.soLanGoiPublish, soLanPublishSauLan1, 'khong goi publish them lan nao');
  assert.equal(einvOf(orderId).invoice_no, invoiceNoLan1);
});

// ── 4. InvoiceDuplicated: reconcile, KHÔNG đổi RefID ─────────────────────────

test('TC-ISSUE-03: MISA bao InvoiceDuplicated -> tra trang thai cu, dong bo, KHONG tao hoa don moi', async () => {
  state.publishMode = null;
  batMisa();
  const receipt = banMotDon('sku_portal_3');
  const orderId = receipt.order_id || receipt.id;
  // Phat hanh that lan dau de MISA "da co" hoa don nay.
  await Einvoices.processInvoiceQueue();
  const invNoThat = einvOf(orderId).invoice_no;
  assert.ok(invNoThat);

  // Bay gio ep processJob goi lai issueInvoice() truc tiep (mo phong tinh huong
  // worker retry mot job da SENDING/RETRYING) — kiem tra Misa.issueInvoice tu no
  // reconcile dung, khong doi RefID.
  const request = JSON.parse(einvOf(orderId).request_snapshot);
  const snapshot = { ...request, order_id: orderId, branch_id: BR, schema_version: 1 };
  const misaCfg = Misa.resolveServerCredentials(AppSettings.getIntegrations(BR).channels.misa);
  const soLanPublishTruoc = state.soLanGoiPublish;
  const kq = await Misa.issueInvoice({ snapshot, cfg: misaCfg, mayHaveLanded: false });
  assert.equal(kq.deduplicated, true);
  assert.equal(kq.invoice_no, invNoThat, 'RefID/hoa don khong doi, chi dong bo lai');
  assert.equal(state.soLanGoiPublish, soLanPublishTruoc + 1, 'co goi publish (bi MISA tu choi InvoiceDuplicated) nhung khong tao them hoa don');
});

// ── 5. InvoiceNumberNotCotinuous: retry có delay (retryable=true) ───────────

test('TC-ISSUE-04: InvoiceNumberNotCotinuous -> retryable=true, worker chuyen RETRYING co backoff', async () => {
  state.publishMode = 'not_continuous';
  batMisa();
  const receipt = banMotDon('sku_portal_4');
  const orderId = receipt.order_id || receipt.id;

  await Einvoices.processInvoiceQueue();
  const after1 = einvOf(orderId);
  assert.equal(after1.invoice_status, 'RETRYING', 'loi tam thoi phai duoc lich thu lai, khong FAILED ngay');
  assert.ok(after1.next_retry_at, 'phai co backoff, khong retry ngay lap tuc');
  assert.match(after1.error_message, /khong lien tuc|NotCotinuous/i);

  state.publishMode = null; // lan sau MISA on dinh lai
});

// ── 6. SystemError: exponential backoff ─────────────────────────────────────

test('TC-ISSUE-05: SystemError o TUNG PHAN TU publishInvoiceResult -> retryable, khong FAILED ngay', async () => {
  state.publishMode = 'system_error';
  batMisa();
  const receipt = banMotDon('sku_portal_5');
  const orderId = receipt.order_id || receipt.id;
  await Einvoices.processInvoiceQueue();
  assert.equal(einvOf(orderId).invoice_status, 'RETRYING');
  state.publishMode = null;
});

test('TC-ISSUE-06: MISA tu choi CA REQUEST (request-level IsSuccess=false) -> van phan loai dung, khong crash', async () => {
  state.publishMode = 'request_level_fail';
  batMisa();
  const receipt = banMotDon('sku_portal_6');
  const orderId = receipt.order_id || receipt.id;
  await Einvoices.processInvoiceQueue();
  assert.equal(einvOf(orderId).invoice_status, 'RETRYING', 'SystemError o cap request cung retryable');
  state.publishMode = null;
});

// ── 7. Timeout sau khi MISA đã nhận: tra cứu trước khi retry ─────────────────

test('TC-ISSUE-07: MISA nhan roi nhung timeout -> lan sau TRA TRUOC KHI GUI LAI, khong tao 2 hoa don', async () => {
  batMisa();
  const receipt = banMotDon('sku_portal_7');
  const orderId = receipt.order_id || receipt.id;

  state.publishMode = 'timeout';
  const misaCfg = Misa.resolveServerCredentials(AppSettings.getIntegrations(BR).channels.misa);
  const request = JSON.parse(einvOf(orderId).request_snapshot);
  const snapshot = { ...request, order_id: orderId, branch_id: BR, schema_version: 1 };
  await assert.rejects(
    Misa.issueInvoice({ snapshot, cfg: { ...misaCfg }, mayHaveLanded: false }),
    (e) => e.retryable === true && e.mayHaveLanded === true,
  );

  state.publishMode = null;
  const soLanPublishTruoc = state.soLanGoiPublish;
  const kq = await Misa.issueInvoice({ snapshot, cfg: misaCfg, mayHaveLanded: true });
  assert.equal(kq.deduplicated, true, 'phai nhan ra MISA da co hoa don nay tu lan timeout truoc, khong gui lai nhu moi');
  assert.equal(state.soLanGoiPublish, soLanPublishTruoc, 'mayHaveLanded=true phai TRA TRANG THAI TRUOC, khong goi publish lai');
});

// ── 8. at_payment và at_shift_close vẫn hoạt động đúng qua Developer Portal ──

test('TC-TIMING-01: at_payment (mac dinh) -> QUEUED ngay, phat hanh khi worker chay', async () => {
  state.publishMode = null;
  batMisa();
  AppSettings.updateSettings({ print_config: { einvoice: { issueTiming: 'at_payment' } } }, BR);
  const r = banMotDon('sku_portal_8');
  const orderId = r.order_id || r.id;
  assert.equal(einvOf(orderId).invoice_status, 'QUEUED');
});

test('TC-TIMING-02: at_shift_close -> giu QUEUED_FOR_SHIFT_CLOSE, KHONG goi MISA cho den khi ket ca', async () => {
  state.publishMode = null;
  batMisa();
  AppSettings.updateSettings({
    print_config: { printers: [], einvoice: { issueTiming: 'at_shift_close' } },
  }, BR);
  const r = banMotDon('sku_portal_9');
  const orderId = r.order_id || r.id;
  assert.equal(einvOf(orderId).invoice_status, 'QUEUED_FOR_SHIFT_CLOSE');

  await Einvoices.processInvoiceQueue();
  // KHONG assert tong so lan goi publish toan cuc — cac test truoc co the de lai
  // job RETRYING (backoff) duoc chinh worker nay nhat tien xu ly lai (dung hanh
  // vi). Chi can bill CUA TEST NAY khong bi dung vao la du.
  assert.equal(einvOf(orderId).invoice_status, 'QUEUED_FOR_SHIFT_CLOSE', 'worker khong duoc dung vao bill dang cho ket ca');

  const shift = Shifts.getActiveShift(BR);
  const closeResult = await Shifts.closeShift(
    { shift_key: shift.shift_key, closing_cash: 0, counts: {} },
    { id: 'u1', username: 'quanly', name: 'Quan Ly' }, BR);
  assert.equal(closeResult.einvoice_batch.issued, 1);
  assert.equal(einvOf(orderId).invoice_status, 'ISSUED');

  // Reset ve mac dinh — khong duoc ro ri chinh sach nay sang test sau.
  AppSettings.updateSettings({ print_config: { einvoice: { issueTiming: 'at_payment' } } }, BR);
});

// ── 9. Không tự in nếu chưa có InvNo thật ────────────────────────────────────

test('TC-PRINT-01: hoa don loi (RETRYING) khong tao phieu xac nhan in — chi in sau khi ISSUED that', async () => {
  state.publishMode = 'system_error';
  batMisa();
  // Can it nhat 1 may in "active" thi firePrintInvoiceConfirmation moi tao duoc
  // print_job — xem misa-shift-close-batch.test.mjs, cung pattern.
  AppSettings.updateSettings({ print_config: {
    printers: [{ id: 'pos80c', name: 'POS-80C', systemName: 'POS-80C',
      label: 'in bill', output: 'receipt', connection: 'system', active: true, auto: true }],
    einvoice: { issueTiming: 'at_payment' },
  } }, BR);
  const jobsBefore = db.prepare(`SELECT COUNT(*) n FROM print_jobs WHERE type='invoice_confirmation'`).get().n;
  const r = banMotDon('sku_portal_10');
  const orderId = r.order_id || r.id;
  await Einvoices.processInvoiceQueue();
  assert.equal(einvOf(orderId).invoice_status, 'RETRYING');
  const jobsAfterFail = db.prepare(`SELECT COUNT(*) n FROM print_jobs WHERE type='invoice_confirmation'`).get().n;
  assert.equal(jobsAfterFail, jobsBefore, 'chua ISSUED thi tuyet doi khong duoc co phieu xac nhan');

  state.publishMode = null;
  // RETRYING dang cho backoff (next_retry_at trong tuong lai) — mo phong thoi
  // gian da troi qua thay vi that su sleep trong test.
  db.prepare(`UPDATE e_invoices SET next_retry_at=NULL WHERE order_id=?`).run(orderId);
  await Einvoices.processInvoiceQueue();
  assert.equal(einvOf(orderId).invoice_status, 'ISSUED');
  const jobsAfterSuccess = db.prepare(`SELECT COUNT(*) n FROM print_jobs WHERE type='invoice_confirmation'`).get().n;
  assert.equal(jobsAfterSuccess, jobsBefore + 1, 'ISSUED that roi moi duoc co dung 1 phieu xac nhan');
});
