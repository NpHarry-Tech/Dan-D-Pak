import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../../services/api_service.dart';
import '../../services/local_store.dart';
import '../../services/socket_service.dart';
import 'self_order_cart.dart';
import 'self_order_models.dart';
import 'self_order_payment_screen.dart';
import 'self_order_staff_exit.dart';
import 'self_order_strings.dart';
import '../../utils/translation.dart';

/// Màn hình GỌI MÓN của khách (kiosk). Bàn đã cố định từ màn chọn bàn.
/// - Có mục t("Món bạn hay gọi") (từ lần ăn thứ 3 của SĐT đã check-in).
/// - GỬI BẾP nhiều đợt trong bữa; xong bữa bấm THANH TOÁN.
/// - Mục t("Món đã gửi bếp") hiện trạng thái từng món REALTIME theo KDS
///   (chờ xác nhận → bếp nhận → đang chế biến → đã xong → đã phục vụ).
class SelfOrderMenuScreen extends StatefulWidget {
  final String serverUrl;
  final String? branchId;
  final String? staffToken;
  final SoTableModel table;
  final SelfOrderLang lang;
  final Map<String, dynamic>? customer;
  final List<dynamic> favorites;

  /// Đơn MỞ sẵn của bàn (khách gọi tiếp giữa bữa): màn chọn bàn truyền vào để
  /// tiếp tục phiên — không bắt chọn lại ngôn ngữ / nhập lại SĐT.
  final Map<String, dynamic>? resumeOrder;

  SelfOrderMenuScreen({
    super.key,
    required this.serverUrl,
    this.branchId,
    this.staffToken,
    required this.table,
    required this.lang,
    this.customer,
    this.favorites = const [],
    this.resumeOrder,
  });

  @override
  State<SelfOrderMenuScreen> createState() => _SelfOrderMenuScreenState();
}

class _SelfOrderMenuScreenState extends State<SelfOrderMenuScreen> {
  List<SoMenuItem> _menu = [];
  final List<SoCartItem> _cart = [];
  String _selectedCategory = 'all';
  SoMenuItem? _detailItem;
  bool _loading = true;
  String? _error;
  bool _sending = false;
  Map<String, dynamic>? _bookMenuConfig;
  String? _orderId; // đơn mở của bàn — có sau lần gửi bếp đầu tiên
  int _sentTotal = 0; // tổng tiền các món ĐÃ gửi bếp
  // Món đã gửi bếp (kèm status KDS) — cập nhật realtime qua socket.
  List<Map<String, dynamic>> _sentItems = [];

  late final ApiService _api;
  void Function(String, dynamic)? _socketListener;

  SelfOrderLang get L => widget.lang;

  @override
  void initState() {
    super.initState();
    _api = ApiService(
      baseUrl: widget.serverUrl,
      token: widget.staffToken,
      branchId: widget.branchId,
    );
    // Nhớ ngôn ngữ khách đã chọn cho bàn này — giữa bữa quay lại gọi thêm
    // thì vào thẳng menu đúng ngôn ngữ, không hỏi lại.
    LocalStore.instance.setString('so_lang_${widget.table.id}', L.code);
    final resume = widget.resumeOrder;
    if (resume != null) _applyOrder(resume);
    _socketListener = _onSocket;
    SocketService().addListener(_socketListener!);
    _load();
  }

  @override
  void dispose() {
    if (_socketListener != null) {
      SocketService().removeListener(_socketListener!);
    }
    super.dispose();
  }

  /// Đồng bộ trạng thái đơn từ server (id, tổng đã gửi, danh sách món + status).
  void _applyOrder(Map<String, dynamic> order) {
    final id = (order['id'] ?? '').toString();
    if (id.isEmpty) return;
    _orderId = id;
    final total = order['total'];
    _sentTotal = total is num
        ? total.toInt()
        : int.tryParse('${total ?? ''}') ?? _sentTotal;
    final items = order['items'];
    if (items is List) {
      _sentItems = items
          .whereType<Map>()
          .map((e) => Map<String, dynamic>.from(e))
          .toList();
    }
  }

