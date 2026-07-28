import 'package:socket_io_client/socket_io_client.dart' as io;

class DanDpakRealtimeClient {
  io.Socket? _socket;
  final List<void Function()> _listeners = [];

  bool isConnected = false;

  /// Định danh thiết bị dùng cho ràng buộc phiên phía server. Nối ở bootstrap
  /// (cùng chỗ với DanDpakApiClient.deviceMetadataProvider) để mọi màn hình gọi
  /// connect() đều gửi kèm mà không phải tự truyền — cùng cách làm với REST.
  static String Function()? deviceIdProvider;

  void connect({
    required String url,
    required String token,
    required String branchId,
    required String device,
    String? deviceId,
    required Iterable<String> events,
    void Function(bool isConnected)? onConnectionChanged,
    void Function(String event, dynamic data)? onEvent,
    bool connectImmediately = true,
    bool enableReconnection = true,
  }) {
    disconnect();

    // deviceId: server ràng buộc phiên với thiết bị đã đăng nhập (xem
    // sessionDeviceGate trong services/auth.js). Thiếu trường này thì WebSocket
    // trở thành đường vòng cho token bị sao chép sang máy khác.
    String resolvedDeviceId = deviceId ?? '';
    if (resolvedDeviceId.isEmpty) {
      try {
        resolvedDeviceId = deviceIdProvider?.call() ?? '';
      } catch (_) {}
    }
    final auth = {
      'branch': branchId,
      'device': device,
      'token': token,
      if (resolvedDeviceId.isNotEmpty) 'deviceId': resolvedDeviceId,
    };
    var options = io.OptionBuilder()
        // WebSocket trước cho độ trễ thấp, NHƯNG cho phép TỤT XUỐNG polling khi
        // ws chập chờn (WiFi yếu / mạng qua proxy) — trước đây ép ws-only nên chỉ
        // cần một cú rớt ws là mất kết nối hẳn, không có đường lui.
        .setTransports(['websocket', 'polling'])
        .setQuery(auth)
        .setAuth(auth)
        // Bắt tay lâu quá thì bỏ để thử lại, khỏi treo "đang kết nối".
        .setTimeout(20000)
        .disableAutoConnect();
    if (enableReconnection) {
      // KHÔNG BAO GIỜ bỏ cuộc, nhưng lùi dần để server chết hẳn thì không bị dội
      // request mỗi giây.
      //
      // ĐO THỰC TẾ trên nhật ký socket_reconnect của cửa hàng: trong 45 lần nối
      // lại, 19 lần rơi vào dải 6–30 giây — đúng bằng các nấc 4s/8s/16s của thang
      // lùi cũ (1s → 2s → 4s → 8s → 16s → 30s). Tức mạng chỉ chớp 1–2 giây nhưng
      // client TỰ BẮT MÌNH chờ thêm cả chục giây, nhân viên thấy "MẤT KẾT NỐI"
      // lâu hơn sự cố thật nhiều lần.
      //
      // Máy POS nằm trong cửa hàng, không phải điện thoại chạy pin ngoài đường:
      // thử lại dày hơn không hại gì. Nấc đầu 400ms và trần 8s → sự cố chớp tắt
      // gần như không kịp thấy, mà server sập hẳn vẫn chỉ bị hỏi ~8s một lần.
      options = options
          .enableReconnection()
          .setReconnectionAttempts(1 << 30)
          .setReconnectionDelay(400)
          .setReconnectionDelayMax(8000)
          .setRandomizationFactor(0.5);
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
