// lib/screens/self_order/self_order_cart.dart
import 'self_order_models.dart';

int _cartIntValue(dynamic value) {
  if (value is int) return value;
  if (value is num) return value.toInt();
  return double.tryParse(value?.toString() ?? '')?.toInt() ?? 0;
}

class SoCartItem {
  final SoMenuItem item;
  int qty;
  String notes;
  final List<SoModifierOption> selectedModifiers;
  // Món đi kèm (option_groups mode:'combo') đã chọn — mỗi phần tử tách thành
  // 1 dòng RIÊNG trên đơn khi gửi (server tự set giá/trạm theo CHÍNH món đó).
  // Lồng dưới dòng cha (không phải cart item riêng) để xóa/tăng-giảm dòng cha
  // tự kéo theo, khỏi cần khớp id cha-con phía client.
  final List<SoComboChild> comboChildren;

  SoCartItem({
    required this.item,
    this.qty = 1,
    this.notes = '',
    List<SoModifierOption>? selectedModifiers,
    List<SoComboChild>? comboChildren,
  })  : selectedModifiers = selectedModifiers ?? [],
        comboChildren = comboChildren ?? [];

  int get singlePrice {
    int price = item.price;
    for (var mod in selectedModifiers) {
      price += mod.price;
    }
    for (var c in comboChildren) {
      price += c.price;
    }
    return price;
  }

  int get totalPrice => singlePrice * qty;

  SoCartItem copy() {
    return SoCartItem(
      item: item,
      qty: qty,
      notes: notes,
      selectedModifiers: List.from(selectedModifiers),
      comboChildren: comboChildren.map((c) => c.copy()).toList(),
    );
  }
}

// Một món đi kèm đã chọn cho 1 dòng combo. Số lượng LUÔN bằng số lượng món
// chính (đặt N combo = N mỗi món đi kèm) — không có ô số lượng riêng, không
// xóa được riêng lẻ (xóa cả dòng cha mới xóa theo), nhưng vẫn ghi chú riêng
// được (vd "salad không sốt").
class SoComboChild {
  final String refItemId;
  final String name;
  final int price;
  String note;

  SoComboChild({
    required this.refItemId,
    required this.name,
    required this.price,
    this.note = '',
  });

  SoComboChild copy() =>
      SoComboChild(refItemId: refItemId, name: name, price: price, note: note);
}

class SoModifierOption {
  // group = tên NHÓM tùy chọn (Size, Topping…) — server validate mods theo group+name.
  final String group;
  final String name;
  final int price;

  SoModifierOption({this.group = '', required this.name, required this.price});

  factory SoModifierOption.fromJson(Map<String, dynamic> json) {
    return SoModifierOption(
      group: (json['group'] ?? '').toString(),
      name: (json['name'] ?? '').toString(),
      price: _cartIntValue(json['price']),
    );
  }
}