  void _onSocket(String event, dynamic payload) {
    if (!mounted || payload is! Map) return;
    final oid = _orderId;
    if (oid == null) return;
    switch (event) {
      case 'order:item': // KDS đổi trạng thái món → cập nhật chip ngay
      case 'order:updated':
      case 'order:confirmed':
      case 'order:new':
        final order = payload['order'];
        final pid =
            (payload['order_id'] ?? (order is Map ? order['id'] : '') ?? '')
                .toString();
        if (pid == oid && order is Map) {
          setState(() => _applyOrder(Map<String, dynamic>.from(order)));
        }
        break;
      case 'payment:done':
        if ((payload['order_id'] ?? '').toString() == oid) {
          // Thu ngân đã tính tiền bàn này → kết thúc phiên, về màn chọn bàn.
          ScaffoldMessenger.of(context).showSnackBar(SnackBar(
            content: Text(L.paidOk),
            backgroundColor: Color(0xFF49D17F),
          ));
          Navigator.of(context)
              .popUntil((r) => !((r.settings.name ?? '').startsWith('/so-')));
        }
        break;
    }
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final rawMenu = await _api.fetchMenuRaw(lang: L.code);
      Map<String, dynamic>? bookMenuConfig;
      try {
        bookMenuConfig = await _api.getPublicBookMenuConfig();
      } catch (_) {
        bookMenuConfig = null;
      }
      if (!mounted) return;
      setState(() {
        _menu = rawMenu;
        _bookMenuConfig = bookMenuConfig;
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.toString().replaceFirst('Exception: ', '');
        _loading = false;
      });
    }
  }

  List<String> get _categories {
    final cats = <String>{};
    for (final item in _menu) {
      if (item.category?.isNotEmpty == true) cats.add(item.category!);
    }
    return ['all', ...cats];
  }

  List<SoMenuItem> get _filteredMenu => _selectedCategory == 'all'
      ? _menu
      : _menu.where((i) => i.category == _selectedCategory).toList();

  String _categoryLabel(String category) =>
      category == 'all' ? L.allCategory : L.categoryName(category);

  /// Món hay gọi — map id server trả về sang SoMenuItem đang bán.
  List<SoMenuItem> get _favoriteMenuItems {
    final ids = widget.favorites
        .whereType<Map>()
        .map((f) => (f['id'] ?? '').toString())
        .where((id) => id.isNotEmpty)
        .toList();
    return [
      for (final id in ids)
        for (final m in _menu)
          if (m.id == id) m
    ];
  }

  int get _cartTotal => _cart.fold(0, (s, i) => s + i.totalPrice);

  void _addItem(SoMenuItem item) {
    setState(() {
      for (final ci in _cart) {
        if (ci.item.id == item.id &&
            ci.notes.isEmpty &&
            ci.selectedModifiers.isEmpty) {
          ci.qty++;
          return;
        }
      }
      _cart.add(
          SoCartItem(item: item, qty: 1, notes: '', selectedModifiers: []));
    });
  }

  void _showItem(SoMenuItem item) => setState(() => _detailItem = item);

  void _addItemById(String id) {
    for (final item in _menu) {
      if (item.id == id) {
        _addItem(item);
        return;
      }
    }
  }

  void _addDetailItem(SoMenuItem item) {
    _addItem(item);
    setState(() => _detailItem = null);
  }

  void _changeQty(int index, int newQty) {
    setState(() {
      if (newQty <= 0) {
        _cart.removeAt(index);
      } else {
        _cart[index].qty = newQty;
      }
    });
  }

  Future<void> _sendOrder() async {
    if (_cart.isEmpty) return;
    setState(() => _sending = true);
    try {
      final items = _cart
          .map((c) => {
                'menu_item_id': c.item.id,
                'qty': c.qty,
                'note': c.notes,
                'mods': <Map<String, dynamic>>[],
              })
          .toList();

      final cust = widget.customer;
      final r = await _api.createOrder(
        tableId: widget.table.id,
        orderType: 'dine_in',
        source: 'customer_ipad', // khách tự gọi → chờ nhân viên xác nhận
        items: items,
        customer: (cust != null && (cust['id'] ?? '').toString().isNotEmpty)
            ? {
                'id': cust['id'],
                'name': cust['name'] ?? '',
                'phone': cust['phone'] ?? '',
              }
            : null,
      );
      if (!mounted) return;
      setState(() {
        // Server trả về đơn ĐẦY ĐỦ (id, total, items + status) — đồng bộ
        // thẳng thay vì tự cộng dồn phía client.
        _applyOrder(r);
        _cart.clear();
        _sending = false;
      });
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        content: Text(L.sentOk),
        backgroundColor: Color(0xFF49D17F),
        duration: Duration(seconds: 2),
      ));
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text(e.toString().replaceFirst('Exception: ', '')),
          backgroundColor: Color(0xFFFF7A7A)));
      setState(() => _sending = false);
    }
  }

  Future<void> _callStaff() async {
    try {
      await _api.callStaff(widget.table.id, L.callStaffBtn);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        content: Text(L.staffComing),
        backgroundColor: Color(0xFF0891B2),
      ));
    } catch (_) {}
  }

  void _checkout() {
    final orderId = _orderId;
    if (orderId == null) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text(L.needSendFirst), backgroundColor: Color(0xFFFF7A7A)));
      return;
    }
    Navigator.of(context).push(PageRouteBuilder(
      settings: RouteSettings(name: '/so-pay'),
      pageBuilder: (_, __, ___) => SelfOrderPaymentScreen(
        serverUrl: widget.serverUrl,
        branchId: widget.branchId,
        staffToken: widget.staffToken,
        table: widget.table,
        lang: L,
        orderId: orderId,
        customerPhone: (widget.customer?['phone'] ?? '').toString(),
      ),
      transitionsBuilder: (_, anim, __, child) =>
          FadeTransition(opacity: anim, child: child),
      transitionDuration: Duration(milliseconds: 350),
    ));
  }

  // ── Mục t("Món đã gửi bếp") — trạng thái realtime theo KDS ──────────────────
  void _openCartPopup() {
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(18)),
      ),
      builder: (_) => StatefulBuilder(
        builder: (context, setModalState) {
          void changeQty(int index, int qty) {
            _changeQty(index, qty);
            setModalState(() {});
          }

          return SafeArea(
            top: false,
            child: SizedBox(
              height: MediaQuery.sizeOf(context).height * 0.62,
              child: _CartPanel(
                lang: L,
                cart: _cart,
                sentItems: _sentItems,
                sentItemsSection: _sentItemsSection,
                total: _sentTotal + _cartTotal,
                sending: _sending,
                onClear: () {
                  setState(() => _cart.clear());
                  setModalState(() {});
                },
                onQtyChange: changeQty,
                onSend: _cart.isEmpty || _sending
                    ? null
                    : () {
                        Navigator.of(context).pop();
                        _sendOrder();
                      },
                onCheckout: _orderId == null || _sending
                    ? null
                    : () {
                        Navigator.of(context).pop();
                        _checkout();
                      },
              ),
            ),
          );
        },
      ),
    );
  }

  static Map<String, Color> _statusColors = {
    'pending_confirm': Color(0xFF9AA3B2),
    'new': Color(0xFF0891B2),
    'accepted': Color(0xFF0891B2),
    'preparing': Color(0xFFD97706),
    'ready': Color(0xFF16A34A),
    'served': Color(0xFF49D17F),
    'cancelled': Color(0xFFFF6B6B),
  };

  Widget _sentItemsSection() {
    return Container(
      constraints: BoxConstraints(maxHeight: 250),
      decoration: BoxDecoration(
        color: Color(0xFFF9FBFC),
        border: Border(bottom: BorderSide(color: Color(0xFFE7EAEE))),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: EdgeInsets.fromLTRB(16, 10, 16, 4),
            child: Text(
              '${L.sentItemsTitle} (${_sentItems.length})',
              style: TextStyle(
                fontSize: 12.5,
                fontWeight: FontWeight.w800,
                color: Color(0xFF677084),
              ),
            ),
          ),
          Flexible(
            child: ListView.builder(
              shrinkWrap: true,
              padding: EdgeInsets.fromLTRB(16, 0, 16, 10),
              itemCount: _sentItems.length,
              itemBuilder: (_, i) => _sentItemRow(_sentItems[i]),
            ),
          ),
        ],
      ),
    );
  }

  Widget _sentItemRow(Map<String, dynamic> item) {
    final status = (item['status'] ?? '').toString();
    final cancelled = status == 'cancelled';
    final color = _statusColors[status] ?? Color(0xFF9AA3B2);
    final qty = item['qty'] is num ? (item['qty'] as num).toInt() : 1;
    return Padding(
      padding: EdgeInsets.symmetric(vertical: 4),
      child: Row(
        children: [
          Expanded(
            child: Text(
              '${item['name'] ?? ''}  ×$qty',
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                fontSize: 13,
                color: cancelled ? Color(0xFF9AA3B2) : Color(0xFF1A2230),
                decoration: cancelled ? TextDecoration.lineThrough : null,
              ),
            ),
          ),
          SizedBox(width: 8),
          Container(
            padding: EdgeInsets.symmetric(horizontal: 8, vertical: 3),
            decoration: BoxDecoration(
              color: color.withValues(alpha: 0.12),
              borderRadius: BorderRadius.circular(999),
            ),
            child: Text(
              L.itemStatusLabel(status),
              style: TextStyle(
                fontSize: 10.5,
                fontWeight: FontWeight.w800,
                color: color,
              ),
            ),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final favs = _favoriteMenuItems;
    final isPortrait =
        MediaQuery.orientationOf(context) == Orientation.portrait;
    final rawBook = _bookMenuConfig?['book'];
    final showBookMenu = isPortrait &&
        _bookMenuConfig?['enabled'] != false &&
        rawBook is Map &&
        rawBook['pages'] is List &&
        (rawBook['pages'] as List).isNotEmpty;
    return Scaffold(
      backgroundColor: Color(0xFFF7F8FA),
      appBar: AppBar(
        automaticallyImplyLeading: false,
        backgroundColor: Colors.white,
        elevation: 0,
        scrolledUnderElevation: 0,
        title: Row(children: [
          SelfOrderStaffLogo(api: _api),
          SizedBox(width: 10),
          Text(L.menuTitle,
              style: TextStyle(
                  fontWeight: FontWeight.bold, color: Color(0xFF1A2230))),
          SizedBox(width: 16),
          Container(
            padding: EdgeInsets.symmetric(horizontal: 12, vertical: 6),
            decoration: BoxDecoration(
              color: Color(0xFF0891B2).withValues(alpha: 0.12),
              borderRadius: BorderRadius.circular(20),
              border: Border.all(color: Color(0xFF0891B2)),
            ),
            child: Row(mainAxisSize: MainAxisSize.min, children: [
              Icon(Icons.table_bar_rounded, size: 16, color: Color(0xFF0891B2)),
              SizedBox(width: 6),
              Text(widget.table.name,
                  style: TextStyle(
                      fontWeight: FontWeight.bold,
                      fontSize: 13,
                      color: Color(0xFF0891B2))),
            ]),
          ),
        ]),
        actions: [
          TextButton.icon(
            onPressed: _callStaff,
            icon: Icon(Icons.notifications_active_outlined,
                size: 18, color: Color(0xFF677084)),
            label: Text(L.callStaffBtn,
                style: TextStyle(fontSize: 13, color: Color(0xFF677084))),
          ),
          Padding(
            padding: EdgeInsets.symmetric(horizontal: 8),
            child: Center(
                child: Text(widget.lang.flag, style: TextStyle(fontSize: 22))),
          ),
        ],
      ),
      body: _loading
          ? Center(child: CircularProgressIndicator(color: Color(0xFF0891B2)))
          : showBookMenu
              ? _BookMenuOrderView(
                  book: Map<String, dynamic>.from(rawBook),
                  serverUrl: widget.serverUrl,
                  lang: L,
                  cartCount: _cart.fold<int>(0, (sum, item) => sum + item.qty),
                  cartTotal: _cartTotal + _sentTotal,
                  onHotspotTap: _addItemById,
                  onOpenCart: _openCartPopup,
                )
              : Row(children: [
                  // ── Menu trái ──────────────────────────────────────────────
                  Expanded(
                    flex: 7,
                    child: Column(children: [
                      Container(
                        height: 52,
                        color: Colors.white,
                        child: ListView.builder(
                          scrollDirection: Axis.horizontal,
                          padding:
                              EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                          itemCount: _categories.length,
                          itemBuilder: (_, i) {
                            final cat = _categories[i];
                            final active = cat == _selectedCategory;
                            return Padding(
                              padding: EdgeInsets.only(right: 8),
                              child: ChoiceChip(
                                label: Text(_categoryLabel(cat)),
                                selected: active,
                                selectedColor: Color(0xFF0891B2),
                                checkmarkColor: Colors.white,
                                backgroundColor: Color(0xFFF3F5F7),
                                labelStyle: TextStyle(
                                  color:
                                      active ? Colors.white : Color(0xFF677084),
                                  fontWeight: FontWeight.bold,
                                  fontSize: 13,
                                ),
                                onSelected: (_) =>
                                    setState(() => _selectedCategory = cat),
                              ),
                            );
                          },
                        ),
                      ),
                      if (_error != null)
                        Container(
                          width: double.infinity,
                          padding: EdgeInsets.all(10),
                          color: Color(0xFFFF7A7A).withValues(alpha: 0.12),
                          child: Text(_error!,
                              style: TextStyle(color: Color(0xFFFF7A7A)),
                              textAlign: TextAlign.center),
                        ),
                      // ⭐ Món bạn hay gọi (từ lần ăn thứ 3)
                      if (favs.isNotEmpty && _selectedCategory == 'all')
                        Container(
                          color: Color(0xFFFFF9E9),
                          padding: EdgeInsets.only(top: 10, bottom: 12),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Padding(
                                padding: EdgeInsets.symmetric(horizontal: 14),
                                child: Text(L.reorderTitle,
                                    style: TextStyle(
                                        fontWeight: FontWeight.w800,
                                        fontSize: 13.5,
                                        color: Color(0xFFB8860B))),
                              ),
                              SizedBox(height: 8),
                              SizedBox(
                                height: 108,
                                child: ListView.builder(
                                  scrollDirection: Axis.horizontal,
                                  padding: EdgeInsets.symmetric(horizontal: 12),
                                  itemCount: favs.length,
                                  itemBuilder: (_, i) =>
                                      _FavCard(item: favs[i], onTap: _showItem),
                                ),
                              ),
                            ],
                          ),
                        ),
                      Expanded(
                        child: Stack(
                          children: [
                            Positioned.fill(
                              child: _filteredMenu.isEmpty
                                  ? Center(
                                      child: Text('—',
                                          style: TextStyle(
                                              color: Colors.grey[400],
                                              fontSize: 32)))
                                  : GridView.builder(
                                      padding: EdgeInsets.all(14),
                                      gridDelegate:
                                          SliverGridDelegateWithMaxCrossAxisExtent(
                                        maxCrossAxisExtent: 190,
                                        childAspectRatio: 0.78,
                                        crossAxisSpacing: 12,
                                        mainAxisSpacing: 12,
                                      ),
                                      itemCount: _filteredMenu.length,
                                      itemBuilder: (_, i) => _MenuCard(
                                          item: _filteredMenu[i],
                                          onTap: _showItem),
                                    ),
                            ),
                            if (_detailItem != null)
                              Positioned.fill(
                                child: LayoutBuilder(
                                  builder: (context, constraints) {
                                    var width = (constraints.maxWidth * 0.72)
                                        .clamp(420.0, 760.0);
                                    final maxSafe = constraints.maxWidth - 24;
                                    if (width > maxSafe) width = maxSafe;
                                    return Align(
                                      alignment: Alignment.centerRight,
                                      child: _ItemDetailPanel(
                                        item: _detailItem!,
                                        lang: L,
                                        width: width,
                                        categoryLabel: _categoryLabel(
                                            _detailItem!.category ?? ''),
                                        onClose: () =>
                                            setState(() => _detailItem = null),
                                        onAdd: () =>
                                            _addDetailItem(_detailItem!),
                                      ),
                                    );
                                  },
                                ),
                              ),
                          ],
                        ),
                      ),
                    ]),
                  ),

                  // ── Cart phải ───────────────────────────────────────────────
                  VerticalDivider(color: Color(0xFFE7EAEE), width: 1),
                  Expanded(
                    flex: 3,
                    child: Container(
                      color: Colors.white,
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          Container(
                            padding: EdgeInsets.symmetric(
                                horizontal: 16, vertical: 14),
                            decoration: BoxDecoration(
                              color: Color(0xFFF3F5F7),
                              border: Border(
                                  bottom: BorderSide(color: Color(0xFFE7EAEE))),
                            ),
                            child: Row(
                              mainAxisAlignment: MainAxisAlignment.spaceBetween,
                              children: [
                                Text(L.cartTitle,
                                    style: TextStyle(
                                        fontSize: 16,
                                        fontWeight: FontWeight.bold,
                                        color: Color(0xFF1A2230))),
                                if (_cart.isNotEmpty)
                                  GestureDetector(
                                    onTap: () => setState(() => _cart.clear()),
                                    child: Text(L.clearCartBtn,
                                        style: TextStyle(
                                            color: Color(0xFFFF6B6B),
                                            fontWeight: FontWeight.bold,
                                            fontSize: 13)),
                                  ),
                              ],
                            ),
                          ),
                          // Món ĐÃ GỬI BẾP + trạng thái realtime theo KDS.
                          if (_sentItems.isNotEmpty) _sentItemsSection(),
                          Expanded(
                            child: _cart.isEmpty
                                ? Center(
                                    child: Column(
                                      mainAxisSize: MainAxisSize.min,
                                      children: [
                                        Opacity(
                                          opacity: 0.55,
                                          child: Image.asset(
                                            'assets/brand/DanOnLogo.png',
                                            width: 140,
                                            fit: BoxFit.contain,
                                            errorBuilder: (_, __, ___) => Icon(
                                                Icons.shopping_basket_outlined,
                                                size: 48,
                                                color: Color(0xFFD3D8DF)),
                                          ),
                                        ),
                                        SizedBox(height: 12),
                                        Text(L.cartEmpty,
                                            style: TextStyle(
                                                color: Color(0xFF9AA3B2),
                                                fontSize: 14)),
                                      ],
                                    ),
                                  )
                                : ListView.separated(
                                    padding: EdgeInsets.all(14),
                                    itemCount: _cart.length,
                                    separatorBuilder: (_, __) => Divider(
                                        color: Color(0xFFE7EAEE), height: 16),
                                    itemBuilder: (_, i) => _CartRow(
                                      item: _cart[i],
                                      onQtyChange: (q) => _changeQty(i, q),
                                    ),
                                  ),
                          ),
                          Container(
                            padding: EdgeInsets.all(18),
                            decoration: BoxDecoration(
                              color: Color(0xFFF3F5F7),
                              border: Border(
                                  top: BorderSide(color: Color(0xFFE7EAEE))),
                            ),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.stretch,
                              children: [
                                Row(
                                  mainAxisAlignment:
                                      MainAxisAlignment.spaceBetween,
                                  children: [
                                    Text(L.totalLabel,
                                        style: TextStyle(
                                            fontSize: 14,
                                            fontWeight: FontWeight.w600,
                                            color: Color(0xFF677084))),
                                    Text(t('đ${_sentTotal + _cartTotal}'),
                                        style: TextStyle(
                                            fontSize: 22,
                                            fontWeight: FontWeight.w900,
                                            color: Color(0xFF0891B2))),
                                  ],
                                ),
                                SizedBox(height: 14),
                                FilledButton(
                                  onPressed: (_cart.isEmpty || _sending)
                                      ? null
                                      : _sendOrder,
                                  style: FilledButton.styleFrom(
                                    backgroundColor: Color(0xFF0891B2),
                                    padding: EdgeInsets.symmetric(vertical: 16),
                                    shape: RoundedRectangleBorder(
                                        borderRadius:
                                            BorderRadius.circular(12)),
                                  ),
                                  child: _sending
                                      ? SizedBox(
                                          width: 20,
                                          height: 20,
                                          child: CircularProgressIndicator(
                                              strokeWidth: 2,
                                              color: Colors.white))
                                      : Text(L.sendKitchenBtn,
                                          style: TextStyle(
                                              fontSize: 15,
                                              fontWeight: FontWeight.bold)),
                                ),
                                SizedBox(height: 8),
                                OutlinedButton.icon(
                                  onPressed: (_orderId == null || _sending)
                                      ? null
                                      : _checkout,
                                  style: OutlinedButton.styleFrom(
                                    foregroundColor: Color(0xFF16A34A),
                                    side: BorderSide(
                                        color: _orderId == null
                                            ? Color(0xFFD3D8DF)
                                            : Color(0xFF16A34A)),
                                    padding: EdgeInsets.symmetric(vertical: 14),
                                    shape: RoundedRectangleBorder(
                                        borderRadius:
                                            BorderRadius.circular(12)),
                                  ),
                                  icon: Icon(Icons.payments_outlined, size: 18),
                                  label: Text(L.checkoutBtn,
                                      style: TextStyle(
                                          fontSize: 14,
                                          fontWeight: FontWeight.bold)),
                                ),
                              ],
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ]),
    );
  }
}

// ─── Món hay gọi (thẻ ngang) ─────────────────────────────────────────────────

class _BookMenuOrderView extends StatefulWidget {
  final Map<String, dynamic> book;
  final String serverUrl;
  final SelfOrderLang lang;
  final int cartCount;
  final int cartTotal;
  final ValueChanged<String> onHotspotTap;
  final VoidCallback onOpenCart;

  const _BookMenuOrderView({
    required this.book,
    required this.serverUrl,
    required this.lang,
    required this.cartCount,
    required this.cartTotal,
    required this.onHotspotTap,
    required this.onOpenCart,
  });

  @override
  State<_BookMenuOrderView> createState() => _BookMenuOrderViewState();
}

class _BookMenuOrderViewState extends State<_BookMenuOrderView>
    with SingleTickerProviderStateMixin {
  int _page = 0;
  double _drag = 0;
  bool _fromRight = true;

  List<Map<String, dynamic>> get _pages => (widget.book['pages'] as List)
      .whereType<Map>()
      .map((e) => Map<String, dynamic>.from(e))
      .toList();

  List<Map<String, dynamic>> get _hotspots =>
      (widget.book['hotspots'] as List? ?? const [])
          .whereType<Map>()
          .map((e) => Map<String, dynamic>.from(e))
          .where((h) => h['enabled'] != false)
          .toList();

  void _startDrag(DragStartDetails d, double width) {
    _fromRight = d.localPosition.dx > width / 2;
    setState(() => _drag = 0.01);
  }

  void _updateDrag(DragUpdateDetails d, double width) {
    final delta = _fromRight ? -d.delta.dx : d.delta.dx;
    setState(() => _drag = (_drag + delta / width).clamp(0, 1));
  }

  void _endDrag() {
    final next = _fromRight ? _page + 1 : _page - 1;
    setState(() {
      if (_drag > .35 && next >= 0 && next < _pages.length) _page = next;
      _drag = 0;
    });
  }

  String _src(Map<String, dynamic> page) {
    final src = (page['src'] ?? '').toString();
    if (src.startsWith('http://') || src.startsWith('https://')) return src;
    final base = widget.serverUrl.replaceFirst(RegExp(r'/$'), '');
    return '$base$src';
  }

  @override
  Widget build(BuildContext context) {
    final nextPage = _fromRight ? _page + 1 : _page - 1;
    final hasNext = nextPage >= 0 && nextPage < _pages.length;
    return Stack(
      children: [
        Positioned.fill(
          child: LayoutBuilder(
            builder: (context, box) {
              final width = box.maxWidth;
              final height = box.maxHeight;
              final pageWidth = math.min(width - 24, height * .72);
              final pageHeight = math.min(height - 20, pageWidth * 1.5);
              return GestureDetector(
                onPanStart: (d) => _startDrag(d, pageWidth),
                onPanUpdate: (d) => _updateDrag(d, pageWidth),
                onPanEnd: (_) => _endDrag(),
                child: Center(
                  child: SizedBox(
                    width: pageWidth,
                    height: pageHeight,
                    child: Stack(
                      children: [
                        if (hasNext)
                          Opacity(
                            opacity: _drag.clamp(.08, 1),
                            child: _BookPageImage(src: _src(_pages[nextPage])),
                          ),
                        Transform(
                          alignment: _fromRight
                              ? Alignment.centerRight
                              : Alignment.centerLeft,
                          transform: Matrix4.identity()
                            ..setEntry(3, 2, 0.001)
                            ..rotateY(
                                (_fromRight ? -1 : 1) * _drag * math.pi * .72),
                          child: _BookPageImage(src: _src(_pages[_page])),
                        ),
                        for (final h in _hotspots)
                          if ((h['page'] as num?)?.toInt() == _page)
                            Positioned(
                              left: pageWidth * ((h['x'] as num? ?? 50) / 100) -
                                  22,
                              top: pageHeight * ((h['y'] as num? ?? 50) / 100) -
                                  22,
                              child: Material(
                                color: Color(0xFF0891B2).withValues(alpha: .88),
                                shape: CircleBorder(),
                                child: InkWell(
                                  customBorder: CircleBorder(),
                                  onTap: () => widget.onHotspotTap(
                                      (h['menu_item_id'] ?? '').toString()),
                                  child: SizedBox(
                                    width: 44,
                                    height: 44,
                                    child: Icon(Icons.add_shopping_cart,
                                        color: Colors.white, size: 20),
                                  ),
                                ),
                              ),
                            ),
                      ],
                    ),
                  ),
                ),
              );
            },
          ),
        ),
        Positioned(
          right: 18,
          bottom: 18,
          child: FilledButton.icon(
            onPressed: widget.onOpenCart,
            icon: Badge(
              label: Text('${widget.cartCount}'),
              isLabelVisible: widget.cartCount > 0,
              child: Icon(Icons.shopping_cart_outlined),
            ),
            label:
                Text('${widget.lang.cartTitle} · ${t('đ${widget.cartTotal}')}'),
            style: FilledButton.styleFrom(
              backgroundColor: Color(0xFF0891B2),
              padding: EdgeInsets.symmetric(horizontal: 18, vertical: 14),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(999),
              ),
            ),
          ),
        ),
      ],
    );
  }
}

class _BookPageImage extends StatelessWidget {
  final String src;
  const _BookPageImage({required this.src});

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(8),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: .12),
            blurRadius: 20,
            offset: Offset(0, 8),
          )
        ],
      ),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(8),
        child: Image.network(src, fit: BoxFit.contain),
      ),
    );
  }
}

