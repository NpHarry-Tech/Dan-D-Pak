// §2 CANONICAL RENDER BRIDGE (server-authoritative).
//
// Khi một tab bán lẻ chạy đường CANONICAL (RetailOrderSession), giá + tổng KHÔNG
// được tính lại ở client. Client CHỈ render nguyên văn `priced_lines` + `pricing`
// mà server (priceCart) trả trong snapshot. File này chỉ chứa hàm THUẦN (không
// phụ thuộc Flutter/State) để dễ unit-test đúng shape server và tránh mọi đường
// tính tiền thứ hai ở client.

/// Một dòng đã ĐỊNH GIÁ bởi server để render (không tự tính lại tiền).
class CanonicalLine {
  final String?
      lineId; // id server để CHANGE_QTY/REMOVE_LINE tham chiếu đúng dòng
  final String skuId;
  final String name;
  final String unit;
  final int qty;
  final num unitPrice;
  final num origPrice;
  final num lineTotal;
  final String? lotId;
  final num? priceOverride;
  final String promoLabel; // '' nếu không có CTKM áp cho dòng
  final num promoAmount;

  const CanonicalLine({
    required this.lineId,
    required this.skuId,
    required this.name,
    required this.unit,
    required this.qty,
    required this.unitPrice,
    required this.origPrice,
    required this.lineTotal,
    required this.lotId,
    required this.priceOverride,
    required this.promoLabel,
    required this.promoAmount,
  });

  bool get hasPriceOverride =>
      priceOverride != null && priceOverride != origPrice;
  bool get hasPromo => promoAmount > 0 || promoLabel.isNotEmpty;
}

/// Projection THUẦN của một snapshot canonical: dòng đã định giá + tổng, tất cả
/// lấy nguyên từ server. Không có phép cộng/nhân nào tạo ra con số mới.
class CanonicalRender {
  final List<CanonicalLine> lines;
  final num subtotal;
  final num discount;
  final num lineDiscount;
  final num orderDiscount;
  final num total;

  const CanonicalRender({
    required this.lines,
    required this.subtotal,
    required this.discount,
    required this.lineDiscount,
    required this.orderDiscount,
    required this.total,
  });

  bool get isEmpty => lines.isEmpty;
  int get itemCount => lines.fold(0, (s, l) => s + l.qty);
}

num _num(dynamic v, [num d = 0]) =>
    v is num ? v : (num.tryParse('${v ?? ''}') ?? d);
int _int(dynamic v, [int d = 0]) =>
    v is num ? v.toInt() : (int.tryParse('${v ?? ''}') ?? d);
String _str(dynamic v) => v == null ? '' : '$v';

/// Nhãn CTKM cho dòng, lấy từ object `promo` server gắn (không suy đoán ở client).
String _promoLabel(Map? promo) {
  if (promo == null) return '';
  final label = _str(promo['label']).trim();
  if (label.isNotEmpty) return label;
  return _str(promo['name']).trim();
}

CanonicalLine _line(Map m) {
  final promo = m['promo'] is Map ? m['promo'] as Map : null;
  return CanonicalLine(
    lineId: m['line_id'] == null ? null : _str(m['line_id']),
    skuId: _str(m['sku_id']),
    name: _str(m['name']),
    unit: _str(m['unit']),
    qty: _int(m['qty']),
    unitPrice: _num(m['unit_price']),
    origPrice: _num(m['orig_price'], _num(m['unit_price'])),
    lineTotal: _num(m['line_total'], _num(m['qty']) * _num(m['unit_price'])),
    lotId: m['lot_id'] == null ? null : _str(m['lot_id']),
    priceOverride:
        m['price_override'] == null ? null : _num(m['price_override']),
    promoLabel: _promoLabel(promo),
    promoAmount: promo == null ? 0 : _num(promo['amount']),
  );
}

/// Đọc snapshot canonical (từ RetailOrderSession.snapshot) → projection render.
/// KHÔNG tính lại tiền: subtotal/discount/total lấy thẳng từ `pricing` server.
CanonicalRender renderCanonical(Map<String, dynamic> snapshot) {
  final rawLines = (snapshot['priced_lines'] as List?) ?? const [];
  final pricing =
      (snapshot['pricing'] as Map?)?.cast<String, dynamic>() ?? const {};
  final lines = rawLines.whereType<Map>().map(_line).toList();
  return CanonicalRender(
    lines: lines,
    subtotal: _num(pricing['subtotal']),
    discount: _num(pricing['discount']),
    lineDiscount: _num(pricing['lineDiscount']),
    orderDiscount: _num(pricing['orderDiscount']),
    total: _num(pricing['total']),
  );
}

// ── Payload builder cho các COMMAND structural (server tự định giá lại) ──────
// Chỉ dữ liệu cấu trúc: KHÔNG kèm giá tính sẵn từ client (server bỏ qua nếu kèm).

Map<String, dynamic> addLinePayload(
        {required String skuId,
        int qty = 1,
        String? lotId,
        num? priceOverride}) =>
    {
      'sku_id': skuId,
      'qty': qty,
      if (lotId != null) 'lot_id': lotId,
      if (priceOverride != null) 'price_override': priceOverride,
    };

Map<String, dynamic> changeQtyPayload(
        {required String lineId, required int qty}) =>
    {'line_id': lineId, 'qty': qty};

Map<String, dynamic> removeLinePayload({required String lineId}) =>
    {'line_id': lineId};

// applyToSnap SET_CUSTOMER đọc payload.customer (object) — priceCart resolve theo
// customer.id (perk từ DB) hoặc dùng object walk-in. null = khách lẻ.
Map<String, dynamic> setCustomerPayload({Map<String, dynamic>? customer}) =>
    {'customer': customer};

Map<String, dynamic> setNotePayload({required String note}) => {'note': note};

Map<String, dynamic> removePromotionPayload() => const {};

Map<String, dynamic> setCombosPayload({required List<dynamic> combos}) =>
    {'selected_combos': combos};

Map<String, dynamic> setManualDiscountPayload({required num amount}) =>
    {'manual_discount': amount};

Map<String, dynamic> applyPromotionPayload({required String voucherId}) =>
    {'voucher_id': voucherId};
