import 'dart:async';

typedef DebounceTimerFactory = Timer Function(
  Duration delay,
  void Function() callback,
);

class DebounceMetrics {
  int received = 0;
  int executed = 0;
  int coalesced = 0;
  int cancelled = 0;
  int errors = 0;
  Duration totalLatency = Duration.zero;
}

class _PendingDebounce {
  _PendingDebounce(this.firstAt, this.lastAt, this.action);

  final DateTime firstAt;
  DateTime lastAt;
  void Function() action;
  Timer? timer;
}

/// Keyed trailing-edge buffer for noisy, non-critical refreshes and searches.
///
/// Every key has its own pending action. A continuous stream is forced to flush
/// at [maxWait], so it cannot postpone the final render forever. Mutations,
/// logout, payment, print ACK and other immediate actions must never use this.
class Debouncer {
  Debouncer({
    this.delay = const Duration(milliseconds: 350),
    this.maxWait = const Duration(seconds: 2),
    DateTime Function()? clock,
    DebounceTimerFactory? timerFactory,
    this.onError,
  })  : _clock = clock ?? DateTime.now,
        _timerFactory = timerFactory ?? Timer.new;

  final Duration delay;
  final Duration maxWait;
  final void Function(Object error, StackTrace stackTrace)? onError;
  final DateTime Function() _clock;
  final DebounceTimerFactory _timerFactory;
  final Map<String, _PendingDebounce> _pending = {};
  final DebounceMetrics metrics = DebounceMetrics();
  bool _disposed = false;

  int get pendingCount => _pending.length;

  void call(void Function() action, {String key = 'local'}) {
    if (_disposed) return;
    if (key.trim().isEmpty) {
      throw ArgumentError.value(key, 'key', 'must identify the scoped stream');
    }
    final now = _clock();
    metrics.received++;
    final existing = _pending[key];
    final entry = existing ?? _PendingDebounce(now, now, action);
    if (existing != null) {
      metrics.coalesced++;
      entry.timer?.cancel();
      entry.lastAt = now;
      entry.action = action; // trailing edge always retains the final event.
    } else {
      _pending[key] = entry;
    }

    final remaining = maxWait - now.difference(entry.firstAt);
    final wait = remaining <= Duration.zero
        ? Duration.zero
        : (remaining < delay ? remaining : delay);
    entry.timer = _timerFactory(wait, () => _execute(key));
  }

  bool flush([String key = 'local']) => _execute(key);

  void flushAll() {
    for (final key in _pending.keys.toList(growable: false)) {
      _execute(key);
    }
  }

  bool cancel([String key = 'local']) {
    final entry = _pending.remove(key);
    if (entry == null) return false;
    entry.timer?.cancel();
    metrics.cancelled++;
    return true;
  }

  void cancelAll() {
    for (final entry in _pending.values) {
      entry.timer?.cancel();
      metrics.cancelled++;
    }
    _pending.clear();
  }

  bool _execute(String key) {
    final entry = _pending.remove(key);
    if (entry == null || _disposed) return false;
    entry.timer?.cancel();
    metrics.executed++;
    metrics.totalLatency += _clock().difference(entry.firstAt);
    try {
      entry.action();
    } catch (error, stackTrace) {
      metrics.errors++;
      if (onError != null) {
        onError!(error, stackTrace);
      } else {
        Zone.current.handleUncaughtError(error, stackTrace);
      }
    }
    return true;
  }

  void dispose() {
    if (_disposed) return;
    cancelAll();
    _disposed = true;
  }
}
