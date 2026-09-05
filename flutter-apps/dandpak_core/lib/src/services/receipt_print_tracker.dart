import 'dart:async';

typedef ReceiptPrintReader = Future<Map<String, dynamic>> Function();
typedef ReceiptPrintListener = void Function(ReceiptPrintState state);
typedef ReceiptPrintDelay = Future<void> Function(Duration duration);

enum ReceiptPrintPhase { queued, claimed, printed, failed, timeout }

class ReceiptPrintState {
  const ReceiptPrintState({
    required this.paymentId,
    required this.orderId,
    required this.scope,
    required this.phase,
    this.error = '',
  });

  final String paymentId;
  final String orderId;
  final String scope;
  final ReceiptPrintPhase phase;
  final String error;

  bool get terminal =>
      phase == ReceiptPrintPhase.printed ||
      phase == ReceiptPrintPhase.failed ||
      phase == ReceiptPrintPhase.timeout;
}

/// Theo dõi đúng MỘT receipt mới nhất trên thiết bị. Mỗi start/cancel tăng
/// generation nên response chậm của bill cũ không thể cập nhật banner bill mới.
/// Poll có deadline hữu hạn; realtime chỉ đánh thức poll để reconcile lại endpoint
/// canonical, không tin mù payload socket.
class ReceiptPrintTracker {
  ReceiptPrintTracker({ReceiptPrintDelay? delay})
      : _delay = delay ?? Future<void>.delayed;

  static final ReceiptPrintTracker instance = ReceiptPrintTracker();

  final ReceiptPrintDelay _delay;
  int _generation = 0;
  String _scope = '';
  String _paymentId = '';
  Set<String> _jobIds = const {};
  Completer<void>? _wake;

  bool get active => _paymentId.isNotEmpty;
  String get activePaymentId => _paymentId;

  Future<void> start({
    required String paymentId,
    required String orderId,
    required String scope,
    required Iterable<String> jobIds,
    required ReceiptPrintReader read,
    required ReceiptPrintListener onState,
    Duration pollInterval = const Duration(seconds: 1),
    Duration maxWait = const Duration(seconds: 45),
  }) async {
    cancel();
    final generation = _generation;
    _scope = scope;
    _paymentId = paymentId;
    _jobIds = jobIds.where((id) => id.trim().isNotEmpty).toSet();
    final deadline = DateTime.now().add(maxWait);
    var lastPhase = ReceiptPrintPhase.queued;

    while (_isCurrent(generation, paymentId, scope)) {
      try {
        final raw = await read();
        if (!_isCurrent(generation, paymentId, scope)) return;
        final phase = _phaseOf('${raw['status'] ?? ''}');
        if (phase != null) {
          lastPhase = phase;
          onState(ReceiptPrintState(
            paymentId: paymentId,
            orderId: orderId,
            scope: scope,
            phase: phase,
            error: '${raw['error'] ?? ''}'.trim(),
          ));
          if (phase == ReceiptPrintPhase.printed ||
              phase == ReceiptPrintPhase.failed) {
            _finishIfCurrent(generation);
            return;
          }
        }
      } catch (_) {
        // Payment đã commit. Lỗi endpoint chỉ giữ trạng thái đang chờ và thử lại,
        // tuyệt đối không phát trạng thái payment failed.
      }

      if (!DateTime.now().isBefore(deadline)) {
        if (_isCurrent(generation, paymentId, scope)) {
          onState(ReceiptPrintState(
            paymentId: paymentId,
            orderId: orderId,
            scope: scope,
            phase: ReceiptPrintPhase.timeout,
            error: lastPhase == ReceiptPrintPhase.claimed
                ? 'Máy in đã nhận lệnh nhưng chưa ACK trong thời gian chờ.'
                : 'Hóa đơn vẫn đang chờ máy in xác nhận.',
          ));
          _finishIfCurrent(generation);
        }
        return;
      }

      final wake = Completer<void>();
      _wake = wake;
      await Future.any<void>([
        _delay(pollInterval),
        wake.future,
      ]);
      if (identical(_wake, wake)) _wake = null;
    }
  }

  /// Socket print:done/failed chỉ đánh thức watch nếu đúng payment/job hiện tại.
  void reconcileRealtime(String event, dynamic payload) {
    if (event != 'print:done' && event != 'print:failed') return;
    if (!active || payload is! Map) return;
    final body =
        payload['payload'] is Map ? payload['payload'] as Map : payload;
    final payment = '${body['payment_id'] ?? payload['payment_id'] ?? ''}';
    final job = '${payload['id'] ?? ''}';
    if (payment != _paymentId && !_jobIds.contains(job)) return;
    final wake = _wake;
    if (wake != null && !wake.isCompleted) wake.complete();
  }

  void cancel() {
    _generation++;
    _scope = '';
    _paymentId = '';
    _jobIds = const {};
    final wake = _wake;
    _wake = null;
    if (wake != null && !wake.isCompleted) wake.complete();
  }

  bool _isCurrent(int generation, String paymentId, String scope) =>
      generation == _generation && paymentId == _paymentId && scope == _scope;

  void _finishIfCurrent(int generation) {
    if (generation != _generation) return;
    _paymentId = '';
    _jobIds = const {};
    _wake = null;
  }

  ReceiptPrintPhase? _phaseOf(String value) {
    switch (value.toLowerCase()) {
      case 'pending':
      case 'queued':
        return ReceiptPrintPhase.queued;
      case 'claimed':
      case 'printing':
        return ReceiptPrintPhase.claimed;
      case 'printed':
        return ReceiptPrintPhase.printed;
      case 'failed':
      case 'cancelled':
      case 'expired':
        return ReceiptPrintPhase.failed;
      default:
        return null;
    }
  }
}
