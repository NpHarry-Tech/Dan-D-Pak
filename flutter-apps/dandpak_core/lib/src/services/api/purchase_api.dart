part of '../api_service.dart';

extension ApiServicePurchaseApi on ApiService {
  Future<Map<String, dynamic>> getPurchaseOrders(
      {String status = '', String q = ''}) async {
    return mapFrom(await getJson(
        '/api/purchase?status=$status&q=${Uri.encodeComponent(q)}',
        errorMessage: 'Không tải được đơn mua'));
  }

  Future<Map<String, dynamic>> getPurchaseOrder(String id) async {
    return mapFrom(await getJson('/api/purchase/$id',
        errorMessage: 'Không tải được đơn mua'));
  }

  Future<Map<String, dynamic>> savePurchaseOrder(
      Map<String, dynamic> body) async {
    return mapFrom(await postJson('/api/purchase',
        body: body, errorMessage: 'Không lưu được đơn mua'));
  }

  Future<void> confirmPurchase(String id) async {
    await postJson('/api/purchase/$id/confirm',
        errorMessage: 'Không xác nhận được đơn');
  }

  Future<void> receivePurchase(String id, Map<String, dynamic> body) async {
    await postJson('/api/purchase/$id/receive',
        body: body, errorMessage: 'Không nhận được hàng');
  }

  Future<void> payPurchase(String id, Map<String, dynamic> body) async {
    await postJson('/api/purchase/$id/pay',
        body: body, errorMessage: 'Không ghi được thanh toán');
  }

  Future<void> cancelPurchase(String id) async {
    await postJson('/api/purchase/$id/cancel',
        errorMessage: 'Không hủy được đơn');
  }

  Future<void> deletePurchase(String id) async {
    await postJson('/api/purchase/$id/delete',
        errorMessage: 'Không xóa được đơn');
  }

  /// "Hoàn thành" kiểu KiotViet: nháp → xác nhận → nhận đủ vào kho 1 bước.
  Future<Map<String, dynamic>> completePurchase(String id,
      {String? warehouseId}) async {
    return mapFrom(await postJson('/api/purchase/$id/complete',
        body: {if (warehouseId != null) 'warehouse_id': warehouseId},
        errorMessage: 'Không hoàn thành được phiếu nhập'));
  }

  // ── Trả hàng nhập (PurchaseReturns) ────────────────────────────────────
  Future<List<dynamic>> getPurchaseReturns(
      {String status = '', String q = ''}) async {
    return listFrom(await getJson(
        '/api/purchase-returns?status=$status&q=${Uri.encodeComponent(q)}',
        errorMessage: 'Không tải được phiếu trả hàng nhập'));
  }

  Future<Map<String, dynamic>> getPurchaseReturn(String id) async {
    return mapFrom(await getJson('/api/purchase-returns/$id',
        errorMessage: 'Không tải được phiếu trả hàng'));
  }

  Future<Map<String, dynamic>> savePurchaseReturn(
      Map<String, dynamic> body) async {
    return mapFrom(await postJson('/api/purchase-returns',
        body: body, errorMessage: 'Không lưu được phiếu trả hàng'));
  }

  Future<Map<String, dynamic>> completePurchaseReturn(String id,
      {String? warehouseId, num? refundReceived}) async {
    return mapFrom(await postJson('/api/purchase-returns/$id/complete',
        body: {
          if (warehouseId != null) 'warehouse_id': warehouseId,
          if (refundReceived != null) 'refund_received': refundReceived,
        },
        errorMessage: 'Không hoàn thành được phiếu trả hàng'));
  }

  Future<void> cancelPurchaseReturn(String id) async {
    await postJson('/api/purchase-returns/$id/cancel',
        errorMessage: 'Không hủy được phiếu trả hàng');
  }

  Future<void> deletePurchaseReturn(String id) async {
    await postJson('/api/purchase-returns/$id/delete',
        errorMessage: 'Không xóa được phiếu trả hàng');
  }
}
