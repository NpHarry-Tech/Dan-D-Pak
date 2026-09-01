// MISA meInvoice — CHẠY THẬT TỪ ĐẦU ĐẾN CUỐI với một máy chủ MISA GIẢ.
//
// Vì sao có file này: không có tài khoản sandbox thì không thể chứng minh
// "nhập thông tin vào là chạy được". Nhưng thứ CẦN chứng minh nằm ở PHÍA
// CHÚNG TA: kiểm tra kết nối 3 bước, ghi cấu hình, chốt bill sinh snapshot,
// worker đẩy hàng đợi, gọi MISA, lưu số hóa đơn, và TUYỆT ĐỐI không phát hành
// hai lần. Máy chủ giả ở đây nói đúng giao thức MISA v3 nên toàn bộ đường đi
// của mình được chạy thật, chỉ có bên kia là giả.
//
// Còn lại đúng MỘT ẩn số không test thay được: đường dẫn và tên trường THẬT
// trong hợp đồng MISA cấp cho doanh nghiệp. Ẩn số đó đã được đưa ra Cài đặt
// (endpointAuth/endpointCompany/…) nên lệch thì sửa cấu hình, không sửa code.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { after, before } from 'node:test';

const temp = mkdtempSync(join(tmpdir(), 'dandpak-misa-e2e-'));
process.env.SQLITE_PATH = join(temp, 'store.db');
process.env.STORAGE_PATH = join(temp, 'storage');
process.env.DATA_ENCRYPTION_KEY = process.env.DATA_ENCRYPTION_KEY
  || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.PRINT_DISPATCH = 'agent';

const { migrate, db } = await import('./db.js');
const Misa = await import('./services/misa/index.js');
const AppSettings = await import('./services/settings.js');
const Einvoices = await import('./services/einvoice.js');
const Invoices = await import('./services/invoices.js');
const Inv = await import('./services/inventory.js');
const Retail = await import('./services/retail.js');
const Shifts = await import('./services/shifts.js');

migrate();

const BR = 'sala';
const TAX = '0312345678';

// ── MÁY CHỦ MISA GIẢ ────────────────────────────────────────────────────────
const state = {
  daPhatHanh: new Map(), // RefID -> invoice
  soLanGoiPublish: 0,
  soLanGoiAuth: 0,
  publishHang: null, // 'timeout' | 'duplicate' | null
  publishDelayMs: 0,
  cancelDelayMs: 0,
  cancelFail: false,
  cancelCalls: 0,
  lastCancelBody: null,
  seq: 0,
};

let server;
let baseURL = '';

function json(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

before(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const path = url.pathname;

    if (path === '/api/v3/auth/token') {
      state.soLanGoiAuth += 1;
      let raw = '';
      req.on('data', (c) => { raw += c; });
      req.on('end', () => {
        const b = JSON.parse(raw || '{}');
        if (b.password !== 'dung-mat-khau') return json(res, 401, { message: 'Sai tài khoản hoặc mật khẩu' });
        json(res, 200, { access_token: 'tok_' + Date.now(), expires_in: 3600 });
      });
      return;
    }

    // Mọi API nghiệp vụ đều phải có Bearer + CompanyTaxCode.
    if (!String(req.headers.authorization || '').startsWith('Bearer ')) {
      return json(res, 401, { message: 'Thiếu token' });
    }

    if (path === '/api/v3/company') {
      const mst = url.searchParams.get('taxcode');
      if (mst !== TAX) return json(res, 200, { data: { TaxCode: '9999999999', CompanyName: 'Cong ty khac' } });
      return json(res, 200, {
        data: { TaxCode: TAX, CompanyName: 'Cong ty Dan D Pak', IsInvoiceWithCode: true, IsActive: true },
      });
    }

    if (path === '/api/v3/invoice-templates') {
      return json(res, 200, {
        data: [
          { TemplateID: 'tpl-1', InvSeries: 'C26MBM', TemplateName: 'HD GTGT may tinh tien', IsInvoiceWithCode: true, IsInvoiceCalculatingMachine: true, IsActive: true },
          { TemplateID: 'tpl-cu', InvSeries: 'C25XXX', TemplateName: 'Mau ngung dung', IsActive: false },
        ],
      });
    }

    if (path === '/api/v3/code/itg/invoice-calculating/invoiceandpublish') {
      state.soLanGoiPublish += 1;
      let raw = '';
      req.on('data', (c) => { raw += c; });
      req.on('end', () => {
        const b = JSON.parse(raw || '{}');
        const ref = b.RefID;
        const publish = () => {
          if (state.publishHang === 'timeout') {
            // Nhận được rồi nhưng KHÔNG trả lời — đúng tình huống nguy hiểm nhất.
            state.daPhatHanh.set(ref, mkInvoice(ref));
            return; // treo, client sẽ hết giờ
          }
          if (state.daPhatHanh.has(ref)) {
            return json(res, 400, { errorCode: 'DUPLICATE_REFID', message: 'RefID đã tồn tại' });
          }
          const inv = mkInvoice(ref);
          state.daPhatHanh.set(ref, inv);
          json(res, 200, { data: inv });
        };
        if (state.publishDelayMs > 0) setTimeout(publish, state.publishDelayMs);
        else publish();
      });
      return;
    }

    if (path === '/api/v3/invoice/status') {
      const ref = url.searchParams.get('refId');
      const inv = state.daPhatHanh.get(ref);
      if (!inv) return json(res, 404, { message: 'Chưa có hóa đơn' });
      return json(res, 200, { data: inv });
    }

    if (path === '/api/v3/invoice/cancel') {
      state.cancelCalls += 1;
      let raw = '';
      req.on('data', (c) => { raw += c; });
      req.on('end', () => {
        const finish = () => {
          state.lastCancelBody = JSON.parse(raw || '{}');
          if (state.cancelFail) return json(res, 503, { message: 'MISA cancel tam thoi loi' });
          json(res, 200, { data: { RefID: state.lastCancelBody.RefID, Cancelled: true } });
        };
        if (state.cancelDelayMs > 0) setTimeout(finish, state.cancelDelayMs);
        else finish();
      });
      return;
    }

    json(res, 404, { message: 'not found' });
  });

  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  baseURL = `http://127.0.0.1:${server.address().port}/api/v3`;
});

