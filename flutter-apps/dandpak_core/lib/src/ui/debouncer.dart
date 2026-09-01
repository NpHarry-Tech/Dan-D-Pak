import 'dart:async';

/// Trailing-edge debouncer: coalesces bursts of calls into one.
///
/// The realtime socket fires one event per order item (a 10-dish order emits
/// ~10 `order:item` events back-to-back). Reloading the floor/shift/KDS on
/// every single event turns that into dozens of HTTP calls + full rebuilds and
/// visibly janks weak POS hardware — so screens funnel their reloads through
/// this instead.
class Debouncer {
  Debouncer({this.delay = const Duration(milliseconds: 350)});

  final Duration delay;
  Timer? _timer;

  void call(void Function() action) {
    _timer?.cancel();
    _timer = Timer(delay, action);
  }

  void dispose() {
    _timer?.cancel();
    _timer = null;
  }
}
