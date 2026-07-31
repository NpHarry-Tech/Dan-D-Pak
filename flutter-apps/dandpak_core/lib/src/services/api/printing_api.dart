part of '../api_service.dart';

extension ApiServicePrintingApi on ApiService {
  /// [live] = soi trạng thái THẬT (máy POS đang cắm máy in có đang chạy app
  /// không, máy in LAN có trả lời không). Thiếu cờ này server trả 'ready' vô
  /// điều kiện — đúng nguyên nhân màn Máy in từng báo "Sẵn sàng" khi máy POS
  /// còn chưa mở app. Timeout nới ra vì có thể phải dò TCP máy in LAN.
  Future<List<dynamic>> getPrinters({bool live = true}) async {
    return listFrom(await getJson(
        '/api/print/printers${live ? '?live=1' : ''}',
        timeout: Duration(seconds: live ? 8 : 3),
        errorMessage: 'Không tải được máy in'));
  }

  Future<void> testPrinter(String id) async {
    await postJson('/api/print/printers/$id/test',
        errorMessage: 'Không in thử được');
  }

  Future<List<dynamic>> getPrintJobs() async {
    final decoded = await getJson('/api/print/jobs?limit=50',
        timeout: const Duration(seconds: 3),
        errorMessage: 'Không tải được lệnh in');
    if (decoded is List) return decoded;
    if (decoded is Map && decoded['jobs'] is List) {
      return decoded['jobs'] as List;
    }
    return <dynamic>[];
  }

  Future<void> reprintJob(String id) async {
    await postJson('/api/print/jobs/$id/reprint',
        errorMessage: 'Không in lại được');
  }

  /// dùng để in bill tự động sau thanh toán kể cả khi tuyến in chưa bật auto.
  Future<Map<String, dynamic>> printJobNow(String id) async {
    return mapFrom(await postJson('/api/print/jobs/$id/print',
        timeout: const Duration(seconds: 20),
        errorMessage: 'Không gửi được lệnh in'));
  }

  Future<String?> forcePrintReceiptJob({
    String orderId = '',
    String billNo = '',
    Duration wait = const Duration(milliseconds: 500),
  }) async {
    final order = orderId.trim();
    final bill = billNo.trim();
    if (order.isEmpty && bill.isEmpty) return 'Thiếu mã bill để tìm lệnh in';
    if (wait > Duration.zero) await Future.delayed(wait);

    final jobs = await getPrintJobs();
    Map<String, dynamic>? found;
    for (final raw in jobs.whereType<Map>()) {
      final job = Map<String, dynamic>.from(raw);
      if ('${job['type']}' != 'receipt') continue;
      final payload = job['payload'] is Map
          ? Map<String, dynamic>.from(job['payload'] as Map)
          : <String, dynamic>{};
      final jobBill = '${payload['bill_no'] ?? payload['number'] ?? ''}';
      final jobOrder = '${payload['order_id'] ?? payload['id'] ?? ''}';
      final title = '${job['title'] ?? ''}';
      final billMatch =
          bill.isNotEmpty && (jobBill == bill || title.contains(bill));
      final orderMatch =
          order.isNotEmpty && (jobOrder == order || title.contains(order));
      if (billMatch || orderMatch) {
        found = job;
        break;
      }
    }

    if (found == null) return 'Không thấy lệnh in bill vừa thanh toán';
    final status = '${found['status']}';
    if (status == 'printed' || status == 'printing') return null;
    final id = '${found['id'] ?? ''}';
    if (id.isEmpty) return 'Lệnh in thiếu ID';

    try {
      final job = await printJobNow(id);
      final nextStatus = '${job['status']}';
      if (nextStatus == 'printed' || nextStatus == 'printing') return null;
      return '${job['error'] ?? 'Chưa in được bill'}';
    } catch (e) {
      return e.toString().replaceFirst('Exception: ', '');
    }
  }

  Future<void> markJobPrinted(String id) async {
    await postJson('/api/print/jobs/$id/printed',
        errorMessage: 'Không cập nhật được lệnh in');
  }

  Future<List<dynamic>> getPendingConfirmations() async {
    return listFrom(await getJson(
      '/api/orders/pending-confirmation',
      errorMessage: 'Không thể tải danh sách món chờ xác nhận',
    ));
  }

  Future<void> confirmPendingOrder(String orderId, List<String> itemIds) async {
    await postJson(
      '/api/orders/$orderId/confirm',
      body: {'item_ids': itemIds},
      errorMessage: 'Không thể xác nhận món ăn',
    );
  }

  Future<void> rejectPendingOrder(
      String orderId, List<String> itemIds, String reason) async {
    await postJson(
      '/api/orders/$orderId/reject',
      body: {'item_ids': itemIds, 'reason': reason},
      errorMessage: 'Không thể từ chối món ăn',
    );
  }

  Future<List<dynamic>> getBankTransactions({
    String status = 'unmatched,underpaid',
    int minutes = 240,
  }) async {
    final res = await getJson(
        '/api/payments/bank-transactions?status=${Uri.encodeComponent(status)}&minutes=$minutes',
        errorMessage: 'Không tải được giao dịch ngân hàng');
    if (res is Map && res['transactions'] is List) {
      return res['transactions'] as List;
    }
    return <dynamic>[];
  }
}
