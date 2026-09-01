import 'package:dandpak_core/src/services/api_service.dart';
import 'package:flutter_test/flutter_test.dart';

class _Api extends ApiService {
  String? posted;

  @override
  Future<dynamic> postJson(String path,
      {Object? body,
      Duration timeout = const Duration(seconds: 30),
      String? errorMessage}) async {
    posted = path;
    return <dynamic>[];
  }
}

class _QueuedApi extends ApiService {
  @override
  Future<dynamic> getJson(String path,
      {Duration timeout = const Duration(seconds: 30), String? errorMessage}) async {
    return [
      {
        'id': 'pj_1',
        'type': 'receipt',
        'status': 'queued',
        'payload': {'order_id': 'ord_queued', 'bill_no': 'B001'},
      }
    ];
  }
}

void main() {
  test('in lại hóa đơn gọi thẳng luồng receipt chuẩn, không dò 50 job cũ',
      () async {
    final api = _Api();
    expect(await api.reprintReceiptForOrder(orderId: 'ord_123'), isNull);
    expect(api.posted, '/api/orders/ord_123/receipt/print');
  });

  test('job đã xếp hàng cho agent không bị báo nhầm là in thất bại', () async {
    final api = _QueuedApi();
    expect(await api.forcePrintReceiptJob(orderId: 'ord_queued'), isNull);
  });
}
