// Máy in bếp đặt renderMode='driver' (Windows/GDI, chữ to đọc từ xa) dùng
// buildKitchenDoc — TRƯỚC ĐÂY dựng bảng 2 cột (tên trái, SL to bên phải), khác
// hoàn toàn cấu trúc "{qty} x {tên}" của kitchenTableLines (ESC/POS) và preview
// thiết kế mẫu. Người dùng thật báo "phiếu bếp in ra khác preview" — đúng do
// lệch renderer này. buildKitchenDoc phải dùng CÙNG cấu trúc dòng.
import assert from 'node:assert/strict';
import test from 'node:test';

const { buildKitchenDoc } = await import('./services/receipt_doc.js');

test('buildKitchenDoc (Windows driver) dùng "{qty} x {ten}" MỘT dòng, không phải bảng 2 cột', () => {
  const doc = buildKitchenDoc({
    zone: 'Tầng trệt', table: 'A04', time: '10:15', date: '12/8/2026',
    staff: 'Nguyễn Phúc Huy', seq: '69c',
    items: [
      { name: 'Trà đào cam sả', qty: 2, mods: [{ group: '', name: 'Ít đá' }, { group: '', name: '50% đường' }], note: 'không ống hút' },
      { name: 'Mì Bò Kho Việt Nam', qty: 1 },
    ],
  }, {});

  const itemBlocks = doc.blocks.filter(b => b.type === 'text' && /Trà đào cam sả|Mì Bò Kho Việt Nam/.test(b.text || ''));
  assert.equal(itemBlocks.length, 2, 'mỗi món phải ra đúng 1 dòng tên+SL (không tách cột)');
  assert.equal(itemBlocks[0].text, '2 x Trà đào cam sả', 'đúng cấu trúc "{qty} x {tên}" giống kitchenTableLines/preview');
  assert.equal(itemBlocks[1].text, '1 x Mì Bò Kho Việt Nam');
  // KHÔNG còn block dạng bảng 2 cột (row/cols) cho món — đó là cấu trúc CŨ gây lệch preview.
  assert.ok(!doc.blocks.some(b => b.type === 'row' && Array.isArray(b.cols) && b.cols.some(c => /Trà đào cam sả/.test(c.text || ''))),
    'không được dựng món bằng row 2 cột nữa');

  const modsBlock = doc.blocks.find(b => (b.text || '').includes('Ít đá'));
  assert.ok(modsBlock, 'yêu cầu thêm phải còn xuất hiện');
  const noteBlock = doc.blocks.find(b => (b.text || '').includes('Ghi chú'));
  assert.ok(noteBlock, 'ghi chú phải còn xuất hiện');
});