after(() => server?.close());

function mkInvoice(ref) {
  state.seq += 1;
  return {
    InvNo: String(1000 + state.seq),
    InvSeries: 'C26MBM',
    LookupCode: 'LK' + state.seq,
    TransactionID: 'TX' + state.seq,
    TaxAuthorityCode: 'CQT' + state.seq,
    RefID: ref,
  };
}

function cfgMau(extra = {}) {
  return {
    enabled: true,
    environment: 'sandbox',
    apiBase: baseURL,
    taxCode: TAX,
    username: 'user',
    password: 'dung-mat-khau',
    appId: 'app',
    integrationType: 'MISA_API_V3',
    taxMethod: 'CREDIT_METHOD',
    roundingPolicy: 'PER_INVOICE',
    invoiceType: 'CASH_REGISTER',
    defaultTaxRate: '8',
    ...extra,
  };
}

// ── I. KIỂM TRA KẾT NỐI ─────────────────────────────────────────────────────

test('TC-CONN-02: sai mat khau -> KHONG bao san sang', async () => {
  const kq = await Misa.testConnection(cfgMau({ password: 'sai' }));
  assert.equal(kq.ok, false);
  assert.equal(kq.step, 'auth');
  assert.equal(kq.status, 'ERROR');
});

test('TC-CONN-03: dung tai khoan nhung SAI ma so thue -> chan', async () => {
  const kq = await Misa.testConnection(cfgMau({ taxCode: '0100000000' }));
  assert.equal(kq.ok, false);
  assert.equal(kq.step, 'company');
  assert.match(kq.message, /không khớp/i);
});

test('TC-CONN-01: dung het -> lay duoc doanh nghiep va mau hoa don', async () => {
  const kq = await Misa.testConnection(cfgMau());
  assert.equal(kq.ok, true);
  assert.equal(kq.company.name, 'Cong ty Dan D Pak');
  assert.equal(kq.company.invoiceWithCode, true);
  // Mẫu đã ngừng sử dụng KHÔNG được hiện ra cho người dùng chọn.
  assert.deepEqual(kq.templates.map((t) => t.id), ['tpl-1']);
  // Chưa chọn mẫu thì chưa được phát hành.
  assert.ok(kq.blockers.some((b) => /mẫu hóa đơn/i.test(b)));
});

test('TC-CONN-05: sandbox nhung tro thang may chu THAT cua MISA -> chan ngay', async () => {
  const kq = await Misa.testConnection(cfgMau({ apiBase: 'https://api.meinvoice.vn' }));
  assert.equal(kq.ok, false);
  assert.match(kq.message, /SANDBOX/);
});

