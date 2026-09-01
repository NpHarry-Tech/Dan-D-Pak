import 'dart:io';

import 'package:flutter/services.dart';

enum ManualPrintResult { opened, unsupported, failed }

class WindowsDocumentPrintService {
  static const _channel = MethodChannel('dandpak/windows_print');

  const WindowsDocumentPrintService();

  Future<ManualPrintResult> showReceipt({
    required String title,
    required String text,
  }) async {
    if (!Platform.isWindows) return ManualPrintResult.unsupported;
    try {
      final opened = await _channel.invokeMethod<bool>('showPrintUI', {
        'title': title,
        'text': stripReceiptControlTokens(text),
        'documentType': 'receipt',
      });
      return opened == true
          ? ManualPrintResult.opened
          : ManualPrintResult.failed;
    } on MissingPluginException {
      return ManualPrintResult.unsupported;
    } catch (_) {
      return ManualPrintResult.failed;
    }
  }
}

String stripReceiptControlTokens(String value) => value
    .replaceAll(RegExp(r'\[\[[A-Za-z]+\d*\]\]'), '')
    .replaceAll(RegExp(r'\[(?:B|U|I)[01]\]'), '')
    .replaceAll(RegExp(r'\n{3,}'), '\n\n')
    .trim();

bool isPrintablePdf(List<int> bytes) =>
    bytes.length > 4 && String.fromCharCodes(bytes.take(5)) == '%PDF-';
