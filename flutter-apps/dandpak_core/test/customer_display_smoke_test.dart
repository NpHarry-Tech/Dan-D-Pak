import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:qr_flutter/qr_flutter.dart';
import 'package:dandpak_core/src/screens/customer_display/customer_display_screen.dart';

void main() {
  test('secondary window keeps its native frame stable at runtime', () {
    final windowSource =
        File('lib/src/screens/customer_display/second_screen.dart')
            .readAsStringSync();
    final fullscreenSource =
        File('lib/src/services/second_window_fullscreen.dart')
            .readAsStringSync();

    expect(windowSource, contains('fromWindowId(id).hide()'));
    expect(windowSource, isNot(contains('fromWindowId(id).close()')));
    expect(windowSource, contains('_pushFailures >= 10'));
    expect(windowSource, isNot(contains('hideSecondWindowChrome')));
    expect(fullscreenSource, isNot(contains('SetWindowLongPtrW')));
    expect(fullscreenSource, isNot(contains('_swpFramechanged')));
  });

  Future<List<FlutterErrorDetails>> pump(
      WidgetTester tester, CustomerDisplayData data,
      {CustomerAdConfig ads = const CustomerAdConfig()}) async {
    final errors = <FlutterErrorDetails>[];
    final prev = FlutterError.onError;
    FlutterError.onError = (d) => errors.add(d);
    await tester.pumpWidget(MaterialApp(
      home: SizedBox(
        width: 1024,
        height: 768,
        child: CustomerDisplayScreen(data: data, ads: ads),
      ),
    ));
    await tester.pump();
    FlutterError.onError = prev;
    for (final d in errors.take(2)) {
      debugPrint('==== ERROR ====');
      debugPrint(d.toString());
    }
    return errors;
  }

  testWidgets('idle (no ads) shows welcome', (tester) async {
    final e = await pump(tester, const CustomerDisplayData());
    expect(find.text('Chào mừng quý khách'), findsOneWidget);
    expect(e, isEmpty);
  });

  testWidgets('order mode shows items + total with diacritics', (tester) async {
    final e = await pump(
      tester,
      const CustomerDisplayData(
        mode: CustomerDisplayMode.order,
        items: [
          CustomerLine(
              name: 'Trà đào', qty: 2, unitPrice: 30000, lineTotal: 60000),
          CustomerLine(
              name: 'Bánh cookie', qty: 1, unitPrice: 30000, lineTotal: 30000),
        ],
        subtotal: 90000,
        total: 90000,
      ),
    );
    expect(find.text('Trà đào'), findsOneWidget);
    expect(find.text('TỔNG CỘNG'), findsOneWidget);
    expect(e, isEmpty);
  });

  testWidgets('payment mode renders a QR', (tester) async {
    final e = await pump(
      tester,
      const CustomerDisplayData(
        mode: CustomerDisplayMode.payment,
        total: 90000,
        paymentMethod: 'Chuyển khoản QR',
        qrData: 'https://tracuu.dandpak.vn/DAN0001',
      ),
    );
    expect(find.byType(QrImageView), findsOneWidget);
    expect(e, isEmpty);
  });

  testWidgets('payment paid shows confirmation', (tester) async {
    final e = await pump(
      tester,
      const CustomerDisplayData(
          mode: CustomerDisplayMode.payment, total: 90000, paid: true),
    );
    expect(find.text('ĐÃ THANH TOÁN'), findsOneWidget);
    expect(e, isEmpty);
  });
}
