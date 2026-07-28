// Hàng đợi in của Hardware Agent không được để job hỏng bịt đường.
//
// Sự cố thật trên máy POS: cửa hàng đổi cấu hình từ 4 tuyến mặc định
// (kitchen/bill/bar/runner) sang MỘT tuyến "POS 2". 96 job cũ trỏ các tuyến đã
// xoá vẫn nằm 'queued', mà pendingAgentJobs quét cũ-nhất-trước rồi mới lọc nên
// chúng chiếm hết cửa sổ — job in thử mới nhất không bao giờ tới tay agent.
// Thu ngân thấy "Đã gửi job in thử" mà máy in im lặng suốt gần một tháng.
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const temp = mkdtempSync(join(tmpdir(), 'dandpak-printq-'));
process.env.SQLITE_PATH = join(temp, 'store.db');
process.env.STORAGE_PATH = join(temp, 'storage');
process.env.DATA_ENCRYPTION_KEY = process.env.DATA_ENCRYPTION_KEY
  || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

const { db, migrate, now } = await import('./db.js');
const Print = await import('./services/printing.js');
const AppSettings = await import('./services/settings.js');

migrate();

// Cấu hình giống cửa hàng sau khi dọn: CHỈ còn một tuyến in hệ điều hành.
AppSettings.updateSettings({
  print_config: {
    printers: [{
      id: 'POS 2', systemName: 'POS-80C', label: 'Nhãn in',
      output: 'receipt', connection: 'system', active: true,
    }],
  },
}, 'br1');

function queueJob(id, printer, createdAt) {
  db.prepare(`INSERT INTO print_jobs (id,branch_id,printer,type,title,payload_json,status,created_at)
    VALUES (?,?,?,?,?,?,'queued',?)`)
    .run(id, 'br1', printer, 'test', 'x', '{}', createdAt);
}

test('job trỏ tuyến in đã xoá không được chặn job hợp lệ mới hơn', () => {
  // 120 job cũ trỏ các tuyến KHÔNG còn trong cấu hình...
  for (let i = 0; i < 120; i++) {
    queueJob(`pj_old_${i}`, ['kitchen', 'bill', 'bar', 'runner'][i % 4],
      new Date(Date.UTC(2026, 6, 6, 0, 0, i)).toISOString());
  }
  // ...và MỘT job hợp lệ, mới nhất.
  queueJob('pj_new', 'POS 2', now());

  const jobs = Print.pendingAgentJobs('br1', { limit: 40 });
  assert.equal(jobs.length, 1, 'agent phải nhận được job hợp lệ dù nó mới nhất');
  assert.equal(jobs[0].id, 'pj_new');
});

test('job mồ côi bị huỷ hẳn để không quét lại mãi', () => {
  const row = db.prepare(`SELECT status,error FROM print_jobs WHERE id='pj_old_0'`).get();
  assert.equal(row.status, 'cancelled');
  assert.match(row.error, /không còn trong cấu hình/);

  // Lần quét sau không còn phải duyệt qua chúng nữa.
  const conLai = db.prepare(
    `SELECT COUNT(*) n FROM print_jobs WHERE branch_id='br1' AND status IN ('queued','failed')`).get().n;
  assert.equal(conLai, 1, 'chỉ còn đúng job hợp lệ nằm chờ');
});

test('tuyến in TẮT tạm thời thì giữ nguyên hàng đợi, không huỷ oan', () => {
  AppSettings.updateSettings({
    print_config: {
      printers: [{
        id: 'POS 2', systemName: 'POS-80C', label: 'Nhãn in',
        output: 'receipt', connection: 'system', active: false,
      }],
    },
  }, 'br1');
  queueJob('pj_tat', 'POS 2', now());

  assert.equal(Print.pendingAgentJobs('br1', { limit: 40 }).length, 0, 'tuyến tắt thì chưa in');
  assert.equal(
    db.prepare(`SELECT status FROM print_jobs WHERE id='pj_tat'`).get().status,
    'queued',
    'nhưng job phải CÒN chờ để bật lại là in tiếp');
});
