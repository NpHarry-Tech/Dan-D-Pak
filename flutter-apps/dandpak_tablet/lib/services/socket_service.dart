import 'package:dandpak_core/dandpak_core.dart';

class SocketService {
  static const _events = [
    'order:new',
    'order:confirmed',
    'kds:refresh',
    'order:item',
    'table:updated',
  ];

  final String url;
  final String token;
  final String branchId;
  final DanDpakRealtimeClient _client = DanDpakRealtimeClient();

  SocketService({required this.url, required this.token, required this.branchId});

  bool get isConnected => _client.isConnected;

  void connect({required void Function(bool) onConnectionChanged}) {
    _client.connect(
      url: url,
      token: token,
      branchId: branchId,
      device: 'kds',
      events: _events,
      onConnectionChanged: onConnectionChanged,
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
