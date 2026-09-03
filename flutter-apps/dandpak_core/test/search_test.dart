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
    expect(searchScoreAny(['DAN', 'Khách khác'], 'dan'),
        greaterThan(searchScoreAny(['Cửa hàng Dan-D Pak'], 'dan')));
    expect(searchScoreAny(['Hà', '0909'], 'dan'), -1);
    final products = [
      {'code': 'SP01', 'name': 'Sữa hạt'},
      {'code': 'SP02', 'name': 'Sữa tươi'},
    ];
    expect(
      searchSubmitCandidate(products, 'SP02', (p) => [p['code'], p['name']]),
      same(products[1]),
    );
    expect(
      searchSubmitCandidate(products, 'sua', (p) => [p['code'], p['name']]),
      isNull,
    );
    expect(
      searchSubmitCandidate(
          [products.first], 'sua', (p) => [p['code'], p['name']]),
      same(products.first),
    );
  });

  test('stale async responses are rejected', () {
    final guard = SearchRequestGuard();
    final oldRequest = guard.next();
    final newRequest = guard.next();
    expect(guard.isCurrent(oldRequest), isFalse);
    expect(guard.isCurrent(newRequest), isTrue);
  });
}
