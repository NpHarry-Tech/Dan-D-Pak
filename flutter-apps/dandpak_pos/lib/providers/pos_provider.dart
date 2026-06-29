import 'dart:math' as math;

import 'package:flutter/foundation.dart';
import '../models/pos_models.dart';
import '../services/api_service.dart';

double _doubleValue(dynamic value) {
  if (value is num) return value.toDouble();
  return double.tryParse(value?.toString() ?? '') ?? 0.0;
}

class PosProvider extends ChangeNotifier {
  final ApiService apiService;

  List<Zone> _zones = [];
  List<TableModel> _tables = [];
  List<Category> _categories = [];
  List<MenuItem> _menuItems = [];
  
  Shift? _currentShift;
  
  Map<String, dynamic>? _operationsConfig;
  
  String _selectedZoneId = 'all';
  TableModel? _selectedTable;
  List<CartItem> _cart = [];
  
  String? _activeOrderId;
  String? _activeBillNo;
  double _activeDiscount = 0.0;
  
  bool _isLoadingFloor = false;
  bool _isLoadingMenu = false;
  bool _isLoadingShift = false;
  bool _isSavingOrder = false;

  PosProvider({required this.apiService});

  List<Zone> get zones => _zones;
  List<TableModel> get tables => _tables;
  List<Category> get categories => _categories;
  List<MenuItem> get menuItems => _menuItems;
  Shift? get currentShift => _currentShift;
  Map<String, dynamic>? get operationsConfig => _operationsConfig;
  
  String get selectedZoneId => _selectedZoneId;
  TableModel? get selectedTable => _selectedTable;
  List<CartItem> get cart => _cart;
  
  String? get activeOrderId => _activeOrderId;
  String? get activeBillNo => _activeBillNo;
  double get activeDiscount => _activeDiscount;
  
  bool get isLoadingFloor => _isLoadingFloor;
  bool get isLoadingMenu => _isLoadingMenu;
  bool get isLoadingShift => _isLoadingShift;
  bool get isSavingOrder => _isSavingOrder;

  double get cartSubtotal {
    double total = 0;
    for (var item in _cart) {
      total += item.totalPrice;
    }
    return total;
  }

  double get cartTotal {
    return math.max(0.0, cartSubtotal - _activeDiscount);
  }

  // Load floor zones & tables
  Future<void> loadFloor() async {
    _isLoadingFloor = true;
    notifyListeners();

    try {
      final tablesData = await apiService.getTables();
      
      final Set<String> zoneNames = {};
      _tables = tablesData.map((t) {
        final table = TableModel.fromJson(t);
        if (t['zone'] != null) {
          zoneNames.add(t['zone']);
        }
        return table;
      }).toList();

      _zones = zoneNames.map((name) => Zone(id: name, name: name)).toList();
      
      // If selected table still exists, refresh it
      if (_selectedTable != null) {
        final updated = _tables.firstWhere((t) => t.id == _selectedTable!.id, orElse: () => _selectedTable!);
        _selectedTable = updated;
      }
      
      _isLoadingFloor = false;
      notifyListeners();
    } catch (e) {
      _isLoadingFloor = false;
      notifyListeners();
      print("Error loading floor: $e");
    }
  }

  // Load categories & menu
  Future<void> loadMenu() async {
    _isLoadingMenu = true;
    notifyListeners();

    try {
      final catsData = await apiService.getCategories();
      _categories = catsData.map((c) => Category.fromJson(c)).toList();

      final menuData = await apiService.getMenu();
      _menuItems = menuData.map((m) => MenuItem.fromJson(m)).toList();

      _isLoadingMenu = false;
      notifyListeners();
    } catch (e) {
      _isLoadingMenu = false;
      notifyListeners();
      print("Error loading menu: $e");
    }
  }

  // Load shift state
  Future<void> loadShift() async {
    _isLoadingShift = true;
    notifyListeners();

    try {
      final shiftData = await apiService.getCurrentShift();
      if (shiftData != null) {
        _currentShift = Shift.fromJson(shiftData);
      } else {
        _currentShift = null;
      }
      _isLoadingShift = false;
      notifyListeners();
    } catch (e) {
      _isLoadingShift = false;
      notifyListeners();
      print("Error loading shift: $e");
    }
  }

  // Load operations config (payment & shifts settings)
  Future<void> loadOperationsConfig() async {
    try {
      _operationsConfig = await apiService.getOperationsConfig();
      notifyListeners();
    } catch (e) {
      print("Error loading operations config: $e");
    }
  }

  void selectZone(String zoneId) {
    _selectedZoneId = zoneId;
    notifyListeners();
  }

