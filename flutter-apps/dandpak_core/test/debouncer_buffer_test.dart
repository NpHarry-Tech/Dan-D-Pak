import 'dart:async';

import 'package:dandpak_core/src/ui/debouncer.dart';
import 'package:flutter_test/flutter_test.dart';

class _FakeTimer implements Timer {
  _FakeTimer(this.at, this.callback);
  final int at;
  final void Function() callback;
  bool _active = true;

  @override
  bool get isActive => _active;
  @override
  int get tick => _active ? 0 : 1;
  @override
  void cancel() => _active = false;
}

class _FakeClock {
  int milliseconds = 0;
  final List<_FakeTimer> timers = [];
  DateTime now() => DateTime.fromMillisecondsSinceEpoch(milliseconds);
  Timer schedule(Duration delay, void Function() callback) {
    final timer = _FakeTimer(milliseconds + delay.inMilliseconds, callback);
    timers.add(timer);
    return timer;
  }

  void elapse(int amount) {
    final target = milliseconds + amount;
    while (true) {
      final due = timers
          .where((timer) => timer.isActive && timer.at <= target)
          .toList()
        ..sort((a, b) => a.at.compareTo(b.at));
      if (due.isEmpty) break;
      final timer = due.first;
      milliseconds = timer.at;
      timer.cancel();
      timer.callback();
    }
    milliseconds = target;
  }
}

Debouncer _buffer(_FakeClock clock,
        {void Function(Object, StackTrace)? onError}) =>
    Debouncer(
      delay: const Duration(milliseconds: 1500),
      maxWait: const Duration(milliseconds: 5000),
      clock: clock.now,
      timerFactory: clock.schedule,
      onError: onError,
    );

void main() {
  test('1499/1500/1501ms boundaries are exact and final event wins', () {
    final clock = _FakeClock();
    final buffer = _buffer(clock);
    final rendered = <int>[];
    buffer(() => rendered.add(1), key: 'tenant|branch|user|crm');
    clock.elapse(1499);
    expect(rendered, isEmpty);
    buffer(() => rendered.add(2), key: 'tenant|branch|user|crm');
    clock.elapse(1500);
    expect(rendered, [2]);
    buffer(() => rendered.add(3), key: 'tenant|branch|user|crm');
    clock.elapse(1501);
    expect(rendered, [2, 3]);
    expect(buffer.metrics.coalesced, 1);
  });

  test('continuous burst flushes at maximum wait', () {
    final clock = _FakeClock();
    final buffer = _buffer(clock);
    var rendered = -1;
    for (var i = 0; i < 10; i++) {
      buffer(() => rendered = i, key: 't|b|u|assets');
      clock.elapse(500);
    }
    expect(rendered, 9);
    expect(buffer.metrics.executed, 1);
    expect(buffer.metrics.coalesced, 9);
    expect(buffer.metrics.totalLatency, const Duration(milliseconds: 5000));
  });

  test('different scope keys never coalesce', () {
    final clock = _FakeClock();
    final buffer = _buffer(clock);
    final rendered = <String>[];
    buffer(() => rendered.add('branch-a'), key: 'tenant|a|user|chat');
    buffer(() => rendered.add('branch-b'), key: 'tenant|b|user|chat');
    expect(buffer.pendingCount, 2);
    clock.elapse(1500);
    expect(rendered, ['branch-a', 'branch-b']);
    expect(buffer.metrics.coalesced, 0);
  });

  test('logout/branch switch cancel, explicit flush, and dispose are safe', () {
    final clock = _FakeClock();
    final buffer = _buffer(clock);
    final rendered = <String>[];
    buffer(() => rendered.add('old-user'), key: 'tenant|a|old|chat');
    expect(buffer.cancel('tenant|a|old|chat'), isTrue);
    buffer(() => rendered.add('new-branch'), key: 'tenant|b|new|chat');
    expect(buffer.flush('tenant|b|new|chat'), isTrue);
    buffer(() => rendered.add('disposed'), key: 'tenant|b|new|assets');
    buffer.dispose();
    clock.elapse(10 * 1000);
    expect(rendered, ['new-branch']);
    expect(buffer.metrics.cancelled, 2);
  });

  test('action exception is measured and does not poison later events', () {
    final clock = _FakeClock();
    final errors = <Object>[];
    final buffer = _buffer(clock, onError: (error, _) => errors.add(error));
    buffer(() => throw StateError('refresh failed'), key: 't|b|u|crm');
    clock.elapse(1500);
    var recovered = false;
    buffer(() => recovered = true, key: 't|b|u|crm');
    clock.elapse(1500);
    expect(errors, hasLength(1));
    expect(recovered, isTrue);
    expect(buffer.metrics.errors, 1);
    expect(buffer.pendingCount, 0);
  });
}
