import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../models/cart.dart';
import '../../models/tablet_models.dart';
import '../../providers/app_provider.dart';
import '../../providers/auth_provider.dart';
import '../../services/api_service.dart';
import 'self_order_welcome_screen.dart';

/// Màn hình gọi món cho khách tự phục vụ (kiosk mode).
/// Ngôn ngữ giao diện hoàn toàn theo [lang] được chọn từ WelcomeScreen.
class SelfOrderMenuScreen extends StatefulWidget {
  final String serverUrl;
  final String? branchId;
  final String? staffToken;
  final SelfOrderLang lang;
  final String customerPhone;

  const SelfOrderMenuScreen({
    super.key,
    required this.serverUrl,
    this.branchId,
    this.staffToken,
    required this.lang,
    required this.customerPhone,
  });

  @override
  State<SelfOrderMenuScreen> createState() => _SelfOrderMenuScreenState();
}

class _SelfOrderMenuScreenState extends State<SelfOrderMenuScreen> {
  List<MenuItem> _menu = [];
  List<Zone> _zones = [];
  List<TableModel> _tables = [];
  final List<CartItem> _cart = [];
  TableModel? _selectedTable;
  String _selectedCategory = 'all';
  bool _loading = true;
  String? _error;
  bool _sending = false;
  Timer? _idleTimer;
  static const _idleDuration = Duration(seconds: 120);

  late final ApiService _api;

  SelfOrderLang get L => widget.lang;

  @override
  void initState() {
    super.initState();
    final appProv = Provider.of<AppProvider>(context, listen: false);
    final authProv = Provider.of<AuthProvider>(context, listen: false);
    _api = ApiService(
      baseUrl: widget.serverUrl,
      token: widget.staffToken ?? authProv.token,
      branchId: widget.branchId ?? appProv.activeBranch?.id,
    );
    _load();
    _resetIdle();
  }

  @override
  void dispose() {
    _idleTimer?.cancel();
    super.dispose();
  }

  void _resetIdle() {
    _idleTimer?.cancel();
    _idleTimer = Timer(_idleDuration, _goBack);
  }

  void _goBack() {
    if (!mounted) return;
    Navigator.of(context).pushReplacement(
      MaterialPageRoute(
        builder: (_) => SelfOrderWelcomeScreen(
          serverUrl: widget.serverUrl,
          branchId: widget.branchId,
          staffToken: widget.staffToken,
        ),
      ),
    );
  }

