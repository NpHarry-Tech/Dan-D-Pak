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

class _IdempotentArchiveApi extends ApiService {
  @override
  Future<dynamic> postJson(
    String path, {
    Object? body,
    Duration timeout = DanDpakApiClient.defaultTimeout,
    String? errorMessage,
  }) async =>
      <String, dynamic>{'id': 'same-content-document'};
}

void main() {
  test(
      'kvArchiveThenImport: archive FAIL => runImport (đổi dữ liệu Kho) KHÔNG được gọi',
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
      kvArchiveThenImport(api, data, sourceScreen: 'Kho — Test',
          runImport: () async {
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
    final data = KvSpreadsheetData([
      'h'
    ], [
      ['a']
    ]); // no bytes
    var importRan = false;
    await expectLater(
      kvArchiveThenImport(api, data, sourceScreen: 'x', runImport: () async {
        importRan = true;
      }),
      throwsA(isA<Exception>()),
    );
    expect(importRan, isFalse);
  });

  test('retry cùng archive trong một form không nạp dòng hai lần', () async {
    final api = _IdempotentArchiveApi();
    final completed = <String>{};
    final data = KvSpreadsheetData(
      ['Mã hàng', 'Số lượng'],
      [
        ['00060', '2']
      ],
      fileName: 'same.xlsx',
      bytes: Uint8List.fromList([8, 9, 10]),
    );
    var imports = 0;
    Future<void> run() => kvArchiveThenImport(api, data,
        sourceScreen: 'Kho — Test',
        completedArchiveIds: completed,
        runImport: () async => imports++);
    await run();
    await run();
    expect(imports, 1);
    expect(completed, {'same-content-document'});
  });
}
