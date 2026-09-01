import 'package:dandpak_core/src/ui/promotion_presentation.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('promotion presentation exposes business facts and hides internals', () {
    final lines = promotionPresentation({
      'voucher_id': 'secret-db-id',
      'code': 'PISTACHIOS',
      'name': 'Sinh nhật mua 3 giá 500k',
      'amount': 100000,
      'type': 'combo',
      'value': 500000,
      'quantity': 3,
      'free_units': 0,
      'free_product_name': '',
    });
    final text = lines.join('\n');
    expect(text, contains('Combo: Sinh nhật mua 3 giá 500k'));
    expect(text, contains('3 sản phẩm'));
    expect(text, contains('500.000đ'));
    expect(text, contains('Giảm: 100.000đ'));
    expect(text, contains('Mã: PISTACHIOS'));
    expect(text, isNot(contains('voucher_id')));
    expect(text, isNot(contains('free_units')));
    expect(text, isNot(contains('secret-db-id')));
    expect(text, isNot(contains('{')));
  });

  test('invalid object dump string is never shown', () {
    expect(promotionPresentation('{voucher_id: secret}'), isEmpty);
  });

  test('discount-only promotion remains understandable', () {
    expect(promotionPresentation(null, fallbackDiscount: 50000).single,
        'Khuyến mãi\nGiảm: 50.000đ');
  });
}
