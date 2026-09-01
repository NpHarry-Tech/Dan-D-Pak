import 'package:flutter_test/flutter_test.dart';
import 'package:dandpak_core/src/services/retail_canonical.dart';

void main() {
  // Snapshot shape khớp server: retailOrderCommands.recompute → priceCart.lines +
  // pricing. Test bảo đảm client CHỈ render, KHÔNG tự tính lại tiền.
  Map<String, dynamic> snap({num total = 17000, num discount = 3000}) => {
        'priced_lines': [
          {
            'sku_id': 'SKU1',
            'name': 'Cà phê sữa',
            'unit': 'ly',
            'qty': 2,
            'unit_price': 10000,
            'orig_price': 10000,
            'lot_id': null,
            'price_override': null,
            'promo': {'label': 'Mua 2 tặng ưu đãi', 'amount': 3000},
            'line_total': 17000,
          },
          {
            'sku_id': 'SKU2',
            'name': 'Bánh',
            'unit': 'cái',
            'qty': 1,
            'unit_price': 8000,
            'orig_price': 12000,
            'lot_id': 'LOT9',
            'price_override': 8000,
            'promo': null,
            'line_total': 8000,
          },
        ],
        'pricing': {
          'subtotal': 32000,
          'discount': discount,
          'lineDiscount': discount,
          'orderDiscount': 0,
          'total': total,
        },
      };

  test('render đọc nguyên priced_lines + pricing từ server', () {
    final r = renderCanonical(snap());
    expect(r.lines.length, 2);
    expect(r.subtotal, 32000);
    expect(r.discount, 3000);
    expect(r.total, 17000);
    expect(r.itemCount, 3);
  });

  test('total lấy TỪ server, KHÔNG tự cộng dòng ở client', () {
    // Server cố tình trả total "lệch" so với tổng dòng ngây thơ (25000) — ví dụ
    // do voucher đơn. Client PHẢI hiện đúng con số server (9999), không tính lại.
    final r = renderCanonical(snap(total: 9999, discount: 15001));
    expect(r.total, 9999);
    // tổng ngây thơ của line_total = 17000 + 8000 = 25000 ≠ total → chứng minh
    // không có đường tính tiền thứ hai ở client.
    final naive = r.lines.fold<num>(0, (s, l) => s + l.lineTotal);
    expect(naive, 25000);
    expect(r.total == naive, isFalse);
  });

  test('dòng: promo label/amount, price_override, lot lấy đúng', () {
    final r = renderCanonical(snap());
    final l0 = r.lines[0];
    expect(l0.promoLabel, 'Mua 2 tặng ưu đãi');
    expect(l0.promoAmount, 3000);
    expect(l0.hasPromo, isTrue);
    expect(l0.lotId, isNull);
    final l1 = r.lines[1];
    expect(l1.priceOverride, 8000);
    expect(l1.origPrice, 12000);
    expect(l1.hasPriceOverride, isTrue);
    expect(l1.lotId, 'LOT9');
    expect(l1.hasPromo, isFalse);
  });

  test('snapshot rỗng → render rỗng, tổng 0', () {
    final r = renderCanonical({});
    expect(r.isEmpty, isTrue);
    expect(r.total, 0);
    expect(r.itemCount, 0);
  });

  test('payload structural KHÔNG kèm giá client cho ADD_LINE', () {
    final p = addLinePayload(skuId: 'SKU1', qty: 3, lotId: 'L1');
    expect(p['sku_id'], 'SKU1');
    expect(p['qty'], 3);
    expect(p['lot_id'], 'L1');
    expect(p.containsKey('unit_price'), isFalse);
    expect(p.containsKey('line_total'), isFalse);
  });

  test('price_override được phép gửi (server xác thực + định giá lại)', () {
    final p = addLinePayload(skuId: 'S', qty: 1, priceOverride: 5000);
    expect(p['price_override'], 5000);
    final noOverride = addLinePayload(skuId: 'S', qty: 1);
    expect(noOverride.containsKey('price_override'), isFalse);
  });
}
