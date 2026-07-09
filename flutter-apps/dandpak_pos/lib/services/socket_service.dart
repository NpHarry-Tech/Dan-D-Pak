import 'dart:convert';
import 'dart:io' show Platform;
import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:dandpak_core/dandpak_core.dart';
import 'package:local_notifier/local_notifier.dart';
import '../ui/sound_player.dart';
import 'app_log.dart';
import 'black_box.dart';

/// Synthetic event dispatched to every listener when the socket RECONNECTS
/// after a drop: events missed while offline are gone, so each screen must
/// treat this as "reload everything you own" (floor, menu, shift, tickets...).
const String kSyncReconnected = 'sync:reconnected';

class SocketService {
  static final SocketService instance = SocketService._internal();
  factory SocketService() => instance;
  SocketService._internal();

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
    // Đồng bộ danh mục/cấu hình đa thiết bị: sửa món/tắt món giữa giờ,
    // nhập-xuất kho, voucher, đổi settings — mọi máy tự làm tươi.
    'menu:updated',
    'inventory:updated',
    'vouchers:updated',
    'settings:updated',
  ];

  /// Trạng thái kết nối realtime — topbar các màn hiển thị chấm Online thật
  /// (đứt kết nối = dữ liệu có thể cũ, nhân viên phải biết).
  final ValueNotifier<bool> connected = ValueNotifier(true);

  final DanDpakRealtimeClient _client = DanDpakRealtimeClient();
  final Set<void Function(String event, dynamic payload)> _listeners = {};

  Map<String, dynamic>? _soundConfig;
  String? _baseUrl;
  String? _branch;
  String? _token;

  void addListener(void Function(String event, dynamic payload) listener) {
    _listeners.add(listener);
  }

  void removeListener(void Function(String event, dynamic payload) listener) {
    _listeners.remove(listener);
  }

  void connect({
    required String baseUrl,
    required String branch,
    required String token,
  }) {
    if (_client.isConnected &&
        _baseUrl == baseUrl &&
        _branch == branch &&
        _token == token) {
      return;
    }

    _baseUrl = baseUrl;
    _branch = branch;
    _token = token;

    reloadSoundConfig();

    dlog('Connecting Socket.IO to $baseUrl for branch $branch...');
    var wasConnected = true;
    _client.connect(
      url: baseUrl,
      branchId: branch,
      token: token,
      device: 'pos',
      events: _events,
      onConnectionChanged: (isConnected) {
        dlog(isConnected ? 'Socket.IO connected.' : 'Socket.IO disconnected.');
        BlackBox.add('socket', isConnected ? 'connected' : 'DISCONNECTED');
        connected.value = isConnected;
        if (isConnected && !wasConnected) {
          // Vừa nối lại sau khi rớt: các event trong lúc offline đã MẤT —
          // phát tín hiệu để mọi màn tự tải lại toàn bộ dữ liệu của nó.
          dlog('Reconnected → broadcasting $kSyncReconnected');
          reloadSoundConfig();
          _dispatch(kSyncReconnected, null);
        }
        wasConnected = isConnected;
      },
      onEvent: (event, payload) {
        if (event == 'connect_error') {
          dlog('Socket.IO connection error.');
          return;
        }
        dlog('Realtime event received: $event');
        BlackBox.add('socket', event);

        // Settings đổi từ máy khác → nạp lại cấu hình âm báo tại đây luôn
        // (SocketService sở hữu sound config).
        if (event == 'settings:updated') reloadSoundConfig();

        // Play the mapped notification sound
        _handleSoundNotification(event, payload);

        if (event == 'payment:done') {
          _showNativeNotification(payload);
        }

        _dispatch(event, payload);
      },
    );
  }

  void _dispatch(String event, dynamic payload) {
    for (final listener in List<void Function(String event, dynamic payload)>.from(_listeners)) {
      try {
        listener(event, payload);
      } catch (e) {
        dlog('Error in SocketService listener: $e');
      }
    }
  }

  void _showNativeNotification(dynamic payload) {
    try {
      if (kIsWeb) return;
      if (!Platform.isWindows && !Platform.isMacOS && !Platform.isLinux) return;
      if (payload is Map && payload['receipt'] is Map) {
        final receipt = payload['receipt'] as Map;
        final tableCode = receipt['table_code'] ?? 'Mang về';
        final total = receipt['total'] ?? 0;
        final billNo = receipt['bill_no'] ?? '';

        const title = 'Khách hàng đã thanh toán';
        final body = 'Bàn $tableCode đã thanh toán thành công số tiền $totalđ (Hóa đơn $billNo)';

        final notification = LocalNotification(
          title: title,
          body: body,
        );
        notification.show();
      }
    } catch (e) {
      dlog('Failed to show native notification: $e');
    }
  }

  Future<void> reloadSoundConfig() async {
    final urlStr = _baseUrl;
    final tokenStr = _token;
    if (urlStr == null || tokenStr == null) return;

    try {
      final res = await http.get(
        Uri.parse('$urlStr/api/settings/app'),
        headers: {
          'Authorization': 'Bearer $tokenStr',
          'Accept': 'application/json',
        },
      );
      if (res.statusCode == 200) {
        final data = jsonDecode(res.body);
        if (data is Map && data['notification_sound_config'] != null) {
          _soundConfig = Map<String, dynamic>.from(data['notification_sound_config']);
        }
      }
    } catch (e) {
      dlog('Failed to fetch sound config in SocketService: $e');
    }
  }

  void _handleSoundNotification(String event, dynamic payload) {
    final cfg = _soundConfig;
    if (cfg == null) return;

    final globalEnabled = cfg['enabled'] ?? true;
    if (!globalEnabled) return;

    final double volume = (cfg['volume'] is num)
        ? (cfg['volume'] as num).toDouble()
        : 1.0;

    String? configEvent;
    String defaultSound = 'Doorbell';

    if (event == 'order:pending') {
      configEvent = 'table_order';
      defaultSound = 'Information_Bell';
    } else if (event == 'staff:call') {
      configEvent = 'staff_call';
      defaultSound = 'Alarmed';
    } else if (event == 'order:new' || event == 'online:order') {
      configEvent = 'online_order';
      defaultSound = 'Doorbell';
    } else if (event == 'payment:done') {
      configEvent = 'payment';
      defaultSound = 'Glass';
    } else if (event == 'order:item') {
      configEvent = 'kds_new_order';
      defaultSound = 'Beeper';
    }

    if (configEvent == null) return;

    final events = cfg['events'];
    final ev = events is Map ? events[configEvent] : null;

    bool enabled = true;
    String soundId = defaultSound;

    if (ev is Map) {
      enabled = ev['enabled'] ?? true;
      if (ev['sound'] != null && ev['sound'].toString().isNotEmpty) {
        soundId = ev['sound'].toString();
      }
    }

    if (!enabled) return;

    final baseUrlStr = _baseUrl;
    if (baseUrlStr != null) {
      playNotificationSound(baseUrlStr, soundId, volume: volume);
    }
  }

  void disconnect() {
    // Intentionally a no-op: the connection is global and shared by every
    // screen; individual screens must only remove their listeners.
  }

  void logoutDisconnect() {
    _client.disconnect();
    _baseUrl = null;
    _branch = null;
    _token = null;
    _soundConfig = null;
    _listeners.clear();
    connected.value = true; // reset — chủ động ngắt, không phải mất kết nối
  }
}
