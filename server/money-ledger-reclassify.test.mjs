// HIEU NANG: reclassifyLedger() truoc day truy van + bien dich lai bang
// money_rules cho TUNG dong giao dich (co the hang tram nghin dong o cua hang
// chay nhieu nam) — gio nap rules MOT LAN roi truyen vao cho ca vong lap.
// Test nay khoa lai dung: viec dung chung 1 danh sach rules KHONG lam sai
// ket qua phan loai cho tung dong khac nhau.
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const temp = mkdtempSync(join(tmpdir(), 'dandpak-money-reclassify-'));
process.env.SQLITE_PATH = join(temp, 'store.db');
process.env.STORAGE_PATH = join(temp, 'storage');
process.env.DATA_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

const { db, migrate, now } = await import('./db.js');
migrate();
const Money = await import('./services/moneyLedger.js');

Money.upsertMoneyRule({ pattern: 'dien luc', category: 'utilities', priority: 10 }, 'sala');
Money.upsertMoneyRule({ pattern: 'nha cung cap A', category: 'supplier_a', priority: 20 }, 'sala');

function insertTx(id, counterparty) {
  db.prepare(`INSERT INTO money_transactions
    (id, ts, branch_id, direction, amount, source, source_id, counterparty, created_at)
    VALUES (?, ?, 'sala', 'out', 100000, 'expense', ?, ?, ?)`)
    .run(id, now(), id, counterparty, now());
}

insertTx('tx_1', 'Thanh toan Dien luc thang 9');
insertTx('tx_2', 'Mua hang Nha cung cap A');
insertTx('tx_3', 'Khong khop rule nao ca');

test('reclassifyLedger phan loai DUNG tung dong du dung chung 1 danh sach rules', () => {
  const result = Money.reclassifyLedger('sala');
  assert.equal(result.reclassified, 2);

  const rows = Object.fromEntries(
    db.prepare(`SELECT id, category FROM money_transactions WHERE branch_id='sala'`).all()
      .map((r) => [r.id, r.category]));
  assert.equal(rows.tx_1, 'utilities');
  assert.equal(rows.tx_2, 'supplier_a');
  assert.equal(rows.tx_3, null);
});
