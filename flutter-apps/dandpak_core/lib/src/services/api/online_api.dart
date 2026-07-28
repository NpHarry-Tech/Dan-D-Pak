part of '../api_service.dart';

extension ApiServiceOnlineApi on ApiService {
  Future<List<dynamic>> getOnlineOrders() async {
    return listFrom(await getJson('/api/online/orders',
        errorMessage: 'Không tải được đơn online'));
  }

  Future<Map<String, dynamic>> getOnlineChannels() async {
    return mapFrom(await getJson('/api/online/channels',
        errorMessage: 'Không tải được kênh bán'));
  }

  Future<void> onlineConfirmPayment(String id) async {
    await postJson('/api/online/orders/$id/confirm-payment',
        errorMessage: 'Không xác nhận được thanh toán');
  }

  Future<void> onlineConfirmDelivery(String id) async {
    await postJson('/api/online/orders/$id/confirm-delivery',
        errorMessage: 'Không xác nhận được giao hàng');
  }

  Future<void> onlineReturn(String id) async {
    await postJson('/api/online/orders/$id/return',
        errorMessage: 'Không trả được đơn');
  }
}