test('dia chi RIENG cua doanh nghiep KHONG bi chan oan', () => {
  // Cổng riêng / on-prem: hệ thống không có cơ sở phán đoán môi trường, cấm
  // bừa là chặn khách hàng hợp lệ.
  assert.equal(Misa.environmentMismatch({ environment: 'sandbox', apiBase: 'https://hoadon.noibo.congty.vn/api/v3' }), '');
  assert.equal(Misa.environmentMismatch({ environment: 'production', apiBase: 'https://hoadon.noibo.congty.vn/api/v3' }), '');
});

test('chon mau roi thi du dieu kien phat hanh', () => {
  const cfg = cfgMau({ templateId: 'tpl-1', series: 'C26MBM', configurationTestPassed: true });
  assert.deepEqual(Misa.activationBlockers(cfg), []);
  assert.equal(Misa.isLive(cfg), true);
  assert.equal(Misa.configStatus(cfg), 'READY');
});

test('token duoc DUNG LAI, khong dang nhap lai moi lan goi', async () => {
  Misa.clearToken();
  const truoc = state.soLanGoiAuth;
  const cfg = cfgMau();
  await Promise.all([
    Misa.fetchCompany(cfg), Misa.fetchCompany(cfg),
    Misa.fetchTemplates(cfg), Misa.fetchTemplates(cfg),
  ]);
  assert.equal(state.soLanGoiAuth - truoc, 1,
    '4 thao tac song song chi duoc dang nhap DUNG MOT lan');
});

// ── II. PHÁT HÀNH ───────────────────────────────────────────────────────────

function batMisa(extra = {}) {
  AppSettings.updateIntegrations({
    channels: { misa: cfgMau({ templateId: 'tpl-1', series: 'C26MBM', configurationTestPassed: true, ...extra }) },
  }, BR);
}

function banMotDon(ma) {
  if (!Shifts.getActiveShift(BR)) {
    Shifts.openShift({ shift_key: 'morning', opening_cash: 0, cash_manual: true },
      { id: 'u1', username: 'test', name: 'Test' }, BR);
  }
  Inv.createSku({ id: ma, name: 'Hat dieu 500g', price: 108000, vat: 8, stock: 50 }, BR);
  return Retail.checkout({
    items: [{ sku_id: ma, qty: 1 }],
    payments: [{ method: 'cash', amount: 108000 }],
    branch_id: BR, cashier: 'test', device_id: 'dev_test',
  });
}

test('TC-ISSUE-01: thanh toan -> snapshot -> hang doi -> phat hanh that', async () => {
  batMisa();
  const receipt = banMotDon('sku_e2e_1');
  const orderId = receipt.order_id || receipt.id;

  const einv = db.prepare(`SELECT * FROM e_invoices WHERE order_id=?`).get(orderId);
  assert.ok(einv, 'chot bill phai sinh ban ghi hoa don ngay');
  assert.ok(einv.request_snapshot, 'phai co snapshot bat bien');
  assert.equal(einv.invoice_status, 'QUEUED');

  await Einvoices.processInvoiceQueue();

  const sau = db.prepare(`SELECT * FROM e_invoices WHERE id=?`).get(einv.id);
  assert.equal(sau.invoice_status, 'ISSUED');
  assert.ok(sau.invoice_no, 'phai luu so hoa don');
  assert.ok(sau.lookup_code, 'phai luu ma tra cuu');
  assert.ok(sau.tax_authority_code, 'phai luu ma CQT');
});

test('VAT tach tu gia DA GOM thue, tong cac dong = tong bill', () => {
  const t = Misa.buildInvoiceLines(
    [{ name: 'A', qty: 1, unit_price: 108000, vat_rate: 8 }], 108000, 8);
  assert.equal(t.grandTotal, 108000);
  assert.equal(t.totalVATAmount, 8000, '108.000 gom 8% -> thue 8.000');
  assert.equal(t.totalAmountWithoutVAT, 100000);
  Misa.assertBalanced(t); // khong duoc nem
});

test('nhieu dong + giam gia: tong cac dong VAN bang tong bill', () => {
  const items = [
    { name: 'A', qty: 3, unit_price: 33333, vat_rate: 8 },
    { name: 'B', qty: 1, unit_price: 17000, vat_rate: 8 },
    { name: 'C', qty: 2, unit_price: 9999, vat_rate: 8 },
  ];
  const t = Misa.buildInvoiceLines(items, 120000, 8);
  Misa.assertBalanced(t);
  assert.equal(t.lines.reduce((s, l) => s + l.Amount + l.VATAmount, 0), 120000);
});

