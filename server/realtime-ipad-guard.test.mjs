// BAO MAT: ket noi Socket.IO device='ipad' KHONG can token (thiet bi cong khai
// dat tai ban). branch_id khong bi mat (GET /api/branches cong khai), nen
// truoc day AI CUNG noi vao nghe hoat dong van hanh cua BAT KY chi nhanh nao.
// Hai lop giam ban kinh no: tu choi branch khong ton tai (chan do vet id), va
// gioi han toc do KET NOI theo IP (khong anh huong kiosk hop le da noi san).
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const temp = mkdtempSync(join(tmpdir(), 'dandpak-realtime-guard-'));
process.env.SQLITE_PATH = join(temp, 'store.db');
process.env.STORAGE_PATH = join(temp, 'storage');
process.env.DATA_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

const { migrate } = await import('./db.js');
migrate();
const Realtime = await import('./realtime.js');

test('branchExists tu choi id bia dat, chap nhan chi nhanh mac dinh that (sala)', () => {
  assert.equal(Realtime.branchExists('khong_ton_tai_' + Date.now()), false);
  assert.equal(Realtime.branchExists('sala'), true);
});

test('gioi han toc do ket noi ipad theo IP: qua nguong thi tu choi', () => {
  const ip = '203.0.113.9';
  let allowed = 0, blocked = 0;
  for (let i = 0; i < 25; i++) {
    if (Realtime.ipadConnectAllowed(ip)) allowed++; else blocked++;
  }
  assert.equal(allowed, 20, 'chi cho phep dung 20 ket noi trong 1 cua so');
  assert.equal(blocked, 5, '5 lan vuot qua phai bi chan');
});

test('IP khac khong bi anh huong boi gioi han cua IP truoc', () => {
  for (let i = 0; i < 20; i++) Realtime.ipadConnectAllowed('203.0.113.10');
  assert.equal(Realtime.ipadConnectAllowed('203.0.113.11'), true,
    'IP moi phai co bo dem rieng, khong bi tinh chung');
});
