part of '../api_service.dart';

extension ApiServiceInvoiceApi on ApiService {
  // ── Invoices (Hóa đơn) ─────────────────────────────────────────────────
  Future<Map<String, dynamic>> getInvoicePage({
    int page = 1,
    int limit = 100,
    String q = '',
    String status = '',
  }) async {
    final query = Uri(queryParameters: {
      'page': '$page',
      'limit': '$limit',
      if (q.trim().isNotEmpty) 'q': q.trim(),
      if (status.isNotEmpty) 'status': status,
    }).query;
    return mapFrom(await getJson('/api/invoices?$query',
        errorMessage: 'Không tải được hóa đơn'));
  }

  Future<Map<String, dynamic>> getInvoiceDetail(String orderId) async =>
      mapFrom(await getJson('/api/invoices/$orderId/detail',
          errorMessage: 'Không tải được chi tiết hóa đơn'));

  /// Issue a VAT invoice for a paid order (from the sales-history dialog).
  Future<Map<String, dynamic>> issueInvoice(Map<String, dynamic> body) async {
    return mapFrom(await postJson('/api/invoices/issue',
        body: body, errorMessage: 'Không xuất được hóa đơn VAT'));
  }

  // ── E-Invoices (Hóa đơn điện tử theo NĐ 70/2025/NĐ-CP) ─────────────────
  Future<Map<String, dynamic>?> getOrderEInvoice(String orderId) async {
    try {
      final res = await getJson('/api/orders/$orderId/einvoice',
          errorMessage: 'Không tải được thông tin HĐĐT');
      if (res is Map) return Map<String, dynamic>.from(res);
    } catch (_) {}
    return null;
  }

  Future<Map<String, dynamic>> retryEInvoice(
      String eInvoiceId, String securityPin) async {
    return mapFrom(await postJson(
      '/api/orders/dummy/einvoice/retry',
      body: {
        'e_invoice_id': eInvoiceId,
        'security_pin': securityPin,
      },
      errorMessage: 'Không thể phát hành lại hóa đơn',
    ));
  }

  Future<Map<String, dynamic>> syncEInvoice(String eInvoiceId) async {
    return mapFrom(await postJson(
      '/api/einvoice/$eInvoiceId/sync',
      errorMessage: 'Không thể đồng bộ trạng thái hóa đơn',
    ));
  }

  Future<Map<String, dynamic>> cancelEInvoice(
      String eInvoiceId, String reason, String securityPin) async {
    return mapFrom(await postJson(
      '/api/einvoice/$eInvoiceId/cancel',
      body: {
        'reason': reason,
        'security_pin': securityPin,
      },
      errorMessage: 'Không thể hủy hóa đơn điện tử',
    ));
  }

  Future<Map<String, dynamic>> getShiftInvoiceSummary(String shiftId) async {
    return mapFrom(await getJson(
      '/api/einvoice/shift-summary?shift_id=$shiftId',
      errorMessage: 'Không thể tải tổng hợp HĐĐT của ca',
    ));
  }
}
