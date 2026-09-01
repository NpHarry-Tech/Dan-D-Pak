import 'package:flutter/foundation.dart';

import '../api_client.dart';
import 'api_service.dart';

/// Step 2 multi-device — MỘT TAB bán lẻ = MỘT canonical order trên server.
///
/// Nguyên tắc cứng (online-only + money integrity):
///  • Client KHÔNG tự đánh số "Hóa đơn N" — nhãn = display_sequence server cấp.
///  • Mọi mutation đi qua hợp đồng: order_id + lease_token + expected_revision +
///    command_id. Sau response, THAY projection bằng canonical server (KHÔNG merge
///    đoán).
///  • EDIT_LEASE_LOST / order.lease.revoked → read-only + reload canonical.
///  • ORDER_VERSION_CONFLICT → reload canonical (không replay local).
///  • ORDER_FINALIZED / order.paid → read-only, đóng khả năng sửa.
///  • Reconnect → reload canonical từ server, tuyệt đối không replay cart local.
class RetailOrderSession extends ChangeNotifier {
  final ApiService api;
  final String device;

  String orderId;
  int displaySequence;
  int revision;
  String leaseToken;
  String status; // open | checkout_locked | paid | void
  bool readOnly;
  String? blockReason;
  Map<String, dynamic> snapshot;

  RetailOrderSession(
    this.api, {
    required this.device,
    required this.orderId,
    required this.displaySequence,
    required this.revision,
    required this.leaseToken,
    this.status = 'open',
    Map<String, dynamic>? snapshot,
  })  : readOnly = false,
        snapshot = snapshot ?? <String, dynamic>{};

  /// Nhãn hiển thị = display_sequence SERVER cấp (KHÔNG BAO GIỜ tabs.length+1).
  String get label => 'Hóa đơn ${displaySequence.toString().padLeft(2, '0')}';

  // §3: giá canonical do SERVER áp (priceCart) — client CHỈ RENDER, không tự tính.
  Map<String, dynamic> get pricing =>
      (snapshot['pricing'] as Map?)?.cast<String, dynamic>() ?? const {};

  /// Dòng đã định giá server (name/qty/unit_price/promo/line_total) để render.
  List<Map<String, dynamic>> get pricedLines =>
      ((snapshot['priced_lines'] as List?) ?? const [])
          .whereType<Map>()
          .map((e) => e.cast<String, dynamic>())
          .toList();

  num get total => (pricing['total'] as num?) ?? 0;
  num get subtotal => (pricing['subtotal'] as num?) ?? 0;
  num get discount => (pricing['discount'] as num?) ?? 0;

  static int _n(dynamic v, [int d = 0]) =>
      v is num ? v.toInt() : (int.tryParse('${v ?? ''}') ?? d);

  /// Tạo tab mới: server cấp order_id + display_sequence ATOMIC + lease.
  static Future<RetailOrderSession> create(ApiService api,
      {required String device,
      String registerId = '',
      String sessionId = ''}) async {
    final r = await api.createRetailOrder(
        device: device, registerId: registerId, sessionId: sessionId);
    return RetailOrderSession(api,
        device: device,
        orderId: '${r['order_id']}',
        displaySequence: _n(r['display_sequence']),
        revision: _n(r['revision']),
        leaseToken: '${r['lease_token'] ?? ''}',
        status: '${r['status'] ?? 'open'}',
        snapshot: r['snapshot'] is Map
            ? Map<String, dynamic>.from(r['snapshot'] as Map)
            : <String, dynamic>{});
  }

  int _cmdSeq = 0;
  String _newCommandId() =>
      '${device}_${DateTime.now().microsecondsSinceEpoch}_${_cmdSeq++}';

  void _adoptCanonical(Map res) {
    revision = _n(res['revision'], revision);
    status = '${res['status'] ?? status}';
    if (res['snapshot'] is Map) {
      snapshot = Map<String, dynamic>.from(res['snapshot'] as Map);
    }
    if (status == 'paid' || status == 'void') readOnly = true;
  }

