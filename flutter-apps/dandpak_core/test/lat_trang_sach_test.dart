// CHIỀU LẬT TRANG PHẢI THEO HƯỚNG VUỐT.
//
// Sự cố thật: khách vuốt từ phải sang trái mà trang lại chạy hiệu ứng ngược
// hướng, hoặc đứng im. Nguyên nhân: bản cũ quyết định chiều lật bằng CHỖ ĐẶT
// NGÓN TAY (`localPosition.dx > width/2`) chứ không phải hướng kéo — bắt đầu
// vuốt ở nửa trái thì máy hiểu là "lật lui" dù ngón tay đang đi sang trái.
//
// Luật: vuốt sang TRÁI → trang SAU. Vuốt sang PHẢI → trang TRƯỚC. Bất kể ngón
// tay đặt ở đâu trên trang.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:dandpak_core/src/widgets/book_page_view.dart';

Map<String, dynamic> quyen() => {
      'pageWidth': 900.0,
      'pageHeight': 600.0,
      'pages': [
        {'id': 'p1', 'src': '/uploads/a.png', 'label': 'Trang 1'},
        {'id': 'p2', 'src': '/uploads/b.png', 'label': 'Trang 2'},
        {'id': 'p3', 'src': '/uploads/c.png', 'label': 'Trang 3'},
      ],
      'hotspots': [
        {'id': 'h1', 'page': 1, 'x': 50, 'y': 50, 'sku_id': 'sku_b'},
      ],
    };

Future<void> dung(WidgetTester tester,
    {Widget? Function(int)? bottomCenter,
    ValueChanged<int>? onPageChanged}) async {
  await tester.pumpWidget(MaterialApp(
    home: Scaffold(
      body: SizedBox(
        width: 1000,
        height: 700,
        child: BookPageView(
          book: quyen(),
          serverUrl: 'http://localhost:3000',
          targetKey: 'sku_id',
          onHotspotTap: (_) {},
          showHotspots: false,
          bottomCenter: bottomCenter,
          onPageChanged: onPageChanged,
        ),
      ),
    ),
  ));
  await tester.pump();
}

/// Vuốt rồi chạy hết animation lật (340ms).
Future<void> vuot(WidgetTester tester, Offset tu, Offset delta) async {
  await tester.timedDragFrom(tu, delta, const Duration(milliseconds: 120));
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('vuot sang TRAI thi qua trang SAU', (tester) async {
    final ghi = <int>[];
    await dung(tester, onPageChanged: ghi.add);

    expect(find.text('1 / 3'), findsOneWidget);
    await vuot(tester, const Offset(500, 350), const Offset(-380, 0));
    expect(find.text('2 / 3'), findsOneWidget);
    expect(ghi, [1]);
  });

  testWidgets('vuot sang PHAI thi quay lai trang TRUOC', (tester) async {
    await dung(tester);
    await vuot(tester, const Offset(500, 350), const Offset(-380, 0));
    expect(find.text('2 / 3'), findsOneWidget);

    await vuot(tester, const Offset(500, 350), const Offset(380, 0));
    expect(find.text('1 / 3'), findsOneWidget);
  });

  testWidgets('bat dau vuot o NUA TRAI van qua trang sau duoc', (tester) async {
    // Đây chính là ca hỏng cũ: đặt tay nửa trái, kéo sang trái. Bản cũ suy ra
    // "lật lui" từ vị trí chạm nên trang đứng im.
    await dung(tester);
    await vuot(tester, const Offset(220, 350), const Offset(-330, 0));
    expect(find.text('2 / 3'), findsOneWidget);
  });

  testWidgets('trang DAU vuot sang phai thi khong di dau ca', (tester) async {
    await dung(tester);
    await vuot(tester, const Offset(500, 350), const Offset(380, 0));
    expect(find.text('1 / 3'), findsOneWidget);
  });

  testWidgets('nut day giua hien theo TRANG dang mo', (tester) async {
    await dung(tester,
        bottomCenter: (page) =>
            page == 1 ? const Text('Xem chi tiet san pham') : null);

    // Trang 1 chưa gắn hàng hoá nào → không có nút.
    expect(find.text('Xem chi tiet san pham'), findsNothing);

    await vuot(tester, const Offset(500, 350), const Offset(-380, 0));
    expect(find.text('Xem chi tiet san pham'), findsOneWidget);
  });

  testWidgets('cham vao trang KHONG lam lat trang', (tester) async {
    // Khách chạm để đọc/bấm nút, không phải để lật. Chỉ vuốt mới lật.
    await dung(tester);
    await tester.tapAt(const Offset(500, 350));
    await tester.pumpAndSettle();
    expect(find.text('1 / 3'), findsOneWidget);
  });
}
