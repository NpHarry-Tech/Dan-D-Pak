import 'package:socket_io_client/socket_io_client.dart' as io;

class DanDpakRealtimeClient {
  io.Socket? _socket;
  final List<void Function()> _listeners = [];

  bool isConnected = false;

  void connect({
    required String url,
    required String token,
    required String branchId,
    required String device,
    required Iterable<String> events,
    void Function(bool isConnected)? onConnectionChanged,
    void Function(String event, dynamic data)? onEvent,
    bool connectImmediately = true,
    bool enableReconnection = true,
  }) {
    disconnect();

    final auth = {'branch': branchId, 'device': device, 'token': token};
    var options = io.OptionBuilder()
        .setTransports(['websocket'])
        .setQuery(auth)
        .setAuth(auth)
        .disableAutoConnect();
    if (enableReconnection) {
      options = options.enableReconnection();
    }

    _socket = io.io(url, options.build());
    _socket!.onConnect((_) {
      isConnected = true;
      onConnectionChanged?.call(true);
    });
    _socket!.onDisconnect((_) {
      isConnected = false;
      onConnectionChanged?.call(false);
    });
    _socket!.onConnectError((err) {
      onEvent?.call('connect_error', err);
    });

    for (final event in events) {
      _socket!.on(event, (data) {
        onEvent?.call(event, data);
        for (final listener in List<void Function()>.from(_listeners)) {
          listener();
        }
      });
    }

    if (connectImmediately) {
      _socket!.connect();
    }
  }

  void addListener(void Function() listener) {
    _listeners.add(listener);
  }

  void removeListener(void Function() listener) {
    _listeners.remove(listener);
  }

  void disconnect() {
    _socket?.disconnect();
    _socket?.dispose();
    _socket = null;
    isConnected = false;
  }

  void dispose() {
    disconnect();
    _listeners.clear();
  }
}
