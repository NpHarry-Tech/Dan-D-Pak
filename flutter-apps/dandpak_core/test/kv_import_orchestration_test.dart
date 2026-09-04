import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:dandpak_core/src/api_client.dart';
import 'package:dandpak_core/src/services/api_service.dart';
import 'package:dandpak_core/src/screens/warehouse/kv_excel.dart';

/// ApiService giả: mọi POST đều ném → mô phỏng lưu file import THẤT BẠI.
class _ThrowingApi extends ApiService {
  @override
  Future<dynamic> postJson(
    String path, {
    Object? body,
    Duration timeout = DanDpakApiClient.defaultTimeout,
    String? errorMessage,
  }) async {
    throw Exception('upload failed');
  }
}

void main() {
  test('kvArchiveThenImport: archive FAIL => runImport (đổi dữ liệu Kho) KHÔNG được gọi',
      () async {
    final api = _ThrowingApi();
    final data = KvSpreadsheetData(
      ['Mã hàng', 'SL'],
      [
        ['SP1', '3']
      ],
      fileName: 'nhap.xlsx',
      bytes: Uint8List.fromList([1, 2, 3, 4]),
    );
    var importRan = false;
    await expectLater(
      kvArchiveThenImport(api, data,
          sourceScreen: 'Kho — Test', runImport: () async {
        importRan = true;
      }),
      throwsA(isA<Exception>()),
    );
    expect(importRan, isFalse,
        reason: 'Không lưu được file gốc thì tuyệt đối không nhập nghiệp vụ');
  });

  test('kvArchiveThenImport: KHÔNG có bytes => ném, runImport KHÔNG được gọi',
      () async {
    final api = _ThrowingApi();
    final data = KvSpreadsheetData(['h'], [
      ['a']
    ]); // no bytes
    var importRan = false;
    await expectLater(
      kvArchiveThenImport(api, data,
          sourceScreen: 'x', runImport: () async {
        importRan = true;
      }),
      throwsA(isA<Exception>()),
    );
    expect(importRan, isFalse);
  });
}
