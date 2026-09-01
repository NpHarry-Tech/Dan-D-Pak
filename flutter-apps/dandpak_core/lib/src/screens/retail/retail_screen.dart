import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../api_client.dart';
import '../../models/retail_models.dart';
import '../../providers/auth_provider.dart';
import '../../providers/customer_display_controller.dart';
import '../../providers/pos_provider.dart';
import '../../services/api_service.dart';
import '../../services/local_store.dart';
import '../../services/retail_canonical.dart';
import '../../services/retail_order_session.dart';
import '../../services/socket_service.dart';
import '../../ui/app_theme.dart';
import '../../ui/debouncer.dart';
import '../../ui/format.dart';
import '../../widgets/app_loading.dart';
import '../../widgets/customer_picker_dialog.dart';
import '../../widgets/manager_pin_dialog.dart';
import '../../widgets/online_only_gate.dart';
import '../../widgets/dan_top_bar.dart';
import '../../widgets/resizable_pane.dart';
import '../../widgets/scan_button.dart';
import '../../widgets/order_note_dialog.dart';
import '../customer_display/customer_display_screen.dart';
import '../order_history_dialog.dart';
import '../shift_dialog.dart';
import 'checkout_dialog.dart';
import 'combo_support.dart';
import '../../services/black_box.dart';
import '../../utils/translation.dart';

part 'retail_cart_widgets.dart';
part 'retail_cart_view.dart';
part 'retail_return_view.dart';
part 'retail_screen_view.dart';
part 'retail_realtime_binding.dart';
part 'retail_canonical_orders.dart';
part 'retail_promotion_section.dart';

class RetailScreen extends StatefulWidget {
  RetailScreen({super.key});

  @override
  State<RetailScreen> createState() => _RetailScreenState();
}

