// Phiếu bếp theo mẫu IPOS: header khu vực/bàn CHỮ TO ĐẬM, bảng có viền "Tên món|SL",
// YÊU CẦU THÊM in dưới món, GHI CHÚ in dưới yêu cầu thêm, mods object không ra
// "[object Object]".
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

process.env.SQLITE_PATH = join(mkdtempSync(join(tmpdir(), 'ddp-ktik-')), 'store.db');
process.env.STORAGE_PATH = join(tmpdir(), 'ktik-store');

const { migrate } = await import('./db.js');
const Print = await import('./services/printing.js');
migrate();

test('phieu bep IPOS: header to dam, bang Ten mon|SL, yeu cau + ghi chu duoi mon', () => {
  const raw = Print.renderJobText({ type: 'kitchen_ticket', payload: {
    zone: 'Tầng trệt', table: 'A04', time: '06:52', date: '11/8/2026',
    staff: 'Nguyễn Phúc Huy', seq: '36a',
    items: [{ name: 'Trà đào cam sả', qty: 2,
      mods: [{ group: '', name: 'Ít đá' }, { group: '', name: '50% đường' }],
      note: 'không ống hút' }],
  }}, 'sala', { widthMm: 80 });
  const plain = raw.replace(/\[\[[BS][0-9]\]\]/g, '');

  // CẢ PHIẾU bọc [[S3]] (chữ to gấp đôi cả 2 chiều). Header khu vuc + ban DAM.
  assert.match(raw, /^\[\[S3\]\]/, 'ca phieu phai bat dau bang [[S3]] (chu to gap doi)');
  assert.match(raw, /\[\[S0\]\]$/, 'ca phieu phai ket thuc bang [[S0]]');
  assert.match(plain, /TẦNG TRỆT/);
  assert.match(plain, /BÀN A04/);
  assert.match(raw, /\[\[B1\]\]BÀN A04\[\[B0\]\]/, 'chu BAN phai in dam');
  // Bang co vien + cot SL.
  assert.match(plain, /\+-+\+-+\+/);
  assert.match(plain, /Tên món\s+\|\s*SL\|/);
  // Mon + so luong o cot SL.
  assert.match(plain, /\| Trà đào cam sả\s+\|\s*2\|/);
  // YEU CAU THEM in dung ten (khong phai [object Object]) va DUOI mon.
  assert.ok(!plain.includes('[object Object]'), 'khong duoc ra [object Object]');
  // Width nua giay -> text dai co the WRAP, nen chi tim chuoi NGAN (khong tach dong).
  const iName = plain.indexOf('Trà đào cam sả');
  const iMods = plain.indexOf('Ít đá');
  const iNote = plain.indexOf('Ghi chú');
  assert.ok(iName >= 0 && iMods >= 0 && iNote >= 0, 'phai co du ten/yeu cau/ghi chu');
  assert.ok(iName < iMods, 'yeu cau them phai DUOI mon');
  assert.ok(iMods < iNote, 'ghi chu phai DUOI yeu cau them');

  // Dung o W=24 (nua giay 48) vi in 2x → khong dong LOGIC nao qua 24 ky tu.
  for (const l of raw.split('\n')) {
    const v = l.replace(/\[\[[BS][0-9]\]\]/g, '');
    assert.ok(v.length <= 24, `dong qua dai (${v.length}): ${v}`);
  }
});
