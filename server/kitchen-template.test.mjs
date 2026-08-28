// Mẫu Phiếu bếp do cửa hàng thiết kế (templates.kitchen_ticket) PHẢI được server
// dùng khi render — nhưng CHỈ khi mẫu có phần tử bảng món ('items'). Mẫu cũ (bản
// clone của tem, không có bảng món) hoặc mẫu rỗng phải rơi về renderTicket dựng
// sẵn để món LUÔN in ra (phiếu bếp không có món là tai hoạ trong bếp).
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

process.env.SQLITE_PATH = join(mkdtempSync(join(tmpdir(), 'ddp-ktpl-')), 'store.db');
process.env.STORAGE_PATH = join(tmpdir(), 'ktpl-store');

const { migrate } = await import('./db.js');
const AppSettings = await import('./services/settings.js');
const Print = await import('./services/printing.js');
migrate();

const PAYLOAD = {
  zone: 'Tầng trệt', table: 'A04', time: '06:52', date: '11/8/2026',
  staff: 'Nguyễn Phúc Huy', seq: '36a',
  items: [
    { name: 'Trà đào cam sả', qty: 2,
      mods: [{ group: '', name: 'Ít đá' }, { group: '', name: '50% đường' }],
      note: 'không ống hút' },
    { name: 'Mì Bò Kho Việt Nam', qty: 1 },
  ],
};

test('mau kitchen co phan tu items -> server render THEO MAU + bang mon co du mon', () => {
  AppSettings.updateSettings({ print_config: {
    templates: { kitchen_ticket: { kind: 'kitchen_ticket', standard: 'dan_kitchen_template', rows: [
      { id: 'h1', type: 'text', text: 'BEP NONG', align: 'center', bold: true, fontSize: 6 },
      { id: 'zone', type: 'text', text: '{zone} - BAN {table}', align: 'center', bold: true },
      { id: 'meta', type: 'text', text: 'So TT: {seq}   NV: {staff}' },
      { id: 'tbl', type: 'items', showQty: true, showMods: true, showNote: true },
    ] } },
  } }, 'ktpl');

  const raw = Print.renderJobText({ type: 'kitchen_ticket', branch_id: 'ktpl', payload: PAYLOAD },
    'ktpl', { widthMm: 80 });
  const plain = Print.stripMarks(raw);

  // Chu tieu de RIENG cua mau (khong co trong renderTicket dung san) -> chung minh
  // server DA dung mau thiet ke.
  assert.match(plain, /BEP NONG/);
  assert.match(plain, /Tầng trệt|TẦNG TRỆT/i);
  assert.match(plain, /BAN A04/i);
  assert.match(plain, /So TT: 36a/);
  // Bang mon co CA HAI mon + so luong.
  assert.match(plain, /\| Trà đào cam sả\s+\|\s*2\|/);
  assert.match(plain, /\| Mì Bò Kho Việt Nam\s+\|\s*1\|/);
  // Yeu cau them + ghi chu.
  assert.match(plain, /Ít đá/);
  assert.match(plain, /Ghi chú: không ống hút/);
  assert.ok(!plain.includes('[object Object]'), 'mods object khong duoc ra [object Object]');
  // Khong dong nao qua kho giay K80 (48 ky tu sau khi bo marker).
  for (const l of raw.split('\n')) {
    assert.ok(Print.stripMarks(l).length <= 48, `dong qua dai: ${Print.stripMarks(l)}`);
  }
});

test('mau kitchen CLONE cu (khong co items) -> FALLBACK renderTicket, mon van in', () => {
  AppSettings.updateSettings({ print_config: {
    templates: { kitchen_ticket: { kind: 'kitchen_ticket', rows: [
      // Mau clone tu tem: chi text + qr, KHONG co phan tu 'items'.
      { id: 'n', type: 'text', text: '{itemName}', align: 'center', bold: true },
      { id: 'q', type: 'qr', qrText: '{orderNo}' },
    ] } },
  } }, 'ktpl2');

  const raw = Print.renderJobText({ type: 'kitchen_ticket', branch_id: 'ktpl2', payload: PAYLOAD },
    'ktpl2', { widthMm: 80 });
  const plain = Print.stripMarks(raw);

  // Fallback renderTicket: ca phieu bọc [[S3]] (chu to gap doi) + header + bang.
  assert.match(raw, /^\[\[S3\]\]/);
  assert.match(plain, /TẦNG TRỆT/);
  assert.match(plain, /Tên món\s+\|\s*SL\|/);
  // Width nua giay -> ten dai wrap, kiem chuoi NGAN (khong tach dong).
  assert.match(plain, /Trà đào cam sả/);
  assert.match(plain, /Mì Bò Kho/);
});

test('khong cau hinh mau kitchen -> renderTicket dung san (khong doi hanh vi cu)', () => {
  const raw = Print.renderJobText({ type: 'kitchen_ticket', branch_id: 'ktpl-none', payload: PAYLOAD },
    'ktpl-none', { widthMm: 80 });
  assert.match(raw, /^\[\[S3\]\]/);
  assert.match(Print.stripMarks(raw), /Tên món\s+\|\s*SL\|/);
});
