import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../models/retail_models.dart';
import '../../providers/auth_provider.dart';
import '../../providers/customer_display_controller.dart';
import '../../providers/pos_provider.dart';
import '../../services/api_service.dart';
import '../../services/socket_service.dart';
import '../../ui/app_theme.dart';
import '../../ui/debouncer.dart';
import '../../ui/format.dart';
import '../../widgets/address_fields.dart';
import '../../widgets/dan_top_bar.dart';
import '../../widgets/resizable_pane.dart';
import '../../widgets/scan_button.dart';
import '../../widgets/tax_lookup.dart';
import '../customer_display/customer_display_screen.dart';
import '../order_history_dialog.dart';
import '../shift_dialog.dart';
import 'checkout_dialog.dart';
import '../../services/black_box.dart';
import '../../utils/translation.dart';

class RetailScreen extends StatefulWidget {
  RetailScreen({super.key});

  @override
  State<RetailScreen> createState() => _RetailScreenState();
}

class _RetailScreenState extends State<RetailScreen> {
  final _searchCtrl = TextEditingController();
  final _barcodeFocus = FocusNode();

  List<Sku> _skus = [];
  List<StockLot> _lots = [];
  List<RetailVoucher> _activeVouchers = [];
  List<RetailCustomer> _customers = [];
  Map<String, dynamic> _operationsConfig = {};
  Map<String, dynamic>? _currentShift;
  final List<RetailSaleTab> _tabs = [RetailSaleTab(id: 1)];
  int _activeTabId = 1;
  int _nextTabId = 1;

  String _search = '';
  bool _inStockOnly = false;
  bool _loading = true;
  String? _error;

  int _skuPage = 1;
  bool _hasMoreSkus = true;
  bool _loadingSkus = false;
  final _skuScrollCtrl = ScrollController();
  final _skuDebouncer = Debouncer(delay: Duration(milliseconds: 300));

  RetailSaleTab get _tab => _tabs.firstWhere(
        (t) => t.id == _activeTabId,
        orElse: () => _tabs.first,
      );

  List<CartLine> get _cart => _tab.cart;
  RetailCustomer? get _customer => _tab.customer;

  bool get _shiftRequired {
    final shifts = _operationsConfig['shifts'];
    if (shifts is Map && shifts['requireOpenShift'] == false) return false;
    return true;
  }

  bool get _salesLocked => _shiftRequired && _currentShift == null;

  final SocketService _socketService = SocketService();
  final Debouncer _socketRefresh = Debouncer();

  // ── Giỏ hàng bán lẻ CHIA SẺ (sync đa thiết bị) ──────────────────────────
  // _cartClientId: id riêng của MÁY này để tự BỎ QUA event do chính mình gây ra
  // (chống ping-pong vô hạn). _applyingRemoteCart: đang áp snapshot của máy khác →
  // KHÔNG đẩy ngược lên server. Đẩy giỏ được debounce để gõ nhanh không spam mạng.
  final String _cartClientId = 'rt${DateTime.now().microsecondsSinceEpoch}';
  bool _applyingRemoteCart = false;
  final Debouncer _cartSyncDebouncer =
      Debouncer(delay: const Duration(milliseconds: 350));