class _CartPanel extends StatelessWidget {
  final SelfOrderLang lang;
  final List<SoCartItem> cart;
  final List<Map<String, dynamic>> sentItems;
  final Widget Function() sentItemsSection;
  final int total;
  final bool sending;
  final VoidCallback onClear;
  final void Function(int index, int qty) onQtyChange;
  final VoidCallback? onSend;
  final VoidCallback? onCheckout;

  const _CartPanel({
    required this.lang,
    required this.cart,
    required this.sentItems,
    required this.sentItemsSection,
    required this.total,
    required this.sending,
    required this.onClear,
    required this.onQtyChange,
    required this.onSend,
    required this.onCheckout,
  });

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Container(
          padding: EdgeInsets.symmetric(horizontal: 16, vertical: 14),
          decoration: BoxDecoration(
            color: Color(0xFFF3F5F7),
            border: Border(bottom: BorderSide(color: Color(0xFFE7EAEE))),
          ),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(lang.cartTitle,
                  style: TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.bold,
                      color: Color(0xFF1A2230))),
              if (cart.isNotEmpty)
                GestureDetector(
                  onTap: onClear,
                  child: Text(lang.clearCartBtn,
                      style: TextStyle(
                          color: Color(0xFFFF6B6B),
                          fontWeight: FontWeight.bold,
                          fontSize: 13)),
                ),
            ],
          ),
        ),
        if (sentItems.isNotEmpty) sentItemsSection(),
        Expanded(
          child: cart.isEmpty
              ? Center(
                  child: Text(lang.cartEmpty,
                      style: TextStyle(color: Color(0xFF9AA3B2), fontSize: 14)),
                )
              : ListView.separated(
                  padding: EdgeInsets.all(14),
                  itemCount: cart.length,
                  separatorBuilder: (_, __) =>
                      Divider(color: Color(0xFFE7EAEE), height: 16),
                  itemBuilder: (_, i) => _CartRow(
                    item: cart[i],
                    onQtyChange: (q) => onQtyChange(i, q),
                  ),
                ),
        ),
        Container(
          padding: EdgeInsets.all(18),
          decoration: BoxDecoration(
            color: Color(0xFFF3F5F7),
            border: Border(top: BorderSide(color: Color(0xFFE7EAEE))),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text(lang.totalLabel,
                      style: TextStyle(
                          fontSize: 14,
                          fontWeight: FontWeight.w600,
                          color: Color(0xFF677084))),
                  Text(t('đ$total'),
                      style: TextStyle(
                          fontSize: 22,
                          fontWeight: FontWeight.w900,
                          color: Color(0xFF0891B2))),
                ],
              ),
              SizedBox(height: 14),
              FilledButton(
                onPressed: onSend,
                style: FilledButton.styleFrom(
                  backgroundColor: Color(0xFF0891B2),
                  padding: EdgeInsets.symmetric(vertical: 16),
                  shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(12)),
                ),
                child: sending
                    ? SizedBox(
                        width: 20,
                        height: 20,
                        child: CircularProgressIndicator(
                            strokeWidth: 2, color: Colors.white))
                    : Text(lang.sendKitchenBtn,
                        style: TextStyle(
                            fontSize: 15, fontWeight: FontWeight.bold)),
              ),
              SizedBox(height: 8),
              OutlinedButton.icon(
                onPressed: onCheckout,
                style: OutlinedButton.styleFrom(
                  foregroundColor: Color(0xFF16A34A),
                  padding: EdgeInsets.symmetric(vertical: 14),
                  shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(12)),
                ),
                icon: Icon(Icons.payments_outlined, size: 18),
                label: Text(lang.checkoutBtn,
                    style:
                        TextStyle(fontSize: 14, fontWeight: FontWeight.bold)),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

