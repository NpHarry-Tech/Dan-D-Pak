// Máy in bếp đặt renderMode='driver' (Windows/GDI, chữ to đọc từ xa) dùng
// buildKitchenDoc. Yêu cầu 17/09/2026: bảng THẬT — tên món sát lề trái, số
// lượng sát lề phải, từng ô riêng — thay vì gộp "{qty} x {tên}" một chuỗi.
// Đổi CẢ BA đường cùng lúc (ESC/POS kitchenTableLines, GDI buildKitchenDoc,
// preview print_template_designer_methods.dart) sang cùng bố cục 2 cột, để
// không lặp lại sự cố lệch renderer 2026-09-08 theo chiều ngược lại. Cỡ chữ
// tên món giờ ĐỌC TỪ CẤU HÌNH (templates.kitchen_ticket 'items' row.fontSize,
// mm, qua sizeFromMm — cùng đơn vị với ESC/POS/preview), không còn cố định.
import assert from 'node:assert/strict';
import test from 'node:test';

const { buildKitchenDoc } = await import('./services/receipt_doc.js');

function payload() {
  return {
    zone: 'Tầng trệt', table: 'A04', time: '10:15', date: '12/8/2026',
    staff: 'Nguyễn Phúc Huy', seq: '69c',
    items: [
      { name: 'Trà đào cam sả', qty: 2, mods: [{ group: '', name: 'Ít đá' }, { group: '', name: '50% đường' }], note: 'không ống hút' },
      { name: 'Mì Bò Kho Việt Nam', qty: 1 },
    ],
  };
}

test('buildKitchenDoc (Windows driver) dựng bảng 2 cột: tên trái, SL phải — cỡ mặc định khi chưa có mẫu tự thiết kế', () => {
  const doc = buildKitchenDoc(payload(), {});

  const itemRows = doc.blocks.filter(b => b.type === 'row'
    && Array.isArray(b.cols) && b.cols.some(c => /Trà đào cam sả|Mì Bò Kho Việt Nam/.test(c.text || '')));
  assert.equal(itemRows.length, 2, 'mỗi món phải ra đúng 1 row 2 cột (tên + SL)');

  const [tra, mi] = itemRows;
  assert.equal(tra.cols[0].text, 'Trà đào cam sả', 'cột 1 = tên món, KHÔNG gộp số lượng vào chuỗi');
  assert.equal(tra.cols[0].align, 'left', 'tên món phải sát lề trái');
  assert.equal(tra.cols[1].text, 'x2', 'cột 2 = số lượng riêng');
  assert.equal(tra.cols[1].align, 'right', 'số lượng phải sát lề phải');
  assert.equal(mi.cols[0].text, 'Mì Bò Kho Việt Nam');
  assert.equal(mi.cols[1].text, 'x1');

  // Chưa có mẫu tự thiết kế (không có templates.kitchen_ticket 'items' row)
  // → giữ cỡ mặc định 22 như trước khi có tính năng chỉnh cỡ chữ bảng món.
  assert.equal(tra.cols[0].size, 22, 'chưa cấu hình fontSize thì giữ cỡ mặc định cũ (22)');

  const modsBlock = doc.blocks.find(b => (b.text || '').includes('Ít đá'));
  assert.ok(modsBlock, 'yêu cầu thêm phải còn xuất hiện');
  const noteBlock = doc.blocks.find(b => (b.text || '').includes('Ghi chú'));
  assert.ok(noteBlock, 'ghi chú phải còn xuất hiện');
});

test('buildKitchenDoc đọc fontSize của khối "Bảng món" trong mẫu tự thiết kế (mm → điểm GDI qua sizeFromMm)', () => {
  const printCfg = {
    templates: {
      kitchen_ticket: {
        kind: 'kitchen_ticket',
        rows: [
          { id: 'r1', type: 'text', text: '- BÀN {table}', align: 'center', bold: true, fontSize: 7 },
          { id: 'r2', type: 'items', showQty: true, showMods: true, showNote: true, fontSize: 6.0 },
        ],
      },
    },
  };
  const doc = buildKitchenDoc(payload(), printCfg);
  const itemRow = doc.blocks.find(b => b.type === 'row' && b.cols?.some(c => c.text === 'Trà đào cam sả'));
  assert.ok(itemRow, 'phải dựng được row cho món khi có mẫu tự thiết kế');
  // sizeFromMm(6.0) = round(6.0*2.45) = 15 — khác 22 mặc định, chứng minh cấu
  // hình thật sự được dùng thay vì cố định như trước.
  assert.equal(itemRow.cols[0].size, 15, 'fontSize (mm) của khối Bảng món phải quyết định cỡ chữ GDI thật');
});

test('showQty=false (mẫu tắt cột SL) thì buildKitchenDoc KHÔNG dựng cột số lượng', () => {
  const printCfg = {
    templates: {
      kitchen_ticket: {
        kind: 'kitchen_ticket',
        rows: [{ id: 'r1', type: 'items', showQty: false }],
      },
    },
  };
  const doc = buildKitchenDoc(payload(), printCfg);
  const itemRow = doc.blocks.find(b => b.type === 'row' && b.cols?.some(c => c.text === 'Trà đào cam sả'));
  assert.equal(itemRow.cols.length, 1, 'tắt cột SL thì row chỉ còn đúng 1 cột (tên món)');
});
