import 'package:dandpak_core/src/screens/management/print_template_designer.dart';
import 'package:dandpak_core/src/screens/warehouse/kv_shared.dart';
import 'package:dandpak_core/src/services/api_service.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('trình chỉnh bill màn nhỏ dùng hai chế độ, không ép hai pane', (tester) async {
    tester.view.physicalSize = const Size(720, 800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(MaterialApp(home: Scaffold(body: PrintTemplateDesigner(
      api: ApiService(),
      initialConfig: {
        'bill': {'paper': 'K80', 'widthMm': 80, 'heightMm': 320},
        'labels': {},
        'templates': {
          'bill': {'kind': 'bill', 'paper': 'K80', 'rows': []},
        },
      },
    ))));
    await tester.pump();
    expect(find.text('Chỉnh sửa'), findsOneWidget);
    expect(find.text('Xem trước'), findsOneWidget);
    expect(tester.takeException(), isNull);
    await tester.tap(find.text('Xem trước'));
    await tester.pump();
    expect(tester.takeException(), isNull);
  });

  testWidgets('header kho không bẻ chữ thành cột dọc trên màn hẹp', (tester) async {
    tester.view.physicalSize = const Size(420, 300);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(MaterialApp(home: Scaffold(body: KvTableHeader(cells: [
      kvHeaderCell('Product name', width: 34),
    ]))));
    final text = tester.widget<Text>(find.text('Product name'));
    expect(text.maxLines, 1);
    expect(text.softWrap, false);
    expect(text.overflow, TextOverflow.ellipsis);
    expect(tester.takeException(), isNull);
  });
}