class _ItemDetailPanel extends StatelessWidget {
  final SoMenuItem item;
  final SelfOrderLang lang;
  final double width;
  final String categoryLabel;
  final VoidCallback onClose;
  final VoidCallback onAdd;

  _ItemDetailPanel({
    required this.item,
    required this.lang,
    required this.width,
    required this.categoryLabel,
    required this.onClose,
    required this.onAdd,
  });

  String get _itemCode {
    final values = [item.code, item.barcode]
        .whereType<String>()
        .map((e) => e.trim())
        .where((e) => e.isNotEmpty)
        .toList();
    return values.isEmpty ? '' : values.first;
  }

  String _joinList(List<dynamic> values) => values
      .map((e) {
        if (e is Map) return (e['name'] ?? e['label'] ?? '').toString().trim();
        return e.toString().trim();
      })
      .where((e) => e.isNotEmpty)
      .toList()
      .join(', ');

  List<(String, String)> get _rows {
    final rows = <(String, String)>[];
    void add(String label, String value) {
      final v = value.trim();
      if (v.isNotEmpty) rows.add((label, v));
    }

    add(lang.categoryLabel, categoryLabel);
    add(lang.descriptionLabel, item.description ?? '');
    add(lang.codeLabel, _itemCode);
    add(lang.ingredientsLabel, _joinList(item.ingredients));
    add(lang.allergensLabel, _joinList(item.allergens));
    if (item.slaMinutes > 0) {
      add(lang.prepTimeLabel, '${item.slaMinutes} ${lang.minutesSuffix}');
    }
    return rows;
  }

