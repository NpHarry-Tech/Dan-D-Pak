import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import '../primitives.dart';
import 'app_notifier.dart';
import '../ui/sound_player.dart';
import 'app_log.dart';
import 'black_box.dart';
import 'connectivity_status.dart';
import 'system_log.dart';

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
    // Giỏ hàng bán lẻ CHIA SẺ: mọi máy cùng chi nhánh thấy đúng cùng giỏ/khách/món.
    'retail:cart',
    // Sự kiện để phát THÔNG BÁO nghiệp vụ (định tuyến theo vai trò).
    'inventory:short',
    'inventory:alert',
    'invoice:issued',
    'online:new',
  ];

  /// Trạng thái kết nối realtime — topbar các màn hiển thị chấm Online thật
  /// (đứt kết nối = dữ liệu có thể cũ, nhân viên phải biết).
  final ValueNotifier<bool> connected = ValueNotifier(true);

  final DanDpakRealtimeClient _client = DanDpakRealtimeClient();
  final Set<void Function(String event, dynamic payload)> _listeners = {};

  Map<String, dynamic>? _soundConfig;
  // Định tuyến thông báo theo vai trò (Cài đặt → Thông báo). Vai trò của MÁY này để
  // quyết định có hiện thông báo nghiệp vụ (bán hàng/HĐ/kho…) trên thiết bị này không.
  Map<String, dynamic>? _routingConfig;
  String currentUserRole = '';
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
        ConnectivityStatus.instance.setSocketConnected(isConnected);
        // Rớt/nối lại realtime đều vào nhật ký hệ thống (có throttle) — mất
        // realtime nghĩa là dữ liệu trên màn có thể cũ, phải truy vết được.
        _logTransition(isConnected);
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
          _logConnectErrorOnce(payload);
          return;
        }
        dlog('Realtime event received: $event');
        BlackBox.add('socket', event);

        // Settings đổi từ máy khác → nạp lại cấu hình âm báo tại đây luôn
        // (SocketService sở hữu sound config).
        if (event == 'settings:updated') reloadSoundConfig();

        // Play the mapped notification sound
        _handleSoundNotification(event, payload);
        // Sự kiện nghiệp vụ → THÔNG BÁO cho đúng vai trò trên thiết bị này.
        _notifyBusiness(event, payload);

        _dispatch(event, payload);
      },
    );
  }

  // Mỗi đợt mất kết nối chỉ ghi một dòng; kết nối lại mới mở khóa lần kế tiếp.
  DateTime? _disconnectedAt;
  bool _outageLogged = false;

  void _logTransition(bool isConnected) {
    if (isConnected) {
      _outageLogged = false;
      final downFor = _disconnectedAt == null
          ? null
          : DateTime.now().difference(_disconnectedAt!);
      if (downFor != null) {
        _disconnectedAt = null;
        SystemLog.log(
          level: 'info',
          source: 'socket',
          eventType: 'socket_reconnect',
          title: 'Realtime đã nối lại sau ${downFor.inSeconds}s gián đoạn',
          durationMs: downFor.inMilliseconds,
        );
      }
      return;
    }
    _disconnectedAt ??= DateTime.now();
    if (_outageLogged) return;
    _outageLogged = true;
    SystemLog.log(
      level: 'warn',
      source: 'socket',
      eventType: 'socket_disconnect',
      title: 'Mất kết nối realtime (Socket.IO)',
      message:
          'Server $_baseUrl · chi nhánh $_branch — dữ liệu trên màn có thể cũ tới khi nối lại.',
    );
  }

  void _logConnectErrorOnce(dynamic error) {
    if (_outageLogged) return;
    _outageLogged = true;
    SystemLog.log(
      level: 'warn',
      source: 'socket',
      eventType: 'socket_error',
      title: 'Socket.IO connect_error',
      message: '$error',
    );
  }

  void _dispatch(String event, dynamic payload) {
    for (final listener
        in List<void Function(String event, dynamic payload)>.from(
            _listeners)) {
      try {
        listener(event, payload);
      } catch (e) {
        dlog('Error in SocketService listener: $e');
      }
    }
  }

  // Sự kiện realtime → thông báo nghiệp vụ, ĐỊNH TUYẾN theo vai trò (dùng
  // notification_routing_config đã cấu hình ở Cài đặt → Thông báo). Ví dụ: bán
  // hàng/HĐ → thu ngân+quản lý; kho/tồn thấp → thủ kho+quản lý; đơn F&B → bếp…
  // Catalog MỞ RỘNG: thêm loại mới chỉ cần 1 case ở _notificationFor.
  void _notifyBusiness(String event, dynamic payload) {
    try {
      final info = _notificationFor(event, payload);
      if (info == null) return;
      if (!_roleReceivesCategory(info.category)) return;
      AppNotifier.show(title: info.title, body: info.body);
    } catch (e) {
      dlog('notifyBusiness error: $e');
    }
  }

  // Map sự kiện → (category định tuyến, tiêu đề, nội dung). Trả null nếu không phải
  // sự kiện cần thông báo.
  ({String category, String title, String body})? _notificationFor(
      String event, dynamic payload) {
    final p = payload is Map ? payload : const <dynamic, dynamic>{};
    String s(dynamic v) => v?.toString() ?? '';
    switch (event) {
      case 'payment:done':
        final r = p['receipt'] is Map ? p['receipt'] as Map : const {};
        final table =
            s(r['table_code']).isEmpty ? 'Mang về' : s(r['table_code']);
        final bill = s(r['bill_no']);
        return (
          category: 'invoice',
          title: 'Khách đã thanh toán',
          body:
              'Bàn $table${bill.isEmpty ? '' : ' · HĐ $bill'} — ${s(r['total'])}đ'
        );
      case 'order:new':
        return (
          category: 'fnb_order',
          title: 'Đơn mới tại bàn / POS',
          body: ''
        );
      case 'order:pending':
        return (
          category: 'fnb_order',
          title: 'Khách tự gọi món (iPad)',
          body: 'Có món chờ nhân viên xác nhận'
        );
      case 'online:new':
      case 'online:order':
        return (
          category: 'online_order',
          title: 'Đơn hàng online mới',
          body: ''
        );
      case 'staff:call':
        final tc =
            s(p['table_code']).isEmpty ? s(p['table_id']) : s(p['table_code']);
        return (
          category: 'fnb_order',
          title: 'Khách gọi nhân viên',
          body: tc.isEmpty ? '' : 'Bàn $tc'
        );
      case 'invoice:issued':
        return (
          category: 'invoice',
          title: 'Đã xuất hóa đơn điện tử',
          body: s(p['invoice_no'])
        );
      case 'inventory:short':
      case 'inventory:alert':
        final name = s(p['name']).isEmpty ? s(p['sku_name']) : s(p['name']);
        return (
          category: 'inventory',
          title: 'Cảnh báo tồn kho thấp',
          body: name
        );
      default:
        return null;
    }
  }

  // Vai trò của MÁY này có nằm trong danh sách nhận thông báo của [category] không.
  // Chưa cấu hình (config null / category thiếu) → MẶC ĐỊNH hiện (không chặn).
  bool _roleReceivesCategory(String category) {
    if (currentUserRole.isEmpty || _routingConfig == null) return true;
    final roles = _routingConfig!['roles'];
    final list = roles is Map ? roles[category] : null;
    if (list is! List) return true;
    return list.map((e) => e.toString()).contains(currentUserRole);
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
          _soundConfig =
              Map<String, dynamic>.from(data['notification_sound_config']);
        }
        if (data is Map && data['notification_routing_config'] != null) {
          _routingConfig =
              Map<String, dynamic>.from(data['notification_routing_config']);
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

    final double volume =
        (cfg['volume'] is num) ? (cfg['volume'] as num).toDouble() : 1.0;

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
    _routingConfig = null;
    _outageLogged = false;
    currentUserRole = '';
    _listeners.clear();
    connected.value = true; // reset — chủ động ngắt, không phải mất kết nối
  }
}