test('TC-ISSUE-07: chay hang doi HAI LAN khong tao hoa don thu hai', async () => {
  batMisa();
  const receipt = banMotDon('sku_e2e_2');
  const orderId = receipt.order_id || receipt.id;
  await Einvoices.processInvoiceQueue();
  const lan1 = db.prepare(`SELECT invoice_no FROM e_invoices WHERE order_id=?`).get(orderId);

  await Einvoices.processInvoiceQueue();
  const rows = db.prepare(`SELECT id, invoice_no FROM e_invoices WHERE order_id=?`).all(orderId);
  assert.equal(rows.length, 1, 'mot bill chi duoc co MOT hoa don');
  assert.equal(rows[0].invoice_no, lan1.invoice_no, 'so hoa don khong duoc doi');
});

test('TC-ISSUE-07B: hai worker song song chi mot worker duoc claim va goi MISA', async () => {
  batMisa();
  const receipt = banMotDon('sku_e2e_race');
  const orderId = receipt.order_id || receipt.id;
  const before = state.soLanGoiPublish;
  state.publishDelayMs = 120;
  try {
    await Promise.all([
      Einvoices.processInvoiceQueue(),
      Einvoices.processInvoiceQueue(),
    ]);
  } finally {
    state.publishDelayMs = 0;
  }

  const invoice = db.prepare(`SELECT * FROM e_invoices WHERE order_id=?`).get(orderId);
  assert.equal(invoice.invoice_status, 'ISSUED');
  assert.equal(state.soLanGoiPublish - before, 1,
    'atomic claim must allow exactly one provider call for the same queued invoice');
});

test('TC-ISSUE-08: MISA da nhan nhung POS het gio -> KHONG phat hanh ban thu hai', async () => {
  batMisa();
  const receipt = banMotDon('sku_e2e_3');
  const orderId = receipt.order_id || receipt.id;

  // Lần 1: MISA nhận request rồi treo → client hết giờ.
  state.publishHang = 'timeout';
  const truocPublish = state.soLanGoiPublish;
  await Einvoices.processInvoiceQueue();
  state.publishHang = null;

  const giua = db.prepare(`SELECT * FROM e_invoices WHERE order_id=?`).get(orderId);
  assert.ok(['RETRYING', 'SENDING', 'FAILED'].includes(giua.invoice_status));
  assert.ok(state.soLanGoiPublish > truocPublish, 'lan dau co goi publish that');

  // Lần 2: phải TRA TRẠNG THÁI trước, thấy đã có rồi thì lấy về, KHÔNG publish nữa.
  db.prepare(`UPDATE e_invoices SET next_retry_at=NULL, invoice_status='RETRYING' WHERE id=?`).run(giua.id);
  const truocLan2 = state.soLanGoiPublish;
  await Einvoices.processInvoiceQueue();

  const cuoi = db.prepare(`SELECT * FROM e_invoices WHERE order_id=?`).get(orderId);
  assert.equal(cuoi.invoice_status, 'ISSUED');
  assert.ok(cuoi.invoice_no);
  assert.equal(state.soLanGoiPublish, truocLan2,
    'DA TRA TRANG THAI thay co roi thi TUYET DOI khong duoc goi publish lan nua');
});

test('TC-ISSUE-10: restart backend giua chung -> job van chay tiep, khong mat', async () => {
  batMisa();
  const receipt = banMotDon('sku_e2e_4');
  const orderId = receipt.order_id || receipt.id;
  // Hàng đợi nằm trong DB nên "restart" = chỉ cần gọi lại worker.
  const truoc = db.prepare(`SELECT invoice_status FROM e_invoices WHERE order_id=?`).get(orderId);
  assert.equal(truoc.invoice_status, 'QUEUED');
  await Einvoices.processInvoiceQueue();
  const sau = db.prepare(`SELECT invoice_status FROM e_invoices WHERE order_id=?`).get(orderId);
  assert.equal(sau.invoice_status, 'ISSUED');
});

