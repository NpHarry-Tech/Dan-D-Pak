import 'package:dandpak_core/src/widgets/manager_pin_dialog.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('thao tác nhạy cảm luôn hiện ô PIN', (tester) async {
    await tester.pumpWidget(MaterialApp(
      home: Builder(
          builder: (context) => TextButton(
                onPressed: () => requestManagerPin(context, 'Tạo kho mới'),
                child: const Text('Mở'),
              )),
    ));

    await tester.tap(find.text('Mở'));
    await tester.pumpAndSettle();

    expect(find.byType(TextField), findsOneWidget);
    expect(find.text('Tạo kho mới'), findsOneWidget);
  });
}
