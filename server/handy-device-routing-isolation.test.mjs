import test from 'node:test';
import assert from 'node:assert/strict';
import { db } from './db.js';
import * as Print from './services/printing.js';
import * as System from './services/system.js';

function xoaJob() {
  db.prepare("DELETE FROM print_jobs WHERE branch_id='sala'").run();
}

function dangKyDevice(deviceId, printerName) {
  System.setAgentPrinters('sala', [{ Name: printerName, widthMm: 58 }], {
    deviceId,
    deviceName: deviceId,
    agentVersion: '2.0.0',
  });
}

test('Handy 01 không được nhận, đọc hoặc báo kết quả job của Handy 02', () => {
  xoaJob();

  // Cả hai máy Handy 01 và Handy 02 đều có máy in cùng tên "May in tich hop"
  dangKyDevice('dev_handy_01', 'May in tich hop');
  dangKyDevice('dev_handy_02', 'May in tich hop');

  // Tạo job in thử dành riêng cho Handy 02 qua tuyến ngầm auto:dev_handy_02:May in tich hop
  const job = Print.createJob({
    printer: 'auto:dev_handy_02:May in tich hop',
    type: 'test',
    title: 'In thử Handy 02',
    payload: { text: 'In thử Handy 02' },
    branch_id: 'sala',
  });

  // 1. Handy 01 pending không được có job này
  const pendingHandy01 = Print.pendingAgentJobs('sala', { deviceId: 'dev_handy_01' });
  assert.equal(pendingHandy01.length, 0, 'Handy 01 không được nhận job của Handy 02 trong pending');

  // 2. Handy 02 pending có đúng job
  const pendingHandy02 = Print.pendingAgentJobs('sala', { deviceId: 'dev_handy_02' });
  assert.equal(pendingHandy02.length, 1, 'Handy 02 phải nhận được đúng 1 job');
  assert.equal(pendingHandy02[0].id, job.id, 'Job nhận được phải đúng ID');

  // 3. claimed_by trong DB là dev_handy_02
  const dbJob = db.prepare("SELECT claimed_by FROM print_jobs WHERE id=?").get(job.id);
  assert.equal(dbJob.claimed_by, 'dev_handy_02', 'Job phải được giữ chỗ bởi dev_handy_02');

  // 4. Handy 01 không đọc được chi tiết job
  assert.throws(
    () => Print.agentJob(job.id, 'sala', { deviceId: 'dev_handy_01' }),
    /không thuộc về thiết bị|không có quyền/i,
    'Handy 01 không được phép đọc chi tiết job của Handy 02'
  );

  // 5. Handy 01 không báo kết quả được cho job của Handy 02
  assert.throws(
    () => Print.agentReportResult(job.id, 'sala', { ok: true, deviceId: 'dev_handy_01' }),
    /không giữ chỗ|không thuộc về thiết bị/i,
    'Handy 01 không được báo kết quả thay cho Handy 02'
  );
});

test('Handy 02 offline thì job của Handy 02 vẫn chờ Handy 02, Handy 01 không được chiếm', () => {
  xoaJob();

  // Handy 01 online, Handy 02 không báo cáo (offline)
  dangKyDevice('dev_handy_01', 'May in tich hop');

  const job = Print.createJob({
    printer: 'auto:dev_handy_02:May in tich hop',
    type: 'test',
    title: 'In thử Handy 02',
    payload: { text: 'In thử Handy 02' },
    branch_id: 'sala',
  });

  const pendingHandy01 = Print.pendingAgentJobs('sala', { deviceId: 'dev_handy_01' });
  assert.equal(pendingHandy01.length, 0, 'Handy 01 không được chiếm job của Handy 02 ngay cả khi Handy 02 offline');
});
