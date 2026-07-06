import 'package:dandpak_core/dandpak_core.dart';

class SocketService {
  static const _events = [
    'order:new',
    'order:confirmed',
    'kds:refresh',
    'order:item',
    'table:updated',
    // Sửa món / tắt món / đổi giá từ POS giữa giờ → iPad order tự tải lại
    // menu (mọi tablet khách cùng thấy thay đổi ngay, không cần F5 tay).
    'menu:updated',
    'settings:updated',
  ];

  final String url;
  final String token;
  final String branchId;
  final DanDpakRealtimeClient _client = DanDpakRealtimeClient();

  SocketService({required this.url, required this.token, required this.branchId});

  bool get isConnected => _client.isConnected;

  void connect({
    required void Function(bool) onConnectionChanged,
    String device = 'kds',
    void Function(String event, dynamic payload)? onEvent,
  }) {
    _client.connect(
      url: url,
      token: token,
      branchId: branchId,
      device: device,
      events: _events,
      onConnectionChanged: onConnectionChanged,
      onEvent: onEvent,
    );
  }

  void addListener(void Function() listener) {
    _client.addListener(listener);
  }

  void removeListener(void Function() listener) {
    _client.removeListener(listener);
  }

  void dispose() {
    _client.dispose();
  }
}
