// SƠ ĐỒ BÀN VỪA CẢ HAI CHIỀU (Gate-7). Sự cố 2026-09-04: bàn bị thiếu/che/cắt và
// tỉ lệ đổi theo màn hình vì POS chỉ tính ô theo BỀ RỘNG (cellW = maxWidth/cols),
// nên màn rộng làm ô cao vống → hàng bàn dưới tràn khung bị cắt.
import 'package:flutter_test/flutter_test.dart';
import 'package:dandpak_core/src/screens/floor_layout.dart';

void main() {
  test('màn RỘNG-THẤP: fit theo chiều cao → KHÔNG tràn dọc (bug cũ tràn)', () {
    // 16 cột. byWidth=120, byHeight=100 → chọn 100 (fit cao). 8 hàng * 100 = 800 vừa.
    final cell = floorCellSize(maxWidth: 1920, maxHeight: 800, rows: 8);
    expect(cell, 100);
    expect((8 * cell) <= 800, isTrue, reason: 'tổng cao không vượt khung');
    // Cách cũ (chỉ theo rộng) = 120 → 8*120=960 > 800 → sẽ cắt. Chứng minh đã sửa.
    expect(1920 / kFloorCols, 120);
  });

  test('màn CAO-HẸP: fit theo bề rộng, không nhỏ hơn minCell → cuộn ngang', () {
    // byWidth=50 < minCell → 60. canvasW=16*60=960 > 800 → UI cuộn ngang.
    final cell = floorCellSize(maxWidth: 800, maxHeight: 1200, rows: 6);
    expect(cell, 60);
  });

  test('chiều cao VÔ HẠN (trong vùng cuộn dọc) → chỉ theo bề rộng', () {
    final cell =
        floorCellSize(maxWidth: 1600, maxHeight: double.infinity, rows: 10);
    expect(cell, 100); // 1600/16
  });

  test('không có hàng nào (rows<=0) → theo bề rộng, không chia 0', () {
    final cell = floorCellSize(maxWidth: 1600, maxHeight: 400, rows: 0);
    expect(cell, 100);
  });

  test('màn siêu nhỏ → không nhỏ hơn minCell', () {
    final cell = floorCellSize(maxWidth: 320, maxHeight: 240, rows: 4);
    expect(cell, 60);
  });

  test('ô luôn VUÔNG nên tỉ lệ giữ nguyên bất kể màn hình (giá trị > 0)', () {
    for (final w in [1366.0, 1920.0, 2560.0, 768.0]) {
      for (final h in [700.0, 1080.0, 480.0]) {
        final c = floorCellSize(maxWidth: w, maxHeight: h, rows: 6);
        expect(c, greaterThan(0));
      }
    }
  });

  test('canonical geometry maps the same saved coordinates for editor and POS',
      () {
    for (final viewport in [
      (1366.0, 768.0),
      (1920.0, 1080.0),
      (2560.0, 1080.0),
      (768.0, 1024.0),
      (1024.0, 768.0),
    ]) {
      final editor = FloorViewportGeometry.fromViewport(
          maxWidth: viewport.$1, maxHeight: viewport.$2, rows: 8);
      final pos = FloorViewportGeometry.fromViewport(
          maxWidth: viewport.$1, maxHeight: viewport.$2, rows: 8);
      expect(editor.cell, pos.cell);
      expect(editor.tableRect(3.25, 4.5), pos.tableRect(3.25, 4.5));
      expect(editor.canvasWidth / editor.cell, kFloorCols);
      expect(editor.canvasHeight / editor.cell, 8);
    }
  });
}
