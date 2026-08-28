import 'format.dart';

String _text(dynamic value) => value?.toString().trim() ?? '';
num _number(dynamic value) =>
    value is num ? value : num.tryParse(_text(value)) ?? 0;

/// User-facing promotion facts only. This deliberately never falls back to
/// Map.toString()/JSON, so internal ids and engine metadata cannot leak to UI.
List<String> promotionPresentation(dynamic raw, {num fallbackDiscount = 0}) {
  final promotions = raw is List ? raw : [raw];
  final result = <String>[];
  for (final value in promotions) {
    if (value is String) {
      final clean = value.trim();
      if (clean.isNotEmpty &&
          !clean.startsWith('{') &&
          !clean.startsWith('[')) {
        result.add(clean);
      }
      continue;
    }
    if (value is! Map) continue;
    final promo = Map<String, dynamic>.from(value);
    final name = _text(promo['name'] ?? promo['display_name']);
    final code = _text(promo['code']);
    final type = _text(promo['type']).toLowerCase();
    final amount = _number(promo['amount'] ?? promo['discount_amount']);
    final percent = _number(promo['percent'] ?? promo['discount_percent']);
    final freeUnits = _number(promo['free_units']);
    final freeProduct = _text(promo['free_product_name']);
    final buyQty = _number(promo['buy_qty'] ?? promo['buy_x']);
    final comboQty = _number(promo['combo_qty'] ?? promo['quantity']);
    final comboPrice = _number(promo['combo_price'] ?? promo['value']);

    final title = switch (type) {
      'combo' => name.isEmpty ? 'Combo' : 'Combo: $name',
      'voucher' =>
        code.isEmpty ? (name.isEmpty ? 'Voucher' : name) : 'Voucher $code',
      'buy_x_get_y' => name.isEmpty ? 'Mua hàng tặng quà' : name,
      'gift' => name.isEmpty ? 'Quà tặng' : name,
      _ => name.isEmpty
          ? (code.isEmpty ? 'Khuyến mãi' : 'Mã: $code')
          : 'Khuyến mãi: $name',
    };
    final facts = <String>[];
    if (type == 'combo' && comboQty > 0 && comboPrice > 0) {
      facts.add('${comboQty.round()} sản phẩm – ${Fmt.money(comboPrice)}');
    } else if (type == 'buy_x_get_y' && buyQty > 0 && freeUnits > 0) {
      facts.add('Mua ${buyQty.round()} tặng ${freeUnits.round()}');
    } else if ((type == 'gift' || freeUnits > 0) && freeUnits > 0) {
      facts.add(
          'Tặng: ${freeProduct.isEmpty ? 'Sản phẩm' : freeProduct} × ${freeUnits.round()}');
    }
    if (percent > 0) {
      facts.add('Giảm ${percent.round()}%');
    } else if (amount > 0) {
      facts.add('Giảm: ${Fmt.money(amount)}');
    }
    if (code.isNotEmpty && type != 'voucher' && title != 'Mã: $code') {
      facts.add('Mã: $code');
    }
    result.add([title, ...facts].join('\n'));
  }
  if (result.isEmpty && fallbackDiscount > 0) {
    result.add('Khuyến mãi\nGiảm: ${Fmt.money(fallbackDiscount)}');
  }
  return result;
}
