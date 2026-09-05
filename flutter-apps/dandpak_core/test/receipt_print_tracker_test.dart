import 'dart:async';

import 'package:dandpak_core/src/services/receipt_print_tracker.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('pending -> claimed -> printed and duplicate states are harmless', () async {
    final delays = <Completer<void>>[];
    final tracker = ReceiptPrintTracker(delay: (_) {
      final c = Completer<void>();
      delays.add(c);
      return c.future;
    });
    final rows = <Map<String, dynamic>>[
      {'status': 'queued'},
      {'status': 'claimed'},
      {'status': 'claimed'},
      {'status': 'printed'},
    ];
    final seen = <ReceiptPrintPhase>[];
    final run = tracker.start(
      paymentId: 'p1', orderId: 'o1', scope: 'tenant|branch|session',
      jobIds: const ['j1'], read: () async => rows.removeAt(0),
      onState: (state) => seen.add(state.phase),
    );
    for (var i = 0; i < 3; i++) {
      await Future<void>.delayed(Duration.zero);
      delays[i].complete();
    }
    await run;
    expect(seen, [
      ReceiptPrintPhase.queued,
      ReceiptPrintPhase.claimed,
      ReceiptPrintPhase.claimed,
      ReceiptPrintPhase.printed,
    ]);
    expect(tracker.active, false);
  });

  test('pending -> failed preserves physical print error', () async {
    var calls = 0;
    final seen = <ReceiptPrintState>[];
    final tracker = ReceiptPrintTracker(delay: (_) async {});
    await tracker.start(
      paymentId: 'p2', orderId: 'o2', scope: 's', jobIds: const [],
      read: () async => ++calls == 1
          ? {'status': 'queued'}
          : {'status': 'failed', 'error': 'het giay'},
      onState: seen.add,
    );
    expect(seen.last.phase, ReceiptPrintPhase.failed);
    expect(seen.last.error, 'het giay');
  });

  test('timeout is finite and endpoint errors never become payment failure', () async {
    final seen = <ReceiptPrintState>[];
    final tracker = ReceiptPrintTracker(delay: (_) async {});
    await tracker.start(
      paymentId: 'p3', orderId: 'o3', scope: 's', jobIds: const [],
      read: () async => throw Exception('status endpoint down'),
      onState: seen.add,
      pollInterval: Duration.zero,
      maxWait: Duration.zero,
    );
    expect(seen.single.phase, ReceiptPrintPhase.timeout);
    expect(seen.where((s) => s.phase == ReceiptPrintPhase.failed), isEmpty);
  });

  test('cancel/dispose stops late response', () async {
    final response = Completer<Map<String, dynamic>>();
    final seen = <ReceiptPrintState>[];
    final tracker = ReceiptPrintTracker(delay: (_) async {});
    final run = tracker.start(
      paymentId: 'p4', orderId: 'o4', scope: 's1', jobIds: const [],
      read: () => response.future, onState: seen.add,
    );
    tracker.cancel();
    response.complete({'status': 'printed'});
    await run;
    expect(seen, isEmpty);
  });

  test('new payment supersedes old stale response', () async {
    final oldResponse = Completer<Map<String, dynamic>>();
    final oldSeen = <ReceiptPrintState>[];
    final newSeen = <ReceiptPrintState>[];
    final tracker = ReceiptPrintTracker(delay: (_) async {});
    final oldRun = tracker.start(
      paymentId: 'old', orderId: 'old-order', scope: 's', jobIds: const ['old-job'],
      read: () => oldResponse.future, onState: oldSeen.add,
    );
    final newRun = tracker.start(
      paymentId: 'new', orderId: 'new-order', scope: 's', jobIds: const ['new-job'],
      read: () async => {'status': 'printed'}, onState: newSeen.add,
    );
    oldResponse.complete({'status': 'failed'});
    await Future.wait([oldRun, newRun]);
    expect(oldSeen, isEmpty);
    expect(newSeen.single.paymentId, 'new');
    expect(newSeen.single.phase, ReceiptPrintPhase.printed);
  });

  test('branch/logout scope cancel and unrelated realtime do not wake poll', () async {
    final delays = <Completer<void>>[];
    final tracker = ReceiptPrintTracker(delay: (_) {
      final c = Completer<void>();
      delays.add(c);
      return c.future;
    });
    var calls = 0;
    final run = tracker.start(
      paymentId: 'p6', orderId: 'o6', scope: 'tenant|b1|u1', jobIds: const ['j6'],
      read: () async => {'status': ++calls == 1 ? 'queued' : 'printed'},
      onState: (_) {},
    );
    await Future<void>.delayed(Duration.zero);
    tracker.reconcileRealtime('print:done', {'id': 'other'});
    await Future<void>.delayed(Duration.zero);
    expect(calls, 1);
    tracker.reconcileRealtime('print:done', {'id': 'j6'});
    await run;
    expect(calls, 2);

    final blocked = Completer<Map<String, dynamic>>();
    final late = <ReceiptPrintState>[];
    final second = tracker.start(
      paymentId: 'p7', orderId: 'o7', scope: 'tenant|b1|u1', jobIds: const [],
      read: () => blocked.future, onState: late.add,
    );
    tracker.cancel(); // logout/branch switch/dispose
    blocked.complete({'status': 'printed'});
    await second;
    expect(late, isEmpty);
  });
}