  // Select table and load active bill details
  Future<void> selectTable(TableModel? table) async {
    _selectedTable = table;
    _cart = [];
    _activeOrderId = null;
    _activeBillNo = null;
    _activeDiscount = 0.0;
    notifyListeners();

    if (table == null) return;

    if (table.activeOrderId != null) {
      try {
        final orderDetails = await apiService.getOrder(table.activeOrderId!);
        _activeOrderId = orderDetails['id'];
        _activeBillNo = orderDetails['bill_no'];
        _activeDiscount = _doubleValue(orderDetails['discount']);
        
        final List<dynamic> items = orderDetails['items'] ?? [];
        _cart = items.map((i) {
          final menuItemId = i['menu_item_id'] ?? '';
          MenuItem? foundItem;
          try {
            foundItem = _menuItems.firstWhere((m) => m.id == menuItemId);
          } catch (_) {
            foundItem = MenuItem(
              id: menuItemId,
              code: i['sku_id'] ?? '',
              name: i['name'] ?? '',
              price: _doubleValue(i['unit_price']),
              categoryId: '',
              imageUrl: '',
              modifiers: [],
            );
          }

          final List<dynamic> mods = i['mods'] ?? [];
          final selectedMods = mods.map((m) => Modifier(
            name: m['name'] ?? '',
            price: _doubleValue(m['price']),
          )).toList();

          // Construct CartItem
          return CartItem(
            item: foundItem,
            qty: i['qty'] ?? 1,
            selectedModifiers: selectedMods,
            notes: i['note'] ?? '',
          );
        }).toList();

        notifyListeners();
      } catch (e) {
        print("Error loading table order: $e");
      }
    }
  }

  void addToCart(MenuItem item, List<Modifier> selectedModifiers, String notes) {
    // Check if duplicate item exists in cart
    for (var cartItem in _cart) {
      if (cartItem.item.id == item.id &&
          _areModifiersEqual(cartItem.selectedModifiers, selectedModifiers) &&
          cartItem.notes == notes) {
        cartItem.qty += 1;
        notifyListeners();
        return;
      }
    }

    _cart.add(CartItem(
      item: item,
      selectedModifiers: List.from(selectedModifiers),
      notes: notes,
    ));
    notifyListeners();
  }

  void updateQty(CartItem cartItem, int qty) {
    if (qty <= 0) {
      _cart.remove(cartItem);
    } else {
      cartItem.qty = qty;
    }
    notifyListeners();
  }

  void removeFromCart(CartItem cartItem) {
    _cart.remove(cartItem);
    notifyListeners();
  }

  void clearCart() {
    _cart = [];
    notifyListeners();
  }

  void setDiscount(double amount) {
    _activeDiscount = amount;
    notifyListeners();
  }

  bool _areModifiersEqual(List<Modifier> a, List<Modifier> b) {
    if (a.length != b.length) return false;
    final Set<String> aNames = a.map((m) => m.name).toSet();
    final Set<String> bNames = b.map((m) => m.name).toSet();
    return aNames.difference(bNames).isEmpty;
  }

  // Submit order to backend
  Future<void> submitOrder() async {
    if (_selectedTable == null) return;
    _isSavingOrder = true;
    notifyListeners();

    try {
      final List<Map<String, dynamic>> orderItems = _cart.map((c) => {
        'menu_item_id': c.item.id,
        'qty': c.qty,
        'note': c.notes,
        'mods': c.selectedModifiers.map((m) => {
          'name': m.name,
          'price': m.price,
        }).toList(),
      }).toList();

      final payload = {
        if (_activeOrderId != null) 'id': _activeOrderId,
        'table_id': _selectedTable!.id,
        'source': 'staff_pos',
        'items': orderItems,
      };

      final orderRes = await apiService.createOrUpdateOrder(payload);
      _activeOrderId = orderRes['id'];
      _activeBillNo = orderRes['bill_no'];

      await loadFloor();
      _isSavingOrder = false;
      notifyListeners();
    } catch (e) {
      _isSavingOrder = false;
      notifyListeners();
      rethrow;
    }
  }

  // Pay order
  Future<void> payOrder(String method, double paidAmount, {Map<String, dynamic>? cardMeta}) async {
    if (_activeOrderId == null) return;
    _isSavingOrder = true;
    notifyListeners();

    try {
      final payload = {
        'lines': [
          {
            'method': method,
            'amount': cartTotal,
            if (cardMeta != null) 'card': cardMeta,
          }
        ],
        'discount': _activeDiscount,
      };

      await apiService.payOrder(_activeOrderId!, payload);
      
      // Reset POS workspace selection
      _selectedTable = null;
      _cart = [];
      _activeOrderId = null;
      _activeBillNo = null;
      _activeDiscount = 0.0;

      await loadFloor();
      await loadShift();
      
      _isSavingOrder = false;
      notifyListeners();
    } catch (e) {
      _isSavingOrder = false;
      notifyListeners();
      rethrow;
    }
  }

  // Open shift
  Future<void> openShift(double openingBalance) async {
    _isLoadingShift = true;
    notifyListeners();
    try {
      final res = await apiService.openShift(openingBalance);
      _currentShift = Shift.fromJson(res);
      _isLoadingShift = false;
      notifyListeners();
    } catch (e) {
      _isLoadingShift = false;
      notifyListeners();
      rethrow;
    }
  }

  // Close shift
  Future<void> closeShift(double closingBalance) async {
    _isLoadingShift = true;
    notifyListeners();
    try {
      await apiService.closeShift(closingBalance);
      _currentShift = null;
      _isLoadingShift = false;
      notifyListeners();
    } catch (e) {
      _isLoadingShift = false;
      notifyListeners();
      rethrow;
    }
  }

  // Resolve staff call
  Future<void> resolveCall(String tableId) async {
    try {
      await apiService.resolveStaffCall(tableId);
      await loadFloor();
    } catch (e) {
      print("Error resolving staff call: $e");
    }
  }

  // Open cash drawer physically
  Future<void> openCashDrawer({String printerId = ''}) async {
    try {
      await apiService.openCashDrawer(printerId: printerId);
    } catch (e) {
      print("Error opening cash drawer: $e");
      rethrow;
    }
  }
}