test('TC-ISSUE-10B: SENDING cu sau crash duoc reclaim va tra provider truoc publish', async () => {
  batMisa();
  const receipt = banMotDon('sku_e2e_stale_sending');
  const orderId = receipt.order_id || receipt.id;
  const invoice = db.prepare(`SELECT * FROM e_invoices WHERE order_id=?`).get(orderId);
  db.prepare(`UPDATE e_invoices SET invoice_status='SENDING',attempt_count=0,updated_at=? WHERE id=?`)
    .run('2000-01-01T00:00:00.000Z', invoice.id);
  const before = state.soLanGoiPublish;

  await Einvoices.processInvoiceQueue();

  const after = db.prepare(`SELECT * FROM e_invoices WHERE id=?`).get(invoice.id);
  assert.equal(after.invoice_status, 'ISSUED');
  assert.equal(state.soLanGoiPublish - before, 1);
  assert.ok(after.attempt_count >= 2,
    'recovery marks a possible prior send before the claimed retry completes');
  const auditRow = db.prepare(`SELECT action FROM invoice_audit_logs
    WHERE e_invoice_id=? AND action='SENDING_LEASE_RECOVERED'`).get(invoice.id);
  assert.ok(auditRow, 'lease recovery must leave an audit trail');
});

test('TC-ISSUE-10C: SENDING con moi khong bi worker khac cuop lease', async () => {
  batMisa();
  const receipt = banMotDon('sku_e2e_fresh_sending');
  const orderId = receipt.order_id || receipt.id;
  const invoice = db.prepare(`SELECT * FROM e_invoices WHERE order_id=?`).get(orderId);
  db.prepare(`UPDATE e_invoices SET invoice_status='SENDING',updated_at=? WHERE id=?`)
    .run(new Date().toISOString(), invoice.id);
  const before = state.soLanGoiPublish;

  await Einvoices.processInvoiceQueue();

  assert.equal(db.prepare(`SELECT invoice_status FROM e_invoices WHERE id=?`).get(invoice.id).invoice_status,
    'SENDING');
  assert.equal(state.soLanGoiPublish, before);
});

test('TC-CANCEL-01: huy goi dung contract MISA roi moi cap nhat local', async () => {
  batMisa();
  const receipt = banMotDon('sku_e2e_cancel_ok');
  const orderId = receipt.order_id || receipt.id;
  await Einvoices.processInvoiceQueue();
  const invoice = db.prepare(`SELECT * FROM e_invoices WHERE order_id=?`).get(orderId);
  const before = state.cancelCalls;

  await Einvoices.cancelInvoice(invoice.id, 'Khach yeu cau huy', 'manager', BR);

  assert.equal(state.cancelCalls - before, 1);
  assert.equal(state.lastCancelBody.CancelReason, 'Khach yeu cau huy');
  assert.ok(state.lastCancelBody.RefID, 'cancel must send the canonical deterministic RefID');
  assert.equal(db.prepare(`SELECT invoice_status FROM e_invoices WHERE id=?`).get(invoice.id).invoice_status,
    'CANCELLED');
});

test('TC-CANCEL-02: provider loi thi local van ISSUED', async () => {
  batMisa();
  const receipt = banMotDon('sku_e2e_cancel_fail');
  const orderId = receipt.order_id || receipt.id;
  await Einvoices.processInvoiceQueue();
  const invoice = db.prepare(`SELECT * FROM e_invoices WHERE order_id=?`).get(orderId);
  state.cancelFail = true;
  try {
    await assert.rejects(
      Einvoices.cancelInvoice(invoice.id, 'Thu huy bi loi', 'manager', BR),
      /MISA meInvoice lỗi/i,
    );
  } finally {
    state.cancelFail = false;
  }
  const after = db.prepare(`SELECT invoice_status,error_code FROM e_invoices WHERE id=?`).get(invoice.id);
  assert.equal(after.invoice_status, 'ISSUED');
  assert.equal(after.error_code, 'CANCEL_PROVIDER_ERROR');
});

test('TC-CANCEL-03: hai lenh huy dong thoi chi mot request qua provider', async () => {
  batMisa();
  const receipt = banMotDon('sku_e2e_cancel_race');
  const orderId = receipt.order_id || receipt.id;
  await Einvoices.processInvoiceQueue();
  const invoice = db.prepare(`SELECT * FROM e_invoices WHERE order_id=?`).get(orderId);
  const before = state.cancelCalls;
  state.cancelDelayMs = 120;
  try {
    const results = await Promise.allSettled([
      Einvoices.cancelInvoice(invoice.id, 'Huy mot lan', 'manager-a', BR),
      Einvoices.cancelInvoice(invoice.id, 'Huy mot lan', 'manager-b', BR),
    ]);
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal(results.filter(r => r.status === 'rejected').length, 1);
  } finally {
    state.cancelDelayMs = 0;
  }
  assert.equal(state.cancelCalls - before, 1);
});

