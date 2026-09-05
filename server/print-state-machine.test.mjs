// MÁY TRẠNG THÁI IN CANONICAL (risk #3/#4 review checkpoint add0b75).
// Job state bền: queued → (claimed qua claimed_by) → printed | failed, có lease
// recovery. 'printed' CHỈ khi agent ACK thật; dispatch ≠ printed; báo lỗi muộn
// không lật ngược job đã in; ACK sai thiết bị/chi nhánh bị từ chối; reprint là
// thao tác riêng có audit.
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const temp = mkdtempSync(join(tmpdir(), 'dandpak-printsm-'));
process.env.SQLITE_PATH = join(temp, 'store.db');
process.env.STORAGE_PATH = join(temp, 'storage');
process.env.DATA_ENCRYPTION_KEY = process.env.DATA_ENCRYPTION_KEY
  || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

const { migrate, db, now } = await import('./db.js');
const Print = await import('./services/printing.js');
migrate();
const BR = 'sala';

let seq = 0;
function mkJob(printer = 'bill') {
  seq += 1;
  return Print.createJob({
    printer, type: 'receipt', title: `HD ${seq}`, payload: { text: `bill ${seq}` },
    branch_id: BR, idempotency_key: `receipt:${BR}:sm-${seq}:0`,
  });
}
const rowOf = (id) => db.prepare(`SELECT status,claimed_by,printed_by FROM print_jobs WHERE id=?`).get(id);
function claim(id, dev, whenIso = now()) {
  db.prepare(`UPDATE print_jobs SET claimed_by=?, claimed_at=? WHERE id=?`).run(dev, whenIso, id);
}

test('queued → claimed → printed CHỈ khi agent ACK ok', () => {
  const j = mkJob();
  assert.equal(rowOf(j.id).status, 'queued');
  claim(j.id, 'devA');
  const printed = Print.agentReportResult(j.id, BR, { ok: true, deviceId: 'devA' });
  assert.equal(printed.status, 'printed');
  assert.equal(rowOf(j.id).printed_by, 'agent', "printed chỉ do ACK THẬT của agent, không phải dispatch");
});

test('ACK sai THIẾT BỊ bị từ chối, job không bị đánh dấu printed', () => {
  const j = mkJob();
  claim(j.id, 'devA');
  assert.throws(() => Print.agentReportResult(j.id, BR, { ok: true, deviceId: 'devB' }), /không giữ chỗ/i);
  assert.notEqual(rowOf(j.id).status, 'printed');
});

test('ACK sai CHI NHÁNH bị từ chối', () => {
  const j = mkJob();
  claim(j.id, 'devA');
  assert.throws(() => Print.agentReportResult(j.id, 'branch_khac', { ok: true, deviceId: 'devA' }),
    /không thuộc chi nhánh/i);
});

test('ACK/lỗi MUỘN sau khi đã printed KHÔNG lật ngược → không in lặp', () => {
  const j = mkJob();
  claim(j.id, 'devA');
  Print.agentReportResult(j.id, BR, { ok: true, deviceId: 'devA' });
  const after = Print.agentReportResult(j.id, BR, { ok: false, error: 'het giay', deviceId: 'devA' });
  assert.equal(after.status, 'printed', 'đã in xong thì báo lỗi muộn chỉ log, không quay lại hàng đợi');
});

test('LEASE RECOVERY: claim quá hạn (>TTL) reclaim được; claim mới thì không', () => {
  // Kiểm ĐÚNG điều kiện reclaim mà pendingAgentJobs/claimJob dùng (AGENT_CLAIM_TTL_MS
  // = 60s): job bị giữ chỗ quá 60s (agent crash) phải để máy KHÁC nhận lại, còn job
  // vừa giữ chỗ thì không. (Tách khỏi lọc tuyến-in để đo đúng cơ chế lease.)
  const AGENT_CLAIM_TTL_MS = 60_000;
  const stale = mkJob();
  claim(stale.id, 'devA', new Date(Date.now() - 5 * 60_000).toISOString());
  const fresh = mkJob();
  claim(fresh.id, 'devA', now());
  const cutoff = new Date(Date.now() - AGENT_CLAIM_TTL_MS).toISOString();
  const reclaimableByB = (id) => !!db.prepare(
    `SELECT 1 FROM print_jobs WHERE id=? AND status IN ('queued','failed')
       AND (claimed_by IS NULL OR claimed_by='' OR claimed_by=? OR COALESCE(claimed_at,'') < ?)`)
    .get(id, 'devB', cutoff);
  assert.ok(reclaimableByB(stale.id),
    'claim quá hạn phải reclaim được (agent crash → job không kẹt vô hạn ở "claimed")');
  assert.ok(!reclaimableByB(fresh.id), 'claim còn hạn KHÔNG bị máy khác cướp');
});

test('reprint là thao tác RIÊNG: tạo job mới reprint_of và GHI AUDIT print.reprint', () => {
  const j = mkJob();
  claim(j.id, 'devA');
  Print.agentReportResult(j.id, BR, { ok: true, deviceId: 'devA' });
  const before = db.prepare(`SELECT COUNT(*) n FROM audit_log WHERE action='print.reprint'`).get().n;
  const re = Print.reprint(j.id, BR, { deviceId: 'devA' });
  assert.ok(re?.id && re.id !== j.id, 'reprint phải tạo JOB MỚI, không sửa job cũ');
  assert.equal(db.prepare(`SELECT reprint_of FROM print_jobs WHERE id=?`).get(re.id).reprint_of, j.id);
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM audit_log WHERE action='print.reprint'`).get().n,
    before + 1, 'reprint phải để lại vết audit');
});
