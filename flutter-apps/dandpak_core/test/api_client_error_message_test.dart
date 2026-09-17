import 'dart:convert';

import 'package:dandpak_core/dandpak_core.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;

void main() {
  final client = DanDpakApiClient();

  test('generic server error uses the operation context', () {
    expect(
      () => client.decodeResponse(
        http.Response('{"message":"Request failed"}', 500),
        errorMessage: 'Không tạo được kho',
      ),
      throwsA(isA<ApiException>()
          .having((e) => e.message, 'message', contains('Không tạo được kho'))
          .having(
              (e) => e.message, 'message', isNot(contains('Request failed')))
          .having((e) => e.statusCode, 'statusCode', 500)),
    );
  });

  test('specific business error from server is preserved', () {
    expect(
      () => client.decodeResponse(
        http.Response.bytes(
          utf8.encode('{"message":"Mã kho đã tồn tại"}'),
          409,
          headers: {'content-type': 'application/json; charset=utf-8'},
        ),
        errorMessage: 'Không tạo được kho',
      ),
      throwsA(isA<ApiException>()
          .having((e) => e.message, 'message', 'Mã kho đã tồn tại')),
    );
  });

  test('nested server error preserves its message and code', () {
    expect(
      () => client.decodeResponse(
        http.Response.bytes(
          utf8.encode(
              '{"error":{"code":"ORDER_FINALIZED","message":"Đơn đã thanh toán"}}'),
          409,
          headers: {'content-type': 'application/json; charset=utf-8'},
        ),
      ),
      throwsA(isA<ApiException>()
          .having((e) => e.message, 'message', 'Đơn đã thanh toán')
          .having((e) => e.code, 'code', 'ORDER_FINALIZED')),
    );
  });
}