class _RetailScreenState extends State<RetailScreen>
    with WidgetsBindingObserver {
  final _searchCtrl = TextEditingController();
  final _barcodeFocus = FocusNode();

  List<Sku> _skus = [];

  /// Server giải thích vì sao danh mục rỗng (kho chưa nối / kho được chọn chưa
  /// có hàng). Rỗng mà không nói lý do là ngõ cụt: cửa hàng không biết là chưa
  /// tạo hàng hay đã tạo mà nằm ở kho khác.
  String _lyDoTrong = '';
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
  // '' = mặc định (theo tên) | price_asc | price_desc | stock_asc | stock_desc.
  // Lưu vĩnh viễn trên THIẾT BỊ này qua LocalStore (giống resizable_pane) — mỗi
  // máy tự nhớ riêng, không đồng bộ qua server.
  String _sortBy = '';
  // Lọc theo NHÓM HÀNG (category). '' = tất cả. Danh sách nhóm lấy từ server
  // (field `categories` trong trang SKU) để đủ nhóm dù đang phân trang.
  String _category = '';
  List<String> _categories = [];
  bool _loading = true;
  String? _error;

  int _skuPage = 1;
  bool _hasMoreSkus = true;
  bool _loadingSkus = false;
  final _skuSearchGuard = SearchRequestGuard();
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
  // Slot đang THANH TOÁN (mở CheckoutDialog). Trong lúc này KHÔNG cho sync giỏ từ
  // máy khác / snapshot cũ ghi đè hay xoá giỏ của slot này — nếu không, request
  // xác nhận đang chậm mà một event 'cleared'/thay giỏ ập tới sẽ xoá mất giỏ đang
  // bán, đơn chưa lưu xong -> "mất tiêu đơn, không vào lịch sử, phải nhập lại".
  int? _checkoutSlot;
  final Debouncer _cartSyncDebouncer =
      Debouncer(delay: const Duration(milliseconds: 350));
  bool _localCartsRestored = false;
  Timer? _presenceTimer;
  // Giảm giá do SERVER tính (gồm CTKM tự động: combo, mua-X-tặng-1). Giỏ gọi khi
  // đổi → hiện + thu ĐÚNG. Chỉ dùng khi chữ ký khớp giỏ hiện tại (tránh cũ).
  final Debouncer _previewDebouncer =
      Debouncer(delay: const Duration(milliseconds: 300));
  Map<String, dynamic>? _preview;
  String _previewSig = '';

  // ── §2 CANONICAL ORDERS (multi-device, server-authoritative) ────────────────
  // Gated: chỉ chạy khi server bật operationsConfig.retail.canonicalOrders=true.
  // Tắt (mặc định) → đường bán lẻ giữ NGUYÊN cơ chế giỏ-chia-sẻ hiện tại đang
  // chạy Production (không đổi hành vi). Bật → mỗi tab = 1 canonical order:
  // mutation đi qua applyCommand, giá do server (priceCart) áp, client chỉ render.
  final Map<int, RetailOrderSession> _sessions = {};
  RetailOrderSession? get _activeSession => _sessions[_activeTabId];
  bool get _canonicalEnabled {
    final r = _operationsConfig['retail'];
    return r is Map && r['canonicalOrders'] == true;
  }

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
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
      _heartbeatPresence();
      _presenceTimer = Timer.periodic(const Duration(seconds: 10), (_) {
        _heartbeatPresence();
        _canonicalHeartbeat();
      });
    });
  }

  // Đổi kho/bảng giá bán lẻ từ máy khác trong lúc tablet này đang đứng yên ở
  // màn Retail (hoặc app bị hệ điều hành treo nền, socket không kịp báo) →
  // danh sách SKU cũ vẫn còn hiển thị dù server đã đổi. Tải lại NGAY khi app
  // quay lại foreground, không chỉ trông chờ socket, để không lệch dữ liệu
  // với máy khác (đúng lỗi báo: tablet vẫn hiện món dù kho liên kết đã trống).
  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed && mounted) {
      _socketRefresh(() {
        if (mounted) _reloadLight();
      });
      _heartbeatPresence();
    } else if (state == AppLifecycleState.paused ||
        state == AppLifecycleState.detached) {
      _leavePresence(_activeTabId);
    }
  }

  void _onSkuScroll() {
    if (_skuScrollCtrl.position.pixels >=
        _skuScrollCtrl.position.maxScrollExtent - 200) {
      _loadSkusNextPage();
    }
  }

  Future<void> _loadSkusNextPage({bool isRefresh = false}) async {
    if (_loadingSkus && !isRefresh) return;
    if (!isRefresh && !_hasMoreSkus) return;

    final generation =
        isRefresh ? _skuSearchGuard.next() : _skuSearchGuard.current;
    final query = _search;
    final page = isRefresh ? 1 : _skuPage;

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
        page: page,
        limit: 40,
        q: query,
        channel: 'retail',
        inStockOnly: _inStockOnly,
        sort: _sortBy,
        category: _category,
      );

      final itemsData = result['items'] as List? ?? [];
      final total = result['total'] as int? ?? 0;
      final cats = (result['categories'] as List?)
              ?.map((e) => e.toString())
              .where((e) => e.isNotEmpty)
              .toList() ??
          const <String>[];

      final skus = itemsData
          .whereType<Map>()
          .map((e) => Sku.fromJson(Map<String, dynamic>.from(e)))
          .toList();

      if (!mounted || !_skuSearchGuard.isCurrent(generation)) return;
      setState(() {
        _skus.addAll(skus);
        _hasMoreSkus = _skus.length < total;
        if (skus.isNotEmpty) {
          _skuPage++;
        }
        // Danh sách nhóm chỉ cần cập nhật ở trang đầu (server trả đủ nhóm mỗi lần).
        if (cats.isNotEmpty) _categories = cats;
        _loadingSkus = false;
      });
    } catch (e) {
      debugPrint("Error loading paginated SKUs: $e");
      if (mounted && _skuSearchGuard.isCurrent(generation)) {
        setState(() {
          _loadingSkus = false;
        });
      }
    }
  }

  void _onSocketEvent(String event, dynamic payload) {
    if (!mounted) return;
    // §2 canonical: chuyển tiếp event order.* tới session (paid/lease/changed).
    // Session tự lọc theo order_id; event không liên quan sẽ bị bỏ qua.
    if (_sessions.isNotEmpty && payload is Map)
      _canonicalOnSocket(event, payload);
    if (event == 'retail:cart') {
      _applyRemoteCart(payload);
      return;
    }
    if (event == 'retail:presence') {
      _applyPresence(payload);
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
    WidgetsBinding.instance.removeObserver(this);
    try {
      context.read<CustomerDisplayController>().clearRetailMirror();
    } catch (_) {}
    _skuScrollCtrl.removeListener(_onSkuScroll);
    _skuScrollCtrl.dispose();
    _skuDebouncer.dispose();
    _socketRefresh.dispose();
    _cartSyncDebouncer.dispose();
    _previewDebouncer.dispose();
    _presenceTimer?.cancel();
    _leavePresence(_activeTabId);
    _releaseAllSessions();
    _socketService.removeListener(_onSocketEvent);
    _searchCtrl.dispose();
    _barcodeFocus.dispose();
    super.dispose();
  }

  static const _kFilterInStockKey = 'retail_filter_in_stock';
  static const _kFilterSortKey = 'retail_filter_sort';
  static const _kFilterCategoryKey = 'retail_filter_category';

  Future<void> _loadFilterPrefs() async {
    final inStock = await LocalStore.instance.getString(_kFilterInStockKey);
    final sort = await LocalStore.instance.getString(_kFilterSortKey);
    final cat = await LocalStore.instance.getString(_kFilterCategoryKey);
    if (!mounted) return;
    setState(() {
      _inStockOnly = inStock == '1';
      _sortBy = sort ?? '';
      _category = cat ?? '';
    });
  }

  Future<void> _saveFilterPrefs() async {
    await LocalStore.instance
        .setString(_kFilterInStockKey, _inStockOnly ? '1' : '0');
    await LocalStore.instance.setString(_kFilterSortKey, _sortBy);
    await LocalStore.instance.setString(_kFilterCategoryKey, _category);
  }

  List<MapEntry<String, String>> get _sortOptions => [
        MapEntry('', t('Mặc định (theo tên)')),
        MapEntry('price_desc', t('Giá: cao → thấp')),
        MapEntry('price_asc', t('Giá: thấp → cao')),
        MapEntry('stock_desc', t('Số lượng: nhiều → ít')),
        MapEntry('stock_asc', t('Số lượng: ít → nhiều')),
      ];

  Future<void> _openFilterSheet() async {
    var tempInStock = _inStockOnly;
    var tempSort = _sortBy;
    var tempCategory = _category;
    // Nhóm hiện có + nhóm đang chọn (dù trang hiện tại chưa nạp) → không mất lựa chọn.
    final catOptions = <String>{
      ..._categories,
      if (_category.isNotEmpty) _category
    }.toList()
      ..sort((a, b) => a.toLowerCase().compareTo(b.toLowerCase()));
    final applied = await showDialog<bool>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setLocal) => AlertDialog(
          title: Text(t('Lọc & sắp xếp')),
          content: SizedBox(
            width: 340,
            child: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  SwitchListTile(
                    contentPadding: EdgeInsets.zero,
                    title: Text(t('Chỉ hiện còn hàng')),
                    value: tempInStock,
                    onChanged: (v) => setLocal(() => tempInStock = v),
                  ),
                  if (catOptions.isNotEmpty) ...[
                    Divider(height: 20),
                    Padding(
                      padding: EdgeInsets.only(bottom: 6),
                      child: Text(t('Nhóm hàng'),
                          style: TextStyle(
                              fontWeight: FontWeight.w800, fontSize: 12.5)),
                    ),
                    DropdownButtonFormField<String>(
                      initialValue: tempCategory.isEmpty ? '' : tempCategory,
                      isExpanded: true,
                      decoration: InputDecoration(
                        isDense: true,
                        border: OutlineInputBorder(),
                        contentPadding:
                            EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                      ),
                      items: [
                        DropdownMenuItem(
                            value: '', child: Text(t('Tất cả nhóm'))),
                        for (final c in catOptions)
                          DropdownMenuItem(value: c, child: Text(c)),
                      ],
                      onChanged: (v) => setLocal(() => tempCategory = v ?? ''),
                    ),
                  ],
                  Divider(height: 20),
                  Padding(
                    padding: EdgeInsets.only(bottom: 4),
                    child: Text(t('Sắp xếp theo'),
                        style: TextStyle(
                            fontWeight: FontWeight.w800, fontSize: 12.5)),
                  ),
                  RadioGroup<String>(
                    groupValue: tempSort,
                    onChanged: (v) => setLocal(() => tempSort = v ?? ''),
                    child: Column(
                      children: [
                        for (final opt in _sortOptions)
                          RadioListTile<String>(
                            contentPadding: EdgeInsets.zero,
                            dense: true,
                            title: Text(opt.value),
                            value: opt.key,
                          ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(ctx).pop(false),
              child: Text(t('Hủy')),
            ),
            FilledButton(
              onPressed: () => Navigator.of(ctx).pop(true),
              child: Text(t('Áp dụng')),
            ),
          ],
        ),
      ),
    );
    if (applied != true || !mounted) return;
    setState(() {
      _inStockOnly = tempInStock;
      _sortBy = tempSort;
      _category = tempCategory;
    });
    unawaited(_saveFilterPrefs());
    _loadSkusNextPage(isRefresh: true);
  }

  Future<void> _load() async {
    await _loadFilterPrefs();
    await _restoreLocalCarts();
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final api = context.read<ApiService>();
      final pos = context.read<PosProvider>();
      final results = await Future.wait<dynamic>([
        api.getSkusPaginated(
            page: 1,
            limit: 40,
            q: _search,
            channel: 'retail',
            inStockOnly: _inStockOnly,
            sort: _sortBy),
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
      final lyDo =
          '${(skuPageResult['empty_reason'] as Map?)?['message'] ?? ''}';
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
        _lyDoTrong = lyDo;
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
      // §2 gated: nếu server bật canonicalOrders → mở canonical session cho tab
      // đang hoạt động (no-op khi tắt → giữ nguyên đường giỏ-chia-sẻ).
      _ensureCanonicalSession();
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
      api.getSkusPaginated(
          page: 1,
          limit: 40,
          q: _search,
          channel: 'retail',
          inStockOnly: _inStockOnly,
          sort: _sortBy),
      api.getRetailLots().catchError((_) => <dynamic>[]),
      api.getActiveVouchers().catchError((_) => <dynamic>[]),
      api.getCustomers().catchError((_) => <dynamic>[]),
      api.getCurrentShift().catchError((_) => null),
    ]);
    final skuPageResult = results[0] as Map<String, dynamic>;
    final skuRows = skuPageResult['items'] as List? ?? [];
    final skuTotal = skuPageResult['total'] as int? ?? 0;
    final lyDo = '${(skuPageResult['empty_reason'] as Map?)?['message'] ?? ''}';

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
      _lyDoTrong = lyDo;
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
    // "Còn hàng" + sắp xếp đã lọc/sắp xếp phía SERVER (getSkusPaginated), TRƯỚC
    // khi phân trang — không lọc lại ở đây nữa (list lọc-sau-khi-tải-trang từng
    // gây thiếu hàng hiện trên màn dù server còn nhiều món khác thoả điều kiện).
    final q = foldSearch(_search);
    var list = _skus.toList();
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
    // §2 gated: tab canonical → ADD_LINE qua server (không sửa _cart local).
    if (_activeSession != null) {
      _canonicalAdd(sku);
      return;
    }
    if (_salesLocked) {
      _toast(t('Cần mở ca làm việc trước khi bán hàng.'), error: true);
      _openShiftDialog();
      return;
    }
    // KHÔNG chặn cứng theo tồn HIỂN THỊ: số này có thể CŨ (vừa nhập/sửa kho ở máy
    // khác mà POS chưa kịp refresh — sự cố ĐVL RM180 06/08/2026, kho 90 nhưng POS
    // báo hết). Server vẫn kiểm tra tồn khi THANH TOÁN nên an toàn. Chỉ CẢNH BÁO.
    if (sku.stock <= 0) {
      _toast(t('${sku.name}: tồn hiển thị 0 — kiểm tra lại nếu cần'));
    }
    final lot = _defaultLot(sku);
    final lotId = lot?.id;
    setState(() {
      final existing =
          _cart.indexWhere((c) => c.sku.id == sku.id && c.lotId == lotId);
      if (existing >= 0) {
        final line = _cart[existing];
        line.qty++;
        if (line.qty > _availableFor(line)) {
          _toast(t('${sku.name}: vượt tồn hiển thị (server sẽ kiểm tra lại)'));
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
      } else {
        // Cảnh báo nếu vượt tồn hiển thị nhưng VẪN cho tăng — tồn có thể cũ,
        // server chặn vượt tồn khi thanh toán.
        line.qty = next;
        if (next > _availableFor(line)) {
          _toast(t('${line.sku.name}: vượt tồn hiển thị'));
        }
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

  // ---- COMBO (Phương án B: combo là item bấm chọn, gom 1 dòng trong giỏ) ----
  int _comboSeq = 0;

  List<RetailVoucher> get _comboVouchers =>
      _usableVouchers.where((v) => v.isCombo && v.comboQty > 0).toList();

  // Ủy quyền toàn bộ tính toán combo cho combo_support.dart (dùng chung với phone).

  Future<void> _editNote() async {
    final value = await editOrderNote(context, _tab.note);
    if (value == null || !mounted) return;
    setState(() => _tab.note = value);
    _pushCustomerDisplay();
  }

  // Chạm đơn giá 1 dòng → nhập PIN Quản lý → chỉnh giá bán dòng đó (server xác
  // thực PIN lúc thanh toán). Combo có giá riêng nên không chỉnh từng dòng.
  Future<void> _editLinePrice(CartLine line) async {
    if (line.isCombo) return;
    final pin = _tab.priceOverridePin ??
        await requestManagerPin(
          context,
          t('Chỉnh giá bán "${line.sku.name}" — cần PIN Quản lý/Admin.'),
          label: t('PIN Quản lý / Admin'),
        );
    if (pin == null || !mounted) return;
    final result = await showDialog<num>(
      context: context,
      builder: (_) =>
          LinePriceDialog(sku: line.sku, current: line.priceOverride),
    );
    if (result == null || !mounted) return;
    setState(() {
      _tab.priceOverridePin = pin;
      // -1 = "Về giá gốc" → xoá override. Bằng giá niêm yết cũng coi là không đổi.
      line.priceOverride =
          (result < 0 || result == line.sku.price) ? null : result;
    });
    _pushCustomerDisplay();
  }

  // Ghi chú RIÊNG cho 1 dòng hàng (in dưới dòng đó trên bill).
  Future<void> _editLineNote(CartLine line) async {
    final value = await editOrderNote(context, line.note ?? '');
    if (value == null || !mounted) return;
    setState(() => line.note = value.trim().isEmpty ? null : value.trim());
    _pushCustomerDisplay();
  }

  // Giảm giá tay (không phải CTKM) — theo tiền hoặc %, cho khách mua sỉ/ưu đãi
  // riêng. Lưu vào _tab.manualDiscount, áp lúc checkout (server tính lại).
  Future<void> _openManualDiscount() async {
    final baseTotal = _totals().total; // trước giảm tay
    final result = await showDialog<num>(
      context: context,
      builder: (_) => ManualDiscountDialog(
          baseTotal: baseTotal, current: _tab.manualDiscount),
    );
    if (result == null || !mounted) return;
    setState(() => _tab.manualDiscount = result.clamp(0, double.infinity));
    _pushCustomerDisplay();
  }

  Future<void> _checkout() async {
    if (_cart.isEmpty) return;
    if (_salesLocked) {
      _toast(t('Cần mở ca làm việc trước khi bán hàng.'), error: true);
      _openShiftDialog();
      return;
    }
    final totals = _totals();
    // Khoá sync xa cho slot này suốt lúc thanh toán (xem _applyRemoteCart) —
    // không để máy khác/snapshot cũ xoá giỏ đang bán giữa chừng.
    _checkoutSlot = _tab.id;
    // ĐỒNG BỘ giỏ lên server NGAY trước khi mở màn thu tiền, để bản ghi giỏ chia
    // sẻ tồn tại với version mới nhất → server chống thanh toán trùng dựa vào
    // (slot, version) này. Nếu offline thì thôi (offline không có máy thứ hai).
    await _saveCartRemote(_tab, _tab.id);
    final checkoutVersion = _tab.version;
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
        // Combo gộp vào giảm sản phẩm để dialog hiển thị + biên lai đủ; `total`
        // đã là số server-authoritative (đã trừ combo) → thu đúng.
        productDiscount: totals.productDiscount + totals.comboDiscount,
        orderDiscount: totals.orderDiscount,
        customerDiscount: totals.customerDiscount,
        manualDiscount: _tab.manualDiscount,
        total: totals.total,
        vatAmount: totals.vat,
        channelLabel: 'Checkout',
        initialNote: _tab.note,
        selectedCombos: _selectedComboIds(),
        securityPin: _tab.priceOverridePin,
        cartSlot: _tab.id,
        cartVersion: checkoutVersion,
      ),
    );
    // Mở khoá sync xa cho slot này (dù thành công hay huỷ) — từ đây máy khác lại
    // được đồng bộ bình thường.
    _checkoutSlot = null;
    if (receipt != null) {
      // §4.1 money-integrity: CHỈ xoá giỏ khi server xác nhận PAID canonical —
      // có ĐỊNH DANH đơn (id/order_id/bill_no) và KHÔNG phải fully_settled:false.
      // Receipt mơ hồ (thiếu định danh / chưa chốt) → GIỮ giỏ, tải lại canonical,
      // báo rõ. Tránh "chuyển khoản xong mất giỏ mà không có bill".
      final paidOrderId =
          '${receipt['id'] ?? receipt['order_id'] ?? receipt['bill_no'] ?? ''}'
              .trim();
      final settled = receipt['fully_settled'] != false;
      if (paidOrderId.isEmpty || !settled) {
        await _reloadLight();
        _toast(
            t('Chưa xác nhận được hóa đơn đã thanh toán — giỏ hàng được giữ lại. Vui lòng kiểm tra Lịch sử.'),
            error: true);
        return;
      }
      setState(() {
        _cart.clear();
        _tab.customer = null;
        _tab.orderVoucherId = null;
        _tab.manualDiscount = 0;
        _tab.note = '';
        _tab.priceOverridePin =
            null; // xong bill → quên PIN chỉnh giá của đúng bill này
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

  Future<void> _printPreview() async {
    if (_cart.isEmpty || _salesLocked) return;
    try {
      await context.read<ApiService>().printRetailPreview({
        'items': [
          for (final c in _cart)
            {
              'sku_id': c.sku.id,
              'qty': c.qty,
              'lot_id': c.lotId,
              'voucher_id': c.voucherId,
            }
        ],
        'voucher_id': _tab.orderVoucherId,
        'customer': _customer?.toCheckoutCustomer(),
        'customer_id': _customer?.id,
        'note': _tab.note,
      });
      if (mounted) _toast(t('Đã gửi lệnh in tạm tính.'));
    } catch (e) {
      if (mounted)
        _toast(e.toString().replaceFirst('Exception: ', ''), error: true);
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
        onReturnToTab: _openReturnTab,
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
      builder: (_) => CustomerPickerDialog(
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

  // Cầu nối setState cho các view tách sang part file (extension) — setState là
  // @protected nên gọi trực tiếp từ extension sẽ cảnh báo; rebuild là public wrapper.
  void rebuild(VoidCallback fn) => setState(fn);

  void _addTab() {
    setState(() {
      _nextTabId++;
      final tab = RetailSaleTab(id: _nextTabId);
      _tabs.add(tab);
      _activeTabId = tab.id;
    });
    _pushCustomerDisplay();
    // §2 gated: tab mới = canonical order mới (server cấp display_sequence). No-op
    // khi tắt gate.
    _ensureCanonicalSession();
  }

  /// Mở TAB TRẢ HÀNG cho bill [orderId] (§1). Preload item bill gốc: ảnh (tra từ
  /// _skus), tên, SKU, giá snapshot, đã bán, đã trả (fetch retailReturns), còn trả.
  /// Không đụng tab bán; bill gốc giữ nguyên.
  Future<void> _openReturnTab(
      String orderId, List<Map<String, dynamic>> items) async {
    final api = context.read<ApiService>();
    final returnedBy = <String, int>{};
    try {
      for (final r in await api.retailReturns(orderId)) {
        final its = (r is Map ? r['items'] : null);
        if (its is List) {
          for (final it in its) {
            if (it is Map) {
              final id = '${it['order_item_id'] ?? ''}';
              returnedBy[id] =
                  (returnedBy[id] ?? 0) + ((it['qty'] as num?)?.toInt() ?? 0);
            }
          }
        }
      }
    } catch (_) {/* chưa trả lần nào */}

    final skuImg = {for (final s in _skus) s.id: s.image};
    final lines = <Map<String, dynamic>>[];
    for (final raw in items) {
      final id = '${raw['order_item_id'] ?? ''}';
      if (id.isEmpty) continue;
      final sold = (raw['qty'] as num?)?.toInt() ?? 0;
      final returned = returnedBy[id] ?? 0;
      if (sold - returned <= 0) continue;
      final skuId = '${raw['sku_id'] ?? ''}';
      lines.add({
        'order_item_id': id,
        'name': '${raw['name'] ?? ''}',
        'sku_id': skuId,
        'code': '${raw['item_code'] ?? raw['item_barcode'] ?? ''}',
        'image': skuId.isNotEmpty ? skuImg[skuId] : null,
        'unit_price': (raw['unit_price'] as num?)?.toInt() ?? 0,
        'sold': sold,
        'returned': returned,
        'qty': 0, // SL sẽ trả (thu ngân chọn +/-)
        'disposition': 'restock',
      });
    }
    if (lines.isEmpty) {
      if (mounted) appToast(context, t('Bill này đã được trả hết.'));
      return;
    }
    setState(() {
      _nextTabId++;
      _tabs.add(RetailSaleTab(
          id: _nextTabId, returnOfOrderId: orderId, returnLines: lines));
      _activeTabId = _nextTabId;
    });
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
        tab.note = '';
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
                        child: RepaintBoundary(
                            child: _tab.isReturn
                                ? _returnCartPanel()
                                : _cartPanel())),
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
                    child: RepaintBoundary(
                        child:
                            _tab.isReturn ? _returnCartPanel() : _cartPanel()),
                  ),
                ],
              );
            }),
          ),
        ],
      ),
    );
  }

  Future<void> _openSharedTab(RetailSaleTab tab) async {
    if (tab.id == _activeTabId) return;
    final others =
        tab.activeDevices.where((device) => device != _cartClientId).toList();
    if (others.isNotEmpty) {
      final accepted = await showDialog<bool>(
        context: context,
        builder: (ctx) => AlertDialog(
          title: Text(t('Giỏ đang được mở ở thiết bị khác')),
          content: Text(t(
              'Nếu tiếp tục, hai thiết bị sẽ cùng nhìn thấy cập nhật realtime. Hệ thống sẽ chặn ghi đè khi phiên bản đã cũ.')),
          actions: [
            TextButton(
                onPressed: () => Navigator.pop(ctx, false),
                child: Text(t('Hủy'))),
            FilledButton(
                onPressed: () => Navigator.pop(ctx, true),
                child: Text(t('Vẫn mở giỏ'))),
          ],
        ),
      );
      if (accepted != true || !mounted) return;
    }
    final previous = _activeTabId;
    setState(() => _activeTabId = tab.id);
    _leavePresence(previous);
    _heartbeatPresence();
    _pushCustomerDisplay();
    _ensureCanonicalSession(); // §2 gated
  }
}

