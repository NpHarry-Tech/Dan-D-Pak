import 'package:dandpak_core/dandpak_core.dart';

class SocketService {
  static const _events = [
    'order:new',
    'order:customer_pending',
    'order:confirmed',
    'order:rejected',
    'order:pending',
    'order:updated',
    'order:item',
    'table:updated',
    'staff:call',
    'payment:done',
    'shift:updated',
  ];

  final DanDpakRealtimeClient _client = DanDpakRealtimeClient();

  void connect({
    required String baseUrl,
    required String branch,
    required String token,
    required Function() onUpdateCallback,
  }) {
    print('Connecting Socket.IO to $baseUrl for branch $branch...');
    _client.connect(
      url: baseUrl,
      branchId: branch,
      token: token,
      device: 'pos',
      events: _events,
      onConnectionChanged: (connected) {
        print(connected ? 'Socket.IO connected.' : 'Socket.IO disconnected.');
      },
      onEvent: (event, _) {
        if (event == 'connect_error') {
          print('Socket.IO connection error.');
          return;
        }
        print('Realtime event received: $event');
        onUpdateCallback();
      },
    );
  }

  void disconnect() {
    _client.disconnect();
  }
}
