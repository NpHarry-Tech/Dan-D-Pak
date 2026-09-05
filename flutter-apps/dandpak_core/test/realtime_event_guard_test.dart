import 'package:dandpak_core/src/services/realtime_event_guard.dart';
import 'package:flutter_test/flutter_test.dart';

Map<String, dynamic> event(
        String id, String branch, String entity, int version) =>
    {
      'id': entity,
      '_rt': {
        'event_id': id,
        'branch_id': branch,
        'entity': entity,
        'version': version
      },
    };

void main() {
  test('drops duplicate and out-of-order events before UI side effects', () {
    final guard = RealtimeEventGuard();
    expect(guard.accept(event('e2', 'sala', 'order:1', 2)), isTrue);
    expect(guard.accept(event('e2', 'sala', 'order:1', 2)), isFalse);
    expect(guard.accept(event('e1', 'sala', 'order:1', 1)), isFalse);
    expect(guard.accept(event('e3', 'sala', 'order:1', 3)), isTrue);
    expect(guard.lastEventId, 'e3');
  });

  test('versions are isolated by branch and legacy payload remains compatible',
      () {
    final guard = RealtimeEventGuard();
    expect(guard.accept(event('s2', 'sala', 'table:1', 2)), isTrue);
    expect(guard.accept(event('h1', 'hanoi', 'table:1', 1)), isTrue);
    expect(guard.accept({'id': 'legacy'}), isTrue);
    guard.reset();
    expect(guard.lastEventId, isNull);
    expect(guard.accept(event('s1', 'sala', 'table:1', 1)), isTrue);
  });
}