test('TC-CANCEL-04: CANCELLING hien la dang xu ly tren ledger va reconciliation', async () => {
  batMisa();
  const receipt = banMotDon('sku_e2e_cancel_visible');
  const orderId = receipt.order_id || receipt.id;
  await Einvoices.processInvoiceQueue();
  const invoice = db.prepare(`SELECT * FROM e_invoices WHERE order_id=?`).get(orderId);
  state.cancelDelayMs = 180;
  const cancelling = Einvoices.cancelInvoice(invoice.id, 'Cho provider xac nhan', 'manager', BR);
  try {
    const ledger = Invoices.ledger(BR, { q: orderId });
    assert.equal(ledger.items[0].einvoice_status, 'PROCESSING');
    assert.equal(ledger.items[0].provider_status, 'CANCELLING');
    const reconciliation = Einvoices.getReconciliation(BR, {});
    assert.ok(reconciliation.summary.queued_count >= 1);
  } finally {
    await cancelling;
    state.cancelDelayMs = 0;
  }
});

test('TC-RECON-01: legacy split request is rejected and bill stays canonical', () => {
  AppSettings.updateIntegrations({ channels: { misa: cfgMau({ enabled: false }) } }, BR);
  const before = Einvoices.getReconciliation(BR, { limit: 200 }).summary;
  try {
    const receipt = banMotDon('sku_e2e_recon_alloc');
    const orderId = receipt.order_id || receipt.id;
    assert.throws(() => Einvoices.createInvoiceRequest(orderId, 'BUYER_PROVIDED_INFO',
      { name: 'Khach phan bo' }, BR, 'manager',
      { amount: 40000, idempotency_key: `alloc:${orderId}:1` }),
    (error) => error?.code === 'SPLIT_INVOICE_DISABLED');

    const invoiceRows = db.prepare(`SELECT id FROM e_invoices WHERE order_id=? AND branch_id=?`)
      .all(orderId, BR);
    assert.equal(invoiceRows.length, 1, 'mot bill chi co mot hoa don canonical');

    const after = Einvoices.getReconciliation(BR, { limit: 200 });
    assert.equal(after.summary.total_bills, before.total_bills + 1);
    assert.equal(after.summary.total_revenue, before.total_revenue + 108000);
    assert.equal(after.summary.queued_count, before.queued_count + 1,
      'pending provider van phai hien trong nhom dang cho xu ly');
    assert.equal(after.items.filter(row => row.order_id === orderId).length, 1,
      'danh sach reconciliation chi co mot dong canonical cho bill');
  } finally {
    batMisa();
  }
});

test('MISA chua bat -> van GHI NHAN hoa don dau ra, khong bo sot', async () => {
  AppSettings.updateIntegrations({ channels: { misa: cfgMau({ enabled: false }) } }, BR);
  const receipt = banMotDon('sku_e2e_5');
  const orderId = receipt.order_id || receipt.id;
  const einv = db.prepare(`SELECT * FROM e_invoices WHERE order_id=?`).get(orderId);
  assert.ok(einv, 'tat MISA van phai co ban ghi hoa don dau ra');
  assert.equal(einv.invoice_status, 'PENDING_PROVIDER');

  // Bật lại thì đẩy hết vào hàng đợi phát hành bù.
  batMisa();
  const r = Einvoices.requeuePendingProvider(BR, 'test');
  assert.ok(r.requeued >= 1);
  await Einvoices.processInvoiceQueue();
  assert.equal(
    db.prepare(`SELECT invoice_status FROM e_invoices WHERE order_id=?`).get(orderId).invoice_status,
    'ISSUED');
});

test('loi DU LIEU thi dung han, khong retry 10 lan vo ich', async () => {
  const { MisaError } = await import('./services/misa/client.js');
  const loiDuLieu = new MisaError('Thiếu trường bắt buộc', { retryable: false, status: 400 });
  assert.equal(loiDuLieu.retryable, false);
  const loiMang = new MisaError('timeout', { retryable: true });
  assert.equal(loiMang.retryable, true);
});

test('khong bao gio ghi token/mat khau ra ngoai', async () => {
  const { sanitize } = await import('./services/misa/client.js');
  const s = sanitize({ password: 'bi-mat', access_token: 'abc', Authorization: 'Bearer xyz', ten: 'giu-lai' });
  assert.equal(s.password, '<da-che>');
  assert.equal(s.access_token, '<da-che>');
  assert.equal(s.Authorization, '<da-che>');
  assert.equal(s.ten, 'giu-lai');
});
