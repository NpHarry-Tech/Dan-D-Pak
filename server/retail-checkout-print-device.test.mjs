// BÁN LẺ THU TIỀN XONG PHẢI IN RA MÁY IN CỦA CHÍNH MÁY ĐÓ.
//
// Sự cố thật (2026-08-01, máy POS cầm tay Sunmi): thanh toán xong bill không tự
// in, chỉ "In thử" là chạy. Nguyên nhân: `/orders/:id/pay` có đọc header
// `x-device-id` và truyền xuống printReceipt, còn `/retail/checkout` — đường mà
// MỌI đơn bán lẻ đi qua — thì không. deviceId rỗng làm resolvePrinterForOutput
// bỏ qua cả ba bước ưu tiên "máy in của máy này", nên máy in gắn liền của máy
// cầm tay (chỉ tồn tại qua agent, không nằm trong print_config) không còn đường
// nào để được chọn → không tạo job nào.
//
// In thử không dính vì testPrinter() gọi thẳng theo id tuyến, không phân giải.
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const temp = mkdtempSync(join(tmpdir(), 'dandpak-ckdev-'));
process.env.SQLITE_PATH = join(temp, 'store.db');
process.env.STORAGE_PATH = join(temp, 'storage');
process.env.DATA_ENCRYPTION_KEY = process.env.DATA_ENCRYPTION_KEY
  || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.PRINT_DISPATCH = 'agent';

const { migrate, db } = await import('./db.js');
const Print = await import('./services/printing.js');
const System = await import('./services/system.js');

migrate();

const BR = 'sala';

test('deviceId rong -> KHONG roi vao tuyen browser chet', () => {
  System.setAgentPrinters(BR, [{ Name: 'InnerPrinter' }], {
    deviceId: 'dev_sunmi', deviceName: 'SUNMI-V2',
  });
  const hoaDon = { number: 'HD100', bill_no: 'Dan010826100', total: 50000 };
  const jobs = Print.printReceipt(hoaDon, BR, { deviceId: '' });
  // Cau hinh MAC DINH co san tuyen id 'bill' kieu 'browser'. O che do agent no
  // KHONG BAO GIO ra giay (vong quet chi phat job lan/system), nhung truoc day
  // no thang o buoc legacyId va chan het cac buoc tim may in that ben duoi.
  for (const j of jobs) {
    assert.notEqual(j.printer, 'bill',
      'tuyen browser mac dinh khong duoc thang - job se nam queued vinh vien');
    assert.ok(!String(j.printer).startsWith('auto:dev_sunmi:'),
      'khong co deviceId thi khong duoc vo may in cua mot thiet bi bat ky');
  }
});

test('co deviceId -> bill ra dung may in gan lien cua may do', () => {
  System.setAgentPrinters(BR, [{ Name: 'InnerPrinter' }], {
    deviceId: 'dev_sunmi', deviceName: 'SUNMI-V2',
  });
  const hoaDon = { number: 'HD101', bill_no: 'Dan010826101', total: 50000 };
  const jobs = Print.printReceipt(hoaDon, BR, { deviceId: 'dev_sunmi' });
  assert.equal(jobs.length, 1, 'phai tao dung 1 lenh in');
  assert.match(String(jobs[0].printer), /^auto:dev_sunmi:InnerPrinter$/);
  assert.equal(hoaDon.print_error, undefined, 'in duoc thi khong co loi');
});

test('may in local thang tuyen cu da gan tren order', () => {
  System.setAgentPrinters(BR, [{ Name: 'InnerPrinter' }], {
    deviceId: 'dev_local_priority', deviceName: 'SUNMI-LOCAL',
  });
  const hoaDon = {
    number: 'HD101B', bill_no: 'Dan010826101B', total: 50000,
    linked_printer_id: 'bill',
  };
  const jobs = Print.printReceipt(hoaDon, BR, { deviceId: 'dev_local_priority' });
  assert.equal(jobs.length, 1);
  assert.match(String(jobs[0].printer), /^auto:dev_local_priority:InnerPrinter$/);
});

test('may KHAC dang cam may in -> KHONG vo sang in nho', () => {
  System.setAgentPrinters(BR, [{ Name: 'MayInQuay' }], {
    deviceId: 'dev_quay', deviceName: 'POS-QUAY',
  });
  // Máy cầm tay không còn báo máy in nào.
  System.setAgentPrinters(BR, [], {
    deviceId: 'dev_sunmi', deviceName: 'SUNMI-V2',
  });
  const hoaDon = { number: 'HD102', bill_no: 'Dan010826102', total: 50000 };
  const jobs = Print.printReceipt(hoaDon, BR, { deviceId: 'dev_sunmi' });
  for (const j of jobs) {
    assert.ok(!String(j.printer).startsWith('auto:dev_quay:'),
      'in ra may in cua nguoi khac thi khong ai biet di tim');
  }
});

