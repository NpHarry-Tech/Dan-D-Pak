part of '../api_service.dart';

extension ApiServicePrintingApi on ApiService {
  /// [live] = soi trạng thái THẬT (máy POS đang cắm máy in có đang chạy app
  /// không, máy in LAN có trả lời không). Thiếu cờ này server trả 'ready' vô
  /// điều kiện — đúng nguyên nhân màn Máy in từng báo "Sẵn sàng" khi máy POS
  /// còn chưa mở app. Timeout nới ra vì có thể phải dò TCP máy in LAN.
  Future<List<dynamic>> getPrinters({bool live = true}) async {
    return listFrom(await getJson('/api/print/printers${live ? '?live=1' : ''}',
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

  Future<Map<String, dynamic>> receiptPrintStatus(String paymentId) async {
    return mapFrom(await getJson('/api/payments/$paymentId/print-status',
        timeout: const Duration(seconds: 3),
        errorMessage: 'Không đọc được trạng thái in hóa đơn'));
  }

  Future<Map<String, dynamic>> waitForReceiptPrint(String paymentId,
      {Duration timeout = const Duration(seconds: 45)}) async {
    final deadline = DateTime.now().add(timeout);
    Map<String, dynamic> state = <String, dynamic>{'status': 'queued'};
    while (DateTime.now().isBefore(deadline)) {
      state = await receiptPrintStatus(paymentId);
      if (state['status'] == 'printed' || state['status'] == 'failed')
        return state;
      await Future<void>.delayed(const Duration(seconds: 1));
    }
    return state;
  }

  /// dùng để in bill tự động sau thanh toán kể cả khi tuyến in chưa bật auto.
  Future<Map<String, dynamic>> printJobNow(String id) async {
    return mapFrom(await postJson('/api/print/jobs/$id/print',
        timeout: const Duration(seconds: 20),
        errorMessage: 'Không gửi được lệnh in'));
  }

  /// Tìm lệnh in HÓA ĐƠN của một đơn trong hàng đợi gần đây.
  Future<Map<String, dynamic>?> _timLenhInBill(
      String order, String bill) async {
    final jobs = await getPrintJobs();
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
      if (billMatch || orderMatch) return job;
    }
    return null;
  }

  /// IN LẠI bill của một hóa đơn — tạo lệnh in MỚI.
  ///
  /// KHÁC hẳn [forcePrintReceiptJob]: hàm kia dùng ngay sau thanh toán, thấy
  /// lệnh cũ đã 'printed' là coi như xong. Dùng nó cho nút "In lại" thì bấm bao
  /// nhiêu lần cũng chỉ báo "đã gửi" mà máy in đứng im — đúng lỗi người dùng
  /// gặp ở màn Hóa đơn. In lại BẮT BUỘC phải sinh job mới
  /// (`POST /print/jobs/:id/reprint`).
  Future<String?> reprintReceiptForOrder({
    String orderId = '',
    String billNo = '',
  }) async {
    final order = orderId.trim();
    final bill = billNo.trim();
    if (order.isEmpty && bill.isEmpty) return 'Thiếu mã bill để in lại';
    if (order.isNotEmpty) {
      try {
        // Server dựng lại receipt từ DB và định tuyến theo x-device-id hiện tại.
        // Không phụ thuộc lịch sử 50 job và không clone tuyến máy in cũ.
        await printOrderReceipt(order);
        return null;
      } catch (e) {
        return e.toString().replaceFirst('Exception: ', '');
      }
    }
    try {
      final found = await _timLenhInBill(order, bill);
      if (found == null) {
        return 'Không thấy lệnh in của hóa đơn này trong lịch sử in';
      }
      final id = '${found['id'] ?? ''}';
      if (id.isEmpty) return 'Lệnh in thiếu ID';
      await reprintJob(id);
      return null;
    } catch (e) {
      return e.toString().replaceFirst('Exception: ', '');
    }
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

    final found = await _timLenhInBill(order, bill);
    if (found == null) return 'Không thấy lệnh in bill vừa thanh toán';
    final status = '${found['status']}';
    // `queued` is the successful durable state when PRINT_DISPATCH=agent: the
    // store agent will claim and print it asynchronously. It is not a failure.
    if (status == 'queued' || status == 'printed' || status == 'printing') {
      return null;
    }
    final id = '${found['id'] ?? ''}';
    if (id.isEmpty) return 'Lệnh in thiếu ID';

    try {
      final job = await printJobNow(id);
      final nextStatus = '${job['status']}';
      if (nextStatus == 'queued' ||
          nextStatus == 'printed' ||
          nextStatus == 'printing') return null;
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

  // ── AGENT IN CHẠY TRONG APP (máy POS cầm tay có máy in gắn liền) ──────────
  // Dùng CHÍNH các endpoint mà Hardware Agent trên Windows vẫn dùng, nên toàn bộ
  // phần phân giải tuyến / chống job mồ côi / giữ chỗ theo máy ở server áp dụng
  // y nguyên. Các route này gác bằng quyền thường của phiên đăng nhập
  // (guardAny 'module.printing','settings.printers','settings.print','pay')
  // — thu ngân có 'pay' là gọi được, không cần token riêng.

  /// Báo máy in của MÁY NÀY lên server. Không báo đều đặn thì server coi máy đã
  /// tắt app và ngừng phát job cho nó.
  Future<void> reportAgentPrinters(List<Map<String, dynamic>> printers) async {
    await postJson('/api/agent/printers/report',
        body: {'printers': printers},
        errorMessage: 'Không báo được máy in lên máy chủ');
  }

  /// Lấy các phiếu đang chờ in DÀNH CHO MÁY NÀY. Server tự lọc theo device id
  /// (gửi kèm trong header) nên hai máy không giành nhau một phiếu.
  Future<List<Map<String, dynamic>>> getAgentPendingJobs(
      {int limit = 20}) async {
    final res = await getJson('/api/agent/print/pending?limit=$limit',
        errorMessage: 'Không lấy được hàng đợi in');
    final raw = res is Map ? res['jobs'] : null;
    return (raw as List? ?? const [])
        .whereType<Map>()
        .map((e) => Map<String, dynamic>.from(e))
        .toList();
  }

  /// Báo phiếu đã in xong hay hỏng. PHẢI gọi kể cả khi hỏng — không báo thì
  /// server để job treo mãi ở trạng thái đang in.
  Future<void> reportAgentJobResult(String id,
      {required bool ok, String? error}) async {
    await postJson('/api/agent/print/jobs/$id/result',
        body: {'ok': ok, if (error != null) 'error': error},
        errorMessage: 'Không báo được kết quả in');
  }
}
