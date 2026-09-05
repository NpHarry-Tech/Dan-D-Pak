import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import '../primitives.dart';
import 'app_notifier.dart';
import '../ui/sound_player.dart';
import 'ring_controller.dart';
import 'app_log.dart';
import 'black_box.dart';
import 'connectivity_status.dart';
import 'system_log.dart';
import 'receipt_print_tracker.dart';

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
    'kds:refresh',
    'kds:alert',
    'table:updated',
    'staff:call',
    'payment:done',
    'payment:auto',
    'payment:customer_claimed',
    'payment:config',
    'print:done',
    'print:failed',
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
    'online:order',
    'online:updated',
    'omni:conversation.updated',
    // Nhật ký hoạt động realtime: server phát sau khi ghi audit_log → màn Nhật ký
    // hiện dòng mới ngay (dedupe theo id khi reconnect resync). Gồm cả dòng
    // "Cập nhật thành công" (app.update_success).
    'activity:new',
    // Kho Tài liệu realtime: file/ảnh mới hoặc đổi trạng thái → tab Tài liệu tự cập nhật.
    'document:new',
    'document:updated',
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

    if (_baseUrl != baseUrl || _branch != branch || _token != token) {
      // A cursor belongs to one authenticated tenant/branch stream only.
      _client.resetResumeCursor();
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
        if (event == 'realtime:resync_required') {
          dlog('Realtime cursor unavailable → full resync required.');
          _dispatch(kSyncReconnected, payload);
          return;
        }
        if (event == 'realtime:resume_complete') return;
        dlog('Realtime event received: $event');
        BlackBox.add('socket', event);
        ReceiptPrintTracker.instance.reconcileRealtime(event, payload);

        // Settings đổi từ máy khác → nạp lại cấu hình âm báo tại đây luôn
        // (SocketService sở hữu sound config).
        if (event == 'settings:updated') reloadSoundConfig();

        // Play the mapped notification sound
        _handleSoundNotification(event, payload);
        // GỠ CHUÔNG khi server báo món tự-gọi đã được xử lý. Server phát LẠI
        // 'order:pending' (kèm 'confirmed'/'rejected') để báo đã xác nhận/từ chối
        // — KHÔNG phải việc mới. Chạy KHÔNG phụ thuộc cấu hình âm thanh để dù có
        // tắt tiếng giữa chừng, chuông đang reo vẫn được gỡ đúng đơn.
        _updateRingResolution(event, payload);
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
      // Thông báo KHÁCH cần nhân viên xử lý (tự gọi món / gọi nhân viên) → banner
      // có nút "Xem" nhảy thẳng vào mục xử lý (AppNotifier.onOpenRequested).
      final actionable = event == 'order:pending' ||
          event == 'staff:call' ||
          event == 'online:new' ||
          event == 'online:order';
      AppNotifier.show(
          title: info.title, body: info.body, showViewAction: actionable);
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
        final order = p['order'] is Map ? p['order'] as Map : p;
        if (s(order['channel']) == 'retail') return null;
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
    // NHÁY ĐÈN HIỆU cho phiếu bếp sắp in — chạy KHÔNG phụ thuộc cấu hình âm
    // thanh (đèn là báo hình, phải nháy dù đã tắt tiếng).
    if (event == 'kds:alert') RingController.instance.flashKds();
    final cfg = _soundConfig;
    if (cfg == null) return;
    if (event == 'order:new' &&
        payload is Map &&
        (payload['order'] is Map
                ? payload['order']['channel']
                : payload['channel']) ==
            'retail') {
      return;
    }

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
    } else if (event == 'kds:alert') {
      // MÁY IN BẾP sắp in: kêu "tít tít tít" (nháy đèn đã xử ở đầu hàm).
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
      // KHÁCH TỰ GỌI MÓN (order:pending) và KHÁCH GỌI NHÂN VIÊN (staff:call):
      // REO LIÊN TỤC như điện thoại đổ chuông tới khi nhân viên bấm chuông xem —
      // không chỉ kêu một tiếng rồi im (yêu cầu chủ cửa hàng). Các sự kiện khác
      // vẫn kêu một tiếng như cũ.
      if (event == 'order:pending') {
        final map = payload is Map ? payload : const {};
        // Đây là lần PHÁT LẠI báo đã xác nhận/từ chối (có 'confirmed'/'rejected')?
        // Nếu vậy KHÔNG reo — việc gỡ chuông đã do _updateRingResolution lo.
        if (map['confirmed'] != null || map['rejected'] != null) return;
        RingController.instance
            .configure(baseUrl: baseUrlStr, soundId: soundId);
        RingController.instance.ring(_ringKeyOf(payload));
      } else if (event == 'staff:call') {
        RingController.instance
            .configure(baseUrl: baseUrlStr, soundId: soundId);
        RingController.instance.ring(_staffRingKeyOf(payload));
      } else {
        playNotificationSound(baseUrlStr, soundId, volume: volume);
      }
    }
  }

  /// Khóa ổn định cho chuông món tự-gọi = mã ĐƠN (order_id). Ring lúc có việc mới
  /// và clear lúc xác nhận/từ chối PHẢI ra cùng khóa → suy từ cùng một trường.
  String _ringKeyOf(dynamic payload) {
    final p = payload is Map ? payload : const {};
    final order = p['order'] is Map ? p['order'] as Map : null;
    final id = order?['id'] ??
        p['order_id'] ??
        p['id'] ??
        order?['table_id'] ??
        p['table_id'];
    return id?.toString() ?? '';
  }

  /// Chuông gọi nhân viên: khóa theo BÀN để gọi lại cùng bàn không cộng dồn.
  String _staffRingKeyOf(dynamic payload) {
    final p = payload is Map ? payload : const {};
    final t = p['table_id'] ??
        p['table'] ??
        (p['table'] is Map ? (p['table'] as Map)['id'] : null);
    return t != null ? 'staff:$t' : '';
  }

  /// 'order:pending' kèm 'confirmed'/'rejected' = tín hiệu ĐÃ XỬ LÝ → gỡ chuông
  /// đúng đơn đó. Chạy vô điều kiện (không phụ thuộc cấu hình âm thanh).
  void _updateRingResolution(String event, dynamic payload) {
    if (event != 'order:pending') return;
    final map = payload is Map ? payload : const {};
    if (map['confirmed'] == null && map['rejected'] == null) return;
    final key = _ringKeyOf(payload);
    if (key.isNotEmpty) RingController.instance.clear(key);
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
