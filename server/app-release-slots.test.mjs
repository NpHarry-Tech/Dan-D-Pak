// ĐIỆN THOẠI VÀ TABLET PHẢI CÓ KHE PHÁT HÀNH RIÊNG.
//
// Lỗi trước đó: cả hai bản Android đều báo platform 'android' nên dùng chung một
// khe. Publish bản điện thoại là ĐÈ bản tablet, và mọi máy Android — kể cả tablet
// — sẽ tải về file được publish sau cùng. Tablet nhận nhầm APK điện thoại.
//
// Ràng buộc quan trọng nhất: khe 'android' PHẢI giữ nguyên nghĩa cũ (= tablet).
// Đổi khe của tablet thì mọi máy đang chạy sẽ hỏi một khe chưa có gì và im lặng
// không bao giờ thấy bản cập nhật nữa — hỏng theo kiểu không ai nhận ra.
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const temp = mkdtempSync(join(tmpdir(), 'dandpak-slots-'));
process.env.SQLITE_PATH = join(temp, 'store.db');
process.env.STORAGE_PATH = join(temp, 'storage');
process.env.DATA_ENCRYPTION_KEY = process.env.DATA_ENCRYPTION_KEY
  || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
// PHAI tro RELEASES_DIR vao thu muc tam. Thieu dong nay, publishRelease() ghi
// thang vao server/releases/ CUA REPO: manifest.json that bi thay bang du lieu
// gia cua test (setup.exe / tablet2.apk / phone.apk), tro toi cac file khong ton
// tai. Da xay ra that ngay 2026-07-31 — phat hien khi ra soat file chua commit.
process.env.RELEASES_DIR = join(temp, 'releases');

const { migrate } = await import('./db.js');
const Rel = await import('./services/appRelease.js');

migrate();

const apk = (ten) => Buffer.from(`gia-lap-apk-${ten}`);

test('khe android VAN LA tablet — khong duoc doi nghia', () => {
  const r = Rel.publishRelease('android', apk('tablet'), {
    version: '2026.07.31.04', buildNumber: 56, fileName: 'tablet.apk',
  });
  assert.equal(r.ok, true);
  assert.equal(Rel.latestFor('android').buildNumber, 56);
});

test('dien thoai co khe RIENG, khong dung chung voi tablet', () => {
  Rel.publishRelease('android-phone', apk('phone'), {
    version: '2026.07.31.04', buildNumber: 17, fileName: 'phone.apk',
  });
  assert.equal(Rel.latestFor('android-phone').buildNumber, 17);
  // Va quan trong nhat: tablet KHONG bi de.
  assert.equal(Rel.latestFor('android').buildNumber, 56,
    'publish ban dien thoai da de mat ban tablet — dung loi cu');
});

test('publish tablet lan nua khong dung toi ban dien thoai', () => {
  Rel.publishRelease('android', apk('tablet2'), {
    version: '2026.07.31.05', buildNumber: 57, fileName: 'tablet2.apk',
  });
  assert.equal(Rel.latestFor('android').buildNumber, 57);
  assert.equal(Rel.latestFor('android-phone').buildNumber, 17,
    'ban dien thoai bi de khi publish tablet');
});

test('ca hai khe Android deu ra file .apk, khong phai .exe', () => {
  // latestFor() co tinh KHONG lo ten file ra ngoai; doc manifest de kiem.
  const m = Rel.readManifest();
  for (const khe of ['android', 'android-phone']) {
    const f = String(m[khe]?.file || '');
    assert.ok(f.endsWith('.apk'), `khe ${khe} dang ra file "${f}"`);
  }
});

test('windows khong bi anh huong', () => {
  Rel.publishRelease('windows', Buffer.from('gia-lap-exe'), {
    version: '2026.07.31.04', buildNumber: 84, fileName: 'setup.exe',
  });
  assert.equal(Rel.latestFor('windows').buildNumber, 84);
  assert.ok(String(Rel.readManifest().windows.file).endsWith('.exe'));
  assert.equal(Rel.latestFor('android').buildNumber, 57);
  assert.equal(Rel.latestFor('android-phone').buildNumber, 17);
});

test('khe la khong duoc chap nhan', () => {
  assert.throws(() => Rel.latestFor('android-tablet'),
    /Nen tang khong ho tro|không hỗ trợ/i,
    'khe sai phai bao loi ro thay vi tra ve rong');
});
