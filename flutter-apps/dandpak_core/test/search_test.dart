import 'package:flutter_test/flutter_test.dart';
import 'package:dandpak_core/src/utils/search.dart';

void main() {
  test('search folds Vietnamese, whitespace, tokens and boundaries', () {
    expect(foldSearch('  Điện   THOẠI '), 'dien thoai');
    expect(searchMatchesAny(['Sữa hạt', 'Hạnh nhân'], 'sua nhan'), isTrue);
    expect(searchMatchesAny(['Sữa hạt', 'Óc chó'], 'sua nhan'), isFalse);
    expect(searchMatchesAny(['safe'], "' OR 1=1 --"), isFalse);
    expect(foldSearch('x' * 250).length, 200);
    expect(searchMatchesAny(['x' * 250, 'needle'], 'needle'), isTrue);
    expect(searchMatchesAny([], ''), isTrue);
  });

  test('stale async responses are rejected', () {
    final guard = SearchRequestGuard();
    final oldRequest = guard.next();
    final newRequest = guard.next();
    expect(guard.isCurrent(oldRequest), isFalse);
    expect(guard.isCurrent(newRequest), isTrue);
  });
}