/// Nút mở bảng "Lọc & sắp xếp" (thay cho FilterChip "Còn hàng" cũ) — tô màu
/// khi có bộ lọc/sắp xếp đang áp dụng để thu ngân biết danh sách đang bị lọc.
class _FilterButton extends StatelessWidget {
  final bool active;
  final VoidCallback onPressed;

  const _FilterButton({required this.active, required this.onPressed});

  @override
  Widget build(BuildContext context) {
    return OutlinedButton.icon(
      onPressed: onPressed,
      style: OutlinedButton.styleFrom(
        backgroundColor: active ? DanColors.brand.withValues(alpha: 0.1) : null,
        foregroundColor: active ? DanColors.brand : null,
        side: active ? BorderSide(color: DanColors.brand) : null,
      ),
      icon: Icon(Icons.filter_list, size: 18),
      label: Text(t('Lọc')),
    );
  }
}

// Một dòng hiển thị trong giỏ: hàng thường (line) HOẶC 1 combo (comboId + nhóm).
class _CartDisplay {
  final CartLine? line;
  final String? comboId;
  final List<CartLine> comboLines;
  const _CartDisplay.single(this.line)
      : comboId = null,
        comboLines = const [];
  const _CartDisplay.combo(this.comboId, this.comboLines) : line = null;
  bool get isCombo => comboId != null;
}