  /// Áp một lệnh mutation. true = áp thành công; false = bị chặn (đã set trạng thái).
  Future<bool> applyCommand(
      String command, Map<String, dynamic> payload) async {
    if (readOnly) return false;
    try {
      final res = await api.retailOrderCommand(orderId,
          commandId: _newCommandId(),
          expectedRevision: revision,
          leaseToken: leaseToken,
          device: device,
          command: command,
          payload: payload);
      _adoptCanonical(res); // canonical — KHÔNG merge đoán
      notifyListeners();
      return true;
    } on ApiException catch (e) {
      final handled = await _handleCoded(e.code);
      if (!handled) rethrow;
      return false;
    }
  }

  Future<bool> _handleCoded(String code) async {
    switch (code) {
      case 'ORDER_VERSION_CONFLICT':
        await reloadCanonical();
        return true;
      case 'EDIT_LEASE_LOST':
        readOnly = true;
        blockReason = 'Quyền sửa đã bị thiết bị khác tiếp quản';
        await reloadCanonical();
        return true;
      case 'ORDER_FINALIZED':
        readOnly = true;
        status = 'paid';
        blockReason = 'Hóa đơn đã thanh toán';
        notifyListeners();
        return true;
      case 'ORDER_ALREADY_CHECKING_OUT':
        readOnly = true;
        blockReason = 'Đơn đang thanh toán ở thiết bị khác';
        notifyListeners();
        return true;
      default:
        return false;
    }
  }

  /// Tải state canonical từ server (dùng khi conflict/reconnect). KHÔNG replay local.
  Future<void> reloadCanonical() async {
    try {
      _adoptCanonical(await api.getRetailOrder(orderId));
    } on ApiException catch (e) {
      if (e.code == 'ORDER_NOT_FOUND' || e.statusCode == 404) {
        readOnly = true;
        blockReason = 'Đơn không còn trên hệ thống';
      }
    }
    notifyListeners();
  }

  /// Reconnect: BỎ projection local, lấy canonical từ server.
  Future<void> onReconnect() => reloadCanonical();

  /// Gia hạn lease. Mất quyền → read-only + reload.
  Future<void> heartbeat() async {
    if (readOnly) return;
    try {
      await api.heartbeatOrderLease(orderId,
          device: device, leaseToken: leaseToken);
    } on ApiException catch (e) {
      if (e.code == 'EDIT_LEASE_LOST') {
        readOnly = true;
        blockReason = 'Mất quyền sửa';
        await reloadCanonical();
      }
    }
  }

  /// TIẾP QUẢN quyền sửa từ thiết bị khác (khi order đang bị máy khác giữ lease).
  /// Server thu hồi lease cũ (phát order.lease.revoked cho máy kia) + cấp lease mới
  /// cho máy này; sau đó reload canonical để sửa tiếp. true = tiếp quản thành công.
  Future<bool> takeover() async {
    try {
      final r = await api.takeoverOrderLease(orderId, device: device);
      leaseToken = '${r['lease_token'] ?? leaseToken}';
      readOnly = false;
      blockReason = null;
      await reloadCanonical();
      return !readOnly;
    } on ApiException catch (e) {
      blockReason = e.message;
      notifyListeners();
      return false;
    }
  }

  Future<void> release() async {
    try {
      await api.releaseOrderLease(orderId,
          device: device, leaseToken: leaseToken);
    } catch (_) {/* đóng tab không được chặn vì lỗi nhả lease */}
  }

  /// Reconcile theo sự kiện realtime của branch (payload có order_id/resource).
  Future<void> onServerEvent(String event, Map payload) async {
    final pid = '${payload['order_id'] ?? payload['resource'] ?? ''}';
    if (pid != orderId) return;
    switch (event) {
      case 'order.paid':
        readOnly = true;
        status = 'paid';
        blockReason = 'Hóa đơn đã được thanh toán trên thiết bị khác';
        notifyListeners();
        break;
      case 'order.lease.revoked':
        if ('${payload['revoked_device'] ?? ''}' == device) {
          readOnly = true;
          blockReason = 'Quyền sửa đã bị tiếp quản';
          await reloadCanonical();
        }
        break;
      case 'order.changed':
        if (_n(payload['revision'], -1) > revision) await reloadCanonical();
        break;
    }
  }
}
