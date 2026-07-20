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

  SoCartItem({
    required this.item,
    this.qty = 1,
    this.notes = '',
    List<SoModifierOption>? selectedModifiers,
  }) : selectedModifiers = selectedModifiers ?? [];

  int get singlePrice {
    int price = item.price;
    for (var mod in selectedModifiers) {
      price += mod.price;
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
    );
  }
}

class SoModifierOption {
  final String name;
  final int price;

  SoModifierOption({required this.name, required this.price});

  factory SoModifierOption.fromJson(Map<String, dynamic> json) {
    return SoModifierOption(
      name: (json['name'] ?? '').toString(),
      price: _cartIntValue(json['price']),
    );
  }
}
