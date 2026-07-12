import 'dart:async';

import 'package:flutter/material.dart';

import '../../services/api_service.dart';
import '../../services/local_store.dart';
import '../../services/socket_service.dart';
import 'self_order_cart.dart';
import 'self_order_models.dart';
import 'self_order_payment_screen.dart';
import 'self_order_staff_exit.dart';
import 'self_order_strings.dart';

/// Màn hình GỌI MÓN của khách (kiosk). Bàn đã cố định từ màn chọn bàn.
/// - Có mục "Món bạn hay gọi" (từ lần ăn thứ 3 của SĐT đã check-in).
/// - GỬI BẾP nhiều đợt trong bữa; xong bữa bấm THANH TOÁN.
/// - Mục "Món đã gửi bếp" hiện trạng thái từng món REALTIME theo KDS
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

  const SelfOrderMenuScreen({
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
  bool _loading = true;
  String? _error;
  bool _sending = false;
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
            backgroundColor: const Color(0xFF49D17F),
          ));
          Navigator.of(context).popUntil(
              (r) => !((r.settings.name ?? '').startsWith('/so-')));
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
      final rawMenu = await _api.fetchMenuRaw();
      if (!mounted) return;
      setState(() {
        _menu = rawMenu;
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
          SoCartItem(item: item, qty: 1, notes: '', selectedModifiers: const []));
    });
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
        backgroundColor: const Color(0xFF49D17F),
        duration: const Duration(seconds: 2),
      ));
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text(e.toString().replaceFirst('Exception: ', '')),
          backgroundColor: const Color(0xFFFF7A7A)));
      setState(() => _sending = false);
    }
  }

  Future<void> _callStaff() async {
    try {
      await _api.callStaff(widget.table.id, L.callStaffBtn);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        content: Text(L.staffComing),
        backgroundColor: const Color(0xFF0891B2),
      ));
    } catch (_) {}
  }

  void _checkout() {
    final orderId = _orderId;
    if (orderId == null) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text(L.needSendFirst),
          backgroundColor: const Color(0xFFFF7A7A)));
      return;
    }
    Navigator.of(context).push(PageRouteBuilder(
      settings: const RouteSettings(name: '/so-pay'),
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
      transitionDuration: const Duration(milliseconds: 350),
    ));
  }

  // ── Mục "Món đã gửi bếp" — trạng thái realtime theo KDS ──────────────────
  static const Map<String, Color> _statusColors = {
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
      constraints: const BoxConstraints(maxHeight: 250),
      decoration: const BoxDecoration(
        color: Color(0xFFF9FBFC),
        border: Border(bottom: BorderSide(color: Color(0xFFE7EAEE))),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 10, 16, 4),
            child: Text(
              '${L.sentItemsTitle} (${_sentItems.length})',
              style: const TextStyle(
                fontSize: 12.5,
                fontWeight: FontWeight.w800,
                color: Color(0xFF677084),
              ),
            ),
          ),
          Flexible(
            child: ListView.builder(
              shrinkWrap: true,
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 10),
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
    final color = _statusColors[status] ?? const Color(0xFF9AA3B2);
    final qty = item['qty'] is num ? (item['qty'] as num).toInt() : 1;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        children: [
          Expanded(
            child: Text(
              '${item['name'] ?? ''}  ×$qty',
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                fontSize: 13,
                color: cancelled
                    ? const Color(0xFF9AA3B2)
                    : const Color(0xFF1A2230),
                decoration: cancelled ? TextDecoration.lineThrough : null,
              ),
            ),
          ),
          const SizedBox(width: 8),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
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
    return Scaffold(
      backgroundColor: const Color(0xFFF7F8FA),
      appBar: AppBar(
        automaticallyImplyLeading: false,
        backgroundColor: Colors.white,
        elevation: 0,
        scrolledUnderElevation: 0,
        title: Row(children: [
          SelfOrderStaffLogo(api: _api),
          const SizedBox(width: 10),
          Text(L.menuTitle,
              style: const TextStyle(
                  fontWeight: FontWeight.bold, color: Color(0xFF1A2230))),
          const SizedBox(width: 16),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
            decoration: BoxDecoration(
              color: const Color(0xFF0891B2).withValues(alpha: 0.12),
              borderRadius: BorderRadius.circular(20),
              border: Border.all(color: const Color(0xFF0891B2)),
            ),
            child: Row(mainAxisSize: MainAxisSize.min, children: [
              const Icon(Icons.table_bar_rounded,
                  size: 16, color: Color(0xFF0891B2)),
              const SizedBox(width: 6),
              Text(widget.table.name,
                  style: const TextStyle(
                      fontWeight: FontWeight.bold,
                      fontSize: 13,
                      color: Color(0xFF0891B2))),
            ]),
          ),
        ]),
        actions: [
          TextButton.icon(
            onPressed: _callStaff,
            icon: const Icon(Icons.notifications_active_outlined,
                size: 18, color: Color(0xFF677084)),
            label: Text(L.callStaffBtn,
                style:
                    const TextStyle(fontSize: 13, color: Color(0xFF677084))),
          ),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 8),
            child: Center(
                child:
                    Text(widget.lang.flag, style: const TextStyle(fontSize: 22))),
          ),
        ],
      ),
      body: _loading
          ? const Center(
              child: CircularProgressIndicator(color: Color(0xFF0891B2)))
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
                      padding: const EdgeInsets.symmetric(
                          horizontal: 12, vertical: 8),
                      itemCount: _categories.length,
                      itemBuilder: (_, i) {
                        final cat = _categories[i];
                        final active = cat == _selectedCategory;
                        return Padding(
                          padding: const EdgeInsets.only(right: 8),
                          child: ChoiceChip(
                            label: Text(cat == 'all' ? L.allCategory : cat),
                            selected: active,
                            selectedColor: const Color(0xFF0891B2),
                            checkmarkColor: Colors.white,
                            backgroundColor: const Color(0xFFF3F5F7),
                            labelStyle: TextStyle(
                              color: active
                                  ? Colors.white
                                  : const Color(0xFF677084),
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
                      padding: const EdgeInsets.all(10),
                      color: const Color(0xFFFF7A7A).withValues(alpha: 0.12),
                      child: Text(_error!,
                          style: const TextStyle(color: Color(0xFFFF7A7A)),
                          textAlign: TextAlign.center),
                    ),
                  // ⭐ Món bạn hay gọi (từ lần ăn thứ 3)
                  if (favs.isNotEmpty && _selectedCategory == 'all')
                    Container(
                      color: const Color(0xFFFFF9E9),
                      padding: const EdgeInsets.only(top: 10, bottom: 12),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Padding(
                            padding:
                                const EdgeInsets.symmetric(horizontal: 14),
                            child: Text(L.reorderTitle,
                                style: const TextStyle(
                                    fontWeight: FontWeight.w800,
                                    fontSize: 13.5,
                                    color: Color(0xFFB8860B))),
                          ),
                          const SizedBox(height: 8),
                          SizedBox(
                            height: 108,
                            child: ListView.builder(
                              scrollDirection: Axis.horizontal,
                              padding: const EdgeInsets.symmetric(
                                  horizontal: 12),
                              itemCount: favs.length,
                              itemBuilder: (_, i) => _FavCard(
                                  item: favs[i], onTap: _addItem),
                            ),
                          ),
                        ],
                      ),
                    ),
                  Expanded(
                    child: _filteredMenu.isEmpty
                        ? Center(
                            child: Text('—',
                                style: TextStyle(
                                    color: Colors.grey[400], fontSize: 32)))
                        : GridView.builder(
                            padding: const EdgeInsets.all(14),
                            gridDelegate:
                                const SliverGridDelegateWithMaxCrossAxisExtent(
                              maxCrossAxisExtent: 190,
                              childAspectRatio: 0.78,
                              crossAxisSpacing: 12,
                              mainAxisSpacing: 12,
                            ),
                            itemCount: _filteredMenu.length,
                            itemBuilder: (_, i) => _MenuCard(
                                item: _filteredMenu[i], onTap: _addItem),
                          ),
                  ),
                ]),
              ),

              // ── Cart phải ───────────────────────────────────────────────
              const VerticalDivider(color: Color(0xFFE7EAEE), width: 1),
              Expanded(
                flex: 3,
                child: Container(
                  color: Colors.white,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Container(
                        padding: const EdgeInsets.symmetric(
                            horizontal: 16, vertical: 14),
                        decoration: const BoxDecoration(
                          color: Color(0xFFF3F5F7),
                          border: Border(
                              bottom: BorderSide(color: Color(0xFFE7EAEE))),
                        ),
                        child: Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            Text(L.cartTitle,
                                style: const TextStyle(
                                    fontSize: 16,
                                    fontWeight: FontWeight.bold,
                                    color: Color(0xFF1A2230))),
                            if (_cart.isNotEmpty)
                              GestureDetector(
                                onTap: () => setState(() => _cart.clear()),
                                child: Text(L.clearCartBtn,
                                    style: const TextStyle(
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
                                        'assets/web/assets/DanOnLogo.png',
                                        width: 140,
                                        fit: BoxFit.contain,
                                        errorBuilder: (_, __, ___) => const Icon(
                                            Icons.shopping_basket_outlined,
                                            size: 48,
                                            color: Color(0xFFD3D8DF)),
                                      ),
                                    ),
                                    const SizedBox(height: 12),
                                    Text(L.cartEmpty,
                                        style: const TextStyle(
                                            color: Color(0xFF9AA3B2),
                                            fontSize: 14)),
                                  ],
                                ),
                              )
                            : ListView.separated(
                                padding: const EdgeInsets.all(14),
                                itemCount: _cart.length,
                                separatorBuilder: (_, __) => const Divider(
                                    color: Color(0xFFE7EAEE), height: 16),
                                itemBuilder: (_, i) => _CartRow(
                                  item: _cart[i],
                                  onQtyChange: (q) => _changeQty(i, q),
                                ),
                              ),
                      ),
                      Container(
                        padding: const EdgeInsets.all(18),
                        decoration: const BoxDecoration(
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
                                    style: const TextStyle(
                                        fontSize: 14,
                                        fontWeight: FontWeight.w600,
                                        color: Color(0xFF677084))),
                                Text('đ${_sentTotal + _cartTotal}',
                                    style: const TextStyle(
                                        fontSize: 22,
                                        fontWeight: FontWeight.w900,
                                        color: Color(0xFF0891B2))),
                              ],
                            ),
                            const SizedBox(height: 14),
                            FilledButton(
                              onPressed: (_cart.isEmpty || _sending)
                                  ? null
                                  : _sendOrder,
                              style: FilledButton.styleFrom(
                                backgroundColor: const Color(0xFF0891B2),
                                padding:
                                    const EdgeInsets.symmetric(vertical: 16),
                                shape: RoundedRectangleBorder(
                                    borderRadius: BorderRadius.circular(12)),
                              ),
                              child: _sending
                                  ? const SizedBox(
                                      width: 20,
                                      height: 20,
                                      child: CircularProgressIndicator(
                                          strokeWidth: 2,
                                          color: Colors.white))
                                  : Text(L.sendKitchenBtn,
                                      style: const TextStyle(
                                          fontSize: 15,
                                          fontWeight: FontWeight.bold)),
                            ),
                            const SizedBox(height: 8),
                            OutlinedButton.icon(
                              onPressed:
                                  (_orderId == null || _sending) ? null : _checkout,
                              style: OutlinedButton.styleFrom(
                                foregroundColor: const Color(0xFF16A34A),
                                side: BorderSide(
                                    color: _orderId == null
                                        ? const Color(0xFFD3D8DF)
                                        : const Color(0xFF16A34A)),
                                padding:
                                    const EdgeInsets.symmetric(vertical: 14),
                                shape: RoundedRectangleBorder(
                                    borderRadius: BorderRadius.circular(12)),
                              ),
                              icon: const Icon(Icons.payments_outlined,
                                  size: 18),
                              label: Text(L.checkoutBtn,
                                  style: const TextStyle(
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

class _FavCard extends StatelessWidget {
  final SoMenuItem item;
  final ValueChanged<SoMenuItem> onTap;
  const _FavCard({required this.item, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: () => onTap(item),
      child: Container(
        width: 210,
        margin: const EdgeInsets.only(right: 10),
        padding: const EdgeInsets.all(10),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: const Color(0xFFFFC24D)),
        ),
        child: Row(children: [
          Container(
            width: 56,
            height: 56,
            decoration: BoxDecoration(
              color: const Color(0xFFF3F5F7),
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
                        style: const TextStyle(fontSize: 26))),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(item.name,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                        fontWeight: FontWeight.bold,
                        fontSize: 13,
                        color: Color(0xFF1A2230))),
                const SizedBox(height: 3),
                Text('đ${item.price}',
                    style: const TextStyle(
                        color: Color(0xFF0891B2),
                        fontWeight: FontWeight.w800,
                        fontSize: 13)),
              ],
            ),
          ),
          const Icon(Icons.add_circle_rounded,
              color: Color(0xFF0891B2), size: 26),
        ]),
      ),
    );
  }
}