  @override
  Widget build(BuildContext context) {
    final optionRows = <(String, String)>[];
    void addOption(String label, String value) {
      final v = value.trim();
      if (v.isNotEmpty) optionRows.add((label, v));
    }

    addOption(lang.optionsLabel, _joinList(item.modifiers));
    addOption(lang.addonsLabel, _joinList(item.addons));

    return Container(
      width: width,
      margin: EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: Color(0xFFE7EAEE)),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.14),
            blurRadius: 22,
            offset: Offset(0, 10),
          ),
        ],
      ),
      clipBehavior: Clip.antiAlias,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          SizedBox(
            height: 250,
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Expanded(child: _itemImage()),
                Expanded(
                  child: Padding(
                    padding: EdgeInsets.fromLTRB(18, 16, 14, 12),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Expanded(
                              child: Text(
                                item.name,
                                maxLines: 3,
                                overflow: TextOverflow.ellipsis,
                                style: TextStyle(
                                  fontSize: 21,
                                  fontWeight: FontWeight.w900,
                                  color: Color(0xFF1A2230),
                                ),
                              ),
                            ),
                            IconButton(
                              onPressed: onClose,
                              icon: Icon(Icons.close),
                              color: Color(0xFF677084),
                              tooltip: lang.backBtn,
                            ),
                          ],
                        ),
                        SizedBox(height: 6),
                        Text(
                          t('đ${item.price}'),
                          style: TextStyle(
                            fontSize: 24,
                            fontWeight: FontWeight.w900,
                            color: Color(0xFF0891B2),
                          ),
                        ),
                        SizedBox(height: 12),
                        Expanded(
                          child: optionRows.isEmpty
                              ? Text(
                                  lang.itemInfoTitle,
                                  style: TextStyle(
                                    fontSize: 12,
                                    fontWeight: FontWeight.w800,
                                    color: Color(0xFF9AA3B2),
                                  ),
                                )
                              : SingleChildScrollView(
                                  child: Column(
                                    crossAxisAlignment:
                                        CrossAxisAlignment.start,
                                    children: [
                                      for (final row in optionRows)
                                        _infoRow(row.$1, row.$2),
                                    ],
                                  ),
                                ),
                        ),
                      ],
                    ),
                  ),
                ),
              ],
            ),
          ),
          Divider(height: 1, color: Color(0xFFE7EAEE)),
          Expanded(
            child: _rows.isEmpty
                ? Center(
                    child: Text(
                      lang.itemInfoTitle,
                      style: TextStyle(
                        color: Color(0xFF9AA3B2),
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                  )
                : SingleChildScrollView(
                    padding: EdgeInsets.fromLTRB(18, 16, 18, 12),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        for (final row in _rows) _infoRow(row.$1, row.$2),
                      ],
                    ),
                  ),
          ),
          Padding(
            padding: EdgeInsets.fromLTRB(18, 0, 18, 18),
            child: FilledButton.icon(
              onPressed: onAdd,
              icon: Icon(Icons.add_shopping_cart, size: 18),
              label: Text(
                lang.addToCartBtn,
                style: TextStyle(fontSize: 15, fontWeight: FontWeight.w900),
              ),
              style: FilledButton.styleFrom(
                backgroundColor: Color(0xFF0891B2),
                padding: EdgeInsets.symmetric(vertical: 15),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(12),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _itemImage() {
    final image = item.image;
    if (image != null && image.startsWith('http')) {
      return Image.network(
        image,
        fit: BoxFit.cover,
        cacheWidth: 760,
        filterQuality: FilterQuality.low,
        gaplessPlayback: true,
        errorBuilder: (_, __, ___) => _emojiBox(item.emoji),
      );
    }
    return _emojiBox(item.emoji);
  }

  Widget _infoRow(String label, String value) => Padding(
        padding: EdgeInsets.only(bottom: 12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              label,
              style: TextStyle(
                fontSize: 11.5,
                fontWeight: FontWeight.w900,
                color: Color(0xFF9AA3B2),
              ),
            ),
            SizedBox(height: 3),
            Text(
              value,
              style: TextStyle(
                fontSize: 14,
                height: 1.35,
                fontWeight: FontWeight.w700,
                color: Color(0xFF1A2230),
              ),
            ),
          ],
        ),
      );

  Widget _emojiBox(String? emoji) => Container(
        color: Color(0xFFF3F5F7),
        alignment: Alignment.center,
        child: Text(emoji ?? '🍽️', style: TextStyle(fontSize: 56)),
      );
}

