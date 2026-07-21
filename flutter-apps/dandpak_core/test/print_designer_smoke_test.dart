import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:qr_flutter/qr_flutter.dart';
import 'package:dandpak_core/src/services/api_service.dart';
import 'package:dandpak_core/src/screens/management/print_template_designer.dart';

void main() {
  testWidgets('PrintTemplateDesigner: visual preview (logo + QR + diacritics)',
      (tester) async {
    await tester.binding.setSurfaceSize(const Size(1400, 900));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    final details = <FlutterErrorDetails>[];
    final prev = FlutterError.onError;
    FlutterError.onError = (d) => details.add(d);

    await tester.pumpWidget(MaterialApp(
      home: Scaffold(
        body: SizedBox.expand(
          child: PrintTemplateDesigner(
            api: ApiService(),
            initialConfig: const {
              'bill': {
                'storeName': 'Dan D Pak',
                'address': 'Đường D9',
                'widthMm': 80,
                'heightMm': 320
              },
              'labels': {'widthMm': 50, 'heightMm': 30},
              'templates': {
                'bill': {
                  'kind': 'bill',
                  'version': 5,
                  'standard': 'dan_payment_receipt',
                  'elements': [
                    {
                      'type': 'image',
                      'y': 1,
                      'x': 38,
                      'label': 'Logo',
                      'src':
                          'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
                    },
                    {
                      'type': 'text',
                      'y': 2,
                      'x': 5,
                      'text': 'HÓA ĐƠN THANH TOÁN',
                      'align': 'center',
                      'bold': true
                    },
                    {'type': 'line', 'y': 3},
                    {'type': 'text', 'y': 4, 'x': 5, 'text': '{items}'},
                    {
                      'type': 'qr',
                      'y': 5,
                      'x': 30,
                      'qrText': '{invoiceLookupUrl}'
                    },
                  ],
                },
              },
            },
          ),
        ),
      ),
    ));
    await tester.pump();

    // Editor: logo row control present.
    expect(find.text('Logo / Ảnh'), findsWidgets);
    // Preview: real QR rendered, and the diacritic title shows in BOTH editor + preview.
    expect(find.byType(QrImageView), findsWidgets);
    expect(find.text('HÓA ĐƠN THANH TOÁN'), findsWidgets);
    expect(find.byType(Image), findsWidgets);

    for (final width in [700.0, 900.0, 1200.0, 1600.0, 2048.0]) {
      await tester.binding.setSurfaceSize(Size(width, 900));
      await tester.pump();
    }

    FlutterError.onError = prev;
    for (final d in details.take(3)) {
      debugPrint('==== ERROR ====');
      debugPrint(d.toString());
    }
    expect(details, isEmpty);
  });
}
