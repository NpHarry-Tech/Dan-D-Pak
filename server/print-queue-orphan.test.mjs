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
const System = await import('./services/system.js');
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

test('hai máy cùng hỏi thì CHỈ MỘT máy nhận job — không in trùng', () => {
  System.setAgentPrinters('br1', [{ Name: 'POS-80C' }], { deviceId: 'dev_A', deviceName: 'A' });
  System.setAgentPrinters('br1', [{ Name: 'POS-80C' }], { deviceId: 'dev_B', deviceName: 'B' });
  queueJob('pj_dua', 'POS 2', now());

  const a = Print.pendingAgentJobs('br1', { limit: 40, deviceId: 'dev_A' });
  const b = Print.pendingAgentJobs('br1', { limit: 40, deviceId: 'dev_B' });
  const idsA = a.map(j => j.id);
  const idsB = b.map(j => j.id);
  assert.ok(idsA.includes('pj_dua'), 'máy hỏi trước giữ được chỗ');
  assert.ok(!idsB.includes('pj_dua'), 'máy hỏi sau KHÔNG được nhận lại job đó');
});

test('máy không cắm máy in đó thì không nhận job của máy in cắm thẳng', () => {
  System.setAgentPrinters('br1', [{ Name: 'POS-80C' }], { deviceId: 'dev_co', deviceName: 'CO' });
  System.setAgentPrinters('br1', [{ Name: 'Microsoft Print to PDF' }],
    { deviceId: 'dev_khong', deviceName: 'KHONG' });
  queueJob('pj_dungmay', 'POS 2', now());

  const khong = Print.pendingAgentJobs('br1', { limit: 40, deviceId: 'dev_khong' });
  assert.ok(!khong.map(j => j.id).includes('pj_dungmay'),
    'máy không có POS-80C thì không được nhận — nếu nhận nó sẽ in lỗi rồi kéo job đã in về failed');

  const co = Print.pendingAgentJobs('br1', { limit: 40, deviceId: 'dev_co' });
  assert.ok(co.map(j => j.id).includes('pj_dungmay'), 'đúng máy đang cắm thì nhận được');
});

test('báo lỗi đến MUỘN không lật ngược job đã in xong', () => {
  queueJob('pj_xong', 'POS 2', now());
  Print.agentReportResult('pj_xong', 'br1', { ok: true });
  assert.equal(db.prepare(`SELECT status FROM print_jobs WHERE id='pj_xong'`).get().status, 'printed');

  // Máy thứ hai in lỗi và báo về muộn.
  Print.agentReportResult('pj_xong', 'br1', { ok: false, error: 'Khong tim thay may in' });
  assert.equal(
    db.prepare(`SELECT status FROM print_jobs WHERE id='pj_xong'`).get().status,
    'printed',
    'job đã in xong phải GIỮ NGUYÊN — nếu về failed nó sẽ vào lại hàng đợi và in lần nữa');
});

test('MÁY CHỦ TRÌ: hai máy cùng với tới một máy in bill thì chỉ máy chính in', () => {
  // Máy in bill LAN — cả hai máy POS đều với tới được.
  AppSettings.updateSettings({
    print_config: {
      printers: [{
        id: 'bill_lan', label: 'Máy in bill', output: 'receipt',
        connection: 'lan', ip: '192.168.1.50', port: 9100, active: true,
        primaryDeviceId: 'dev_pos1',
      }],
    },
  }, 'br1');
  System.setAgentPrinters('br1', [], { deviceId: 'dev_pos1', deviceName: 'POS 1' });
  System.setAgentPrinters('br1', [], { deviceId: 'dev_pos2', deviceName: 'POS 2' });

  queueJob('pj_bill1', 'bill_lan', now());
  assert.equal(
    Print.pendingAgentJobs('br1', { limit: 40, deviceId: 'dev_pos2' }).length, 0,
    'POS 2 không phải máy chính thì không được in');
  assert.ok(
    Print.pendingAgentJobs('br1', { limit: 40, deviceId: 'dev_pos1' })
      .map(j => j.id).includes('pj_bill1'),
    'POS 1 là máy chính thì in');
});

test('MÁY CHỦ TRÌ nghỉ thì máy còn lại gánh, không tắc bán hàng', () => {
  // Chỉ POS 2 còn báo cáo — POS 1 (máy chính) coi như đã tắt.
  System.setAgentPrinters('br2', [], { deviceId: 'dev_pos2', deviceName: 'POS 2' });
  AppSettings.updateSettings({
    print_config: {
      printers: [{
        id: 'bill_lan', label: 'Máy in bill', output: 'receipt',
        connection: 'lan', ip: '192.168.1.50', port: 9100, active: true,
        primaryDeviceId: 'dev_pos1_da_tat',
      }],
    },
  }, 'br2');
  db.prepare(`INSERT INTO print_jobs (id,branch_id,printer,type,title,payload_json,status,created_at)
    VALUES ('pj_bill2','br2','bill_lan','receipt','x','{}','queued',?)`).run(now());

  assert.ok(
    Print.pendingAgentJobs('br2', { limit: 40, deviceId: 'dev_pos2' })
      .map(j => j.id).includes('pj_bill2'),
    'máy chính offline thì máy còn lại phải in được');
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
