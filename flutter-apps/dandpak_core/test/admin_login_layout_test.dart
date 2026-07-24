import 'package:dandpak_core/src/screens/login_gate_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('admin keypad and submit stay visible on SM-T225 landscape',
      (tester) async {
    tester.view.physicalSize = const Size(1340, 736);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Builder(
            builder: (context) => TextButton(
              onPressed: () => showDialog<void>(
                context: context,
                builder: (_) => AdminLoginDialog(),
              ),
              child: const Text('open'),
            ),
          ),
        ),
      ),
    );
    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();

    expect(find.text('0'), findsOneWidget);
    expect(find.text('ĐĂNG NHẬP'), findsOneWidget);
    expect(tester.takeException(), isNull);

    final zeroBottom = tester.getBottomRight(find.text('0')).dy;
    final submitBottom = tester.getBottomRight(find.text('ĐĂNG NHẬP')).dy;
    expect(zeroBottom, lessThan(736));
    expect(submitBottom, lessThan(736));
  });
}
