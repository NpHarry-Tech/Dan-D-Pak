import 'dart:async';
import 'dart:convert';
import 'dart:math' as math;

import 'package:flutter/foundation.dart' hide Category;
import '../models/pos_models.dart';
import '../models/retail_models.dart';
import '../services/api_service.dart';
import '../services/app_log.dart';
import '../services/local_store.dart';
import '../services/system_log.dart';

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
  // PIN Quản lý/Chủ đã nhập khi chỉnh giá dòng — gửi kèm submit (server bắt PIN).
  String? _lineOverridePin;
  Map<String, dynamic>? _selectedCustomer;

  // CTKM/voucher cho đơn F&B — dùng CHUNG engine với Retail (buildOrderDiscountPlan
  // ở server). orderVoucherId = CTKM áp cả bill; lineVouchers = CTKM sản phẩm CHỈ
  // áp được cho dòng hàng retail (item.isRetail, có sku_id) đã gửi bếp/lưu (persisted:
  // server ghép theo order_item_id) — món F&B thường (không sku_id) không dính được,
  // đúng luật ở vouchers.js. _discountPlan là kết quả preview mới nhất từ server.
  List<RetailVoucher> _activeVouchers = [];
  String? _orderVoucherId;
  final Map<String, String> _lineVouchers = {};
  Map<String, dynamic>? _discountPlan;
  bool _isPreviewingDiscount = false;

  // Combo (Option B, giống Retail — xem combo_support.dart): các dòng cùng
  // comboId trong _cart gộp thành 1 combo. selectedComboIds gửi server để
  // server CHỈ áp đúng combo đã chọn (không tự áp thêm combo khác).
  int _comboSeq = 0;

  bool _isLoadingFloor = false;
  bool _isLoadingMenu = false;
  bool _isLoadingShift = false;
  bool _isSavingOrder = false;
  bool _isPayingOrder = false;

  PosProvider({required this.apiService});

  String _paymentOperationStoreKey(String orderId) =>
      'pending_payment_operation_$orderId';

  Future<String> _paymentOperationId(String orderId) async {
    final store = LocalStore.instance;
    final key = _paymentOperationStoreKey(orderId);
    final existing = await store.getString(key);
    if (existing != null && existing.isNotEmpty) return existing;
    final created = 'pay-$orderId-'
        '${DateTime.now().microsecondsSinceEpoch.toRadixString(36)}-'
        '${math.Random.secure().nextInt(0x7fffffff).toRadixString(36)}';
    await store.setString(key, created);
    return created;
  }

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

  double get cartVat {
    final subtotal = cartSubtotal;
    final total = cartTotal;
    if (subtotal <= 0 || total <= 0) return 0;
    final pricedItems = _cart.where((item) => item.totalPrice > 0).toList();
    var allocated = 0.0;
    var vat = 0.0;
    for (var index = 0; index < pricedItems.length; index++) {
      final item = pricedItems[index];
      final gross = item.totalPrice;
      final discountedGross = index == pricedItems.length - 1
          ? total - allocated
          : (gross * total / subtotal).roundToDouble();
      allocated += discountedGross;
      final rate = item.item.vatRate;
      if (rate > 0) {
        vat += discountedGross -
            (discountedGross / (1 + rate / 100)).roundToDouble();
      }
    }
    return vat;
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
    _orderVoucherId = null;
    _lineVouchers.clear();
    _discountPlan = null;
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
          isRetail: skuId.isNotEmpty,
        );
      }
      foundItem = MenuItem(
        id: foundItem.id,
        code: foundItem.code,
        name: foundItem.name,
        price: _doubleValue(i['unit_price']),
        vatRate: _doubleValue(i['vat_rate']),
        categoryId: foundItem.categoryId,
        imageUrl: foundItem.imageUrl,
        modifiers: foundItem.modifiers,
        isRetail: foundItem.isRetail,
      );

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

  // GHI CHÚ DÒNG (đồng bộ Retail): đặt ghi chú cho một món trong giỏ. Món đã gửi
  // bếp (persisted) sửa ghi chú sẽ KHÔNG tự đẩy lại — chỉnh trước khi gửi bếp.
  void setLineNote(CartItem cartItem, String note) {
    cartItem.notes = note.trim();
    notifyListeners();
  }

  // CHỈNH GIÁ DÒNG (giảm giá trực tiếp trên món, như Retail): [price] = giá bán mới
  // mỗi đơn vị, null = về giá niêm yết. [pin] = PIN Quản lý/Chủ đã nhập ở UI, giữ
  // lại để gửi kèm khi submit (server bắt PIN khi có dòng chỉnh giá).
  void setLinePrice(CartItem cartItem, double? price, {String? pin}) {
    cartItem.unitPriceOverride = price;
    if (price != null && pin != null && pin.isNotEmpty) _lineOverridePin = pin;
    if (!_cart.any((c) => c.hasPriceOverride)) _lineOverridePin = null;
    notifyListeners();
  }

  void removeFromCart(CartItem cartItem) {
    _cart.remove(cartItem);
    if (!_cart.any((c) => c.hasPriceOverride)) _lineOverridePin = null;
    notifyListeners();
  }

  void clearCart() {
    _cart = [];
    _lineOverridePin = null;
    notifyListeners();
  }

  void setDiscount(double amount) {
    _activeDiscount = amount;
    notifyListeners();
    refreshDiscountPreview();
  }

  void setCustomer(Map<String, dynamic>? customer) {
    _selectedCustomer =
        customer == null ? null : Map<String, dynamic>.from(customer);
    notifyListeners();
    refreshDiscountPreview();
  }

  // ── CTKM/voucher (dùng CHUNG engine với Retail — xem services/payments.js
  // buildOrderDiscountPlan) ──────────────────────────────────────────────────
  List<RetailVoucher> get activeVouchers => _activeVouchers;
  String? get orderVoucherId => _orderVoucherId;
  Map<String, String> get lineVouchers => _lineVouchers;
  bool get isPreviewingDiscount => _isPreviewingDiscount;

  /// Danh sách CTKM ÁP ĐƯỢC cho toàn bill (scope 'order') — CTKM sản phẩm
  /// (sku/all_sku/combo) chỉ chọn được TỪNG DÒNG retail, xem [lineVoucherOptionsFor].
  List<RetailVoucher> get orderVoucherOptions =>
      _activeVouchers.where((v) => v.isOrder).toList();

  /// CTKM sản phẩm áp được cho MỘT dòng retail cụ thể trong đơn F&B (dòng
  /// thêm qua "Thêm retail", có sku_id) — món F&B thường không có lựa chọn nào
  /// vì server luôn từ chối (đúng luật ở vouchers.js).
  List<RetailVoucher> lineVoucherOptionsFor(CartItem item) {
    if (!item.item.isRetail) return const [];
    return _activeVouchers
        .where((v) => v.isSku || v.isAllSku)
        .where((v) => v.appliesToSku(item.item.id))
        .toList();
  }

  /// Kết quả preview mới nhất từ server (subtotal/discount/total/appliedSkuPromos…).
  Map<String, dynamic>? get discountPlan => _discountPlan;
  List<Map<String, dynamic>> get appliedPromos {
    final list = _discountPlan?['appliedSkuPromos'];
    return list is List
        ? list
            .whereType<Map>()
            .map((e) => Map<String, dynamic>.from(e))
            .toList()
        : const [];
  }

  /// Giảm giá/Tổng cộng HIỂN THỊ: dùng plan đã preview (gồm voucher + ưu đãi
  /// khách + giảm tay) nếu có, không thì rơi về giảm tay đơn thuần như cũ.
  double get displayDiscount {
    final d = _discountPlan?['discount'];
    return d is num ? d.toDouble() : _activeDiscount;
  }

  double get displayTotal {
    final t = _discountPlan?['total'];
    return t is num ? t.toDouble() : cartTotal;
  }

  Future<void> loadActiveVouchers() async {
    try {
      final rows = await apiService.getActiveVouchers();
      _activeVouchers = rows
          .whereType<Map>()
          .map((e) => RetailVoucher.fromJson(Map<String, dynamic>.from(e)))
          .toList();
      notifyListeners();
    } catch (e) {
      dlog('Error loading active vouchers: $e');
    }
  }

  void setOrderVoucher(String? voucherId) {
    _orderVoucherId = voucherId;
    notifyListeners();
    refreshDiscountPreview();
  }

  /// [voucherId] null = bỏ CTKM đang chọn cho dòng này.
  void setLineVoucher(CartItem item, String? voucherId) {
    if (item.orderItemId.isEmpty) return; // chưa gửi bếp/lưu → chưa có gì để áp
    if (voucherId == null || voucherId.isEmpty) {
      _lineVouchers.remove(item.orderItemId);
    } else {
      _lineVouchers[item.orderItemId] = voucherId;
    }
    notifyListeners();
    refreshDiscountPreview();
  }

  /// Gọi lại server tính THỬ giảm giá (KHÔNG ghi gì) mỗi khi voucher/khách/giảm
  /// tay đổi, để bill pane hiện đúng số tiền sẽ thu trước khi bấm Thanh toán.
  Future<void> refreshDiscountPreview() async {
    final orderId = _activeOrderId;
    if (orderId == null) {
      _discountPlan = null;
      notifyListeners();
      return;
    }
    _isPreviewingDiscount = true;
    notifyListeners();
    try {
      final plan = await apiService.orderDiscountPreview(
        orderId,
        voucherId: _orderVoucherId,
        lineVouchers: _lineVouchers,
        manualDiscount: _activeDiscount,
        customer: _selectedCustomer,
        // LUÔN gửi (kể cả rỗng) để ép opt-in giống Retail POS — không gửi gì
        // thì server coi null = tự áp MỌI combo khớp giỏ (hành vi cũ), có thể
        // áp nhầm combo thu ngân chưa hề chọn.
        selectedCombos: selectedComboIds,
      );
      _discountPlan = plan;
    } catch (e) {
      dlog('Error previewing discount: $e');
      _discountPlan = null;
    } finally {
      _isPreviewingDiscount = false;
      notifyListeners();
    }
  }

  bool _areModifiersEqual(List<Modifier> a, List<Modifier> b) {
    if (a.length != b.length) return false;
    final Set<String> aNames = a.map((m) => m.name).toSet();
    final Set<String> bNames = b.map((m) => m.name).toSet();
    return aNames.difference(bNames).isEmpty;
  }

  // Gõ nhanh nhiều món (tap liên tiếp trong "Thêm món FnB") gọi submitOrder()
  // nhiều lần gần như cùng lúc. Trước đây mỗi lần gọi bắn NGAY một request
  // riêng — request sau không biết request trước đã/sắp lưu món nào, nên gửi
  // TRÙNG các món "chưa persisted"; và vì _applyOrderDetails() THAY THẾ toàn
  // bộ _cart bằng response, một response CŨ (ít món hơn) trả về SAU một
  // response MỚI (nhiều món hơn) sẽ xoá mất các món vừa thêm — đúng triệu
  // chứng "chọn nhanh nhiều món thì rớt món". Chỉ CHO PHÉP một request submit
  // chạy tại một thời điểm; các lệnh gọi đến trong lúc đang chạy được gộp lại
  // thành một vòng chạy tiếp theo (không bắn request song song, không áp
  // response cũ đè lên state mới).
  bool _submitRunning = false;
  bool _submitAgainNeeded = false;
  final List<Completer<void>> _submitWaiters = [];

  Future<void> submitOrder() async {
    if (_selectedTable == null) return;
    if (_submitRunning) {
      _submitAgainNeeded = true;
      final waiter = Completer<void>();
      _submitWaiters.add(waiter);
      return waiter.future;
    }
    _submitRunning = true;
    _isSavingOrder = true;
    notifyListeners();
    try {
      await _drainSubmitQueue();
    } finally {
      _submitRunning = false;
      _isSavingOrder = false;
      notifyListeners();
    }
  }

  Future<void> _drainSubmitQueue() async {
    while (true) {
      _submitAgainNeeded = false;
      final waiters = List<Completer<void>>.from(_submitWaiters);
      _submitWaiters.clear();
      try {
        await _submitOrderOnce();
        for (final w in waiters) {
          if (!w.isCompleted) w.complete();
        }
      } catch (e, s) {
        for (final w in waiters) {
          if (!w.isCompleted) w.completeError(e, s);
        }
        rethrow;
      }
      if (!_submitAgainNeeded && _submitWaiters.isEmpty) return;
    }
  }

  Future<void> _submitOrderOnce() async {
    final unsaved = _cart.where((c) => !c.persisted).toList();
    if (unsaved.isEmpty) return;

    final List<Map<String, dynamic>> orderItems = unsaved
        .map((c) => {
              if (c.item.isRetail)
                'sku_id': c.item.id
              else
                'menu_item_id': c.item.id,
              'qty': c.qty,
              'note': c.notes,
              // CHỈNH GIÁ DÒNG: gửi giá đã đổi; server tự lấy giá niêm yết làm
              // orig_price để bill in "gốc → sau đổi". Không chỉnh thì bỏ qua.
              if (c.hasPriceOverride) 'price': c.unitPriceOverride,
              'mods': c.selectedModifiers
                  .map((m) => {
                        'name': m.name,
                        'price': m.price,
                      })
                  .toList(),
            })
        .toList();

    final hasOverride = unsaved.any((c) => c.hasPriceOverride);
    final payload = {
      if (_activeOrderId != null) 'id': _activeOrderId,
      'table_id': _selectedTable!.id,
      'source': 'cashier',
      'items': orderItems,
      // Server bắt PIN Quản lý/Chủ khi có dòng chỉnh giá.
      if (hasOverride && _lineOverridePin != null)
        'security_pin': _lineOverridePin,
    };

    final orderRes = await apiService.createOrUpdateOrder(payload);
    // KHÔNG dùng _applyOrderDetails() (thay CẢ _cart bằng response) — món
    // khách vừa thêm cục bộ TRONG LÚC request này đang bay (đã ở _cart, chưa
    // kịp gửi vì đang chờ lượt submit tiếp theo) sẽ bị response NÀY (chưa hề
    // biết tới chúng) xoá mất nếu ghi đè cả danh sách. Chỉ gán id/trạng thái
    // server trả về vào ĐÚNG các dòng vừa gửi (unsaved), giữ nguyên phần còn
    // lại của giỏ hàng.
    _mergeSubmittedItems(orderRes, unsaved);
    notifyListeners();
    await loadFloor();
    // Giỏ vừa đổi (thêm/gửi món mới) → số CTKM đã preview trước đó không còn
    // đúng nữa (subtotal đổi), làm mới ngay để bill pane không hiện số cũ.
    if (_hasActivePromoSelection) {
      unawaited(refreshDiscountPreview());
    }
  }

  void _mergeSubmittedItems(
      Map<String, dynamic> orderDetails, List<CartItem> sent) {
    _activeOrderId = orderDetails['id']?.toString();
    _activeBillNo = orderDetails['bill_no']?.toString();
    _activeDiscount = _doubleValue(orderDetails['discount']);
    final custFromServer = _readCustomer(orderDetails);
    if (custFromServer != null) _selectedCustomer = custFromServer;

    final List<dynamic> items = orderDetails['items'] ?? [];
    final knownIds = _cart
        .map((c) => c.orderItemId)
        .where((id) => id.isNotEmpty)
        .toSet();
    // Dòng "mới" = server trả về nhưng client CHƯA biết id (chưa gán cho món
    // nào trong giỏ) — đó chính là các dòng vừa được chèn cho lượt gửi này.
    // Server chèn ĐÚNG theo thứ tự payload đã gửi nên ghép vị trí là an toàn.
    final freshRows = items
        .where((i) => i is Map && i['status']?.toString() != 'cancelled')
        .map((raw) => Map<String, dynamic>.from(raw as Map))
        .where((row) => !knownIds.contains(row['id']?.toString() ?? ''))
        .toList();
    final count = sent.length < freshRows.length ? sent.length : freshRows.length;
    for (var i = 0; i < count; i++) {
      final row = freshRows[i];
      final cartItem = sent[i];
      cartItem.orderItemId = row['id']?.toString() ?? '';
      cartItem.status = row['status']?.toString() ?? '';
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
    if (_hasActivePromoSelection) {
      unawaited(refreshDiscountPreview());
    }
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
    // Đẩy nốt món vừa thêm còn nằm cục bộ trước khi xác nhận — nếu vòng
    // submit trước đó lỡ lỗi mạng, món sẽ bị BỎ SÓT khỏi phiếu bếp trong khi
    // người dùng tưởng đã bấm "gửi hết" (bug thật: submit lỗi âm thầm, bấm
    // Xác nhận chỉ gửi phần đã lên server, phần lỗi nằm lại giỏ không ai biết).
    await submitOrder();
    if (_activeOrderId == null) return;
    if (!_cart.any((c) => c.status == 'pending_confirm')) return;
    // Gửi bếp = flow có correlationId (request confirm + phiếu bếp in ra).
    await SystemLog.runFlow('send_kitchen', () async {
      final order =
          await apiService.confirmOrderItems(_activeOrderId!, const []);
      _applyOrderDetails(order);
      await loadFloor();
      notifyListeners();
    });
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

  // Hủy NHIỀU món đã chọn cùng lúc — gộp thành 1 phiếu hủy bếp thay vì mỗi
  // món 1 phiếu rời khi hủy tuần tự (đúng góp ý người dùng: chọn nhiều rồi
  // hủy 1 lần). Món nháp cục bộ (chưa persisted) chỉ cần xóa khỏi giỏ, không
  // gọi server; phần còn lại gộp vào MỘT lệnh cancelItemsBatch duy nhất.
  Future<void> cancelCartItems(
    List<CartItem> items, {
    String reason = 'Nhân viên hủy',
    String? managerPin,
  }) async {
    if (items.isEmpty) return;
    final drafts = items.where((c) => !c.persisted).toList();
    for (final draft in drafts) {
      _cart.remove(draft);
    }
    final persistedIds = items
        .where((c) => c.persisted)
        .map((c) => c.orderItemId)
        .toList();
    if (persistedIds.isEmpty) {
      notifyListeners();
      return;
    }
    await apiService.cancelItemsBatch(_activeOrderId!, persistedIds, reason,
        managerPin: managerPin);
    await reloadActiveOrder();
  }

  // ── Combo (Option B, dùng CHUNG với Retail — xem combo_support.dart) ───────
  // Combo là 1 item bấm chọn ở "Thêm retail": khách/thu ngân chọn đủ N SKU
  // (vị nào cũng được) trong tập cho phép, giỏ gộp các SKU đó thành 1 nhóm
  // gắn chung comboId. Server áp CHÍNH XÁC giá combo qua selected_combos (xem
  // buildOrderDiscountPlan) — y hệt cách Retail POS đã làm.
  List<RetailVoucher> get comboVouchers =>
      _activeVouchers.where((v) => v.isCombo && v.comboQty > 0).toList();

  Map<String, List<CartItem>> get comboItemGroups {
    final map = <String, List<CartItem>>{};
    for (final c in _cart) {
      if (c.comboId != null) (map[c.comboId!] ??= <CartItem>[]).add(c);
    }
    return map;
  }

  List<String> get selectedComboIds =>
      comboItemGroups.keys.map((id) => id.split('#').first).toSet().toList();

  bool get _hasActivePromoSelection =>
      _orderVoucherId != null ||
      _lineVouchers.isNotEmpty ||
      selectedComboIds.isNotEmpty;

  int comboCountFor(String comboId) {
    final lines = comboItemGroups[comboId] ?? const [];
    if (lines.isEmpty || lines.first.comboPer <= 0) return 0;
    return lines.first.qty ~/ lines.first.comboPer;
  }

  /// Ghi combo vào giỏ: mỗi SKU chọn thành 1 CartItem (isRetail) gắn cùng
  /// comboId. [existingId] khác null = SỬA combo cũ (xoá nhóm cũ rồi ghi lại,
  /// giữ nguyên comboId để không tạo dòng mới trên server một cách vô ích).
  void applyCombo(RetailVoucher v, Map<Sku, int> perCombo, int count,
      {String? existingId}) {
    final chosen = perCombo.entries.where((e) => e.value > 0).toList();
    if (chosen.isEmpty || count <= 0) return;
    final comboId = existingId ?? '${v.id}#${_comboSeq++}';
    if (existingId != null) _cart.removeWhere((c) => c.comboId == existingId);
    for (final e in chosen) {
      final sku = e.key;
      final perUnit = e.value;
      final menuItem = MenuItem(
        id: sku.id,
        code: sku.barcode,
        name: sku.name,
        price: sku.price.toDouble(),
        vatRate: sku.vatRate.toDouble(),
        categoryId: sku.category,
        imageUrl: sku.image,
        modifiers: const [],
        isRetail: true,
      );
      _cart.add(CartItem(
        item: menuItem,
        qty: perUnit * count,
        selectedModifiers: const [],
        comboId: comboId,
        comboName: v.displayName,
        comboPer: perUnit,
      ));
    }
    notifyListeners();
  }

  /// Xoá cả nhóm combo. Dòng chưa lưu (nháp) chỉ cần bỏ khỏi giỏ cục bộ; dòng
  /// đã lưu (persisted) phải hủy qua server (gộp 1 phiếu, giống hủy nhiều món
  /// thường — xem cancelCartItems) vì đã có order_item thật cần đối soát.
  Future<void> removeCombo(String comboId,
      {String reason = 'Hủy combo', String? managerPin}) async {
    final group = (comboItemGroups[comboId] ?? const []).toList();
    if (group.isEmpty) return;
    await cancelCartItems(group, reason: reason, managerPin: managerPin);
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
    // displayTotal đã gồm CTKM/voucher preview (nếu có chọn) — cartTotal thuần
    // chỉ trừ giảm tay nên thu thiếu nếu chốt số theo nó lúc có voucher.
    final amountDue = math.max(0.0, totalOverride ?? displayTotal);
    final installmentAmount = math.max(0.0, paidAmount);
    if (amountDue <= 0 || installmentAmount <= 0) {
      throw Exception('Hóa đơn không có số tiền cần thanh toán.');
    }
    if (_isPayingOrder) {
      throw Exception('Đang xử lý thanh toán, vui lòng chờ.');
    }
    _isPayingOrder = true;
    _isSavingOrder = true;
    notifyListeners();

    // Cả flow thanh toán chạy dưới MỘT correlationId — request /pay, lệnh in,
    // HĐĐT phát sinh đều truy vết được thành một chuỗi trong nhật ký.
    return SystemLog.runFlow('payment', () async {
      try {
        // Giữ nguyên operation ID qua timeout, retry và cả lúc app khởi động lại.
        // Chỉ xóa sau khi server trả một kết quả terminal; nếu response bị mất,
        // lần thử sau sẽ replay đúng payment thay vì tạo lần thu tiền thứ hai.
        final paymentOperationId = await _paymentOperationId(targetOrderId);
        final payload = {
          'lines': [
            {
              'method': method,
              'amount': installmentAmount,
              if (cardMeta != null) 'card': cardMeta,
              if (bankTxId != null && bankTxId.isNotEmpty)
                'bank_tx_id': bankTxId,
              if (manualReason != null)
                'manual_confirm': {'reason': manualReason},
            }
          ],
          'discount': discountOverride ?? _activeDiscount,
          if (_orderVoucherId != null) 'voucher_id': _orderVoucherId,
          if (_lineVouchers.isNotEmpty) 'line_vouchers': _lineVouchers,
          if ((customerOverride ?? _selectedCustomer) != null)
            'customer': customerOverride ?? _selectedCustomer,
          if (securityPin != null && securityPin.isNotEmpty)
            'security_pin': securityPin,
          'idempotency_key': paymentOperationId,
        };

        final receipt = await apiService.payOrder(targetOrderId, payload);
        await LocalStore.instance
            .remove(_paymentOperationStoreKey(targetOrderId));

        if (receipt['fully_settled'] != false) {
          _selectedTable = null;
          _cart = [];
          _activeOrderId = null;
          _activeBillNo = null;
          _activeDiscount = 0.0;
          _selectedCustomer = null;
          _orderVoucherId = null;
          _lineVouchers.clear();
          _discountPlan = null;
        } else {
          await reloadActiveOrder();
        }

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
    });
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

  // Các thao tác GHI đang chạy, khoá theo hành động. Chặn bấm dồn (vd "Kết ca"
  // lúc mạng lag) tạo nhiều request/nhiều modal chồng nhau. Request có thể lâu
  // hơn mọi cửa sổ debounce nên PHẢI khoá theo "đang bay", không theo thời gian.
  final Set<String> _inFlightActions = {};
  bool _disposed = false;

  /// Chạy [action] đúng MỘT lần cho mỗi [key] tại một thời điểm. Lần bấm sau khi
  /// lần trước CHƯA xong sẽ bị chặn (ném) thay vì gọi API/đẩy modal lần nữa.
  Future<T> singleFlight<T>(String key, Future<T> Function() action) async {
    if (_disposed) throw StateError('Provider đã dispose.');
    if (_inFlightActions.contains(key)) {
      throw Exception('Đang xử lý, vui lòng chờ trong giây lát.');
    }
    _inFlightActions.add(key);
    try {
      return await action();
    } finally {
      _inFlightActions.remove(key);
    }
  }

  bool isActionInFlight(String key) => _inFlightActions.contains(key);

  Future<void> openShiftCounts({
    required String shiftKey,
    required Map<String, int> counts,
    required int openingCash,
    required bool cashManual,
  }) {
    return singleFlight('shift:open', () async {
      final generation = apiService.authGeneration;
      await apiService.openShiftCounts(
        shiftKey: shiftKey,
        counts: counts,
        openingCash: openingCash,
        cashManual: cashManual,
      );
      if (_disposed || generation != apiService.authGeneration) return;
      await loadShift();
    });
  }

  Future<void> closeShiftCounts({
    required String shiftKey,
    required Map<String, int> counts,
    required int closingCash,
    String? managerOverridePin,
  }) {
    return singleFlight('shift:close', () async {
      final generation = apiService.authGeneration;
      await apiService.closeShiftCounts(
        shiftKey: shiftKey,
        counts: counts,
        closingCash: closingCash,
        managerOverridePin: managerOverridePin,
      );
      if (_disposed || generation != apiService.authGeneration) return;
      await loadShift();
    });
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

  @override
  void dispose() {
    _disposed = true;
    _inFlightActions.clear();
    super.dispose();
  }
}