  @override
  void initState() {
    super.initState();
    BlackBox.screen = 'retail';
    _skuScrollCtrl.addListener(_onSkuScroll);
    _load();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      context.read<CustomerDisplayController>().resumeSalesMirror();
      final auth = context.read<AuthProvider>();
      _socketService.connect(
        baseUrl: auth.serverUrl,
        branch: auth.selectedBranchId,
        token: auth.token ?? '',
      );
      _socketService.addListener(_onSocketEvent);
    });
  }

  void _onSkuScroll() {
    if (_skuScrollCtrl.position.pixels >=
        _skuScrollCtrl.position.maxScrollExtent - 200) {
      _loadSkusNextPage();
    }
  }

  Future<void> _loadSkusNextPage({bool isRefresh = false}) async {
    if (_loadingSkus) return;
    if (!isRefresh && !_hasMoreSkus) return;

    setState(() {
      _loadingSkus = true;
      if (isRefresh) {
        _skuPage = 1;
        _skus = [];
        _hasMoreSkus = true;
      }
    });

    try {
      final api = context.read<ApiService>();
      final result = await api.getSkusPaginated(
        page: _skuPage,
        limit: 40,
        q: _search,
        channel: 'retail',
      );

      final itemsData = result['items'] as List? ?? [];
      final total = result['total'] as int? ?? 0;

      final skus = itemsData
          .whereType<Map>()
          .map((e) => Sku.fromJson(Map<String, dynamic>.from(e)))
          .toList();

      if (!mounted) return;
      setState(() {
        _skus.addAll(skus);
        _hasMoreSkus = _skus.length < total;
        if (skus.isNotEmpty) {
          _skuPage++;
        }
        _loadingSkus = false;
      });
    } catch (e) {
      debugPrint("Error loading paginated SKUs: $e");
      if (mounted) {
        setState(() {
          _loadingSkus = false;
        });
      }
    }
  }

  void _onSocketEvent(String event, dynamic payload) {
    if (!mounted) return;
    if (event == 'retail:cart') {
      _applyRemoteCart(payload);
      return;
    }
    if (event == 'inventory:updated' ||
        event == 'vouchers:updated' ||
        event == 'payment:done' ||
        event == 'shift:updated' ||
        event == 'settings:updated' ||
        event == kSyncReconnected) {
      _socketRefresh(() {
        if (mounted) _reloadLight();
      });
    }
  }

  @override
  void dispose() {
    try {
      context.read<CustomerDisplayController>().clearRetailMirror();
    } catch (_) {}
    _skuScrollCtrl.removeListener(_onSkuScroll);
    _skuScrollCtrl.dispose();
    _skuDebouncer.dispose();
    _socketRefresh.dispose();
    _cartSyncDebouncer.dispose();
    _socketService.removeListener(_onSocketEvent);
    _searchCtrl.dispose();
    _barcodeFocus.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final api = context.read<ApiService>();
      final pos = context.read<PosProvider>();
      final results = await Future.wait<dynamic>([
        api.getSkusPaginated(page: 1, limit: 40, q: _search, channel: 'retail'),
        api.getOperationsConfig().catchError((_) => <String, dynamic>{}),
        api.getRetailLots().catchError((_) => <dynamic>[]),
        api.getActiveVouchers().catchError((_) => <dynamic>[]),
        api.getCustomers().catchError((_) => <dynamic>[]),
        api.getCurrentShift().catchError((_) => null),
        pos.loadShift(),
        api.getRetailCarts().catchError((_) => <dynamic>[]),
      ]);
      final skuPageResult = results[0] as Map<String, dynamic>;
      final skuRows = skuPageResult['items'] as List? ?? [];
      final skuTotal = skuPageResult['total'] as int? ?? 0;
      final operations = results[1] as Map<String, dynamic>;
      final lotRows = results[2] as List;
      final activeRows = results[3] as List;
      final customerRows = results[4] as List;
      final shift = results[5] as Map<String, dynamic>?;
      if (!mounted) return;
      final parsedSkus = skuRows
          .whereType<Map>()
          .map((e) => Sku.fromJson(Map<String, dynamic>.from(e)))
          .toList();
      final parsedLots = lotRows
          .whereType<Map>()
          .map((e) => StockLot.fromJson(Map<String, dynamic>.from(e)))
          .toList();
      final parsedVouchers = activeRows
          .whereType<Map>()
          .map((e) => RetailVoucher.fromJson(Map<String, dynamic>.from(e)))
          .toList();
      final parsedCustomers = customerRows
          .whereType<Map>()
          .map((e) => RetailCustomer.fromJson(Map<String, dynamic>.from(e)))
          .toList();
      if (!mounted) return;
      setState(() {
        _operationsConfig = operations;
        _skus = parsedSkus;
        _skuPage = 2;
        _hasMoreSkus = _skus.length < skuTotal;
        _lots = parsedLots;
        _activeVouchers = parsedVouchers;
        _customers = parsedCustomers;
        _currentShift = shift;
        for (final t in _tabs) {
          if (t.orderVoucherId != null &&
              !_activeVouchers.any((v) => v.id == t.orderVoucherId)) {
            t.orderVoucherId = null;
          }
          for (final line in t.cart) {
            if (line.voucherId != null &&
                !_activeVouchers.any((v) => v.id == line.voucherId)) {
              line.voucherId = null;
            }
          }
        }
        _loading = false;
      });
      // Dựng lại các giỏ CHIA SẺ đang mở của chi nhánh (máy khác đã tạo trước đó).
      // _applyRemoteCart tự chặn sync ngược; sau đó đẩy màn khách trong trạng thái
      // "đang áp" để KHÔNG vô tình đẩy giỏ rỗng đè lên giỏ máy khác lúc mở màn.
      final cartRows = results[7] as List;
      for (final c in cartRows) {
        if (c is Map) _applyRemoteCart(Map<String, dynamic>.from(c));
      }
      _applyingRemoteCart = true;
      _pushCustomerDisplay();
      _applyingRemoteCart = false;
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.toString().replaceFirst('Exception: ', '');
        _loading = false;
      });
    }
  }

  Future<void> _reloadLight() async {
    final api = context.read<ApiService>();
    final results = await Future.wait([
      api.getSkusPaginated(page: 1, limit: 40, q: _search, channel: 'retail'),
      api.getRetailLots().catchError((_) => <dynamic>[]),
      api.getActiveVouchers().catchError((_) => <dynamic>[]),
      api.getCustomers().catchError((_) => <dynamic>[]),
      api.getCurrentShift().catchError((_) => null),
    ]);
    final skuPageResult = results[0] as Map<String, dynamic>;
    final skuRows = skuPageResult['items'] as List? ?? [];
    final skuTotal = skuPageResult['total'] as int? ?? 0;

    final parsedSkus = skuRows
        .whereType<Map>()
        .map((e) => Sku.fromJson(Map<String, dynamic>.from(e)))
        .toList();
    final parsedLots = (results[1] as List)
        .whereType<Map>()
        .map((e) => StockLot.fromJson(Map<String, dynamic>.from(e)))
        .toList();
    final parsedVouchers = (results[2] as List)
        .whereType<Map>()
        .map((e) => RetailVoucher.fromJson(Map<String, dynamic>.from(e)))
        .toList();
    final parsedCustomers = (results[3] as List)
        .whereType<Map>()
        .map((e) => RetailCustomer.fromJson(Map<String, dynamic>.from(e)))
        .toList();
    if (!mounted) return;
    setState(() {
      _skus = parsedSkus;
      _skuPage = 2;
      _hasMoreSkus = _skus.length < skuTotal;
      _lots = parsedLots;
      _activeVouchers = parsedVouchers;
      _customers = parsedCustomers;
      _currentShift = results[4] as Map<String, dynamic>?;
      for (final t in _tabs) {
        if (t.orderVoucherId != null &&
            !_activeVouchers.any((v) => v.id == t.orderVoucherId)) {
          t.orderVoucherId = null;
        }
        for (final line in t.cart) {
          if (line.voucherId != null &&
              !_activeVouchers.any((v) => v.id == line.voucherId)) {
            line.voucherId = null;
          }
        }
      }
    });
    _pushCustomerDisplay();
  }

  void _toast(String m, {bool error = false}) =>
      appToast(context, m, isError: error);

  void _pushCustomerDisplay() {
    if (!mounted) return;
    try {
      final totals = _totals();
      context.read<CustomerDisplayController>().showRetailCart(
        items: [
          for (final c in _cart)
            CustomerLine(
              name: c.sku.name,
              options: _lineOptions(c),
              promoText: _lineAppliedPromoText(c),
              qty: c.qty,
              unitPrice: c.sku.price,
              lineTotal: c.lineTotal,
            ),
        ],
        subtotal: totals.subtotal,
        discount: totals.productDiscount +
            totals.orderDiscount +
            totals.customerDiscount +
            totals.manualDiscount,
        tax: 0,
        total: totals.total,
        discountLabel: t('Khuyến mãi / giảm giá'),
      );
    } catch (_) {}
    // Mọi thay đổi giỏ (thêm/sửa/xóa món, khách, voucher, giảm giá) đều đi qua đây
    // → đẩy giỏ lên server để máy khác thấy. Bỏ qua khi đang ÁP snapshot máy khác.
    if (!_applyingRemoteCart) _syncCart();
  }

  // Snapshot giỏ ĐANG mở — đủ để máy khác dựng lại dòng hàng mà không cần SKU đã tải.
  Map<String, dynamic> _cartSnapshot(RetailSaleTab tab) => {
        'lines': [
          for (final c in tab.cart)
            {
              'sku': c.sku.toJson(),
              'qty': c.qty,
              'lot_id': c.lotId,
              'voucher_id': c.voucherId,
            }
        ],
        'customer': tab.customer?.toCheckoutCustomer(),
        'order_voucher_id': tab.orderVoucherId,
        'manual_discount': tab.manualDiscount.round(),
      };

  // Đẩy snapshot tab đang mở lên server (debounce) → server phát 'retail:cart'.
  void _syncCart() {
    final tab = _tab;
    final slot = tab.id;
    _cartSyncDebouncer(() {
      if (!mounted) return;
      context
          .read<ApiService>()
          .saveRetailCart(slot, _cartSnapshot(tab), device: _cartClientId)
          .catchError((_) => <String, dynamic>{});
    });
  }

  // Áp snapshot giỏ do MÁY KHÁC gửi tới (tự bỏ qua event của chính mình).
  void _applyRemoteCart(dynamic payload) {
    if (payload is! Map) return;
    if ((payload['device'] ?? '').toString() == _cartClientId) return;
    final slot = (payload['slot'] as num?)?.toInt() ?? 0;
    if (slot < 1) return;
    _applyingRemoteCart = true;
    try {
      RetailSaleTab? tab;
      for (final tb in _tabs) {
        if (tb.id == slot) {
          tab = tb;
          break;
        }
      }
      final cleared = payload['cleared'] == true;
      if (cleared) {
        if (tab == null) return;
        final target = tab;
        setState(() {
          target.cart.clear();
          target.customer = null;
          target.orderVoucherId = null;
          target.manualDiscount = 0;
        });
      } else {
        if (tab == null) {
          tab = RetailSaleTab(id: slot);
          _tabs.add(tab);
          if (slot > _nextTabId) _nextTabId = slot;
        }
        final target = tab;
        final lines = <CartLine>[];
        for (final raw in (payload['lines'] as List? ?? const [])) {
          if (raw is! Map) continue;
          final skuMap = raw['sku'];
          if (skuMap is! Map) continue;
          final sku = Sku.fromJson(Map<String, dynamic>.from(skuMap));
          final lot = raw['lot_id']?.toString();
          final vou = raw['voucher_id']?.toString();
          lines.add(CartLine(
            sku,
            (raw['qty'] as num?)?.toInt() ?? 1,
            lotId: (lot == null || lot.isEmpty) ? null : lot,
            voucherId: (vou == null || vou.isEmpty) ? null : vou,
          ));
        }
        final custMap = payload['customer'];
        final ovId = payload['order_voucher_id']?.toString();
        setState(() {
          target.cart
            ..clear()
            ..addAll(lines);
          target.customer = custMap is Map
              ? RetailCustomer.fromJson(Map<String, dynamic>.from(custMap))
              : null;
          target.orderVoucherId = (ovId == null || ovId.isEmpty) ? null : ovId;
          target.manualDiscount =
              (payload['manual_discount'] as num?)?.toDouble() ?? 0;
        });
      }
      if (slot == _activeTabId) _pushCustomerDisplay();
    } finally {
      _applyingRemoteCart = false;
    }
  }

  String _lineOptions(CartLine line) {
    final lot = _selectedLot(line);
    if (lot == null) return '';
    final parts = <String>[
      if (lot.lotNo.isNotEmpty) 'Lot ${lot.lotNo}',
      if (lot.expiryDate.isNotEmpty) 'HSD ${lot.expiryDate}',
    ];
    return parts.join(' • ');
  }

  List<Sku> get _filteredSkus {
    final q = foldSearch(_search);
    var list = _skus.toList();
    if (_inStockOnly) list = list.where((s) => s.stock > 0).toList();
    if (q.isNotEmpty) {
      list = list
          .where((s) =>
              searchMatches(s.name, q) ||
              searchMatches(s.barcode, q) ||
              searchMatches(s.category, q))
          .toList();
    }
    return list;
  }

  List<StockLot> _lotsForSku(Sku sku) => _lots
      .where((l) =>
          l.itemType == 'sku' &&
          l.itemId == sku.id &&
          (sku.warehouseId.isEmpty || l.warehouseId == sku.warehouseId))
      .toList();

  StockLot? _selectedLot(CartLine line) {
    if (line.lotId == null || line.lotId!.isEmpty) return null;
    for (final lot in _lots) {
      if (lot.id == line.lotId) return lot;
    }
    return null;
  }

  StockLot? _defaultLot(Sku sku) {
    final rows = _lotsForSku(sku);
    return rows.isEmpty ? null : rows.first;
  }

  num _availableFor(CartLine line) {
    final lot = _selectedLot(line);
    if (lot != null) return lot.qtyOnHand;
    return line.sku.stock;
  }

  void _addToCart(Sku sku) {
    if (_salesLocked) {
      _toast(t('Cần mở ca làm việc trước khi bán hàng.'), error: true);
      _openShiftDialog();
      return;
    }
    if (sku.stock <= 0) {
      _toast(t('${sku.name} đã hết hàng'), error: true);
      return;
    }
    final lot = _defaultLot(sku);
    final lotId = lot?.id;
    setState(() {
      final existing =
          _cart.indexWhere((c) => c.sku.id == sku.id && c.lotId == lotId);
      if (existing >= 0) {
        final line = _cart[existing];
        if (line.qty < _availableFor(line)) {
          line.qty++;
        } else {
          _toast(t('Không đủ tồn cho lô đã chọn'), error: true);
        }
      } else {
        _cart.add(CartLine(sku, 1, lotId: lotId));
      }
    });
    _pushCustomerDisplay();
  }

  Future<void> _submitSearch(String raw) async {
    final q = raw.trim();
    if (q.isEmpty) return;
    final local = _skus.where((s) => s.barcode == q).toList();
    if (local.isNotEmpty) {
      _addToCart(local.first);
      _clearSearch();
      return;
    }
    if (RegExp(r'^\d+$').hasMatch(q)) {
      try {
        final m = await context.read<ApiService>().getSkuByBarcode(q);
        if (m != null) {
          _addToCart(Sku.fromJson(m));
          _clearSearch();
          return;
        }
      } catch (_) {
        // Fall through to keyword matching.
      }
    }
    final folded = foldSearch(q);
    final matches = _skus
        .where((s) => searchMatches(s.name, folded) || s.barcode == q)
        .toList();
    if (matches.length == 1) {
      _addToCart(matches.first);
      _clearSearch();
    } else {
      _toast(
          matches.isEmpty
              ? t('Không tìm thấy sản phẩm $q')
              : t('Có ${matches.length} sản phẩm trùng khớp, hãy chạm sản phẩm cần bán'),
          error: matches.isEmpty);
    }
    _barcodeFocus.requestFocus();
  }

  void _clearSearch() {
    _searchCtrl.clear();
    setState(() => _search = '');
    _loadSkusNextPage(isRefresh: true);
    _barcodeFocus.requestFocus();
  }

  void _changeQty(CartLine line, int delta) {
    setState(() {
      final next = line.qty + delta;
      if (next <= 0) {
        _cart.remove(line);
      } else if (next <= _availableFor(line)) {
        line.qty = next;
      } else {
        _toast(t('Không đủ tồn cho lô đã chọn'), error: true);
      }
    });
    _pushCustomerDisplay();
  }

  void _changeLot(CartLine line, String? lotId) {
    setState(() {
      line.lotId = lotId == null || lotId.isEmpty ? null : lotId;
      line.voucherId = null;
      final available = _availableFor(line).floor();
      if (available > 0 && line.qty > available) line.qty = available;
    });
    _pushCustomerDisplay();
  }

  RetailVoucher? _voucherById(String? id) {
    if (id == null || id.isEmpty) return null;
    for (final v in _usableVouchers) {
      if (v.id == id) return v;
    }
    return null;
  }

  List<RetailVoucher> get _usableVouchers =>
      _activeVouchers.where((v) => v.usableForCustomer(_customer)).toList();

  String _promoLabelForSku(Sku sku) {
    // Khớp voucher gán đúng SKU hoặc t('Mọi sản phẩm') (all_sku); SKU cụ thể
    // ưu tiên hiển thị trước.
    final matches =
        _usableVouchers.where((v) => v.appliesToSku(sku.id)).toList();
    if (matches.isEmpty) return '';
    matches.sort((a, b) {
      final ad = a.amountFor(sku.price, qty: 1);
      final bd = b.amountFor(sku.price, qty: 1);
      if (bd != ad) return bd.compareTo(ad);
      if (a.isSku != b.isSku) return a.isSku ? -1 : 1;
      return 0;
    });
    return matches.first.valueLabel;
  }

  String? _lotNoOf(CartLine line) => _selectedLot(line)?.lotNo;

  List<RetailVoucher> _lineVoucherCandidates(CartLine line) {
    final lotNo = _lotNoOf(line);
    return _usableVouchers
        .where((v) =>
            (v.isSku || v.isAllSku) &&
            v.appliesToSku(line.sku.id, lotNo: lotNo))
        .toList();
  }

  RetailVoucher? _selectedLineVoucher(CartLine line) {
    final id = line.voucherId;
    if (id == null || id.isEmpty) return null;
    return _lineVoucherCandidates(line).where((v) => v.id == id).firstOrNull;
  }

  num _lineVoucherAmount(CartLine line, RetailVoucher v) {
    final base = line.lineTotal;
    if (base <= 0) return 0;
    if (v.type == 'buy_x_get_1') {
      final x = v.value.round().clamp(1, 1000000);
      final freeUnits = line.qty ~/ (x + 1);
      return (freeUnits * line.sku.price).clamp(0, base);
    }
    if (base < v.minTotal) return 0;
    return v.amountFor(base, qty: line.qty).clamp(0, base);
  }

  String _lineAppliedPromoText(CartLine line) {
    final v = _selectedLineVoucher(line);
    if (v == null) return '';
    final amount = _lineVoucherAmount(line, v);
    if (amount <= 0) return '';
    if (v.type == 'buy_x_get_1') {
      final x = v.value.round().clamp(1, 1000000);
      final freeUnits = line.qty ~/ (x + 1);
      return t('${v.displayName}: tặng $freeUnits ${line.sku.unit}');
    }
    return t('${v.displayName}: giảm ${Fmt.money(amount)}');
  }

  _RetailTotals _totals() {
    final subtotal = _cart.fold<num>(0, (s, c) => s + c.lineTotal);
    num productDiscount = 0;
    for (final line in _cart) {
      final v = _selectedLineVoucher(line);
      if (v != null) productDiscount += _lineVoucherAmount(line, v);
    }
    final afterProduct = (subtotal - productDiscount).clamp(0, double.infinity);
    final orderVoucher = _voucherById(_tab.orderVoucherId);
    final orderDiscount =
        orderVoucher != null && afterProduct >= orderVoucher.minTotal
            ? orderVoucher.amountFor(afterProduct)
            : 0;
    final afterVoucher =
        (afterProduct - orderDiscount).clamp(0, double.infinity);
    final customerDiscount = _customer?.perkAmount(afterVoucher) ?? 0;
    final afterCustomer =
        (afterVoucher - customerDiscount).clamp(0, double.infinity);
    final manualDiscount = 0;
    final total = afterCustomer.clamp(0, double.infinity);
    return _RetailTotals(
      subtotal: subtotal,
      productDiscount: productDiscount,
      orderDiscount: orderDiscount,
      customerDiscount: customerDiscount,
      manualDiscount: manualDiscount,
      total: total,
      orderVoucher: orderVoucher,
    );
  }

  Future<void> _checkout() async {
    if (_cart.isEmpty) return;
    if (_salesLocked) {
      _toast(t('Cần mở ca làm việc trước khi bán hàng.'), error: true);
      _openShiftDialog();
      return;
    }
    final totals = _totals();
    final receipt = await showDialog<Map<String, dynamic>>(
      context: context,
      builder: (_) => CheckoutDialog(
        api: context.read<ApiService>(),
        cart: _cart.map((c) => c.copy()).toList(),
        operationsConfig: _operationsConfig,
        invoiceLabel: 'RT${_tab.id.toString().padLeft(2, '0')}',
        customer: _customer,
        voucher: totals.orderVoucher,
        subtotal: totals.subtotal,
        productDiscount: totals.productDiscount,
        orderDiscount: totals.orderDiscount,
        customerDiscount: totals.customerDiscount,
        manualDiscount: 0,
        total: totals.total,
        channelLabel: 'Checkout',
      ),
    );
    if (receipt != null) {
      setState(() {
        _cart.clear();
        _tab.customer = null;
        _tab.orderVoucherId = null;
        _tab.manualDiscount = 0;
      });
      _pushCustomerDisplay();
      _toast('Đã thanh toán ${Fmt.money(receipt['total'] ?? totals.total)}');
      final printError = '${receipt['print_error'] ?? ''}'.trim();
      if (printError.isNotEmpty) {
        _toast('Đã thanh toán, nhưng chưa in được: $printError', error: true);
      }
      await _reloadLight();
    }
  }

  Future<void> _openHistory() async {
    // Web-parity t("Lịch sử bán hàng"): search + channel filter + two-pane
    // receipt view (same dialog as POS), with retail refund enabled.
    await showDialog<void>(
      context: context,
      builder: (_) => OrderHistoryDialog(
        api: context.read<ApiService>(),
        allowRefund: true,
        onAfterChange: _reloadLight,
      ),
    );
    if (mounted) await _reloadLight();
  }

  Future<void> _openShiftDialog() async {
    final pos = context.read<PosProvider>();
    final api = context.read<ApiService>();
    await pos.loadShift();
    if (!mounted) return;
    await showDialog<void>(context: context, builder: (_) => ShiftDialog());
    if (!mounted) return;
    await pos.loadShift();
    final shift = await api.getCurrentShift().catchError((_) => null);
    if (mounted) setState(() => _currentShift = shift);
  }

  Future<void> _openCustomerPicker() async {
    final picked = await showDialog<Object?>(
      context: context,
      builder: (_) => _CustomerPickerDialog(
        api: context.read<ApiService>(),
        customers: _customers,
        selected: _customer,
      ),
    );
    if (!mounted) return;
    if (picked == null) return;
    setState(() => _tab.customer = picked is RetailCustomer ? picked : null);
    _pushCustomerDisplay();
    await _reloadCustomers();
  }

  Future<void> _reloadCustomers() async {
    final rows = await context
        .read<ApiService>()
        .getCustomers()
        .catchError((_) => <dynamic>[]);
    if (!mounted) return;
    setState(() {
      _customers = rows
          .whereType<Map>()
          .map((e) => RetailCustomer.fromJson(Map<String, dynamic>.from(e)))
          .toList();
    });
  }

  Future<void> _pickOrderVoucher() async {
    final rows = _usableVouchers
        .where((v) => v.isOrder && v.code.trim().isNotEmpty)
        .toList();
    final selected = await showDialog<String?>(
      context: context,
      builder: (_) => _ExternalVoucherDialog(
        vouchers: rows,
        selected: _voucherById(_tab.orderVoucherId),
        billTotal: _totals().subtotal,
      ),
    );
    if (selected == null) return;
    setState(() => _tab.orderVoucherId = selected.isEmpty ? null : selected);
    _pushCustomerDisplay();
  }

  Future<void> _pickLineVoucher(CartLine line) async {
    final rows = _lineVoucherCandidates(line);
    if (rows.isEmpty) return;
    final selected = await showDialog<String?>(
      context: context,
      builder: (ctx) => SimpleDialog(
        backgroundColor: DanColors.surface,
        title: Text(t('Khuyến mãi sản phẩm')),
        children: [
          SimpleDialogOption(
            onPressed: () => Navigator.of(ctx).pop(''),
            child: Text(t('Không áp dụng CTKM')),
          ),
          for (final v in rows)
            SimpleDialogOption(
              onPressed: () => Navigator.of(ctx).pop(v.id),
              child: Row(
                children: [
                  Expanded(
                    child: Text(v.displayName,
                        maxLines: 2, overflow: TextOverflow.ellipsis),
                  ),
                  SizedBox(width: 10),
                  Text(
                    v.type == 'buy_x_get_1'
                        ? v.valueLabel
                        : '-${Fmt.money(_lineVoucherAmount(line, v))}',
                    style: TextStyle(
                        color: DanColors.done, fontWeight: FontWeight.w900),
                  ),
                ],
              ),
            ),
        ],
      ),
    );
    if (selected == null) return;
    setState(() => line.voucherId = selected.isEmpty ? null : selected);
    _pushCustomerDisplay();
  }

  void _addTab() {
    setState(() {
      _nextTabId++;
      final tab = RetailSaleTab(id: _nextTabId);
      _tabs.add(tab);
      _activeTabId = tab.id;
    });
    _pushCustomerDisplay();
  }

  Future<void> _closeTab(RetailSaleTab tab) async {
    // Giỏ đang có món → BẮT BUỘC xác nhận trước khi xóa (chống lỡ tay mất giỏ).
    if (tab.cart.isNotEmpty) {
      final ok = await _confirmClearCart(tab);
      if (ok != true) return;
    }
    if (_tabs.length == 1) {
      setState(() {
        tab.cart.clear();
        tab.customer = null;
        tab.orderVoucherId = null;
        tab.manualDiscount = 0;
      });
      _pushCustomerDisplay(); // đẩy giỏ rỗng → server tự giải phóng slot này
      return;
    }
    final removedSlot = tab.id;
    setState(() {
      final idx = _tabs.indexOf(tab);
      _tabs.remove(tab);
      if (_activeTabId == tab.id) {
        _activeTabId = _tabs[(idx - 1).clamp(0, _tabs.length - 1)].id;
      }
    });
    // pushCustomerDisplay chỉ sync tab ĐANG mở → phải giải phóng slot vừa đóng riêng.
    context
        .read<ApiService>()
        .clearRetailCart(removedSlot, device: _cartClientId)
        .catchError((_) {});
    _pushCustomerDisplay();
  }

  // Hộp xác nhận xóa giỏ hàng (tiếng Việt qua t() để đồng bộ song ngữ toàn app).
  Future<bool?> _confirmClearCart(RetailSaleTab tab) => showDialog<bool>(
        context: context,
        builder: (ctx) => AlertDialog(
          backgroundColor: DanColors.surface,
          title: Text(t('Xóa giỏ hàng?'),
              style:
                  const TextStyle(fontWeight: FontWeight.w900, fontSize: 18)),
          content: Text(
              t('${tab.title} đang có ${tab.cart.length} mặt hàng. Xóa toàn bộ giỏ này? Thao tác không thể hoàn tác.'),
              style: const TextStyle(fontSize: 14, height: 1.4)),
          actions: [
            TextButton(
                onPressed: () => Navigator.of(ctx).pop(false),
                child: Text(t('Giữ lại'))),
            FilledButton(
                style: FilledButton.styleFrom(backgroundColor: DanColors.late),
                onPressed: () => Navigator.of(ctx).pop(true),
                child: Text(t('Xóa giỏ'))),
          ],
        ),
      );

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final user = auth.currentUser;
    final branch = auth.selectedBranch;

    return Scaffold(
      backgroundColor: DanColors.bg,
      appBar: PreferredSize(
        preferredSize: Size.fromHeight(56),
        child: RepaintBoundary(
          child: DanModuleTopBar(
            brandName: branch.name.isNotEmpty ? branch.name : branch.id,
            title: t('Bán lẻ (Retail)'),
            subtitle: '',
            titleIcon: Icons.shopping_cart_outlined,
            userName: user?.name ?? '—',
            userRole: roleLabel(user?.role ?? ''),
            online: true,
            onBack: () => Navigator.of(context).maybePop(),
            onLogout: () => auth.logout(),
            actions: [
              DanTopBarButton(
                onPressed: _openShiftDialog,
                label:
                    _currentShift == null ? t('Ca: chưa mở') : t('Ca: đang mở'),
                danger: _currentShift == null,
                success: _currentShift != null,
                minWidth: 118,
              ),
              DanTopBarButton(
                onPressed: _openHistory,
                icon: Icons.history,
                label: t('Lịch sử / Đổi trả'),
              ),
            ],
          ),
        ),
      ),
      body: Column(
        children: [
          RepaintBoundary(child: _tabBar()),
          if (_salesLocked) _shiftWarning(),
          Expanded(
            child: LayoutBuilder(builder: (context, c) {
              final compact = c.maxWidth < 980;
              if (compact) {
                return Column(
                  children: [
                    Expanded(child: RepaintBoundary(child: _productArea())),
                    Divider(height: 1, color: DanColors.border),
                    SizedBox(
                        height: 360,
                        child: RepaintBoundary(child: _cartPanel())),
                  ],
                );
              }
              return Row(
                children: [
                  Expanded(child: RepaintBoundary(child: _productArea())),
                  ResizablePane(
                    storageKey: 'retail',
                    maxAvailable: c.maxWidth,
                    minWidth: 360,
                    maxWidth: 760,
                    defaultWidth: 500,
                    child: RepaintBoundary(child: _cartPanel()),
                  ),
                ],
              );
            }),
          ),
        ],
      ),
    );
  }

  Widget _tabBar() {
    return Container(
      height: 56,
      padding: EdgeInsets.symmetric(horizontal: 14, vertical: 9),
      color: DanColors.surface2,
      child: Row(
        children: [
          Expanded(
            child: ListView.separated(
              scrollDirection: Axis.horizontal,
              itemCount: _tabs.length,
              separatorBuilder: (_, __) => SizedBox(width: 8),
              itemBuilder: (_, i) {
                final tab = _tabs[i];
                final active = tab.id == _activeTabId;
                return InkWell(
                  onTap: () {
                    setState(() => _activeTabId = tab.id);
                    _pushCustomerDisplay();
                  },
                  borderRadius: BorderRadius.circular(DanRadius.sm),
                  child: Container(
                    padding: EdgeInsets.symmetric(horizontal: 12),
                    decoration: BoxDecoration(
                      color: active ? DanColors.brand : DanColors.surface,
                      borderRadius: BorderRadius.circular(DanRadius.sm),
                      border: Border.all(
                          color: active ? DanColors.brand : DanColors.border2),
                    ),
                    child: Row(
                      children: [
                        Icon(Icons.receipt_long_outlined,
                            size: 15,
                            color: active ? Colors.white : DanColors.muted),
                        SizedBox(width: 7),
                        Text(tab.title,
                            style: TextStyle(
                                color: active ? Colors.white : DanColors.text,
                                fontWeight: FontWeight.w900,
                                fontSize: 12.5)),
                        if (tab.cart.isNotEmpty) ...[
                          SizedBox(width: 6),
                          _CountDot('${tab.cart.length}', active),
                        ],
                        SizedBox(width: 5),
                        InkWell(
                          onTap: () => _closeTab(tab),
                          borderRadius: BorderRadius.circular(99),
                          child: Icon(Icons.close,
                              size: 15,
                              color: active ? Colors.white70 : DanColors.faint),
                        ),
                      ],
                    ),
                  ),
                );
              },
            ),
          ),
          SizedBox(width: 8),
          IconButton.outlined(
            onPressed: _addTab,
            icon: Icon(Icons.add),
            tooltip: t('Thêm hóa đơn'),
          ),
        ],
      ),
    );
  }

  Widget _shiftWarning() {
    return Material(
      color: DanColors.late.withValues(alpha: .08),
      child: InkWell(
        onTap: _openShiftDialog,
        child: Container(
          width: double.infinity,
          padding: EdgeInsets.symmetric(horizontal: 16, vertical: 9),
          child: Row(
            children: [
              Icon(Icons.lock_clock_outlined, color: DanColors.late, size: 18),
              SizedBox(width: 8),
              Text(t('Cần mở ca làm việc trước khi bán retail.'),
                  style: TextStyle(
                      color: DanColors.late, fontWeight: FontWeight.w800)),
            ],
          ),
        ),
      ),
    );
  }

  Widget _productArea() {
    final list = _filteredSkus;
    final serverUrl = context.read<AuthProvider>().serverUrl;
    final narrow = MediaQuery.sizeOf(context).width < 560;
    return Column(
      children: [
        Padding(
          padding: EdgeInsets.fromLTRB(14, 12, 14, 10),
          child: Row(
            children: [
              Expanded(
                child: TextField(
                  controller: _searchCtrl,
                  focusNode: _barcodeFocus,
                  decoration: InputDecoration(
                    hintText:
                        t('Tìm sản phẩm hoặc quét/nhập mã vạch rồi Enter...'),
                    // Tablet/điện thoại: bấm để mở camera quét; desktop: chỉ là
                    // icon gợi ý (máy quét USB gõ thẳng vào ô).
                    prefixIcon: ScanIconButton(
                      title: t('Quét sản phẩm'),
                      onCode: (code) {
                        _searchCtrl.text = code;
                        _submitSearch(code);
                      },
                    ),
                    isDense: true,
                  ),
                  onChanged: (v) {
                    setState(() => _search = v);
                    _skuDebouncer(() {
                      _loadSkusNextPage(isRefresh: true);
                    });
                  },
                  onSubmitted: _submitSearch,
                ),
              ),
              SizedBox(width: 8),
              narrow
                  ? IconButton.filled(
                      onPressed: () => _submitSearch(_searchCtrl.text),
                      icon: Icon(Icons.add, size: 18),
                      tooltip: t('Thêm'),
                    )
                  : FilledButton.icon(
                      onPressed: () => _submitSearch(_searchCtrl.text),
                      icon: Icon(Icons.add, size: 18),
                      label: Text(t('Thêm')),
                    ),
              SizedBox(width: 8),
              FilterChip(
                label: Text(t('Còn hàng')),
                selected: _inStockOnly,
                onSelected: (v) => setState(() => _inStockOnly = v),
              ),
            ],
          ),
        ),
        Padding(
          padding: EdgeInsets.fromLTRB(16, 0, 16, 7),
          child: Align(
            alignment: Alignment.centerLeft,
            child: Text(
                '${list.length} ${t('SP')} (${t('hiện')} ${_skus.length})',
                style: TextStyle(fontSize: 11.5, color: DanColors.muted)),
          ),
        ),
        Expanded(
          child: _loading && _skus.isEmpty
              ? Center(child: CircularProgressIndicator())
              : _error != null && _skus.isEmpty
                  ? Center(
                      child: Text(t('Chưa có sản phẩm'),
                          style: TextStyle(color: DanColors.faint)),
                    )
                  : list.isEmpty
                      ? Center(
                          child: Text(t('Không có sản phẩm'),
                              style: TextStyle(color: DanColors.faint)))
                      : GridView.builder(
                          controller: _skuScrollCtrl,
                          padding: EdgeInsets.fromLTRB(14, 0, 14, 14),
                          gridDelegate:
                              SliverGridDelegateWithMaxCrossAxisExtent(
                            maxCrossAxisExtent: narrow ? 132 : 160,
                            mainAxisExtent: narrow ? 192 : 206,
                            crossAxisSpacing: 10,
                            mainAxisSpacing: 10,
                          ),
                          itemCount: list.length + (_loadingSkus ? 1 : 0),
                          itemBuilder: (_, i) {
                            if (i >= list.length) {
                              return Center(child: CircularProgressIndicator());
                            }
                            return _SkuCard(
                              sku: list[i],
                              serverUrl: serverUrl,
                              promoLabel: _promoLabelForSku(list[i]),
                              onTap: () => _addToCart(list[i]),
                            );
                          },
                        ),
        ),
      ],
    );
  }

  Widget _cartPanel() {
    final totals = _totals();
    return Container(
      color: DanColors.surface,
      child: Column(
        children: [
          Padding(
            padding: EdgeInsets.fromLTRB(16, 14, 12, 10),
            child: Row(
              children: [
                Icon(Icons.shopping_cart_outlined,
                    size: 18, color: DanColors.muted),
                SizedBox(width: 8),
                Text(t('Giỏ hàng'),
                    style:
                        TextStyle(fontSize: 16, fontWeight: FontWeight.w900)),
                SizedBox(width: 8),
                Text('${_cart.length} ${t('mặt hàng')}',
                    style: TextStyle(fontSize: 12, color: DanColors.faint)),
                Spacer(),
                if (_cart.isNotEmpty)
                  IconButton(
                    onPressed: () {
                      setState(() {
                        _cart.clear();
                        _tab.manualDiscount = 0;
                        _tab.orderVoucherId = null;
                      });
                      _pushCustomerDisplay();
                    },
                    icon: Icon(Icons.delete_outline,
                        color: DanColors.late, size: 19),
                    tooltip: t('Xóa giỏ'),
                  ),
              ],
            ),
          ),
          Divider(height: 1, color: DanColors.border),
          Expanded(
            child: _cart.isEmpty
                ? _EmptyCart()
                : ListView.separated(
                    padding: EdgeInsets.all(12),
                    itemCount: _cart.length,
                    separatorBuilder: (_, __) => SizedBox(height: 8),
                    itemBuilder: (_, i) {
                      final line = _cart[i];
                      return _CartRow(
                        line: line,
                        lots: _lotsForSku(line.sku),
                        promoText: _linePromoHint(line),
                        hasPromos: _lineVoucherCandidates(line).isNotEmpty,
                        promoApplied: line.voucherId != null,
                        onPickPromo: () => _pickLineVoucher(line),
                        onLotChanged: (lotId) => _changeLot(line, lotId),
                        onInc: () => _changeQty(line, 1),
                        onDec: () => _changeQty(line, -1),
                        onRemove: () {
                          setState(() => _cart.removeAt(i));
                          _pushCustomerDisplay();
                        },
                      );
                    },
                  ),
          ),
          Divider(height: 1, color: DanColors.border),
          _cartFooter(totals),
        ],
      ),
    );
  }

  String _linePromoHint(CartLine line) {
    final applied = _lineAppliedPromoText(line);
    if (applied.isNotEmpty) return applied;
    RetailVoucher? bestVoucher;
    num best = 0;
    for (final v in _lineVoucherCandidates(line)) {
      final amount = _lineVoucherAmount(line, v);
      if (amount > best) {
        best = amount;
        bestVoucher = v;
      }
    }
    if (bestVoucher == null) {
      final buyX = _lineVoucherCandidates(line)
          .where((v) => v.type == 'buy_x_get_1')
          .firstOrNull;
      return buyX == null ? '' : '${t('Có CTKM')}: ${buyX.displayName}';
    }
    if (bestVoucher.type == 'buy_x_get_1') {
      return '${t('Gợi ý')}: ${bestVoucher.displayName}';
    }
    return '${t('Gợi ý')}: ${bestVoucher.displayName} ${t('giảm')} ${Fmt.money(best)}';
  }

  Widget _cartFooter(_RetailTotals totals) {
    return Padding(
      padding: EdgeInsets.all(16),
      child: Column(
        children: [
          _clickRow(
            t('Khách hàng'),
            _customer?.title.isNotEmpty == true
                ? _customer!.title
                : t('Bán cho người tiêu dùng'),
            _openCustomerPicker,
          ),
          _clickRow(
            'Voucher',
            totals.orderVoucher?.displayName ?? t('Thêm'),
            _pickOrderVoucher,
            accent: totals.orderVoucher != null,
          ),
          SizedBox(height: 6),
          _totalRow(t('Tạm tính'), Fmt.money(totals.subtotal)),
          if (totals.productDiscount > 0)
            _totalRow(t('Khuyến mãi sản phẩm'),
                '-${Fmt.money(totals.productDiscount)}',
                accent: DanColors.doing),
          if (totals.orderDiscount > 0)
            _totalRow(totals.orderVoucher?.name ?? 'Voucher',
                '-${Fmt.money(totals.orderDiscount)}',
                accent: DanColors.done),
          if (totals.customerDiscount > 0)
            _totalRow(t('Ưu đãi khách hàng'),
                '-${Fmt.money(totals.customerDiscount)}',
                accent: DanColors.done),
          Divider(height: 18, color: DanColors.border),
          _totalRow(t('TỔNG CỘNG'), Fmt.money(totals.total), big: true),
          SizedBox(height: 12),
          SizedBox(
            width: double.infinity,
            height: 50,
            child: FilledButton.icon(
              onPressed: _cart.isEmpty || _salesLocked ? null : _checkout,
              icon: Icon(Icons.payments_outlined),
              label: Text('${t('Thanh toán')}  ${Fmt.money(totals.total)}',
                  style: TextStyle(fontSize: 15, fontWeight: FontWeight.w900)),
            ),
          ),
        ],
      ),
    );
  }

  Widget _clickRow(String label, String value, VoidCallback onTap,
      {bool accent = false}) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(DanRadius.sm),
      child: Padding(
        padding: EdgeInsets.symmetric(vertical: 4),
        child: Row(
          children: [
            Expanded(
              child: Text(label,
                  style: TextStyle(
                      fontSize: 12.5,
                      fontWeight: FontWeight.w700,
                      color: DanColors.muted)),
            ),
            SizedBox(width: 12),
            Expanded(
              flex: 2,
              child: Align(
                alignment: Alignment.centerRight,
                child: Text(value,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    textAlign: TextAlign.right,
                    style: TextStyle(
                        fontSize: 12.5,
                        color: accent ? DanColors.done : DanColors.text,
                        fontWeight: FontWeight.w900)),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _totalRow(String label, String value,
      {bool big = false, Color? accent}) {
    return Padding(
      padding: EdgeInsets.symmetric(vertical: 3),
      child: Row(
        children: [
          // Nhãn lấy đúng bề rộng cần (Flexible-loose) nên t("TỔNG CỘNG") không bị
          // cắt "…"; số tiền chiếm phần còn lại và canh phải.
          Flexible(
            child: Text(label,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                    fontSize: big ? 15 : 12.5,
                    fontWeight: big ? FontWeight.w900 : FontWeight.w700,
                    color: big ? DanColors.text : DanColors.muted)),
          ),
          SizedBox(width: 12),
          Expanded(
            child: Align(
              alignment: Alignment.centerRight,
              child: Text(value,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  textAlign: TextAlign.right,
                  style: TextStyle(
                      fontSize: big ? 20 : 13,
                      fontWeight: FontWeight.w900,
                      color:
                          big ? DanColors.brand : (accent ?? DanColors.text))),
            ),
          ),
        ],
      ),
    );
  }
}

class _ExternalVoucherDialog extends StatefulWidget {
  final List<RetailVoucher> vouchers;
  final RetailVoucher? selected;
  final num billTotal;

  _ExternalVoucherDialog({
    required this.vouchers,
    required this.selected,
    required this.billTotal,
  });

  @override
  State<_ExternalVoucherDialog> createState() => _ExternalVoucherDialogState();
}

class _ExternalVoucherDialogState extends State<_ExternalVoucherDialog> {
  late final TextEditingController _codeCtrl;
  String? _error;

  @override
  void initState() {
    super.initState();
    final v = widget.selected;
    _codeCtrl =
        TextEditingController(text: v?.code.isNotEmpty == true ? v!.code : '');
  }

  @override
  void dispose() {
    _codeCtrl.dispose();
    super.dispose();
  }

  RetailVoucher? _match() {
    final q = _codeCtrl.text.trim().toUpperCase();
    if (q.isEmpty) return null;
    for (final v in widget.vouchers) {
      if (v.code.toUpperCase() == q) return v;
    }
    return null;
  }

  void _apply() {
    final q = _codeCtrl.text.trim();
    if (q.isEmpty) {
      Navigator.of(context).pop('');
      return;
    }
    final v = _match();
    if (v == null) {
      setState(
          () => _error = t('Mã voucher không tồn tại hoặc chưa đủ điều kiện.'));
      return;
    }
    Navigator.of(context).pop(v.id);
  }

  @override
  Widget build(BuildContext context) {
    final match = _match();
    return Dialog(
      backgroundColor: DanColors.surface,
      child: ConstrainedBox(
        constraints: BoxConstraints(maxWidth: 620, maxHeight: 620),
        child: Column(
          children: [
            Padding(
              padding: EdgeInsets.fromLTRB(20, 18, 14, 10),
              child: Row(
                children: [
                  Expanded(
                    child: Text(t('Voucher ngoài'),
                        style: TextStyle(
                            fontSize: 19, fontWeight: FontWeight.w900)),
                  ),
                  IconButton(
                    onPressed: () => Navigator.of(context).pop(),
                    icon: Icon(Icons.close, color: DanColors.faint),
                  ),
                ],
              ),
            ),
            Divider(height: 1, color: DanColors.border),
            Expanded(
              child: SingleChildScrollView(
                padding: EdgeInsets.all(18),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Text(
                      t('Nhập mã voucher giấy, voucher công ty, đối tác hoặc UrBox. CTKM sản phẩm chọn bằng icon hộp quà trên từng dòng hàng.'),
                      style: TextStyle(fontSize: 12.5, color: DanColors.muted),
                    ),
                    SizedBox(height: 12),
                    TextField(
                      controller: _codeCtrl,
                      autofocus: true,
                      textCapitalization: TextCapitalization.characters,
                      decoration: InputDecoration(
                        labelText: t('Mã voucher'),
                        prefixIcon: Icon(Icons.local_activity_outlined),
                        errorText: _error,
                      ),
                      onChanged: (_) => setState(() => _error = null),
                      onSubmitted: (_) => _apply(),
                    ),
                    SizedBox(height: 12),
                    if (match != null)
                      _ExternalVoucherTile(
                        voucher: match,
                        billTotal: widget.billTotal,
                        selected: true,
                        onTap: _apply,
                      )
                    else if (widget.vouchers.isEmpty)
                      Padding(
                        padding: EdgeInsets.symmetric(vertical: 24),
                        child: Center(
                          child: Text(
                              t('Không có voucher ngoài đang hoạt động'),
                              style: TextStyle(color: DanColors.faint)),
                        ),
                      )
                    else ...[
                      Text(t('Gợi ý voucher đang hoạt động'),
                          style: TextStyle(
                              fontSize: 12.5, fontWeight: FontWeight.w900)),
                      SizedBox(height: 8),
                      for (final v in widget.vouchers)
                        Padding(
                          padding: EdgeInsets.only(bottom: 8),
                          child: _ExternalVoucherTile(
                            voucher: v,
                            billTotal: widget.billTotal,
                            selected: widget.selected?.id == v.id,
                            onTap: () {
                              _codeCtrl.text =
                                  v.code.isNotEmpty ? v.code : v.name;
                              _apply();
                            },
                          ),
                        ),
                    ],
                  ],
                ),
              ),
            ),
            Divider(height: 1, color: DanColors.border),
            Padding(
              padding: EdgeInsets.all(14),
              child: Row(
                children: [
                  TextButton(
                    onPressed: () => Navigator.of(context).pop(''),
                    child: Text(t('Không dùng')),
                  ),
                  Spacer(),
                  FilledButton.icon(
                    onPressed: _apply,
                    icon: Icon(Icons.check, size: 18),
                    label: Text(t('Áp dụng')),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _ExternalVoucherTile extends StatelessWidget {
  final RetailVoucher voucher;
  final num billTotal;
  final bool selected;
  final VoidCallback onTap;

  _ExternalVoucherTile({
    required this.voucher,
    required this.billTotal,
    required this.selected,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final amount =
        billTotal >= voucher.minTotal ? voucher.amountFor(billTotal) : 0;
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(DanRadius.md),
      child: Container(
        padding: EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: selected
              ? DanColors.brand.withValues(alpha: .08)
              : DanColors.surface2,
          borderRadius: BorderRadius.circular(DanRadius.md),
          border:
              Border.all(color: selected ? DanColors.brand : DanColors.border),
        ),
        child: Row(
          children: [
            Icon(Icons.local_activity_outlined,
                color: selected ? DanColors.brand : DanColors.muted),
            SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(voucher.displayName,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(fontWeight: FontWeight.w900)),
                  SizedBox(height: 2),
                  Text(
                    voucher.minTotal > 0
                        ? '${t('Tối thiểu')} ${Fmt.money(voucher.minTotal)}'
                        : t('Không yêu cầu bill tối thiểu'),
                    style: TextStyle(fontSize: 11.5, color: DanColors.muted),
                  ),
                ],
              ),
            ),
            SizedBox(width: 10),
            Text(amount > 0 ? '-${Fmt.money(amount)}' : voucher.valueLabel,
                style: TextStyle(
                    color: DanColors.done, fontWeight: FontWeight.w900)),
          ],
        ),
      ),
    );
  }
}

class _RetailTotals {
  final num subtotal;
  final num productDiscount;
  final num orderDiscount;
  final num customerDiscount;
  final num manualDiscount;
  final num total;
  final RetailVoucher? orderVoucher;

  _RetailTotals({
    required this.subtotal,
    required this.productDiscount,
    required this.orderDiscount,
    required this.customerDiscount,
    required this.manualDiscount,
    required this.total,
    required this.orderVoucher,
  });
}

class _SkuCard extends StatelessWidget {
  final Sku sku;
  final String serverUrl;
  final String promoLabel;
  final VoidCallback onTap;

  _SkuCard({
    required this.sku,
    required this.serverUrl,
    required this.promoLabel,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final out = sku.stock <= 0;
    return InkWell(
      onTap: out ? null : onTap,
      borderRadius: BorderRadius.circular(DanRadius.md),
      child: Opacity(
        opacity: out ? .52 : 1,
        child: Container(
          decoration: BoxDecoration(
            color: DanColors.surface,
            border: Border.all(color: DanColors.border),
            borderRadius: BorderRadius.circular(DanRadius.md),
            boxShadow: [
              BoxShadow(
                  color: Colors.black.withValues(alpha: .025),
                  blurRadius: 6,
                  offset: Offset(0, 2)),
            ],
          ),
          clipBehavior: Clip.antiAlias,
          child: Stack(
            children: [
              Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  SizedBox(height: 122, child: _image()),
                  Expanded(
                    child: Padding(
                      padding: EdgeInsets.fromLTRB(9, 6, 9, 7),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          // Flexible: tên co lại nếu thiếu chỗ, không đẩy tràn card.
                          Flexible(
                            child: Text(sku.name,
                                maxLines: 2,
                                overflow: TextOverflow.ellipsis,
                                style: TextStyle(
                                    fontSize: 12,
                                    fontWeight: FontWeight.w800,
                                    height: 1.18)),
                          ),
                          Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Text(Fmt.money(sku.price),
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  style: TextStyle(
                                      fontSize: 14,
                                      fontWeight: FontWeight.w900,
                                      color: DanColors.brand)),
                              Text(
                                  '${t('Tồn')}: ${Fmt.int0(sku.stock)} ${sku.unit}',
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  style: TextStyle(
                                      fontSize: 10.5,
                                      color: out
                                          ? DanColors.late
                                          : DanColors.muted,
                                      fontWeight: FontWeight.w600)),
                            ],
                          ),
                        ],
                      ),
                    ),
                  ),
                ],
              ),
              // Badge khuyến mãi chỉ hiện khi SKU thực sự có voucher.
              if (promoLabel.isNotEmpty)
                Positioned(
                  top: 7,
                  right: 7,
                  child: Container(
                    padding: EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                    decoration: BoxDecoration(
                      color: DanColors.doing,
                      borderRadius: BorderRadius.circular(99),
                      boxShadow: [
                        BoxShadow(
                            color: Colors.black.withValues(alpha: .12),
                            blurRadius: 8)
                      ],
                    ),
                    child: Text(promoLabel,
                        style: TextStyle(
                            fontSize: 9.5,
                            color: Colors.white,
                            fontWeight: FontWeight.w900)),
                  ),
                ),
              if (out)
                Positioned(
                  top: 7,
                  left: 7,
                  child: Container(
                    padding: EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                    decoration: BoxDecoration(
                      color: DanColors.late,
                      borderRadius: BorderRadius.circular(99),
                    ),
                    child: Text(t('Hết'),
                        style: TextStyle(
                            color: Colors.white,
                            fontSize: 9.5,
                            fontWeight: FontWeight.w900)),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _image() {
    if (sku.image.isEmpty) {
      return _placeholder();
    }
    final url = sku.image.startsWith('http')
        ? sku.image
        : '$serverUrl${sku.image.startsWith('/') ? '' : '/'}${sku.image}';
    return Container(
      color: Colors.white,
      child: Image.network(
        url,
        fit: BoxFit.contain,
        width: double.infinity,
        // Thumbnail-size decode + reuse frame across rebuilds → far lighter on
        // weak POS hardware when the catalogue has many SKUs.
        cacheWidth: 240,
        filterQuality: FilterQuality.low,
        gaplessPlayback: true,
        errorBuilder: (_, __, ___) => _placeholder(),
      ),
    );
  }

  Widget _placeholder() {
    // SKU chưa có ảnh → ô xám nhạt + icon hộp hàng cho có chủ đích (trước đây
    // để trống trơn nên trông như thẻ bị lỗi/trắng).
    return Container(
      color: DanColors.surface2,
      alignment: Alignment.center,
      child:
          Icon(Icons.inventory_2_outlined, size: 34, color: DanColors.border),
    );
  }
}

class _CartRow extends StatelessWidget {
  final CartLine line;
  final List<StockLot> lots;
  final String promoText;
  final bool hasPromos;
  final bool promoApplied;
  final VoidCallback onPickPromo;
  final ValueChanged<String?> onLotChanged;
  final VoidCallback onInc;
  final VoidCallback onDec;
  final VoidCallback onRemove;

  _CartRow({
    required this.line,
    required this.lots,
    required this.promoText,
    required this.hasPromos,
    required this.promoApplied,
    required this.onPickPromo,
    required this.onLotChanged,
    required this.onInc,
    required this.onDec,
    required this.onRemove,
  });

  @override
  Widget build(BuildContext context) {
    final hasLots = lots.isNotEmpty;
    final selected =
        hasLots && lots.any((l) => l.id == line.lotId) ? line.lotId : '';
    return Container(
      padding: EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: DanColors.surface2,
        borderRadius: BorderRadius.circular(DanRadius.md),
        border: Border.all(color: DanColors.border),
      ),
      child: Column(
        children: [
          Row(
            children: [
              if (hasPromos) ...[
                InkWell(
                  onTap: onPickPromo,
                  borderRadius: BorderRadius.circular(8),
                  child: Container(
                    width: 28,
                    height: 28,
                    alignment: Alignment.center,
                    decoration: BoxDecoration(
                      color: promoApplied ? DanColors.doing : DanColors.surface,
                      borderRadius: BorderRadius.circular(8),
                      border: Border.all(
                          color: promoApplied
                              ? DanColors.doing
                              : DanColors.border2),
                    ),
                    child: Icon(Icons.card_giftcard,
                        size: 15,
                        color: promoApplied ? Colors.white : DanColors.doing),
                  ),
                ),
                SizedBox(width: 8),
              ],
              Expanded(
                child: Text(line.sku.name,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style:
                        TextStyle(fontSize: 12.5, fontWeight: FontWeight.w800)),
              ),
              SizedBox(width: 8),
              Text(Fmt.money(line.lineTotal),
                  style: TextStyle(
                      color: DanColors.brand, fontWeight: FontWeight.w900)),
            ],
          ),
          SizedBox(height: 7),
          if (hasLots)
            DropdownButtonFormField<String>(
              initialValue: selected,
              isDense: true,
              // Nhãn lot dài (mã + HSD + tồn) — isExpanded để không tràn ngang.
              isExpanded: true,
              decoration: InputDecoration(
                labelText: 'Lot / HSD',
                isDense: true,
                contentPadding:
                    EdgeInsets.symmetric(horizontal: 10, vertical: 8),
              ),
              items: [
                DropdownMenuItem(value: '', child: Text(t('FEFO tự động'))),
                for (final lot in lots)
                  DropdownMenuItem(
                      value: lot.id,
                      child: Text(lot.label,
                          maxLines: 1, overflow: TextOverflow.ellipsis)),
              ],
              onChanged: onLotChanged,
            )
          else
            Align(
              alignment: Alignment.centerLeft,
              child: Text(t('FEFO tự động'),
                  style: TextStyle(fontSize: 11, color: DanColors.faint)),
            ),
          if (promoText.isNotEmpty) ...[
            SizedBox(height: 6),
            Align(
              alignment: Alignment.centerLeft,
              child: Text(promoText,
                  style: TextStyle(
                      color: DanColors.doing,
                      fontSize: 11,
                      fontWeight: FontWeight.w800)),
            ),
          ],
          SizedBox(height: 7),
          Row(
            children: [
              _QtyBtn(icon: Icons.remove, onTap: onDec),
              Container(
                width: 34,
                alignment: Alignment.center,
                child: Text('${line.qty}',
                    style:
                        TextStyle(fontSize: 14, fontWeight: FontWeight.w900)),
              ),
              _QtyBtn(icon: Icons.add, onTap: onInc),
              Spacer(),
              Text(Fmt.money(line.sku.price),
                  style: TextStyle(fontSize: 11.5, color: DanColors.faint)),
              IconButton(
                onPressed: onRemove,
                visualDensity: VisualDensity.compact,
                icon: Icon(Icons.close, size: 16, color: DanColors.faint),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _QtyBtn extends StatelessWidget {
  final IconData icon;
  final VoidCallback onTap;
  _QtyBtn({required this.icon, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(7),
      child: Container(
        width: 28,
        height: 28,
        decoration: BoxDecoration(
          color: DanColors.surface,
          borderRadius: BorderRadius.circular(7),
          border: Border.all(color: DanColors.border2),
        ),
        child: Icon(icon, size: 15, color: DanColors.text),
      ),
    );
  }
}

class _EmptyCart extends StatelessWidget {
  _EmptyCart();

  @override
  Widget build(BuildContext context) {
    // Cuộn được + ảnh giới hạn chiều cao: trên tablet màn ngắn, khối rỗng này
    // KHÔNG còn tràn xuống đè lên phần tổng tiền/thanh toán bên dưới.
    return SingleChildScrollView(
      padding: EdgeInsets.symmetric(vertical: 16),
      child: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ConstrainedBox(
              constraints: BoxConstraints(maxWidth: 132, maxHeight: 80),
              child: Image.asset(
                'assets/brand/DanOnLogo.png',
                fit: BoxFit.contain,
                errorBuilder: (_, __, ___) => Icon(Icons.shopping_bag_outlined,
                    size: 52, color: DanColors.faint),
              ),
            ),
            SizedBox(height: 14),
            Container(
              padding: EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              decoration: BoxDecoration(
                color: DanColors.surface2,
                borderRadius: BorderRadius.circular(99),
                border: Border.all(color: DanColors.border2),
              ),
              child: Text(t('Quét/chạm sản phẩm để bắt đầu'),
                  style: TextStyle(
                      color: DanColors.muted,
                      fontSize: 12,
                      fontWeight: FontWeight.w800)),
            ),
            SizedBox(height: 8),
            Text(t('Giỏ hàng đang trống'),
                style: TextStyle(fontSize: 11, color: DanColors.faint)),
          ],
        ),
      ),
    );
  }
}

class _CountDot extends StatelessWidget {
  final String text;
  final bool active;
  _CountDot(this.text, this.active);

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: EdgeInsets.symmetric(horizontal: 6, vertical: 1),
      decoration: BoxDecoration(
        color: active ? Colors.white24 : DanColors.surface3,
        borderRadius: BorderRadius.circular(99),
      ),
      child: Text(text,
          style: TextStyle(
              color: active ? Colors.white : DanColors.muted,
              fontSize: 10,
              fontWeight: FontWeight.w900)),
    );
  }
}

class _CustomerPickerDialog extends StatefulWidget {
  final ApiService api;
  final List<RetailCustomer> customers;
  final RetailCustomer? selected;

  _CustomerPickerDialog({
    required this.api,
    required this.customers,
    required this.selected,
  });

  @override
  State<_CustomerPickerDialog> createState() => _CustomerPickerDialogState();
}

class _NoCustomer {
  _NoCustomer();
}

class _CustomerPickerDialogState extends State<_CustomerPickerDialog> {
  final _search = TextEditingController();
  String _q = '';

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  List<RetailCustomer> get _rows {
    final q = foldSearch(_q);
    if (q.isEmpty) return widget.customers;
    return widget.customers
        .where((c) =>
            searchMatches(c.code, q) ||
            searchMatches(c.title, q) ||
            searchMatches(c.phone, q) ||
            searchMatches(c.taxCode, q) ||
            searchMatches(c.company, q))
        .toList();
  }

  Future<void> _create() async {
    final saved = await showDialog<RetailCustomer>(
      context: context,
      builder: (_) => _CustomerEditDialog(api: widget.api),
    );
    if (saved != null && mounted) Navigator.of(context).pop(saved);
  }

  @override
  Widget build(BuildContext context) {
    return Dialog(
      backgroundColor: DanColors.surface,
      child: ConstrainedBox(
        constraints: BoxConstraints(maxWidth: 560, maxHeight: 660),
        child: Column(
          children: [
            Padding(
              padding: EdgeInsets.fromLTRB(20, 18, 14, 10),
              child: Row(
                children: [
                  Expanded(
                    child: Text(t('Chọn khách hàng'),
                        style: TextStyle(
                            fontSize: 18, fontWeight: FontWeight.w900)),
                  ),
                  TextButton.icon(
                    onPressed: _create,
                    icon: Icon(Icons.add, size: 17),
                    label: Text(t('Thêm')),
                  ),
                  IconButton(
                      onPressed: () => Navigator.of(context).pop(),
                      icon: Icon(Icons.close)),
                ],
              ),
            ),
            Padding(
              padding: EdgeInsets.fromLTRB(16, 0, 16, 10),
              child: TextField(
                controller: _search,
                decoration: InputDecoration(
                  hintText: t('Tìm mã, tên, SĐT, MST...'),
                  prefixIcon: Icon(Icons.search),
                  isDense: true,
                ),
                onChanged: (v) => setState(() => _q = v),
              ),
            ),
            Divider(height: 1, color: DanColors.border),
            ListTile(
              leading: Icon(Icons.person_off_outlined),
              title: Text(t('Bán cho người tiêu dùng')),
              onTap: () => Navigator.of(context).pop(_NoCustomer()),
            ),
            Expanded(
              child: _rows.isEmpty
                  ? Center(
                      child: Text(t('Chưa có khách hàng'),
                          style: TextStyle(color: DanColors.faint)))
                  : ListView.separated(
                      padding: EdgeInsets.all(12),
                      itemCount: _rows.length,
                      separatorBuilder: (_, __) => SizedBox(height: 8),
                      itemBuilder: (_, i) {
                        final c = _rows[i];
                        final selected = c.id == widget.selected?.id;
                        return ListTile(
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(DanRadius.md),
                            side: BorderSide(
                                color: selected
                                    ? DanColors.brand
                                    : DanColors.border),
                          ),
                          tileColor:
                              selected ? DanColors.brandDim : DanColors.surface,
                          title: Text(c.title,
                              style: TextStyle(fontWeight: FontWeight.w900)),
                          subtitle: Text(c.subtitle.isEmpty ? '—' : c.subtitle),
                          trailing: selected
                              ? Icon(Icons.check_circle, color: DanColors.brand)
                              : null,
                          onTap: () => Navigator.of(context).pop(c),
                        );
                      },
                    ),
            ),
          ],
        ),
      ),
    );
  }
}

class _CustomerEditDialog extends StatefulWidget {
  final ApiService api;
  _CustomerEditDialog({required this.api});

  @override
  State<_CustomerEditDialog> createState() => _CustomerEditDialogState();
}

class _CustomerEditDialogState extends State<_CustomerEditDialog> {
  final _name = TextEditingController();
  final _phone = TextEditingController();
  final _email = TextEditingController();
  final _tax = TextEditingController();
  final _company = TextEditingController();
  final _address = TextEditingController();
  final _addressDetail = TextEditingController();
  final _addressWard = TextEditingController();
  final _addressProvince = TextEditingController();
  final _wardCode = TextEditingController();
  final _provinceCode = TextEditingController();
  final _perkValue = TextEditingController();
  String _perkType = 'none';
  bool _autoInvoice = false;
  bool _saving = false;
  // Truy xuất Cục Thuế theo MST; tên công ty + địa chỉ truy xuất được sẽ khóa.
  late final TaxLookupController _taxLookup = TaxLookupController(
    api: widget.api,
    mst: _tax,
    company: _company,
    address: _address,
  );

  @override
  void dispose() {
    _taxLookup.dispose();
    _name.dispose();
    _phone.dispose();
    _email.dispose();
    _tax.dispose();
    _company.dispose();
    _address.dispose();
    _addressDetail.dispose();
    _addressWard.dispose();
    _addressProvince.dispose();
    _wardCode.dispose();
    _provinceCode.dispose();
    _perkValue.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (_name.text.trim().isEmpty &&
        _phone.text.trim().isEmpty &&
        _company.text.trim().isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text(t('Nhập tên, SĐT hoặc tên công ty')),
          backgroundColor: DanColors.late));
      return;
    }
    setState(() => _saving = true);
    try {
      final saved = await widget.api.upsertCustomer({
        'name': _name.text.trim(),
        'phone': _phone.text.trim(),
        'email': _email.text.trim(),
        'tax_code': _tax.text.trim(),
        'company': _company.text.trim(),
        'address': _address.text.trim(),
        'address_detail': _addressDetail.text.trim(),
        'address_ward': _addressWard.text.trim(),
        'address_province': _addressProvince.text.trim(),
        'ward_code': _wardCode.text.trim(),
        'province_code': _provinceCode.text.trim(),
        'perk_type': _perkType,
        'perk_value': retailN(_perkValue.text.trim()).round(),
        'auto_invoice': _autoInvoice,
      });
      if (mounted) {
        Navigator.of(context)
            .pop(RetailCustomer.fromJson(Map<String, dynamic>.from(saved)));
      }
    } catch (e) {
      if (mounted) {
        setState(() => _saving = false);
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(
            content: Text(e.toString().replaceFirst('Exception: ', '')),
            backgroundColor: DanColors.late));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      backgroundColor: DanColors.surface,
      title: Text(t('Thêm khách hàng')),
      content: SizedBox(
        width: dialogWidth(context, 520),
        child: SingleChildScrollView(
          child: ListenableBuilder(
            listenable: _taxLookup,
            builder: (context, _) => Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                TextField(
                    controller: _name,
                    decoration: InputDecoration(labelText: t('Tên khách'))),
                SizedBox(height: 8),
                TextField(
                    controller: _phone,
                    decoration: InputDecoration(labelText: t('Số điện thoại'))),
                SizedBox(height: 8),
                TextField(
                    controller: _email,
                    decoration: InputDecoration(labelText: 'Email')),
                SizedBox(height: 8),
                MstField(
                  lookup: _taxLookup,
                  isDense: false,
                  onMessage: (m, {bool error = false}) =>
                      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
                    content: Text(m),
                    backgroundColor: error ? DanColors.late : DanColors.text,
                  )),
                ),
                SizedBox(height: 8),
                TextField(
                    controller: _company,
                    readOnly: _taxLookup.companyLocked,
                    decoration: taxLockedDecoration(
                        label: t('Tên công ty'),
                        locked: _taxLookup.companyLocked,
                        isDense: false)),
                SizedBox(height: 8),
                AddressFields(
                  address: _address,
                  detail: _addressDetail,
                  ward: _addressWard,
                  province: _addressProvince,
                  wardCode: _wardCode,
                  provinceCode: _provinceCode,
                  locked: _taxLookup.addressLocked,
                ),
                SizedBox(height: 8),
                Row(
                  children: [
                    Expanded(
                      child: DropdownButtonFormField<String>(
                        initialValue: _perkType,
                        decoration: InputDecoration(labelText: t('Ưu đãi')),
                        items: [
                          DropdownMenuItem(
                              value: 'none', child: Text(t('Không'))),
                          DropdownMenuItem(value: 'pct', child: Text('Theo %')),
                          DropdownMenuItem(
                              value: 'amount', child: Text(t('Số tiền'))),
                        ],
                        onChanged: (v) =>
                            setState(() => _perkType = v ?? 'none'),
                      ),
                    ),
                    SizedBox(width: 8),
                    Expanded(
                      child: TextField(
                        controller: _perkValue,
                        keyboardType: TextInputType.number,
                        decoration: InputDecoration(labelText: t('Giá trị')),
                      ),
                    ),
                  ],
                ),
                SwitchListTile(
                  value: _autoInvoice,
                  title: Text(t('Tự bật xuất hóa đơn')),
                  onChanged: (v) => setState(() => _autoInvoice = v),
                ),
              ],
            ),
          ),
        ),
      ),
      actions: [
        TextButton(
            onPressed: _saving ? null : () => Navigator.of(context).pop(),
            child: Text(t('Hủy'))),
        FilledButton(
          onPressed: _saving ? null : _save,
          child: _saving
              ? SizedBox(
                  width: 18,
                  height: 18,
                  child: CircularProgressIndicator(
                      strokeWidth: 2, color: Colors.white))
              : Text(t('Lưu')),
        ),
      ],
    );
  }
}
