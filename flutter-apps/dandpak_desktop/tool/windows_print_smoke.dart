import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const _PrintSmokeApp());
}

class _PrintSmokeApp extends StatefulWidget {
  const _PrintSmokeApp();

  @override
  State<_PrintSmokeApp> createState() => _PrintSmokeAppState();
}

class _PrintSmokeAppState extends State<_PrintSmokeApp> {
  static const _channel = MethodChannel('dandpak/windows_print');
  String _status = 'waiting';

  @override
  void initState() {
    super.initState();
    unawaited(_openPrintUi());
  }

  Future<void> _openPrintUi() async {
    await Future<void>.delayed(const Duration(seconds: 1));
    const source = '''[[B1]]CONG TY TNHH DICH VU TIEP THI BCM[[B0]]
HOA DON THANH TOAN (IN LAI)
So bill: PRINT-SMOKE-B166
--------------------------------
Sua hat de cuoi mua 3 gia 500k  3   500.000d
Khuyen mai: Combo 3 san pham, giam 100.000d
--------------------------------
TONG CONG:                    500.000d
''';
    var exitCode = 0;
    try {
      final opened = await _channel.invokeMethod<bool>('showPrintUI', {
        'title': 'Dan D Pak Bill Vector Smoke b166',
        'text': source.replaceAll(RegExp(r'\[\[B[01]\]\]'), ''),
      });
      _status = opened == true ? 'opened' : 'not-opened';
      if (opened != true) exitCode = 1;
    } on PlatformException catch (error) {
      _status = '${error.code}: ${error.message}';
      exitCode = 2;
    } catch (error) {
      _status = 'unexpected: $error';
      exitCode = 3;
    }
    await File('D:/Dan D Pak/artifacts/windows-print-smoke-result.txt')
        .writeAsString(_status);
    if (mounted) setState(() {});
    await Future<void>.delayed(const Duration(seconds: 15));
    exit(exitCode);
  }

  @override
  Widget build(BuildContext context) => MaterialApp(
        home: Scaffold(
          body: Center(
            child: Text('Windows PrintManager smoke: $_status'),
          ),
        ),
      );
}
