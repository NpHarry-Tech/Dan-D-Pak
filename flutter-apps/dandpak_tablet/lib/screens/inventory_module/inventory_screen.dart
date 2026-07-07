// lib/screens/inventory_module/inventory_screen.dart
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../models/tablet_models.dart';
import '../../providers/app_provider.dart';
import '../../providers/auth_provider.dart';
import '../../services/api_service.dart';
import 'count_sheet_panel.dart';
import 'movement_dialog.dart';

class InventoryScreen extends StatefulWidget {
  const InventoryScreen({super.key});

  @override
  State<InventoryScreen> createState() => _InventoryScreenState();
}

class _InventoryScreenState extends State<InventoryScreen> with SingleTickerProviderStateMixin {
  late TabController _tabController;
  List<Warehouse> _warehouses = [];
  List<InventoryItem> _inventory = [];
  List<Lot> _lots = [];
  List<dynamic> _movements = [];
  bool _loading = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 4, vsync: this);
    _loadWarehouses();
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  Future<void> _loadWarehouses() async {
    setState(() {
      _loading = true;
      _error = null;
    });

    final appProv = Provider.of<AppProvider>(context, listen: false);
    final authProv = Provider.of<AuthProvider>(context, listen: false);
    final api = ApiService(baseUrl: appProv.serverUrl, token: authProv.token, branchId: appProv.activeBranch?.id);

    try {
      final whList = await api.fetchWarehouses();
      setState(() {
        _warehouses = whList;
      });

      if (whList.isNotEmpty) {
        if (appProv.activeWarehouse == null) {
          appProv.setActiveWarehouse(whList.first);
        }
        await _loadWarehouseData();
      } else {
        setState(() => _loading = false);
      }
    } catch (e) {
      setState(() {
        _error = e.toString().replaceFirst('Exception: ', '');
        _loading = false;
      });
    }
  }

  Future<void> _loadWarehouseData() async {
    final appProv = Provider.of<AppProvider>(context, listen: false);
    final authProv = Provider.of<AuthProvider>(context, listen: false);
    final api = ApiService(baseUrl: appProv.serverUrl, token: authProv.token, branchId: appProv.activeBranch?.id);

    if (appProv.activeWarehouse == null) return;

    setState(() {
      _loading = true;
      _error = null;
    });

    try {
      final isRetail = appProv.activeWarehouse!.type == 'retail';
      final results = await Future.wait([
        api.fetchInventory(appProv.activeWarehouse!.id, isRetail),
        api.fetchLots(appProv.activeWarehouse!.id),
        api.fetchMovements(),
      ]);

      setState(() {
        _inventory = results[0] as List<InventoryItem>;
        _lots = results[1] as List<Lot>;
        _movements = results[2];
        _loading = false;
      });
    } catch (e) {
      setState(() {
        _error = e.toString().replaceFirst('Exception: ', '');
        _loading = false;
      });
    }
  }

  void _openMovementDialog(InventoryItem item, String mode) {
    final appProv = Provider.of<AppProvider>(context, listen: false);
    final authProv = Provider.of<AuthProvider>(context, listen: false);
    final api = ApiService(baseUrl: appProv.serverUrl, token: authProv.token, branchId: appProv.activeBranch?.id);

    showDialog(
      context: context,
      builder: (context) {
        return MovementDialog(
          item: item,
          mode: mode,
          warehouseId: appProv.activeWarehouse!.id,
          api: api,
          onSuccess: _loadWarehouseData,
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    final appProv = Provider.of<AppProvider>(context);

    return Scaffold(
      backgroundColor: const Color(0xFF0F141C),
      appBar: AppBar(
        backgroundColor: const Color(0xFF161C23),
        title: const Text('Quản lý Kho hàng', style: TextStyle(fontWeight: FontWeight.bold)),
        actions: [
          if (_warehouses.isNotEmpty) ...[
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 10),
              margin: const EdgeInsets.symmetric(vertical: 8),
              decoration: BoxDecoration(
                color: const Color(0xFF1E2630),
                borderRadius: BorderRadius.circular(8),
              ),
              child: DropdownButtonHideUnderline(
                child: DropdownButton<String>(
                  dropdownColor: const Color(0xFF1E2630),
                  value: appProv.activeWarehouse?.id,
                  style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold),
                  items: _warehouses.map((wh) {
                    return DropdownMenuItem(
                      value: wh.id,
                      child: Text(wh.name),
                    );
                  }).toList(),
                  onChanged: (val) {
                    if (val != null) {
                      final selected = _warehouses.firstWhere((w) => w.id == val);
                      appProv.setActiveWarehouse(selected);
                      _loadWarehouseData();
                    }
                  },
                ),
              ),
            ),
            const SizedBox(width: 14),
          ],
          IconButton(
            icon: const Icon(Icons.refresh, color: Colors.white70),
            onPressed: _loadWarehouseData,
          ),
        ],
        bottom: TabBar(
          controller: _tabController,
          labelColor: const Color(0xFF2F7D6B),
          unselectedLabelColor: Colors.white60,
          indicatorColor: const Color(0xFF2F7D6B),
          tabs: const [
            Tab(icon: Icon(Icons.inventory_2), text: 'Tồn Kho'),
            Tab(icon: Icon(Icons.compare_arrows), text: 'Nhập/Xuất Nhanh'),
            Tab(icon: Icon(Icons.assignment), text: 'Kiểm Kho'),
            Tab(icon: Icon(Icons.history), text: 'Lịch sử kho'),
          ],
        ),
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator(color: Color(0xFF2F7D6B)))
          : Column(
              children: [
                if (_error != null)
                  Container(
                    width: double.infinity,
                    padding: const EdgeInsets.all(12),
                    color: const Color(0xFFFF7A7A).withOpacity(0.15),
                    child: Text('Lỗi: $_error', style: const TextStyle(color: Color(0xFFFF7A7A), fontWeight: FontWeight.bold), textAlign: TextAlign.center),
                  ),
                Expanded(
                  child: TabBarView(
                    controller: _tabController,
                    children: [
                      _buildStockTab(),
                      _buildQuickMovementsTab(),
                      _buildStocktakeTab(appProv),
                      _buildHistoryTab(),
                    ],
                  ),
                ),
              ],
            ),
    );
  }

  Widget _buildStockTab() {
    if (_inventory.isEmpty) {
      return const Center(child: Text('Không có dữ liệu tồn kho.', style: TextStyle(color: Colors.white30)));
    }

    return ListView.separated(
      padding: const EdgeInsets.all(16),
      itemCount: _inventory.length,
      separatorBuilder: (_, __) => const Divider(color: Colors.white10),
      itemBuilder: (context, index) {
        final item = _inventory[index];
        final isLow = item.stock < item.minStock;
        final isOut = item.stock <= 0;

        Color titleColor = Colors.white;
        Color statusColor = Colors.white54;
        String statusText = 'Bình thường';
        if (isOut) {
          titleColor = const Color(0xFFFF7A7A);
          statusColor = const Color(0xFFFF7A7A);
          statusText = 'HẾT HÀNG';
        } else if (isLow) {
          titleColor = Colors.orangeAccent;
          statusColor = Colors.orangeAccent;
          statusText = 'Tồn kho thấp';
        }

        return Container(
          padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 12),
          decoration: BoxDecoration(
            color: isOut
                ? Colors.redAccent.withOpacity(0.04)
                : (isLow ? Colors.orangeAccent.withOpacity(0.04) : Colors.transparent),
            borderRadius: BorderRadius.circular(8),
          ),
          child: Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Text(item.name, style: TextStyle(color: titleColor, fontWeight: FontWeight.bold, fontSize: 15)),
                        const SizedBox(width: 8),
                        if (isLow || isOut)
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                            decoration: BoxDecoration(
                              color: statusColor.withOpacity(0.18),
                              borderRadius: BorderRadius.circular(4),
                            ),
                            child: Text(
                              statusText,
                              style: TextStyle(color: statusColor, fontSize: 10, fontWeight: FontWeight.bold),
                            ),
                          ),
                      ],
                    ),
                    const SizedBox(height: 4),
                    Text(
                      'Loại: ${item.stockType.toUpperCase()} | Định mức: ${item.minStock} ${item.unit}',
                      style: const TextStyle(color: Colors.white30, fontSize: 12),
                    ),
                  ],
                ),
              ),
              Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Text(
                    '${item.stock} ${item.unit}',
                    style: TextStyle(
                      color: titleColor,
                      fontSize: 16,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  Text(
                    'đ${item.cost} / đơn vị',
                    style: const TextStyle(color: Colors.white30, fontSize: 11),
                  ),
                ],
              ),
            ],
          ),
        );
      },
    );
  }

  Widget _buildQuickMovementsTab() {
    if (_inventory.isEmpty) {
      return const Center(child: Text('Không có dữ liệu tồn kho.', style: TextStyle(color: Colors.white30)));
    }

    return ListView.separated(
      padding: const EdgeInsets.all(16),
      itemCount: _inventory.length,
      separatorBuilder: (_, __) => const Divider(color: Colors.white10),
      itemBuilder: (context, index) {
        final item = _inventory[index];
        return Padding(
          padding: const EdgeInsets.symmetric(vertical: 6),
          child: Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(item.name, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
                    Text('Tồn hiện tại: ${item.stock} ${item.unit}', style: const TextStyle(color: Colors.white30, fontSize: 12)),
                  ],
                ),
              ),
              OutlinedButton.icon(
                style: OutlinedButton.styleFrom(
                  side: const BorderSide(color: Color(0xFF2F7D6B)),
                  foregroundColor: const Color(0xFF2F7D6B),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
                ),
                icon: const Icon(Icons.add, size: 16),
                label: const Text('Nhập'),
                onPressed: () => _openMovementDialog(item, 'receipt'),
              ),
              const SizedBox(width: 10),
              OutlinedButton.icon(
                style: OutlinedButton.styleFrom(
                  side: const BorderSide(color: Color(0xFFFF7A7A)),
                  foregroundColor: const Color(0xFFFF7A7A),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
                ),
                icon: const Icon(Icons.remove, size: 16),
                label: const Text('Xuất'),
                onPressed: () => _openMovementDialog(item, 'issue'),
              ),
            ],
          ),
        );
      },
    );
  }

  Widget _buildStocktakeTab(AppProvider appProv) {
    if (appProv.activeWarehouse == null) {
      return const Center(child: Text('Chưa chọn kho hàng', style: TextStyle(color: Colors.white30)));
    }

    final authProv = Provider.of<AuthProvider>(context, listen: false);
    final api = ApiService(baseUrl: appProv.serverUrl, token: authProv.token, branchId: appProv.activeBranch?.id);

    return Padding(
      padding: const EdgeInsets.all(16),
      child: CountSheetPanel(
        inventory: _inventory,
        lots: _lots,
        warehouseId: appProv.activeWarehouse!.id,
        api: api,
        onComplete: () {
          _tabController.animateTo(0);
          _loadWarehouseData();
        },
      ),
    );
  }

  Widget _buildHistoryTab() {
    if (_movements.isEmpty) {
      return const Center(child: Text('Không có lịch sử nhập xuất.', style: TextStyle(color: Colors.white30)));
    }

    return ListView.separated(
      padding: const EdgeInsets.all(16),
      itemCount: _movements.length,
      separatorBuilder: (_, __) => const Divider(color: Colors.white10),
      itemBuilder: (context, index) {
        final mv = _movements[index];
        final type = mv['type']?.toString() ?? 'issue';
        final isReceipt = type == 'receive' || type == 'receipt';
        final qty = double.tryParse(mv['qty']?.toString() ?? '0') ?? 0.0;

        return Padding(
          padding: const EdgeInsets.symmetric(vertical: 8),
          child: Row(
            children: [
              Container(
                padding: const EdgeInsets.all(8),
                decoration: BoxDecoration(
                  color: isReceipt ? Colors.green.withOpacity(0.12) : Colors.redAccent.withOpacity(0.12),
                  shape: BoxShape.circle,
                ),
                child: Icon(
                  isReceipt ? Icons.arrow_downward : Icons.arrow_upward,
                  color: isReceipt ? Colors.green : Colors.redAccent,
                  size: 18,
                ),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(mv['item_name'] ?? mv['sku_name'] ?? 'Hàng hóa', style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
                    Text(
                      'Lý do: ${mv['reason'] ?? mv['lot_no'] ?? 'Nhập kho'}',
                      style: const TextStyle(color: Colors.white30, fontSize: 12),
                    ),
                  ],
                ),
              ),
              Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Text(
                    '${isReceipt ? "+" : "-"}$qty',
                    style: TextStyle(
                      color: isReceipt ? Colors.green : Colors.redAccent,
                      fontWeight: FontWeight.bold,
                      fontSize: 15,
                    ),
                  ),
                  Text(
                    mv['created_at'] != null ? mv['created_at'].toString().split('T')[0] : '',
                    style: const TextStyle(color: Colors.white30, fontSize: 10),
                  ),
                ],
              ),
            ],
          ),
        );
      },
    );
  }
}
