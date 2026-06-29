// lib/providers/ordering_provider.dart
import 'package:flutter/material.dart';
import '../models/cart.dart';
import '../models/tablet_models.dart';
import '../services/api_service.dart';

class OrderingProvider with ChangeNotifier {
  final List<CartItem> _cart = [];
  TableModel? _selectedTable;
  String _selectedCategory = 'all';
  String _orderType = 'dine_in'; // 'dine_in', 'takeaway'

  List<CartItem> get cart => _cart;
  TableModel? get selectedTable => _selectedTable;
  String get selectedCategory => _selectedCategory;
  String get orderType => _orderType;

  int get cartTotal => _cart.fold(0, (sum, item) => sum + item.totalPrice);

  void selectTable(TableModel? table) {
    _selectedTable = table;
    if (table != null) {
      _orderType = 'dine_in';
    }
    notifyListeners();
  }

  void setOrderType(String type) {
    _orderType = type;
    if (type == 'takeaway') {
      _selectedTable = null;
    }
    notifyListeners();
  }

  void selectCategory(String cat) {
    _selectedCategory = cat;
    notifyListeners();
  }

  void addToCart(MenuItem item, {List<ModifierOption>? modifiers, String notes = '', int qty = 1}) {
    // Check if item with identical modifiers and notes already in cart
    for (var cartItem in _cart) {
      if (cartItem.item.id == item.id &&
          cartItem.notes == notes &&
          _areModifiersEqual(cartItem.selectedModifiers, modifiers ?? [])) {
        cartItem.qty += qty;
        notifyListeners();
        return;
      }
    }

    _cart.add(CartItem(item: item, qty: qty, notes: notes, selectedModifiers: modifiers));
    notifyListeners();
  }

  void updateCartQty(int index, int qty) {
    if (index >= 0 && index < _cart.length) {
      if (qty <= 0) {
        _cart.removeAt(index);
      } else {
        _cart[index].qty = qty;
      }
      notifyListeners();
    }
  }

  void removeFromCart(int index) {
    if (index >= 0 && index < _cart.length) {
      _cart.removeAt(index);
      notifyListeners();
    }
  }

  void clearCart() {
    _cart.clear();
    notifyListeners();
  }

  bool _areModifiersEqual(List<ModifierOption> list1, List<ModifierOption> list2) {
    if (list1.length != list2.length) return false;
    final names1 = list1.map((e) => e.name).toList()..sort();
    final names2 = list2.map((e) => e.name).toList()..sort();
    for (int i = 0; i < names1.length; i++) {
      if (names1[i] != names2[i]) return false;
    }
    return true;
  }

  Future<Map<String, dynamic>> sendOrderToKitchen(ApiService api) async {
    if (_cart.isEmpty) throw Exception('Giỏ hàng trống');
    if (_orderType == 'dine_in' && _selectedTable == null) {
      throw Exception('Vui lòng chọn bàn để gọi món dine_in');
    }

    final itemsPayload = _cart.map((c) => {
      'menu_item_id': c.item.id,
      'qty': c.qty,
      'note': c.notes,
      'mods': c.selectedModifiers.map((m) => {'name': m.name, 'price': m.price}).toList(),
    }).toList();

    final res = await api.createOrder(
      tableId: _selectedTable?.id,
      orderType: _orderType,
      items: itemsPayload,
    );

    clearCart();
    return res; // Returns { id, bill_no, total, status }
  }
}
