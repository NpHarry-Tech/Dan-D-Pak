import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:intl/intl.dart';
import '../providers/auth_provider.dart';
import '../providers/pos_provider.dart';
import '../models/pos_models.dart';
import '../services/socket_service.dart';
import 'shift_dialog.dart';
import 'payment_dialog.dart';

class PosScreen extends StatefulWidget {
  const PosScreen({super.key});

  @override
  State<PosScreen> createState() => _PosScreenState();
}

class _PosScreenState extends State<PosScreen> {
  final SocketService _socketService = SocketService();
  final _currencyFormat = NumberFormat.decimalPattern('vi-VN');
  String _searchQuery = '';
  Category? _selectedCategory;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final pos = context.read<PosProvider>();
      final auth = context.read<AuthProvider>();

      // Load initial data
      pos.loadFloor();
      pos.loadMenu();
      pos.loadShift();
      pos.loadOperationsConfig();

      // Establish WebSocket bindings
      _socketService.connect(
        baseUrl: auth.serverUrl,
        branch: auth.selectedBranchId,
        token: auth.token ?? '',
        onUpdateCallback: () {
          if (mounted) {
            pos.loadFloor();
            pos.loadShift();
          }
        },
      );
    });
  }

  @override
  void dispose() {
    _socketService.disconnect();
    super.dispose();
  }

  void _onLogout() async {
    final auth = context.read<AuthProvider>();
    await auth.logout();
  }

  void _onOpenCashDrawer() async {
    try {
      await context.read<PosProvider>().openCashDrawer();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Đã gửi lệnh mở két tiền!'), backgroundColor: Colors.green),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Lỗi mở két: $e'), backgroundColor: Colors.redAccent),
        );
      }
    }
  }

  void _showModifiersDialog(MenuItem item) {
    if (item.modifiers.isEmpty) {
      context.read<PosProvider>().addToCart(item, [], '');
      return;
    }

    final List<Modifier> selectedMods = [];
    final TextEditingController noteController = TextEditingController();

    showDialog(
      context: context,
      builder: (context) {
        return StatefulBuilder(
          builder: (context, setModalState) {
            return AlertDialog(
              backgroundColor: const Color(0xFF1E2633),
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
              title: Text('Chọn Toppings / Modifiers cho ${item.name}', style: const TextStyle(color: Colors.white, fontSize: 16)),
              content: SizedBox(
                width: 380,
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    ...item.modifiers.map((m) {
                      final isSelected = selectedMods.any((selected) => selected.name == m.name);
                      return CheckboxListTile(
                        title: Text(m.name, style: const TextStyle(color: Colors.white, fontSize: 14)),
                        subtitle: Text('+${_currencyFormat.format(m.price)}đ', style: const TextStyle(color: Colors.amber)),
                        value: isSelected,
                        activeColor: Colors.amber,
                        checkColor: const Color(0xFF141923),
                        onChanged: (bool? checked) {
                          setModalState(() {
                            if (checked == true) {
                              selectedMods.add(m);
                            } else {
                              selectedMods.removeWhere((selected) => selected.name == m.name);
                            }
                          });
                        },
                      );
                    }),
                    const SizedBox(height: 12),
                    TextField(
                      controller: noteController,
                      style: const TextStyle(color: Colors.white, fontSize: 13),
                      decoration: const InputDecoration(
                        labelText: 'Ghi chú món ăn',
                        labelStyle: TextStyle(color: Color(0xFF8A99AD)),
                        enabledBorder: UnderlineInputBorder(borderSide: BorderSide(color: Color(0xFF2C384E))),
                      ),
                    ),
                  ],
                ),
              ),
              actions: [
                TextButton(
                  onPressed: () => Navigator.of(context).pop(),
                  child: const Text('HỦY', style: TextStyle(color: Color(0xFF8A99AD))),
                ),
                ElevatedButton(
                  onPressed: () {
                    context.read<PosProvider>().addToCart(item, selectedMods, noteController.text.trim());
                    Navigator.of(context).pop();
                  },
                  style: ElevatedButton.styleFrom(backgroundColor: Colors.amber, foregroundColor: const Color(0xFF141923)),
                  child: const Text('THÊM VÀO GIỎ', style: TextStyle(fontWeight: FontWeight.bold)),
                ),
              ],
            );
          },
        );
      },
    );
  }

  void _showDiscountDialog() {
    final pos = context.read<PosProvider>();
    final TextEditingController discountController = TextEditingController(text: pos.activeDiscount.toStringAsFixed(0));
    showDialog(
      context: context,
      builder: (context) {
        return AlertDialog(
          backgroundColor: const Color(0xFF1E2633),
          title: const Text('Áp dụng Giảm giá', style: TextStyle(color: Colors.white)),
          content: TextField(
            controller: discountController,
            keyboardType: TextInputType.number,
            style: const TextStyle(color: Colors.white),
            decoration: const InputDecoration(
              labelText: 'Số tiền giảm (VND)',
              labelStyle: TextStyle(color: Color(0xFF8A99AD)),
              suffixText: 'đ',
              suffixStyle: TextStyle(color: Colors.amber),
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(context).pop(),
              child: const Text('HỦY', style: TextStyle(color: Color(0xFF8A99AD))),
            ),
            ElevatedButton(
              onPressed: () {
                final amt = double.tryParse(discountController.text) ?? 0.0;
                pos.setDiscount(amt);
                Navigator.of(context).pop();
              },
              style: ElevatedButton.styleFrom(backgroundColor: Colors.amber, foregroundColor: const Color(0xFF141923)),
              child: const Text('ÁP DỤNG'),
            ),
          ],
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final pos = context.watch<PosProvider>();

    return Scaffold(
      backgroundColor: const Color(0xFF141923),
      body: Row(
        children: [
          // PANEL 1: FLOOR MAP (TABLES)
          Container(
            width: 320,
            decoration: const BoxDecoration(
              color: Color(0xFF1E2633),
              border: Border(right: BorderSide(color: Color(0xFF2C384E))),
            ),
            child: Column(
              children: [
                // Branch and User Info Header
                _buildHeader(auth, pos),
                const Divider(color: Color(0xFF2C384E), height: 1),
                // Zone filter
                _buildZoneFilter(pos),
                // Table list
                Expanded(
                  child: pos.isLoadingFloor
                      ? const Center(child: CircularProgressIndicator(color: Colors.amber))
                      : _buildTableGrid(pos),
                ),
                const Divider(color: Color(0xFF2C384E), height: 1),
                // Bottom Shift & Numpad Drawer controller
                _buildShiftPanel(pos),
              ],
            ),
          ),

          // PANEL 2: PRODUCT MENU GRID
          Expanded(
            child: Column(
              children: [
                // Top Search Bar
                _buildSearchBar(),
                // Category tabs
                _buildCategoryList(pos),
                // Menu Items Grid
                Expanded(
                  child: pos.isLoadingMenu
                      ? const Center(child: CircularProgressIndicator(color: Colors.amber))
                      : _buildMenuGrid(pos),
                ),
              ],
            ),
          ),

          // PANEL 3: ORDER CART
          Container(
            width: 360,
            decoration: const BoxDecoration(
              color: Color(0xFF1E2633),
              border: Border(left: BorderSide(color: Color(0xFF2C384E))),
            ),
            child: _buildCartPanel(pos),
          )
        ],
      ),
    );
  }

  Widget _buildHeader(AuthProvider auth, PosProvider pos) {
    return Padding(
      padding: const EdgeInsets.all(16.0),
      child: Row(
        children: [
          const Icon(Icons.store, color: Colors.amber, size: 28),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  auth.currentUser?.username.toUpperCase() ?? 'STAFF',
                  style: const TextStyle(fontWeight: FontWeight.bold, color: Colors.white, fontSize: 14),
                ),
                Text(
                  'Chi nhánh: ${auth.selectedBranchId.toUpperCase()}',
                  style: const TextStyle(color: Color(0xFF8A99AD), fontSize: 11),
                ),
              ],
            ),
          ),
          IconButton(
            icon: const Icon(Icons.point_of_sale_outlined, color: Colors.amber, size: 20),
            onPressed: _onOpenCashDrawer,
            tooltip: 'Mở két tiền',
          ),
          const SizedBox(width: 8),
          IconButton(
            icon: const Icon(Icons.logout, color: Colors.redAccent, size: 20),
            onPressed: _onLogout,
            tooltip: 'Đăng xuất',
          )
        ],
      ),
    );
  }

  Widget _buildZoneFilter(PosProvider pos) {
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 12),
      child: Row(
        children: [
          _zoneChip('Tất cả', 'all', pos),
          ...pos.zones.map((z) => _zoneChip(z.name, z.id, pos)),
        ],
      ),
    );
  }

  Widget _zoneChip(String label, String id, PosProvider pos) {
    final active = pos.selectedZoneId == id;
    return GestureDetector(
      onTap: () => pos.selectZone(id),
      child: Container(
        margin: const EdgeInsets.symmetric(horizontal: 4),
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
        decoration: BoxDecoration(
          color: active ? Colors.amber : const Color(0xFF252F42),
          borderRadius: BorderRadius.circular(20),
        ),
        child: Text(
          label,
          style: TextStyle(
            color: active ? const Color(0xFF141923) : Colors.white,
            fontSize: 11,
            fontWeight: FontWeight.bold,
          ),
        ),
      ),
    );
  }

  Widget _buildTableGrid(PosProvider pos) {
    final filtered = pos.tables.where((t) {
      if (pos.selectedZoneId == 'all') return true;
      return t.zoneId == pos.selectedZoneId;
    }).toList();

    if (filtered.isEmpty) {
      return const Center(
        child: Text('Không có bàn', style: TextStyle(color: Color(0xFF8A99AD))),
      );
    }

    return GridView.builder(
      padding: const EdgeInsets.all(12),
      gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
        crossAxisCount: 3,
        crossAxisSpacing: 10,
        mainAxisSpacing: 10,
        childAspectRatio: 1.0,
      ),
      itemCount: filtered.length,
      itemBuilder: (context, index) {
        final table = filtered[index];
        final isSelected = pos.selectedTable?.id == table.id;
        final hasOrder = table.activeOrderId != null;
        
        Color bg = const Color(0xFF252F42);
        Color border = const Color(0xFF2C384E);
        if (isSelected) {
          bg = Colors.amber.withOpacity(0.15);
          border = Colors.amber;
        } else if (table.status == 'calling') {
          bg = Colors.redAccent.withOpacity(0.2);
          border = Colors.redAccent;
        } else if (hasOrder) {
          bg = Colors.greenAccent.withOpacity(0.1);
          border = Colors.greenAccent.withOpacity(0.5);
        }

        return InkWell(
          onTap: () => pos.selectTable(table),
          child: Container(
            decoration: BoxDecoration(
              color: bg,
              borderRadius: BorderRadius.circular(8),
              border: Border.all(color: border, width: isSelected ? 2 : 1),
            ),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                if (table.status == 'calling')
                  const Icon(Icons.notifications_active, color: Colors.redAccent, size: 16)
                else
                  const Icon(Icons.table_bar_outlined, color: Color(0xFF8A99AD), size: 16),
                const SizedBox(height: 4),
                Text(
                  table.code,
                  style: const TextStyle(fontWeight: FontWeight.bold, color: Colors.white, fontSize: 13),
                ),
                if (hasOrder && table.activeOrderTotal != null)
                  Text(
                    '${_currencyFormat.format(table.activeOrderTotal)}đ',
                    style: const TextStyle(fontSize: 10, color: Colors.amber),
                  ),
              ],
            ),
          ),
        );
      },
    );
  }

  Widget _buildShiftPanel(PosProvider pos) {
    final shift = pos.currentShift;
    return Container(
      padding: const EdgeInsets.all(16),
      color: const Color(0xFF141923),
      child: Column(
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text('TRẠNG THÁI CA:', style: TextStyle(color: Color(0xFF8A99AD), fontSize: 10)),
                  Text(
                    shift != null ? 'CA ĐANG MỞ' : 'CA ĐÃ ĐÓNG',
                    style: TextStyle(
                      fontWeight: FontWeight.black,
                      color: shift != null ? Colors.greenAccent : Colors.redAccent,
                      fontSize: 12,
                    ),
                  ),
                ],
              ),
              ElevatedButton(
                onPressed: () {
                  showDialog(
                    context: context,
                    builder: (_) => const ShiftDialog(),
                  );
                },
                style: ElevatedButton.styleFrom(
                  backgroundColor: shift != null ? Colors.redAccent : Colors.amber,
                  foregroundColor: const Color(0xFF141923),
                  padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                  minimumSize: Size.zero,
                  tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                ),
                child: Text(
                  shift != null ? 'ĐÓNG CA' : 'MỞ CA',
                  style: const TextStyle(fontSize: 11, fontWeight: FontWeight.bold),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildSearchBar() {
    return Padding(
      padding: const EdgeInsets.all(16.0),
      child: TextField(
        style: const TextStyle(color: Colors.white),
        decoration: InputDecoration(
          hintText: 'Tìm kiếm món ăn, thức uống...',
          hintStyle: const TextStyle(color: Color(0xFF8A99AD)),
          prefixIcon: const Icon(Icons.search, color: Color(0xFF8A99AD)),
          filled: true,
          fillColor: const Color(0xFF1E2633),
          enabledBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(30),
            borderSide: const BorderSide(color: Color(0xFF2C384E)),
          ),
          focusedBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(30),
            borderSide: const BorderSide(color: Colors.amber),
          ),
        ),
        onChanged: (val) {
          setState(() {
            _searchQuery = val.toLowerCase();
          });
        },
      ),
    );
  }

  Widget _buildCategoryList(PosProvider pos) {
    return Container(
      height: 48,
      margin: const EdgeInsets.only(bottom: 8),
      child: ListView(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: 16),
        children: [
          GestureDetector(
            onTap: () => setState(() => _selectedCategory = null),
            child: Container(
              margin: const EdgeInsets.only(right: 8),
              padding: const EdgeInsets.symmetric(horizontal: 16),
              decoration: BoxDecoration(
                color: _selectedCategory == null ? Colors.amber : const Color(0xFF1E2633),
                borderRadius: BorderRadius.circular(8),
                border: Border.all(color: const Color(0xFF2C384E)),
              ),
              child: Center(
                child: Text(
                  'Tất cả',
                  style: TextStyle(
                    color: _selectedCategory == null ? const Color(0xFF141923) : Colors.white,
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ),
            ),
          ),
          ...pos.categories.map((c) {
            final active = _selectedCategory?.id == c.id;
            return GestureDetector(
              onTap: () => setState(() => _selectedCategory = c),
              child: Container(
                margin: const EdgeInsets.only(right: 8),
                padding: const EdgeInsets.symmetric(horizontal: 16),
                decoration: BoxDecoration(
                  color: active ? Colors.amber : const Color(0xFF1E2633),
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(color: const Color(0xFF2C384E)),
                ),
                child: Center(
                  child: Text(
                    c.name,
                    style: TextStyle(
                      color: active ? const Color(0xFF141923) : Colors.white,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ),
              ),
            );
          }),
        ],
      ),
    );
  }

  Widget _buildMenuGrid(PosProvider pos) {
    final filtered = pos.menuItems.where((m) {
      final matchesCat = _selectedCategory == null || m.categoryId == _selectedCategory!.id;
      final matchesSearch = m.name.toLowerCase().contains(_searchQuery) || m.code.toLowerCase().contains(_searchQuery);
      return matchesCat && matchesSearch;
    }).toList();

    if (filtered.isEmpty) {
      return const Center(child: Text('Không tìm thấy món ăn nào', style: TextStyle(color: Color(0xFF8A99AD))));
    }

    return GridView.builder(
      padding: const EdgeInsets.all(16),
      gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
        crossAxisCount: 4,
        crossAxisSpacing: 16,
        mainAxisSpacing: 16,
        childAspectRatio: 0.8,
      ),
      itemCount: filtered.length,
      itemBuilder: (context, index) {
        final item = filtered[index];
        return Card(
          color: const Color(0xFF1E2633),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(8),
            side: const BorderSide(color: Color(0xFF2C384E)),
          ),
          child: InkWell(
            onTap: () => _showModifiersDialog(item),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Expanded(
                  child: item.imageUrl.isNotEmpty
                      ? Image.network(item.imageUrl, fit: BoxFit.cover, errorBuilder: (_, __, ___) => const Icon(Icons.fastfood, color: Color(0xFF8A99AD), size: 40))
                      : const Icon(Icons.fastfood, color: Color(0xFF8A99AD), size: 40),
                ),
                Padding(
                  padding: const EdgeInsets.all(10.0),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        item.name,
                        style: const TextStyle(fontWeight: FontWeight.bold, color: Colors.white, fontSize: 13),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                      const SizedBox(height: 4),
                      Text(
                        '${_currencyFormat.format(item.price)}đ',
                        style: const TextStyle(color: Colors.amber, fontWeight: FontWeight.bold, fontSize: 12),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        );
      },
    );
  }

  Widget _buildCartPanel(PosProvider pos) {
    if (pos.selectedTable == null) {
      return const Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.table_restaurant, color: Color(0xFF8A99AD), size: 48),
            SizedBox(height: 12),
            Text('CHƯA CHỌN BÀN', style: TextStyle(color: Color(0xFF8A99AD), fontWeight: FontWeight.bold)),
            Text('Vui lòng chọn bàn ở cột bên trái để bắt đầu.', style: TextStyle(color: Color(0xFF8A99AD), fontSize: 11)),
          ],
        ),
      );
    }

    return Column(
      children: [
        // Cart Header
        Padding(
          padding: const EdgeInsets.all(16.0),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                'BÀN: ${pos.selectedTable!.code}',
                style: const TextStyle(fontWeight: FontWeight.black, fontSize: 16, color: Colors.white),
              ),
              if (pos.selectedTable!.status == 'calling')
                ElevatedButton.icon(
                  onPressed: () => pos.resolveCall(pos.selectedTable!.id),
                  icon: const Icon(Icons.notifications_off, size: 14),
                  label: const Text('TẮT CHUÔNG', style: TextStyle(fontSize: 10)),
                  style: ElevatedButton.styleFrom(backgroundColor: Colors.redAccent, foregroundColor: Colors.white),
                ),
            ],
          ),
        ),
        const Divider(color: Color(0xFF2C384E), height: 1),

        // Cart items list
        Expanded(
          child: pos.cart.isEmpty
              ? const Center(child: Text('Giỏ hàng trống', style: TextStyle(color: Color(0xFF8A99AD))))
              : ListView.builder(
                  padding: const EdgeInsets.all(12),
                  itemCount: pos.cart.length,
                  itemBuilder: (context, index) {
                    final c = pos.cart[index];
                    return Container(
                      margin: const EdgeInsets.only(bottom: 8),
                      padding: const EdgeInsets.all(10),
                      decoration: BoxDecoration(
                        color: const Color(0xFF141923),
                        borderRadius: BorderRadius.circular(6),
                        border: Border.all(color: const Color(0xFF2C384E)),
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            mainAxisAlignment: MainAxisAlignment.spaceBetween,
                            children: [
                              Expanded(
                                child: Text(c.item.name, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 12)),
                              ),
                              Text('${_currencyFormat.format(c.totalPrice)}đ', style: const TextStyle(color: Colors.amber, fontSize: 12)),
                            ],
                          ),
                          if (c.selectedModifiers.isNotEmpty)
                            Padding(
                              padding: const EdgeInsets.only(top: 4.0),
                              child: Text(
                                c.selectedModifiers.map((m) => '+${m.name}').join(', '),
                                style: const TextStyle(color: Color(0xFF8A99AD), fontSize: 10),
                              ),
                            ),
                          if (c.notes.isNotEmpty)
                            Padding(
                              padding: const EdgeInsets.only(top: 4.0),
                              child: Text('Ghi chú: ${c.notes}', style: const TextStyle(color: Colors.amberAccent, fontSize: 10)),
                            ),
                          const SizedBox(height: 8),
                          Row(
                            mainAxisAlignment: MainAxisAlignment.spaceBetween,
                            children: [
                              Row(
                                children: [
                                  _qtyBtn(Icons.remove, () => pos.updateQty(c, c.qty - 1)),
                                  Padding(
                                    padding: const EdgeInsets.symmetric(horizontal: 10.0),
                                    child: Text('${c.qty}', style: const TextStyle(color: Colors.white)),
                                  ),
                                  _qtyBtn(Icons.add, () => pos.updateQty(c, c.qty + 1)),
                                ],
                              ),
                              IconButton(
                                icon: const Icon(Icons.delete_outline, color: Colors.redAccent, size: 18),
                                onPressed: () => pos.removeFromCart(c),
                                padding: EdgeInsets.zero,
                                constraints: const BoxConstraints(),
                              ),
                            ],
                          ),
                        ],
                      ),
                    );
                  },
                ),
        ),
        const Divider(color: Color(0xFF2C384E), height: 1),

        // Cart totals and buttons
        Container(
          padding: const EdgeInsets.all(16),
          color: const Color(0xFF141923),
          child: Column(
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  const Text('Tạm tính:', style: TextStyle(color: Color(0xFF8A99AD), fontSize: 12)),
                  Text('${_currencyFormat.format(pos.cartSubtotal)}đ', style: const TextStyle(color: Colors.white, fontSize: 12)),
                ],
              ),
              const SizedBox(height: 6),
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  GestureDetector(
                    onTap: _showDiscountDialog,
                    child: Row(
                      children: [
                        const Text('Giảm giá:', style: TextStyle(color: Color(0xFF8A99AD), fontSize: 12)),
                        const SizedBox(width: 4),
                        Icon(Icons.edit, color: Colors.amber[600], size: 12),
                      ],
                    ),
                  ),
                  Text('-${_currencyFormat.format(pos.activeDiscount)}đ', style: const TextStyle(color: Colors.redAccent, fontSize: 12)),
                ],
              ),
              const Divider(color: Color(0xFF2C384E), height: 16),
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  const Text('TỔNG THANH TOÁN:', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 13)),
                  Text(
                    '${_currencyFormat.format(pos.cartTotal)}đ',
                    style: const TextStyle(color: Colors.amber, fontWeight: FontWeight.black, fontSize: 18),
                  ),
                ],
              ),
              const SizedBox(height: 16),
              Row(
                children: [
                  Expanded(
                    child: ElevatedButton(
                      onPressed: pos.isSavingOrder ? null : () => pos.submitOrder(),
                      style: ElevatedButton.styleFrom(
                        backgroundColor: const Color(0xFF252F42),
                        foregroundColor: Colors.white,
                        padding: const EdgeInsets.symmetric(vertical: 14),
                      ),
                      child: pos.isSavingOrder
                          ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2))
                          : const Text('LƯU ĐƠN', style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold)),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: ElevatedButton(
                      onPressed: pos.activeOrderId == null
                          ? null
                          : () {
                              showDialog(
                                context: context,
                                builder: (_) => const PaymentDialog(),
                              );
                            },
                      style: ElevatedButton.styleFrom(
                        backgroundColor: Colors.amber,
                        foregroundColor: const Color(0xFF141923),
                        padding: const EdgeInsets.symmetric(vertical: 14),
                      ),
                      child: const Text('THANH TOÁN', style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold)),
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _qtyBtn(IconData icon, Function() onTap) {
    return InkWell(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.all(4),
        decoration: BoxDecoration(
          color: const Color(0xFF252F42),
          borderRadius: BorderRadius.circular(4),
          border: Border.all(color: const Color(0xFF2C384E)),
        ),
        child: Icon(icon, color: Colors.white, size: 14),
      ),
    );
  }
}