// ─── Menu card ────────────────────────────────────────────────────────────────

class _MenuCard extends StatelessWidget {
  final SoMenuItem item;
  final ValueChanged<SoMenuItem> onTap;
  const _MenuCard({required this.item, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return Card(
      color: Colors.white,
      elevation: 0,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(14),
        side: const BorderSide(color: Color(0xFFE7EAEE)),
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
              padding: const EdgeInsets.all(10),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(item.name,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                          fontSize: 13,
                          fontWeight: FontWeight.bold,
                          color: Color(0xFF1A2230))),
                  const SizedBox(height: 3),
                  Text('đ${item.price}',
                      style: const TextStyle(
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
      color: const Color(0xFFF3F5F7),
      alignment: Alignment.center,
      child: Text(emoji ?? '🍽️', style: const TextStyle(fontSize: 44)));
}

// ─── Cart row ─────────────────────────────────────────────────────────────────

class _CartRow extends StatelessWidget {
  final SoCartItem item;
  final ValueChanged<int> onQtyChange;
  const _CartRow({required this.item, required this.onQtyChange});

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(item.item.name,
                  style: const TextStyle(
                      fontWeight: FontWeight.bold,
                      color: Color(0xFF1A2230),
                      fontSize: 13)),
              Text('đ${item.totalPrice}',
                  style: const TextStyle(
                      color: Color(0xFF0891B2),
                      fontWeight: FontWeight.bold,
                      fontSize: 12)),
            ],
          ),
        ),
        Row(children: [
          _QtyBtn(icon: Icons.remove, onTap: () => onQtyChange(item.qty - 1)),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 10),
            child: Text('${item.qty}',
                style: const TextStyle(
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
  const _QtyBtn({required this.icon, required this.onTap});
  @override
  Widget build(BuildContext context) => GestureDetector(
        onTap: onTap,
        child: Container(
          width: 28,
          height: 28,
          decoration: BoxDecoration(
              color: const Color(0xFFF3F5F7),
              borderRadius: BorderRadius.circular(6)),
          child: Icon(icon, size: 14, color: const Color(0xFF677084)),
        ),
      );
}
