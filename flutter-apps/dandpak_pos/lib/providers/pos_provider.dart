import 'dart:convert';
import 'dart:isolate';
import 'dart:math' as math;

import 'package:flutter/foundation.dart' hide Category;
import '../models/pos_models.dart';
import '../services/api_service.dart';
import '../services/app_log.dart';

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
  // Full /shifts/current snapshot: { shift, config, report, day_report,
  // drawer, opening_suggestion }. Drives the shift/cash-drawer panel.
  Map<String, dynamic>? _shiftState;

  Map<String, dynamic>? _operationsConfig;

  String _selectedZoneId = 'all';
  TableModel? _selectedTable;
  List<CartItem> _cart = [];

  String? _activeOrderId;
  String? _activeBillNo;
  double _activeDiscount = 0.0;
  Map<String, dynamic>? _selectedCustomer;

  bool _isLoadingFloor = false;
  bool _isLoadingMenu = false;
  bool _isLoadingShift = false;
  bool _isSavingOrder = false;
  bool _isPayingOrder = false;

  PosProvider({required this.apiService});

  List<Zone> get zones => _zones;
  List<TableModel> get tables => _tables;
  List<Category> get categories => _categories;
  List<MenuItem> get menuItems => _menuItems;
  Shift? get currentShift => _currentShift;
  Map<String, dynamic>? get shiftState => _shiftState;
  Map<String, dynamic>? get operationsConfig => _operationsConfig;

  /// Raw shift object (has shift_key / shift_label the Shift model omits).
  Map<String, dynamic>? get rawShift {
    final s = _shiftState?['shift'];
    return s is Map ? Map<String, dynamic>.from(s) : null;
  }

  Map<String, dynamic> get shiftReport {
    final r = _shiftState?['report'];
    return r is Map ? Map<String, dynamic>.from(r) : {};
  }

  Map<String, dynamic> get dayReport {
    final r = _shiftState?['day_report'];
    return r is Map ? Map<String, dynamic>.from(r) : {};
  }

  int get openingSuggestion {
    final v = _shiftState?['opening_suggestion'];
    return v is num ? v.round() : 0;
  }

  List<int> get shiftDenominations {
    final cfg = _shiftState?['config'];
    final shifts = cfg is Map ? cfg['shifts'] : null;
    final denoms = shifts is Map ? shifts['denominations'] : null;
    if (denoms is List && denoms.isNotEmpty) {
      final out = denoms
          .map((e) => e is num ? e.toInt() : int.tryParse('$e') ?? 0)
          .where((e) => e > 0)
          .toList();
      if (out.isNotEmpty) return out;
    }
    return const [
      500000,
      200000,
      100000,
      50000,
      20000,
      10000,
      5000,
      2000,
      1000
    ];
  }

  List<Map<String, dynamic>> get shiftLabels {
    final cfg = _shiftState?['config'];
    final shifts = cfg is Map ? cfg['shifts'] : null;
    final labels = shifts is Map ? shifts['labels'] : null;
    final out = <Map<String, dynamic>>[];
    if (labels is List) {
      for (final l in labels) {
        if (l is Map && l['enabled'] != false) {
          out.add(Map<String, dynamic>.from(l));
        }
      }
    }
    if (out.isEmpty) {
      return [
        {'key': 'morning', 'label': 'Ca sáng'},
        {'key': 'evening', 'label': 'Ca tối'},
      ];
    }
    return out;
  }

  String get selectedZoneId => _selectedZoneId;
  TableModel? get selectedTable => _selectedTable;
  List<CartItem> get cart => _cart;

  String? get activeOrderId => _activeOrderId;
  String? get activeBillNo => _activeBillNo;
  double get activeDiscount => _activeDiscount;
  Map<String, dynamic>? get selectedCustomer => _selectedCustomer;

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
        final updated = _tables.firstWhere((t) => t.id == _selectedTable!.id,
            orElse: () => _selectedTable!);
        _selectedTable = updated;
      }

      _isLoadingFloor = false;
      notifyListeners();
    } catch (e) {
      _isLoadingFloor = false;
      notifyListeners();
      dlog("Error loading floor: $e");
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
      dlog("Error loading menu: $e");
    }
  }

  // Load the full shift + cash-drawer snapshot (branch-scoped on the server,
  // so F&B POS and Retail POS see the same shift/drawer).
  Future<void> loadShift() async {
    _isLoadingShift = true;
    notifyListeners();

    try {
      final state = await apiService.getShiftState();
      _shiftState = state;
      final shift = state['shift'];
      if (shift is Map) {
        final merged = Map<String, dynamic>.from(shift);
        final report = state['report'];
        if (report is Map && report['expected_cash'] != null) {
          merged['expected_cash'] = report['expected_cash'];
        }
        _currentShift = Shift.fromJson(merged);
      } else {
        _currentShift = null;
      }
    } catch (e) {
      dlog("Error loading shift: $e");
    } finally {
      _isLoadingShift = false;
      notifyListeners();
    }
  }

  Future<void> refreshShift() => loadShift();

  // Load operations config (payment & shifts settings)
  Future<void> loadOperationsConfig() async {
    try {
      _operationsConfig = await apiService.getOperationsConfig();
      notifyListeners();
    } catch (e) {
      dlog("Error loading operations config: $e");
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
    _selectedCustomer = null;
    notifyListeners();

    if (table == null) return;

    if (table.activeOrderId != null) {
      try {
        final orderDetails = await apiService.getOrder(table.activeOrderId!);
        _applyOrderDetails(orderDetails);
        notifyListeners();
      } catch (e) {
        dlog("Error loading table order: $e");
      }
    }
  }

  void _applyOrderDetails(Map<String, dynamic> orderDetails) {
    _activeOrderId = orderDetails['id']?.toString();
    _activeBillNo = orderDetails['bill_no']?.toString();
    _activeDiscount = _doubleValue(orderDetails['discount']);
    _selectedCustomer = _readCustomer(orderDetails);

    final List<dynamic> items = orderDetails['items'] ?? [];
    _cart = items
        .where((i) => i is Map && i['status']?.toString() != 'cancelled')
        .map((raw) {
      final i = Map<String, dynamic>.from(raw as Map);
      final menuItemId = i['menu_item_id']?.toString() ?? '';
      final skuId = i['sku_id']?.toString() ?? '';
      MenuItem? foundItem;
      try {
        foundItem = _menuItems.firstWhere((m) => m.id == menuItemId);
      } catch (_) {
        foundItem = MenuItem(
          id: menuItemId.isNotEmpty ? menuItemId : skuId,
          code: skuId,
          name: i['name']?.toString() ?? '',
          price: _doubleValue(i['unit_price']),
          categoryId: '',
          imageUrl: i['image']?.toString() ?? '',
          modifiers: [],
        );
      }

      final List<dynamic> mods = i['mods'] ?? [];
      final selectedMods = mods
          .whereType<Map>()
          .map((m) => Modifier(
                name: m['name']?.toString() ?? '',
                price: _doubleValue(m['price']),
              ))
          .toList();

      return CartItem(
        item: foundItem,
        qty: i['qty'] is num ? (i['qty'] as num).toInt() : 1,
        selectedModifiers: selectedMods,
        notes: i['note']?.toString() ?? '',
        orderItemId: i['id']?.toString() ?? '',
        status: i['status']?.toString() ?? '',
        station: i['station']?.toString() ?? '',
        unitPriceOverride: _doubleValue(i['unit_price']),
      );
    }).toList();
  }

  Map<String, dynamic>? _readCustomer(Map<String, dynamic> orderDetails) {
    final customer = orderDetails['customer'];
    if (customer is Map) return Map<String, dynamic>.from(customer);
    final raw = orderDetails['customer_json'];
    if (raw is String && raw.trim().isNotEmpty) {
      try {
        final decoded = jsonDecode(raw);
        if (decoded is Map && decoded.isNotEmpty) {
          return Map<String, dynamic>.from(decoded);
        }
      } catch (_) {}
    }
    return null;
  }

  void addToCart(
      MenuItem item, List<Modifier> selectedModifiers, String notes) {
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

  void setCustomer(Map<String, dynamic>? customer) {
    _selectedCustomer =
        customer == null ? null : Map<String, dynamic>.from(customer);
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
      final unsaved = _cart.where((c) => !c.persisted).toList();
      if (unsaved.isEmpty) {
        _isSavingOrder = false;
        notifyListeners();
        return;
      }

      final List<Map<String, dynamic>> orderItems = unsaved
          .map((c) => {
                'menu_item_id': c.item.id,
                'qty': c.qty,
                'note': c.notes,
                'mods': c.selectedModifiers
                    .map((m) => {
                          'name': m.name,
                          'price': m.price,
                        })
                    .toList(),
              })
          .toList();

      final payload = {
        if (_activeOrderId != null) 'id': _activeOrderId,
        'table_id': _selectedTable!.id,
        'source': 'staff_pos',
        'items': orderItems,
      };

      final orderRes = await apiService.createOrUpdateOrder(payload);
      _applyOrderDetails(orderRes);

      await loadFloor();
      _isSavingOrder = false;
      notifyListeners();
    } catch (e) {
      _isSavingOrder = false;
      notifyListeners();
      rethrow;
    }
  }

  // Pay order. [bankTxId]/[manualReason]/[securityPin] phục vụ xác nhận thủ
  // công chuyển khoản (khách quét QR cũ / webhook chậm): server bắt PIN của
  // chính thu ngân (hoặc Admin) và ghi audit người duyệt.
  Future<void> reloadActiveOrder() async {
    if (_activeOrderId == null) return;
    final orderDetails = await apiService.getOrder(_activeOrderId!);
    _applyOrderDetails(orderDetails);
    await loadFloor();
    notifyListeners();
  }

  Future<void> moveSelectedTable(String targetTableId) async {
    final source = _selectedTable;
    if (source == null) return;
    final moved = await apiService.moveTable(source.id, targetTableId);
    await loadFloor();
    final targetId = moved['table_id']?.toString() ?? targetTableId;
    final target = _tables.firstWhere(
      (t) => t.id == targetId,
      orElse: () => _selectedTable!,
    );
    await selectTable(target);
  }

  Future<void> mergeSelectedTable(String targetTableId) async {
    final source = _selectedTable;
    if (source == null) return;
    final merged = await apiService.mergeTable(source.id, targetTableId);
    await loadFloor();
    final targetId = merged['table_id']?.toString() ?? targetTableId;
    final target = _tables.firstWhere(
      (t) => t.id == targetId,
      orElse: () => _selectedTable!,
    );
    await selectTable(target);
  }

  Future<void> splitActiveOrder(List<String> itemIds) async {
    if (_activeOrderId == null) return;
    final result = await apiService.splitOrder(_activeOrderId!, itemIds);
    final split = result['split'];
    if (split is Map) {
      _applyOrderDetails(Map<String, dynamic>.from(split));
    }
    await loadFloor();
    notifyListeners();
  }

  Future<void> confirmActiveOrder() async {
    if (_activeOrderId == null) return;
    final order = await apiService.confirmOrderItems(_activeOrderId!, const []);
    _applyOrderDetails(order);
    await loadFloor();
    notifyListeners();
  }

  Future<void> cancelCartItem(
    CartItem item, {
    String reason = 'Nhân viên hủy',
    String? managerPin,
  }) async {
    if (!item.persisted) {
      _cart.remove(item);
      notifyListeners();
      return;
    }
    await apiService.cancelItem(item.orderItemId, reason,
        managerPin: managerPin);
    await reloadActiveOrder();
  }

  Future<void> payOrder(
    String method,
    double paidAmount, {
    Map<String, dynamic>? cardMeta,
    String? bankTxId,
    String? manualReason,
    String? securityPin,
    String? orderId,
    double? totalOverride,
    double? discountOverride,
    Map<String, dynamic>? customerOverride,
  }) async {
    final targetOrderId = (orderId ?? _activeOrderId)?.trim();
    if (targetOrderId == null || targetOrderId.isEmpty) {
      throw Exception('Thiếu mã hóa đơn để thanh toán.');
    }
    final amountDue = math.max(0.0, totalOverride ?? cartTotal);
    if (amountDue <= 0) {
      throw Exception('Hóa đơn không có số tiền cần thanh toán.');
    }
    if (_isPayingOrder) {
      throw Exception('Đang xử lý thanh toán, vui lòng chờ.');
    }
    _isPayingOrder = true;
    _isSavingOrder = true;
    notifyListeners();

    try {
      final payload = {
        'lines': [
          {
            'method': method,
            'amount': amountDue,
            if (cardMeta != null) 'card': cardMeta,
            if (bankTxId != null && bankTxId.isNotEmpty) 'bank_tx_id': bankTxId,
            if (manualReason != null)
              'manual_confirm': {'reason': manualReason},
          }
        ],
        'discount': discountOverride ?? _activeDiscount,
        if ((customerOverride ?? _selectedCustomer) != null)
          'customer': customerOverride ?? _selectedCustomer,
        if (securityPin != null && securityPin.isNotEmpty)
          'security_pin': securityPin,
      };

      await apiService.payOrder(targetOrderId, payload);

      // Reset POS workspace selection
      _selectedTable = null;
      _cart = [];
      _activeOrderId = null;
      _activeBillNo = null;
      _activeDiscount = 0.0;
      _selectedCustomer = null;

      await loadFloor();
      await loadShift();

      _isSavingOrder = false;
      _isPayingOrder = false;
      notifyListeners();
    } catch (e) {
      _isSavingOrder = false;
      _isPayingOrder = false;
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

  // ── Full shift + cash-drawer actions (used by the shared ShiftDialog) ──

  Future<void> openShiftCounts({
    required String shiftKey,
    required Map<String, int> counts,
    required int openingCash,
    required bool cashManual,
  }) async {
    await apiService.openShiftCounts(
      shiftKey: shiftKey,
      counts: counts,
      openingCash: openingCash,
      cashManual: cashManual,
    );
    await loadShift();
  }

  Future<void> closeShiftCounts({
    required String shiftKey,
    required Map<String, int> counts,
    required int closingCash,
    String? managerOverridePin,
  }) async {
    await apiService.closeShiftCounts(
      shiftKey: shiftKey,
      counts: counts,
      closingCash: closingCash,
      managerOverridePin: managerOverridePin,
    );
    await loadShift();
  }

  Future<Map<String, dynamic>> getCashDrawer() => apiService.getCashDrawer();

  Future<Map<String, dynamic>> createCashExpense(
      Map<String, dynamic> body) async {
    final res = await apiService.createCashExpense(body);
    await loadShift();
    return res;
  }

  Future<Map<String, dynamic>> createCashReimbursement(
      Map<String, dynamic> body) async {
    final res = await apiService.createCashReimbursement(body);
    await loadShift();
    return res;
  }

  // Resolve staff call
  Future<void> resolveCall(String tableId) async {
    try {
      await apiService.resolveStaffCall(tableId);
      await loadFloor();
    } catch (e) {
      dlog("Error resolving staff call: $e");
    }
  }

  // Open cash drawer physically
  Future<void> openCashDrawer({String printerId = ''}) async {
    try {
      await apiService.openCashDrawer(printerId: printerId);
    } catch (e) {
      dlog("Error opening cash drawer: $e");
      rethrow;
    }
  }
}
