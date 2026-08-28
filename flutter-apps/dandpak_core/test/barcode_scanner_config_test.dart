import 'dart:io';

import 'package:dandpak_core/src/screens/scanner/barcode_scanner_screen.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_scanner/mobile_scanner.dart';

void main() {
  test('scanner keeps analysing frames and limits work to retail formats', () {
    final controller = createRetailBarcodeController();
    addTearDown(controller.dispose);
    expect(controller.autoStart, isTrue);
    expect(controller.detectionSpeed, DetectionSpeed.normal);
    expect(controller.detectionTimeoutMs, 120);
    expect(controller.returnImage, isFalse);
    expect(
        controller.formats,
        containsAll(<BarcodeFormat>[
          BarcodeFormat.ean13,
          BarcodeFormat.ean8,
          BarcodeFormat.upcA,
          BarcodeFormat.upcE,
          BarcodeFormat.code128,
          BarcodeFormat.code39,
        ]));
    expect(controller.formats, isNot(contains(BarcodeFormat.qrCode)));
    expect(controller.formats, isNot(contains(BarcodeFormat.itf)));
  });

  test('invalid frame does not make a later valid barcode unusable', () {
    expect(isUsableRetailBarcode(BarcodeFormat.ean13, '123'), isFalse);
    expect(
        isUsableRetailBarcode(BarcodeFormat.qrCode, '8936050342277'), isFalse);
    expect(isUsableRetailBarcode(BarcodeFormat.ean13, '8936050342277'), isTrue);
    expect(isUsableRetailBarcode(BarcodeFormat.code128, ' DDP001 '), isTrue);
  });

  test('camera error offers an in-place controller restart', () {
    final source = File(
            'lib/src/screens/scanner/barcode_scanner_screen.dart')
        .readAsStringSync();
    expect(source, contains('onRetry: _retry'));
    expect(source, contains('await _controller.stop()'));
    expect(source, contains('await _controller.start()'));
    expect(source, contains("t('Thử lại')"));
  });
}
