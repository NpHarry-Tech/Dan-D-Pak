// lib/models/cart.dart
import 'tablet_models.dart';

int _intValue(dynamic value) {
  if (value is int) return value;
  if (value is num) return value.toInt();
  return double.tryParse(value?.toString() ?? '')?.toInt() ?? 0;
}

class CartItem {
  final MenuItem item;
  int qty;
  String notes;
  final List<ModifierOption> selectedModifiers;

  CartItem({
    required this.item,
    this.qty = 1,
    this.notes = '',
    List<ModifierOption>? selectedModifiers,
  }) : selectedModifiers = selectedModifiers ?? [];

  int get singlePrice {
    int price = item.price;
    for (var mod in selectedModifiers) {
      price += mod.price;
    }
    return price;
  }

  int get totalPrice => singlePrice * qty;

  CartItem copy() {
    return CartItem(
      item: item,
      qty: qty,
      notes: notes,
      selectedModifiers: List.from(selectedModifiers),
    );
  }
}

class ModifierOption {
  final String name;
  final int price;

  ModifierOption({required this.name, required this.price});

  factory ModifierOption.fromJson(Map<String, dynamic> json) {
    return ModifierOption(
      name: (json['name'] ?? '').toString(),
      price: _intValue(json['price']),
    );
  }
}
