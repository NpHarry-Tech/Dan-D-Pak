// DropdownButtonFormField/DropdownMenu dinh vi SAI popup khi nam trong
// ListView/SingleChildScrollView dang cuon (loi Flutter da biet:
// flutter/flutter#12053, #139871). SearchPickField/showSearchPickDialog thay
// the bang mot showDialog rieng (luon tu can giua man hinh, khong bao gio
// dinh loi vi tri do) — test nay khoa lai hanh vi loc + chon.
import 'package:dandpak_core/src/widgets/search_pick_dialog.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  const options = [
    SearchPickOption('a', 'Mirinda Soda Kem 330Ml'),
    SearchPickOption('b', 'Nước Khoáng Ice-Field 2L'),
    SearchPickOption('c', 'Coca Vị Nguyên Bản'),
    SearchPickOption('d', 'Nước Khoáng Có Gas Perrier 330Ml'),
  ];

  Future<String?> pump(WidgetTester tester) async {
    String? result;
    await tester.pumpWidget(MaterialApp(
      home: Scaffold(
        body: Builder(
          builder: (context) => ElevatedButton(
            onPressed: () async {
              result = await showSearchPickDialog(
                context,
                title: 'Chọn món đi kèm',
                options: options,
              );
            },
            child: const Text('open'),
          ),
        ),
      ),
    ));
    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();
    return result;
  }

  testWidgets('go tim thi loc dung danh sach, khong phan biet hoa/thuong/dau', (tester) async {
    await pump(tester);
    expect(find.text('Mirinda Soda Kem 330Ml'), findsOneWidget);
    expect(find.text('Coca Vị Nguyên Bản'), findsOneWidget);

    await tester.enterText(find.byType(TextField), 'nuoc khoang');
    await tester.pumpAndSettle();

    expect(find.text('Nước Khoáng Ice-Field 2L'), findsOneWidget);
    expect(find.text('Nước Khoáng Có Gas Perrier 330Ml'), findsOneWidget);
    expect(find.text('Mirinda Soda Kem 330Ml'), findsNothing);
    expect(find.text('Coca Vị Nguyên Bản'), findsNothing);
  });

  testWidgets('bam vao mot dong tra ve dung value va dong dialog', (tester) async {
    late String? picked;
    await tester.pumpWidget(MaterialApp(
      home: Scaffold(
        body: Builder(
          builder: (context) => ElevatedButton(
            onPressed: () async {
              picked = await showSearchPickDialog(
                context,
                title: 'Chọn món đi kèm',
                options: options,
              );
            },
            child: const Text('open'),
          ),
        ),
      ),
    ));
    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();

    await tester.tap(find.text('Coca Vị Nguyên Bản'));
    await tester.pumpAndSettle();

    expect(picked, 'c');
    expect(find.byType(Dialog), findsNothing);
  });

  testWidgets('SearchPickField hien dung nhan cua value dang chon', (tester) async {
    await tester.pumpWidget(const MaterialApp(
      home: Scaffold(
        body: SearchPickField(
          value: 'b',
          options: options,
          dialogTitle: 'Chọn món đi kèm',
          onChanged: _noop,
        ),
      ),
    ));
    expect(find.text('Nước Khoáng Ice-Field 2L'), findsOneWidget);
  });
}

void _noop(String? _) {}