class _FavCard extends StatelessWidget {
  final SoMenuItem item;
  final ValueChanged<SoMenuItem> onTap;
  _FavCard({required this.item, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: () => onTap(item),
      child: Container(
        width: 210,
        margin: EdgeInsets.only(right: 10),
        padding: EdgeInsets.all(10),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: Color(0xFFFFC24D)),
        ),
        child: Row(children: [
          Container(
            width: 56,
            height: 56,
            decoration: BoxDecoration(
              color: Color(0xFFF3F5F7),
              borderRadius: BorderRadius.circular(10),
            ),
            clipBehavior: Clip.antiAlias,
            child: item.image != null && item.image!.startsWith('http')
                ? Image.network(item.image!,
                    fit: BoxFit.cover,
                    // Decode cỡ thumbnail — menu dài không được nuốt RAM tablet.
                    cacheWidth: 112,
                    filterQuality: FilterQuality.low,
                    gaplessPlayback: true,
                    errorBuilder: (_, __, ___) =>
                        Center(child: Text(item.emoji ?? '🍽️')))
                : Center(
                    child: Text(item.emoji ?? '🍽️',
                        style: TextStyle(fontSize: 26))),
          ),
          SizedBox(width: 10),
          Expanded(
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(item.name,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                        fontWeight: FontWeight.bold,
                        fontSize: 13,
                        color: Color(0xFF1A2230))),
                SizedBox(height: 3),
                Text(t('đ${item.price}'),
                    style: TextStyle(
                        color: Color(0xFF0891B2),
                        fontWeight: FontWeight.w800,
                        fontSize: 13)),
              ],
            ),
          ),
          Icon(Icons.add_circle_rounded, color: Color(0xFF0891B2), size: 26),
        ]),
      ),
    );
  }
}