  Future<void> _load() async {
    setState(() { _loading = true; _error = null; });
    try {
      final results = await Future.wait([
        _api.fetchMenu(),
        _api.fetchZones(),
        _api.fetchTables(),
      ]);
      setState(() {
        _menu = results[0] as List<MenuItem>;
        _zones = results[1] as List<Zone>;
        _tables = results[2] as List<TableModel>;
        _loading = false;
      });
    } catch (e) {
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

  List<MenuItem> get _filteredMenu => _selectedCategory == 'all'
      ? _menu
      : _menu.where((i) => i.category == _selectedCategory).toList();

  int get _cartTotal => _cart.fold(0, (s, i) => s + i.totalPrice);

  void _addItem(MenuItem item) {
    _resetIdle();
    setState(() {
      for (final ci in _cart) {
        if (ci.item.id == item.id && ci.notes.isEmpty && ci.selectedModifiers.isEmpty) {
          ci.qty++;
          return;
        }
      }
      _cart.add(CartItem(item: item, qty: 1, notes: '', selectedModifiers: const []));
    });
  }

  void _changeQty(int index, int newQty) {
    _resetIdle();
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
    if (_selectedTable == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(L.selectTablePrompt), backgroundColor: const Color(0xFFFF7A7A)),
      );
      return;
    }
    setState(() => _sending = true);
    _resetIdle();
    try {
      final items = _cart.map((c) => {
        'menu_item_id': c.item.id,
        'qty': c.qty,
        'note': c.notes,
        'mods': <Map<String, dynamic>>[],
      }).toList();

      await _api.createOrder(
        tableId: _selectedTable!.id,
        orderType: 'dine_in',
        items: items,
      );

      if (mounted) {
        _showThankYou();
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Lỗi: $e'), backgroundColor: const Color(0xFFFF7A7A)),
        );
        setState(() => _sending = false);
      }
    }
  }

  void _showThankYou() {
    showDialog(
      context: context,
      barrierDismissible: false,
      builder: (_) => AlertDialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.check_circle_rounded, color: Color(0xFF49D17F), size: 72),
            const SizedBox(height: 16),
            Text(L.thankYou,
                textAlign: TextAlign.center,
                style: const TextStyle(fontSize: 20, fontWeight: FontWeight.bold)),
          ],
        ),
      ),
    );
    Future.delayed(const Duration(seconds: 3), () {
      if (mounted) _goBack();
    });
  }

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: _resetIdle,
      child: Scaffold(
        backgroundColor: const Color(0xFFF7F8FA),
        appBar: AppBar(
          automaticallyImplyLeading: false,
          backgroundColor: Colors.white,
          elevation: 0,
          scrolledUnderElevation: 0,
          title: Row(children: [
            // Logo nhỏ
            Container(
              width: 32, height: 32,
              decoration: BoxDecoration(
                color: const Color(0xFF0891B2),
                borderRadius: BorderRadius.circular(8),
              ),
              child: const Center(
                child: Text('D', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
              ),
            ),
            const SizedBox(width: 10),
            Text(L.menuTitle,
                style: const TextStyle(fontWeight: FontWeight.bold, color: Color(0xFF1A2230))),
            const SizedBox(width: 16),
            // Chip bàn đang chọn
            GestureDetector(
              onTap: _showTablePicker,
              child: AnimatedContainer(
                duration: const Duration(milliseconds: 200),
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                decoration: BoxDecoration(
                  color: _selectedTable != null
                      ? const Color(0xFF0891B2).withValues(alpha: 0.12)
                      : const Color(0xFFF3F5F7),
                  borderRadius: BorderRadius.circular(20),
                  border: Border.all(
                    color: _selectedTable != null
                        ? const Color(0xFF0891B2)
                        : const Color(0xFFD3D8DF),
                  ),
                ),
                child: Row(mainAxisSize: MainAxisSize.min, children: [
                  Icon(Icons.table_bar_rounded,
                      size: 16,
                      color: _selectedTable != null
                          ? const Color(0xFF0891B2)
                          : const Color(0xFF677084)),
                  const SizedBox(width: 6),
                  Text(
                    _selectedTable?.name ?? '— Chọn bàn —',
                    style: TextStyle(
                      fontWeight: FontWeight.bold,
                      fontSize: 13,
                      color: _selectedTable != null
                          ? const Color(0xFF0891B2)
                          : const Color(0xFF677084),
                    ),
                  ),
                ]),
              ),
            ),
          ]),
          actions: [
            // Ngôn ngữ đang dùng
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 4),
              child: Center(
                child: Text(widget.lang.flag,
                    style: const TextStyle(fontSize: 22)),
              ),
            ),
            // Nút quay lại chọn ngôn ngữ
            IconButton(
              icon: const Icon(Icons.language_rounded, color: Color(0xFF677084)),
              tooltip: 'Change language',
              onPressed: _goBack,
            ),
          ],
        ),
        body: _loading
            ? const Center(child: CircularProgressIndicator(color: Color(0xFF0891B2)))
            : Row(children: [
                // ── Menu trái ──────────────────────────────────────────────
                Expanded(
                  flex: 7,
                  child: Column(children: [
                    // Category tabs
                    Container(
                      height: 52,
                      color: Colors.white,
                      child: ListView.builder(
                        scrollDirection: Axis.horizontal,
                        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
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
                                color: active ? Colors.white : const Color(0xFF677084),
                                fontWeight: FontWeight.bold,
                                fontSize: 13,
                              ),
                              onSelected: (_) => setState(() {
                                _selectedCategory = cat;
                                _resetIdle();
                              }),
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
                    // Menu grid
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
                              itemBuilder: (_, i) =>
                                  _MenuCard(item: _filteredMenu[i], onTap: _addItem),
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
                        // Cart header
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
                          decoration: const BoxDecoration(
                            color: Color(0xFFF3F5F7),
                            border: Border(bottom: BorderSide(color: Color(0xFFE7EAEE))),
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
                                  onTap: () => setState(() {
                                    _cart.clear();
                                    _resetIdle();
                                  }),
                                  child: Text(L.clearCartBtn,
                                      style: const TextStyle(
                                          color: Color(0xFFFF6B6B),
                                          fontWeight: FontWeight.bold,
                                          fontSize: 13)),
                                ),
                            ],
                          ),
                        ),
                        // Items
                        Expanded(
                          child: _cart.isEmpty
                              ? Center(
                                  child: Column(
                                    mainAxisSize: MainAxisSize.min,
                                    children: [
                                      const Icon(Icons.shopping_basket_outlined,
                                          size: 48, color: Color(0xFFD3D8DF)),
                                      const SizedBox(height: 10),
                                      Text(L.cartEmpty,
                                          style: const TextStyle(
                                              color: Color(0xFF9AA3B2), fontSize: 14)),
                                    ],
                                  ),
                                )
                              : ListView.separated(
                                  padding: const EdgeInsets.all(14),
                                  itemCount: _cart.length,
                                  separatorBuilder: (_, __) =>
                                      const Divider(color: Color(0xFFE7EAEE), height: 16),
                                  itemBuilder: (_, i) => _CartRow(
                                    item: _cart[i],
                                    onQtyChange: (q) => _changeQty(i, q),
                                  ),
                                ),
                        ),
                        // Footer: total + send
                        Container(
                          padding: const EdgeInsets.all(18),
                          decoration: const BoxDecoration(
                            color: Color(0xFFF3F5F7),
                            border: Border(top: BorderSide(color: Color(0xFFE7EAEE))),
                          ),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.stretch,
                            children: [
                              Row(
                                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                children: [
                                  Text(L.totalLabel,
                                      style: const TextStyle(
                                          fontSize: 14,
                                          fontWeight: FontWeight.w600,
                                          color: Color(0xFF677084))),
                                  Text('đ$_cartTotal',
                                      style: const TextStyle(
                                          fontSize: 22,
                                          fontWeight: FontWeight.w900,
                                          color: Color(0xFF0891B2))),
                                ],
                              ),
                              const SizedBox(height: 14),
                              FilledButton(
                                onPressed: (_cart.isEmpty || _sending) ? null : _sendOrder,
                                style: FilledButton.styleFrom(
                                  backgroundColor: const Color(0xFF0891B2),
                                  padding: const EdgeInsets.symmetric(vertical: 16),
                                  shape: RoundedRectangleBorder(
                                      borderRadius: BorderRadius.circular(12)),
                                ),
                                child: _sending
                                    ? const SizedBox(
                                        width: 20, height: 20,
                                        child: CircularProgressIndicator(
                                            strokeWidth: 2, color: Colors.white))
                                    : Text(L.sendKitchenBtn,
                                        style: const TextStyle(
                                            fontSize: 15, fontWeight: FontWeight.bold)),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ]),
      ),
    );
  }

  void _showTablePicker() {
    _resetIdle();
    showModalBottomSheet(
      context: context,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (_) => Column(
        children: [
          const SizedBox(height: 8),
          Container(width: 40, height: 4,
              decoration: BoxDecoration(
                  color: const Color(0xFFD3D8DF),
                  borderRadius: BorderRadius.circular(2))),
          const SizedBox(height: 12),
          Expanded(
            child: ListView.builder(
              itemCount: _zones.length,
              itemBuilder: (_, zi) {
                final zone = _zones[zi];
                final zoneTables = _tables.where((t) => t.zoneId == zone.id).toList();
                return Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                      child: Text(zone.name.toUpperCase(),
                          style: const TextStyle(
                              color: Color(0xFF0891B2),
                              fontWeight: FontWeight.bold,
                              fontSize: 12,
                              letterSpacing: 1)),
                    ),
                    GridView.builder(
                      shrinkWrap: true,
                      physics: const NeverScrollableScrollPhysics(),
                      padding: const EdgeInsets.symmetric(horizontal: 12),
                      gridDelegate:
                          const SliverGridDelegateWithFixedCrossAxisCount(
                        crossAxisCount: 4,
                        crossAxisSpacing: 8,
                        mainAxisSpacing: 8,
                        childAspectRatio: 1.5,
                      ),
                      itemCount: zoneTables.length,
                      itemBuilder: (_, ti) {
                        final t = zoneTables[ti];
                        final sel = _selectedTable?.id == t.id;
                        return GestureDetector(
                          onTap: () {
                            setState(() => _selectedTable = t);
                            Navigator.pop(context);
                          },
                          child: AnimatedContainer(
                            duration: const Duration(milliseconds: 150),
                            decoration: BoxDecoration(
                              color: sel
                                  ? const Color(0xFF0891B2)
                                  : const Color(0xFFF3F5F7),
                              borderRadius: BorderRadius.circular(8),
                              border: Border.all(
                                color: sel
                                    ? const Color(0xFF0891B2)
                                    : const Color(0xFFE7EAEE),
                              ),
                            ),
                            alignment: Alignment.center,
                            child: Text(t.name,
                                style: TextStyle(
                                    color: sel ? Colors.white : const Color(0xFF1A2230),
                                    fontWeight: FontWeight.bold,
                                    fontSize: 13)),
                          ),
                        );
                      },
                    ),
                    const SizedBox(height: 8),
                  ],
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}

// ─── Menu card ────────────────────────────────────────────────────────────────

class _MenuCard extends StatelessWidget {
  final MenuItem item;
  final ValueChanged<MenuItem> onTap;
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
                  ? Image.network(item.image!, fit: BoxFit.cover,
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
  final CartItem item;
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
          _QtyBtn(
              icon: Icons.remove,
              onTap: () => onQtyChange(item.qty - 1)),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 10),
            child: Text('${item.qty}',
                style: const TextStyle(
                    fontWeight: FontWeight.bold,
                    color: Color(0xFF1A2230))),
          ),
          _QtyBtn(
              icon: Icons.add,
              onTap: () => onQtyChange(item.qty + 1)),
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
          width: 28, height: 28,
          decoration: BoxDecoration(
              color: const Color(0xFFF3F5F7),
              borderRadius: BorderRadius.circular(6)),
          child: Icon(icon, size: 14, color: const Color(0xFF677084)),
        ),
      );
}