test('luong retail.checkout THAT truyen deviceId xuong toi lenh in', async () => {
  System.setAgentPrinters(BR, [{ Name: 'InnerPrinter' }], {
    deviceId: 'dev_sunmi', deviceName: 'SUNMI-V2',
  });
  const Retail = await import('./services/retail.js');
  const Inv = await import('./services/inventory.js');
  const Shifts = await import('./services/shifts.js');

  // Bán hàng đòi có ca đang mở — mở một ca thật để đi đúng luồng production.
  if (!Shifts.getActiveShift(BR)) {
    Shifts.openShift({ shift_key: 'morning', opening_cash: 0, cash_manual: true },
      { id: 'u1', username: 'test', name: 'Test' }, BR);
  }

  // Một mặt hàng bán được, có tồn.
  Inv.createSku({ id: 'sku_in', name: 'Hat dieu 500g', price: 50000, stock: 10 }, BR);

  const truoc = db.prepare(`SELECT COUNT(*) c FROM print_jobs WHERE type='receipt'`).get().c;
  const receipt = Retail.checkout({
    items: [{ sku_id: 'sku_in', qty: 1 }],
    payments: [{ method: 'cash', amount: 50000 }],
    branch_id: BR,
    cashier: 'test',
    device_id: 'dev_sunmi',
  });
  const sau = db.prepare(`SELECT COUNT(*) c FROM print_jobs WHERE type='receipt'`).get().c;
  assert.ok(sau > truoc, 'checkout phai sinh lenh in hoa don');
  assert.equal(receipt.print_status, 'queued',
    'tao job ben khong duoc gan nhan da in khi agent chua ACK');
  assert.equal(receipt.print_job_ids.length, 1);
  assert.equal(Print.receiptPrintStatus(receipt.payment_id, BR).status, 'queued');
  const pending = Print.pendingAgentJobs(BR, { limit: 100, deviceId: 'dev_sunmi' });
  assert.ok(pending.some(item => item.id === receipt.print_job_ids[0]));
  assert.equal(Print.receiptPrintStatus(receipt.payment_id, BR).status, 'claimed');
  Print.agentReportResult(receipt.print_job_ids[0], BR, {
    ok: true,
    deviceId: 'dev_sunmi',
  });
  assert.equal(Print.receiptPrintStatus(receipt.payment_id, BR).status, 'printed');

  const job = db.prepare(
    `SELECT printer FROM print_jobs WHERE type='receipt' ORDER BY created_at DESC LIMIT 1`).get();
  assert.match(String(job.printer), /^auto:dev_sunmi:/,
    'phai in ra may in cua CHINH may vua thu tien');
});

test('loi tao print job KHONG duoc rollback payment da thanh cong', async () => {
  System.setAgentPrinters(BR, [{ Name: 'InnerPrinter' }], {
    deviceId: 'dev_print_fail', deviceName: 'SUNMI-FAIL',
  });
  const Retail = await import('./services/retail.js');
  const Inv = await import('./services/inventory.js');
  const Shifts = await import('./services/shifts.js');
  if (!Shifts.getActiveShift(BR)) {
    Shifts.openShift({ shift_key: 'morning', opening_cash: 0, cash_manual: true },
      { id: 'u1', username: 'test', name: 'Test' }, BR);
  }
  Inv.createSku({ id: 'sku_print_fail', name: 'Hang test loi in', price: 25000, stock: 1 }, BR);
  db.exec(`CREATE TRIGGER fail_receipt_job BEFORE INSERT ON print_jobs
    WHEN NEW.type='receipt' BEGIN SELECT RAISE(ABORT, 'forced print failure'); END;`);
  let receipt;
  try {
    receipt = Retail.checkout({
      items: [{ sku_id: 'sku_print_fail', qty: 1 }],
      payments: [{ method: 'cash', amount: 25000 }],
      branch_id: BR,
      cashier: 'test',
      device_id: 'dev_print_fail',
      client_request_id: 'print_failure_must_not_rollback',
    });
    assert.equal(receipt.total, 25000);
    assert.equal(db.prepare(`SELECT status FROM orders WHERE id=?`).get(receipt.order_id).status, 'paid');
    assert.equal(db.prepare(`SELECT stock FROM skus WHERE id='sku_print_fail'`).get().stock, 0);
    assert.equal(db.prepare(`SELECT COUNT(*) n FROM sale_snapshots WHERE order_id=?`).get(receipt.order_id).n, 1);
    assert.equal(db.prepare(`SELECT status FROM receipt_print_outbox WHERE payment_id=?`).get(receipt.payment_id).status, 'retrying');
  } finally {
    db.exec(`DROP TRIGGER IF EXISTS fail_receipt_job`);
  }
  const retried = Print.processReceiptPrintOutbox();
  assert.equal(retried.done, 1, 'worker phải phục hồi lệnh in sau khi printer DB hoạt động lại');
  assert.equal(db.prepare(`SELECT status FROM receipt_print_outbox WHERE payment_id=?`).get(receipt.payment_id).status, 'done');
  Print.processReceiptPrintOutbox();
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM print_jobs WHERE idempotency_key LIKE ?`)
    .get(`receipt:${BR}:${receipt.payment_id}:%`).n, 1, 'replay worker không được tạo bản in trùng');
});
