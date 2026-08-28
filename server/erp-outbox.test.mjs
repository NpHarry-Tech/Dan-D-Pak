// ERP OUTBOX — điểm CỐT LÕI về đúng đắn (mission #11/#12/#24/#25). Test với
// adapter MOCK (không cần BC thật): idempotency enqueue, sync, retry lỗi tạm
// thời, dead-letter lỗi vĩnh viễn, DUPLICATE = thành công idempotent.
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const temp = mkdtempSync(join(tmpdir(), 'ddp-erp-'));
process.env.SQLITE_PATH = join(temp, 'store.db');
process.env.STORAGE_PATH = join(temp, 'storage');
process.env.DATA_ENCRYPTION_KEY = process.env.DATA_ENCRYPTION_KEY
  || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

const { migrate, db } = await import('./db.js');
const { updateErpConfig } = await import('./services/settings/erp.js');
const { enqueueSale, processErpOutbox } = await import('./integrations/erp/outbox.js');
const { ErpError, ERROR_CLASS } = await import('./integrations/erp/erp_adapter.js');
migrate();

updateErpConfig({ enabled: true, tenantId: 't', clientId: 'c', clientSecret: 'sekret',
  companyId: 'comp', defaultCustomerNo: 'KH-LE' }, 'sala');

const sampleOrder = { id: 'o1', bill_no: 'Dan140826001', paid_at: '2026-08-14T03:00:00.000Z' };
const sampleReceipt = {
  bill_no: 'Dan140826001', total: 50000, vat_amount: 3704, goods_amount: 46296,
  items: [{ id: 'it1', name: 'Cà phê', sku_code: 'CF01', qty: 2, unit_price: 25000, vat_rate: 8, amount: 50000 }],
  lines: [{ method: 'cash', amount: 50000 }],
};

const mockFactory = (impl) => () => ({ postSale: impl });

test('enqueueSale idempotent — cùng bill chỉ 1 dòng outbox', () => {
  enqueueSale(sampleOrder, sampleReceipt, 'sala');
  enqueueSale(sampleOrder, sampleReceipt, 'sala');   // lần 2
  const n = db.prepare(`SELECT COUNT(*) n FROM erp_outbox WHERE branch_id='sala'`).get().n;
  assert.equal(n, 1, 'gửi 2 lần chỉ tạo 1 sự kiện');
  const row = db.prepare(`SELECT external_id, status FROM erp_outbox`).get();
  assert.match(row.external_id, /^DDP-SALE-SALA-DAN140826001$/);
  assert.equal(row.status, 'pending');
});

test('postSale thành công → synced + nav_document_no', async () => {
  const stats = await processErpOutbox({ adapterFactory: mockFactory(async () => ({ documentNo: 'BC-INV-0007' })) });
  assert.equal(stats.synced, 1);
  const row = db.prepare(`SELECT status, nav_document_no FROM erp_outbox`).get();
  assert.equal(row.status, 'synced');
  assert.equal(row.nav_document_no, 'BC-INV-0007');
});

test('ERP tắt → enqueue là no-op', () => {
  updateErpConfig({ enabled: false }, 'sala');
  const r = enqueueSale({ id: 'o2', bill_no: 'Dan140826002' },
    { bill_no: 'Dan140826002', total: 1000, items: [], lines: [] }, 'sala');
  assert.equal(r, null);
  const n = db.prepare(`SELECT COUNT(*) n FROM erp_outbox`).get().n;
  assert.equal(n, 1, 'không thêm dòng khi ERP tắt');
  updateErpConfig({ enabled: true }, 'sala');
});

test('lỗi TẠM THỜI (AUTH) → retry, KHÔNG dead', async () => {
  db.prepare(`INSERT INTO erp_outbox (id,branch_id,external_id,doc_type,payload_json,status,retry_count,next_attempt_at,created_at,updated_at)
    VALUES ('r1','sala','DDP-SALE-SALA-T1','SALE','{"external_id":"x"}','pending',0,NULL,?,?)`)
    .run(new Date().toISOString(), new Date().toISOString());
  const stats = await processErpOutbox({
    adapterFactory: mockFactory(async () => { throw new ErpError('401', ERROR_CLASS.AUTH); }),
  });
  assert.equal(stats.retried, 1);
  const row = db.prepare(`SELECT status, retry_count, next_attempt_at, error_class FROM erp_outbox WHERE id='r1'`).get();
  assert.equal(row.status, 'pending');
  assert.equal(row.retry_count, 1);
  assert.equal(row.error_class, 'AUTH');
  assert.ok(row.next_attempt_at, 'phải đặt lịch retry (backoff)');
});

test('lỗi VĨNH VIỄN (VALIDATION) → dead ngay', async () => {
  db.prepare(`INSERT INTO erp_outbox (id,branch_id,external_id,doc_type,payload_json,status,retry_count,next_attempt_at,created_at,updated_at)
    VALUES ('r2','sala','DDP-SALE-SALA-T2','SALE','{"external_id":"x"}','pending',0,NULL,?,?)`)
    .run(new Date().toISOString(), new Date().toISOString());
  const stats = await processErpOutbox({
    adapterFactory: mockFactory(async () => { throw new ErpError('bad data', ERROR_CLASS.VALIDATION); }),
  });
  assert.equal(stats.dead, 1);
  const row = db.prepare(`SELECT status, error_class FROM erp_outbox WHERE id='r2'`).get();
  assert.equal(row.status, 'dead');
  assert.equal(row.error_class, 'VALIDATION');
});

test('DUPLICATE ở BC → coi như đã post (synced, idempotent)', async () => {
  db.prepare(`INSERT INTO erp_outbox (id,branch_id,external_id,doc_type,payload_json,status,retry_count,next_attempt_at,created_at,updated_at)
    VALUES ('r3','sala','DDP-SALE-SALA-T3','SALE','{"external_id":"x"}','pending',0,NULL,?,?)`)
    .run(new Date().toISOString(), new Date().toISOString());
  const stats = await processErpOutbox({
    adapterFactory: mockFactory(async () => { throw new ErpError('already exists', ERROR_CLASS.DUPLICATE); }),
  });
  assert.equal(stats.synced, 1);
  assert.equal(db.prepare(`SELECT status FROM erp_outbox WHERE id='r3'`).get().status, 'synced');
});

test('hết lượt retry → dead-letter', async () => {
  db.prepare(`INSERT INTO erp_outbox (id,branch_id,external_id,doc_type,payload_json,status,retry_count,next_attempt_at,created_at,updated_at)
    VALUES ('r4','sala','DDP-SALE-SALA-T4','SALE','{"external_id":"x"}','pending',7,NULL,?,?)`)
    .run(new Date().toISOString(), new Date().toISOString());
  const stats = await processErpOutbox({
    adapterFactory: mockFactory(async () => { throw new ErpError('timeout', ERROR_CLASS.TIMEOUT); }),
  });
  assert.equal(stats.dead, 1, 'retry_count=7 (>=MAX) + lỗi tạm thời → dead');
  assert.equal(db.prepare(`SELECT status FROM erp_outbox WHERE id='r4'`).get().status, 'dead');
});