// ─── Menu card ────────────────────────────────────────────────────────────────

class _MenuCard extends StatelessWidget {
  final SoMenuItem item;
  final ValueChanged<SoMenuItem> onTap;
  _MenuCard({required this.item, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return Card(
      color: Colors.white,
      elevation: 0,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(14),
        side: BorderSide(color: Color(0xFFE7EAEE)),
      ),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: () => onTap(item),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Expanded(
              child: item.image != null && item.image!.startsWith('http')
                  ? Image.network(item.image!,
                      fit: BoxFit.cover,
                      // Ô lưới ~190dp — decode đúng cỡ hiển thị, menu hàng
                      // trăm món không được nuốt RAM/CPU tablet.
                      cacheWidth: 380,
                      filterQuality: FilterQuality.low,
                      gaplessPlayback: true,
                      errorBuilder: (_, __, ___) => _emojiBox(item.emoji))
                  : _emojiBox(item.emoji),
            ),
            Padding(
              padding: EdgeInsets.all(10),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(item.name,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                          fontSize: 13,
                          fontWeight: FontWeight.bold,
                          color: Color(0xFF1A2230))),
                  SizedBox(height: 3),
                  Text(t('đ${item.price}'),
                      style: TextStyle(
                          fontSize: 13,
                          color: Color(0xFF0891B2),
                          fontWeight: FontWeight.w800)),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _emojiBox(String? emoji) => Container(
      color: Color(0xFFF3F5F7),
      alignment: Alignment.center,
      child: Text(emoji ?? '🍽️', style: TextStyle(fontSize: 44)));
}

// ─── Cart row ─────────────────────────────────────────────────────────────────

class _CartRow extends StatelessWidget {
  final SoCartItem item;
  final ValueChanged<int> onQtyChange;
  _CartRow({required this.item, required this.onQtyChange});

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(item.item.name,
                  style: TextStyle(
                      fontWeight: FontWeight.bold,
                      color: Color(0xFF1A2230),
                      fontSize: 13)),
              Text(t('đ${item.totalPrice}'),
                  style: TextStyle(
                      color: Color(0xFF0891B2),
                      fontWeight: FontWeight.bold,
                      fontSize: 12)),
            ],
          ),
        ),
        Row(children: [
          _QtyBtn(icon: Icons.remove, onTap: () => onQtyChange(item.qty - 1)),
          Padding(
            padding: EdgeInsets.symmetric(horizontal: 10),
            child: Text('${item.qty}',
                style: TextStyle(
                    fontWeight: FontWeight.bold, color: Color(0xFF1A2230))),
          ),
          _QtyBtn(icon: Icons.add, onTap: () => onQtyChange(item.qty + 1)),
        ]),
      ],
    );
  }
}

class _QtyBtn extends StatelessWidget {
  final IconData icon;
  final VoidCallback onTap;
  _QtyBtn({required this.icon, required this.onTap});
  @override
  Widget build(BuildContext context) => GestureDetector(
        onTap: onTap,
        child: Container(
          width: 28,
          height: 28,
          decoration: BoxDecoration(
              color: Color(0xFFF3F5F7), borderRadius: BorderRadius.circular(6)),
          child: Icon(icon, size: 14, color: Color(0xFF677084)),
        ),
      );
}
