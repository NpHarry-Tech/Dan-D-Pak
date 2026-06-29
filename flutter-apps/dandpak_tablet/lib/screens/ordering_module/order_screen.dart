// lib/screens/ordering_module/order_screen.dart
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../models/tablet_models.dart';
import '../../providers/app_provider.dart';
import '../../providers/auth_provider.dart';
import '../../providers/ordering_provider.dart';
import '../../services/api_service.dart';
import 'modifier_dialog.dart';
import 'payment_dialog.dart';

class OrderScreen extends StatefulWidget {
  const OrderScreen({super.key});

  @override
  State<OrderScreen> createState() => _OrderScreenState();
}

class _OrderScreenState extends State<OrderScreen> {
  final GlobalKey<ScaffoldState> _scaffoldKey = GlobalKey<ScaffoldState>();
  List<MenuItem> _menuItems = [];
  List<Zone> _zones = [];
  List<TableModel> _tables = [];
  bool _loading = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _loadMenuAndTables();
  }

  Future<void> _loadMenuAndTables() async {
    setState(() {
      _loading = true;
      _error = null;
    });

    final appProv = Provider.of<AppProvider>(context, listen: false);
    final authProv = Provider.of<AuthProvider>(context, listen: false);
    final api = ApiService(baseUrl: appProv.serverUrl, token: authProv.token, branchId: appProv.activeBranch?.id);

    try {
      final results = await Future.wait([
        api.fetchMenu(),
        api.fetchZones(),
        api.fetchTables(),
      ]);

      setState(() {
        _menuItems = results[0] as List<MenuItem>;
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
    for (var item in _menuItems) {
      if (item.category != null && item.category!.isNotEmpty) {
        cats.add(item.category!);
      }
    }
    return ['all', ...cats];
  }

  List<MenuItem> _filteredMenu(String category) {
    if (category == 'all') return _menuItems;
    return _menuItems.where((item) => item.category == category).toList();
  }

  void _showModifierDialog(MenuItem item) {
    showDialog(
      context: context,
      builder: (context) {
        return ModifierDialog(
          item: item,
          onAdd: (mods, notes, qty) {
            Provider.of<OrderingProvider>(context, listen: false).addToCart(
              item,
              modifiers: mods,
              notes: notes,
              qty: qty,
            );
          },
        );
      },
    );
  }

  Future<void> _sendToKitchen() async {
    final appProv = Provider.of<AppProvider>(context, listen: false);
    final authProv = Provider.of<AuthProvider>(context, listen: false);
    final orderProv = Provider.of<OrderingProvider>(context, listen: false);
    final api = ApiService(baseUrl: appProv.serverUrl, token: authProv.token, branchId: appProv.activeBranch?.id);

    try {
      final res = await orderProv.sendOrderToKitchen(api);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Đơn hàng ${res['bill_no']} đã được gửi bếp!'),
            backgroundColor: Colors.green,
          ),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Lỗi: $e'), backgroundColor: Colors.red),
        );
      }
    }
  }

  Future<void> _checkoutAndPay() async {
    final appProv = Provider.of<AppProvider>(context, listen: false);
    final authProv = Provider.of<AuthProvider>(context, listen: false);
    final orderProv = Provider.of<OrderingProvider>(context, listen: false);
    final api = ApiService(baseUrl: appProv.serverUrl, token: authProv.token, branchId: appProv.activeBranch?.id);

    if (orderProv.cart.isEmpty) return;

    try {
      // 1. Submit order first
      final orderRes = await orderProv.sendOrderToKitchen(api);
      
      // 2. Open payment modal dialog
      if (mounted) {
        showDialog(
          context: context,
          builder: (context) {
            return PaymentDialog(
              order: orderRes,
              api: api,
              onSuccess: () {
                _loadMenuAndTables();
              },
            );
          },
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Lỗi: $e'), backgroundColor: Colors.red),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final orderProv = Provider.of<OrderingProvider>(context);
    final cats = _categories;
    final filteredItems = _filteredMenu(orderProv.selectedCategory);

    return Scaffold(
      key: _scaffoldKey,
      backgroundColor: const Color(0xFF0F141C),
      appBar: AppBar(
        backgroundColor: const Color(0xFF161C23),
        title: Row(
          children: [
            const Text('Gọi món & Phục vụ', style: TextStyle(fontWeight: FontWeight.bold)),
            const SizedBox(width: 20),
            ElevatedButton.icon(
              style: ElevatedButton.styleFrom(
                backgroundColor: const Color(0xFF242F3D),
                foregroundColor: Colors.white,
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
              ),
              icon: const Icon(Icons.table_bar, size: 18, color: Color(0xFF2F7D6B)),
              label: Text(
                orderProv.selectedTable != null ? 'Bàn: ${orderProv.selectedTable!.name}' : 'Chọn Bàn',
                style: const TextStyle(fontWeight: FontWeight.bold),
              ),
              onPressed: () => _scaffoldKey.currentState?.openDrawer(),
            ),
          ],
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh, color: Colors.white70),
            onPressed: _loadMenuAndTables,
          ),
        ],
      ),
      drawer: _buildTableDrawer(orderProv),
      body: _loading
          ? const Center(child: CircularProgressIndicator(color: Color(0xFF2F7D6B)))
          : Row(
              children: [
                // Left Menu Grid
                Expanded(
                  flex: 7,
                  child: Column(
                    children: [
                      // Category Tabs
                      Container(
                        height: 54,
                        color: const Color(0xFF161C23),
                        child: ListView.builder(
                          scrollDirection: Axis.horizontal,
                          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                          itemCount: cats.length,
                          itemBuilder: (context, index) {
                            final cat = cats[index];
                            final active = cat == orderProv.selectedCategory;
                            return Padding(
                              padding: const EdgeInsets.only(right: 8),
                              child: ChoiceChip(
                                label: Text(cat == 'all' ? 'Tất cả' : cat),
                                selected: active,
                                selectedColor: const Color(0xFF2F7D6B),
                                checkmarkColor: Colors.white,
                                labelStyle: TextStyle(
                                  color: active ? Colors.white : Colors.white70,
                                  fontWeight: FontWeight.bold,
                                ),
                                onSelected: (_) => orderProv.selectCategory(cat),
                              ),
                            );
                          },
                        ),
                      ),
                      if (_error != null)
                        Container(
                          width: double.infinity,
                          padding: const EdgeInsets.all(12),
                          color: const Color(0xFFFF7A7A).withOpacity(0.15),
                          child: Text('Lỗi: $_error', style: const TextStyle(color: Color(0xFFFF7A7A), fontWeight: FontWeight.bold), textAlign: TextAlign.center),
                        ),
                      // Menu Grid
                      Expanded(
                        child: filteredItems.isEmpty
                            ? const Center(child: Text('Không tìm thấy món ăn nào', style: TextStyle(color: Colors.white30)))
                            : GridView.builder(
                                padding: const EdgeInsets.all(14),
                                gridDelegate: const SliverGridDelegateWithMaxCrossAxisExtent(
                                  maxCrossAxisExtent: 200,
                                  childAspectRatio: 0.8,
                                  crossAxisSpacing: 12,
                                  mainAxisSpacing: 12,
                                ),
                                itemCount: filteredItems.length,
                                itemBuilder: (context, index) {
                                  final item = filteredItems[index];
                                  return _buildMenuItemCard(item);
                                },
                              ),
                      ),
                    ],
                  ),
                ),
                // Right Sidebar Cart
                VerticalDivider(color: Colors.white.withOpacity(0.05), width: 1),
                Expanded(
                  flex: 3,
                  child: Container(
                    color: const Color(0xFF161C23),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        Container(
                          padding: const EdgeInsets.all(16),
                          decoration: BoxDecoration(
                            color: const Color(0xFF1E2630),
                            border: Border(bottom: BorderSide(color: Colors.white.withOpacity(0.05))),
                          ),
                          child: Row(
                            mainAxisAlignment: MainAxisAlignment.spaceBetween,
                            children: [
                              const Text('Giỏ hàng', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: Colors.white)),
                              if (orderProv.cart.isNotEmpty)
                                TextButton(
                                  onPressed: orderProv.clearCart,
                                  child: const Text('Xóa hết', style: TextStyle(color: Color(0xFFFF7A7A))),
                                ),
                            ],
                          ),
                        ),
                        Expanded(
                          child: orderProv.cart.isEmpty
                              ? const Center(
                                  child: Column(
                                    mainAxisSize: MainAxisSize.min,
                                    children: [
                                      Icon(Icons.shopping_basket_outlined, size: 48, color: Colors.white24),
                                      SizedBox(height: 12),
                                      Text('Chưa chọn món ăn', style: TextStyle(color: Colors.white38)),
                                    ],
                                  ),
                                )
                              : ListView.separated(
                                  padding: const EdgeInsets.all(16),
                                  itemCount: orderProv.cart.length,
                                  separatorBuilder: (_, __) => const Divider(color: Colors.white10),
                                  itemBuilder: (context, index) {
                                    final cartItem = orderProv.cart[index];
                                    return _buildCartRow(orderProv, cartItem, index);
                                  },
                                ),
                        ),
                        Container(
                          padding: const EdgeInsets.all(20),
                          decoration: BoxDecoration(
                            color: const Color(0xFF1E2630),
                            border: Border(top: BorderSide(color: Colors.white.withOpacity(0.05))),
                          ),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.stretch,
                            children: [
                              Row(
                                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                children: [
                                  const Text('Tổng hóa đơn:', style: TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: Colors.white70)),
                                  Text(
                                    'đ${orderProv.cartTotal}',
                                    style: const TextStyle(fontSize: 22, fontWeight: FontWeight.extrabold, color: Color(0xFF2F7D6B)),
                                  ),
                                ],
                              ),
                              const SizedBox(height: 16),
                              Row(
                                children: [
                                  Expanded(
                                    child: OutlinedButton(
                                      style: OutlinedButton.styleFrom(
                                        side: const BorderSide(color: Color(0xFF2F7D6B)),
                                        padding: const EdgeInsets.symmetric(vertical: 14),
                                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                                      ),
                                      onPressed: orderProv.cart.isEmpty ? null : _sendToKitchen,
                                      child: const Text('GỬI BẾP', style: TextStyle(color: Color(0xFF2F7D6B), fontWeight: FontWeight.bold)),
                                    ),
                                  ),
                                  const SizedBox(width: 10),
                                  Expanded(
                                    child: FilledButton(
                                      style: FilledButton.styleFrom(
                                        backgroundColor: const Color(0xFF2F7D6B),
                                        padding: const EdgeInsets.symmetric(vertical: 14),
                                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                                      ),
                                      onPressed: orderProv.cart.isEmpty ? null : _checkoutAndPay,
                                      child: const Text('THANH TOÁN', style: TextStyle(fontWeight: FontWeight.bold)),
                                    ),
                                  ),
                                ],
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ],
            ),
    );
  }

  Widget _buildMenuItemCard(MenuItem item) {
    return Card(
      color: const Color(0xFF1E2630),
      elevation: 3,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: () => _showModifierDialog(item),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Expanded(
              child: item.image != null && item.image!.startsWith('http')
                  ? Image.network(item.image!, fit: BoxFit.cover)
                  : Container(
                      color: const Color(0xFF242F3D),
                      alignment: Alignment.center,
                      child: Text(item.emoji ?? '🍔', style: const TextStyle(fontSize: 48)),
                    ),
            ),
            Padding(
              padding: const EdgeInsets.all(10),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    item.name,
                    style: const TextStyle(fontSize: 14, fontWeight: FontWeight.bold, color: Colors.white),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                  const SizedBox(height: 4),
                  Text(
                    'đ${item.price}',
                    style: const TextStyle(fontSize: 13, color: Color(0xFF2F7D6B), fontWeight: FontWeight.w800),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildCartRow(OrderingProvider orderProv, CartItem cartItem, int index) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(cartItem.item.name, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 14)),
                  if (cartItem.selectedModifiers.isNotEmpty)
                    Padding(
                      padding: const EdgeInsets.only(top: 2),
                      child: Text(
                        cartItem.selectedModifiers.map((e) => e.name).join(', '),
                        style: const TextStyle(color: Colors.white54, fontSize: 11, fontStyle: FontStyle.italic),
                      ),
                    ),
                  if (cartItem.notes.isNotEmpty)
                    Padding(
                      padding: const EdgeInsets.only(top: 2),
                      child: Text(
                        'Note: ${cartItem.notes}',
                        style: const TextStyle(color: Colors.orangeAccent, fontSize: 11),
                      ),
                    ),
                ],
              ),
            ),
            const SizedBox(width: 8),
            Text('đ${cartItem.totalPrice}', style: const TextStyle(color: Colors.white70, fontWeight: FontWeight.bold, fontSize: 13)),
          ],
        ),
        const SizedBox(height: 8),
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Row(
              children: [
                IconButton(
                  style: IconButton.styleFrom(backgroundColor: const Color(0xFF242F3D), padding: EdgeInsets.zero, minimumSize: const Size(28, 28)),
                  icon: const Icon(Icons.remove, color: Colors.white70, size: 14),
                  onPressed: () => orderProv.updateCartQty(index, cartItem.qty - 1),
                ),
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 10),
                  child: Text('${cartItem.qty}', style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
                ),
                IconButton(
                  style: IconButton.styleFrom(backgroundColor: const Color(0xFF242F3D), padding: EdgeInsets.zero, minimumSize: const Size(28, 28)),
                  icon: const Icon(Icons.add, color: Colors.white70, size: 14),
                  onPressed: () => orderProv.updateCartQty(index, cartItem.qty + 1),
                ),
              ],
            ),
            IconButton(
              icon: const Icon(Icons.delete, color: Color(0xFFFF7A7A), size: 18),
              onPressed: () => orderProv.removeFromCart(index),
            )
          ],
        )
      ],
    );
  }

  Widget _buildTableDrawer(OrderingProvider orderProv) {
    return Drawer(
      backgroundColor: const Color(0xFF161C23),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const DrawerHeader(
            decoration: BoxDecoration(color: Color(0xFF1E2630)),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Icon(Icons.table_bar, size: 36, color: Color(0xFF2F7D6B)),
                SizedBox(height: 8),
                Text('Sơ đồ Bàn / Khu vực', style: TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold)),
              ],
            ),
          ),
          Expanded(
            child: _zones.isEmpty
                ? const Center(child: Text('Không có dữ liệu bàn', style: TextStyle(color: Colors.white30)))
                : ListView.builder(
                    padding: const EdgeInsets.all(14),
                    itemCount: _zones.length,
                    itemBuilder: (context, index) {
                      final zone = _zones[index];
                      final zoneTables = _tables.where((t) => t.zoneId == zone.id).toList();
                      return Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(zone.name.toUpperCase(), style: const TextStyle(color: Color(0xFF2F7D6B), fontWeight: FontWeight.bold, fontSize: 13, letterSpacing: 1)),
                          const SizedBox(height: 10),
                          GridView.builder(
                            shrinkWrap: true,
                            physics: const NeverScrollableScrollPhysics(),
                            gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                              crossAxisCount: 3,
                              crossAxisSpacing: 8,
                              mainAxisSpacing: 8,
                              childAspectRatio: 1.1,
                            ),
                            itemCount: zoneTables.length,
                            itemBuilder: (context, index) {
                              final table = zoneTables[index];
                              final isSelected = orderProv.selectedTable?.id == table.id;
                              final isServing = table.status == 'serving' || table.status == 'busy';
                              
                              Color cardColor = const Color(0xFF1E2630);
                              if (isSelected) cardColor = const Color(0xFF2F7D6B);
                              else if (isServing) cardColor = const Color(0xFFE0A93B).withOpacity(0.2);

                              return InkWell(
                                onTap: () {
                                  orderProv.selectTable(table);
                                  Navigator.of(context).pop(); // close drawer
                                },
                                child: Container(
                                  decoration: BoxDecoration(
                                    color: cardColor,
                                    borderRadius: BorderRadius.circular(8),
                                    border: Border.all(
                                      color: isSelected ? const Color(0xFF2F7D6B) : Colors.white10,
                                    ),
                                  ),
                                  alignment: Alignment.center,
                                  child: Column(
                                    mainAxisSize: MainAxisSize.min,
                                    children: [
                                      Text(
                                        table.name,
                                        style: TextStyle(
                                          color: isSelected ? Colors.white : Colors.white70,
                                          fontWeight: FontWeight.bold,
                                        ),
                                      ),
                                      const SizedBox(height: 4),
                                      Text(
                                        isServing ? 'Có khách' : 'Trống',
                                        style: TextStyle(
                                          color: isSelected ? Colors.white70 : Colors.white30,
                                          fontSize: 10,
                                        ),
                                      )
                                    ],
                                  ),
                                ),
                              );
                            },
                          ),
                          const SizedBox(height: 20),
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
