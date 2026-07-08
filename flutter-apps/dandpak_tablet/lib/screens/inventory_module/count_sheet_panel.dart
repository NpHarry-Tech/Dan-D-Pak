// lib/screens/inventory_module/count_sheet_panel.dart
import 'package:flutter/material.dart';
import '../../models/tablet_models.dart';
import '../../services/api_service.dart';

class CountSheetPanel extends StatefulWidget {
  final List<InventoryItem> inventory;
  final List<Lot> lots;
  final String warehouseId;
  final ApiService api;
  final VoidCallback onComplete;

  const CountSheetPanel({
    super.key,
    required this.inventory,
    required this.lots,
    required this.warehouseId,
    required this.api,
    required this.onComplete,
  });

  @override
  State<CountSheetPanel> createState() => _CountSheetPanelState();
}

class _CountSheetPanelState extends State<CountSheetPanel> {
  final _searchController = TextEditingController();
  final _sessionNameController = TextEditingController();
  final List<Map<String, dynamic>> _lines = []; // { item: InventoryItem, counted: double, lot: Lot? }
  bool _busy = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _sessionNameController.text = 'Kiểm kho ngày ${DateTime.now().day}/${DateTime.now().month}';
  }

  @override
  void dispose() {
    _searchController.dispose();
    _sessionNameController.dispose();
    super.dispose();
  }

  void _addItem(InventoryItem item) {
    // Check if already added
    if (_lines.any((l) => l['item'].id == item.id)) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('${item.name} đã được thêm vào phiếu')),
      );
      return;
    }

    setState(() {
      _lines.add({
        'item': item,
        'counted': item.stock, // initialize with book stock
        'lot': null,
      });
    });
  }

  void _removeLine(int index) {
    setState(() {
      _lines.removeAt(index);
    });
  }

  void _updateCounted(int index, String val) {
    final double? parsed = double.tryParse(val);
    if (parsed != null && parsed >= 0) {
      setState(() {
        _lines[index]['counted'] = parsed;
      });
    }
  }

  double get _totalVarianceQty {
    double total = 0;
    for (var line in _lines) {
      final item = line['item'] as InventoryItem;
      final counted = line['counted'] as double;
      total += (counted - item.stock).abs();
    }
    return total;
  }

  double get _totalVarianceValue {
    double total = 0;
    for (var line in _lines) {
      final item = line['item'] as InventoryItem;
      final counted = line['counted'] as double;
      total += (counted - item.stock) * item.cost;
    }
    return total;
  }

  Future<void> _submitStocktake() async {
    if (_lines.isEmpty) {
      setState(() => _error = 'Vui lòng thêm ít nhất một sản phẩm vào phiếu kiểm');
      return;
    }
    if (_sessionNameController.text.trim().isEmpty) {
      setState(() => _error = 'Vui lòng đặt tên phiên kiểm kho');
      return;
    }

    setState(() {
      _busy = true;
      _error = null;
    });

    final payloadLines = _lines.map((l) {
      final item = l['item'] as InventoryItem;
      return {
        'stock_type': item.stockType,
        'item_id': item.id,
        'counted_qty': l['counted'],
        'lot_id': l['lot']?.id,
      };
    }).toList();

    try {
      await widget.api.submitStocktake(
        warehouseId: widget.warehouseId,
        name: _sessionNameController.text.trim(),
        lines: payloadLines,
      );

      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Chốt kiểm kho thành công! Đã cân đối số lượng.'), backgroundColor: Colors.green),
        );
        widget.onComplete();
      }
    } catch (e) {
      setState(() {
        _error = e.toString().replaceFirst('Exception: ', '');
        _busy = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        // Header info & Actions
        Row(
          children: [
            Expanded(
              child: TextField(
                controller: _sessionNameController,
                style: const TextStyle(color: Color(0xFF1A2230)),
                decoration: InputDecoration(
                  labelText: 'Tên / Mã phiên kiểm kho',
                  labelStyle: const TextStyle(color: Color(0xFF677084)),
                  filled: true,
                  fillColor: const Color(0xFFF3F5F7),
                  border: OutlineInputBorder(borderRadius: BorderRadius.circular(10), borderSide: BorderSide.none),
                ),
              ),
            ),
            const SizedBox(width: 14),
            IconButton(
              icon: const Icon(Icons.qr_code_scanner, color: Color(0xFF0891B2), size: 30),
              onPressed: () {
                // Barcode simulation helper
                if (widget.inventory.isNotEmpty) {
                  final scanned = widget.inventory.first;
                  _addItem(scanned);
                  ScaffoldMessenger.of(context).showSnackBar(
                    SnackBar(content: Text('Quét vạch: ${scanned.name}')),
                  );
                }
              },
            ),
          ],
        ),
        const SizedBox(height: 14),
        // Search bar list view autocomplete
        Autocomplete<InventoryItem>(
          displayStringForOption: (item) => '${item.name} (${item.unit})',
          optionsBuilder: (textEditingValue) {
            if (textEditingValue.text.isEmpty) {
              return const Iterable<InventoryItem>.empty();
            }
            return widget.inventory.where((item) {
              return item.name.toLowerCase().contains(textEditingValue.text.toLowerCase()) ||
                  (item.barcode?.toLowerCase().contains(textEditingValue.text.toLowerCase()) ?? false);
            });
          },
          onSelected: (item) {
            _searchController.clear();
            _addItem(item);
          },
          fieldViewBuilder: (context, controller, focusNode, onFieldSubmitted) {
            return TextField(
              controller: controller,
              focusNode: focusNode,
              style: const TextStyle(color: Color(0xFF1A2230)),
              decoration: InputDecoration(
                hintText: 'Nhập tên hàng, mã vạch để tìm kiếm...',
                hintStyle: const TextStyle(color: Color(0xFF9AA3B2)),
                prefixIcon: const Icon(Icons.search, color: Color(0xFF677084)),
                filled: true,
                fillColor: const Color(0xFFF3F5F7),
                border: OutlineInputBorder(borderRadius: BorderRadius.circular(10), borderSide: BorderSide.none),
              ),
            );
          },
        ),
        const SizedBox(height: 18),
        // Main list lines
        Expanded(
          child: _lines.isEmpty
              ? const Center(
                  child: Text(
                    'Chưa có mặt hàng nào được thêm vào danh sách kiểm.',
                    style: TextStyle(color: Color(0xFF677084)),
                  ),
                )
              : ListView.separated(
                  itemCount: _lines.length,
                  separatorBuilder: (_, __) => const Divider(color: Color(0xFFE7EAEE)),
                  itemBuilder: (context, index) {
                    final line = _lines[index];
                    final item = line['item'] as InventoryItem;
                    final counted = line['counted'] as double;
                    final diff = counted - item.stock;
                    final diffVal = diff * item.cost;

                    return Padding(
                      padding: const EdgeInsets.symmetric(vertical: 8),
                      child: Row(
                        children: [
                          Expanded(
                            flex: 4,
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(item.name, style: const TextStyle(color: Color(0xFF1A2230), fontWeight: FontWeight.bold)),
                                Text('Đơn vị: ${item.unit} | Giá vốn: đ${item.cost}', style: const TextStyle(color: Color(0xFF677084), fontSize: 11)),
                              ],
                            ),
                          ),
                          Expanded(
                            flex: 2,
                            child: Text(
                              'Sổ sách: ${item.stock}',
                              style: const TextStyle(color: Color(0xFF1A2230)),
                              textAlign: TextAlign.center,
                            ),
                          ),
                          Expanded(
                            flex: 2,
                            child: SizedBox(
                              height: 38,
                              child: TextFormField(
                                initialValue: counted.toString(),
                                keyboardType: const TextInputType.numberWithOptions(decimal: true),
                                style: const TextStyle(color: Color(0xFF1A2230), fontSize: 14, fontWeight: FontWeight.bold),
                                textAlign: TextAlign.center,
                                decoration: InputDecoration(
                                  contentPadding: const EdgeInsets.symmetric(horizontal: 6),
                                  filled: true,
                                  fillColor: const Color(0xFFF3F5F7),
                                  border: OutlineInputBorder(borderRadius: BorderRadius.circular(6), borderSide: BorderSide.none),
                                ),
                                onChanged: (val) => _updateCounted(index, val),
                              ),
                            ),
                          ),
                          Expanded(
                            flex: 2,
                            child: Column(
                              children: [
                                Text(
                                  'Lệch: ${diff > 0 ? "+" : ""}${diff.toStringAsFixed(1)}',
                                  style: TextStyle(
                                    color: diff == 0
                                        ? const Color(0xFF677084)
                                        : (diff > 0 ? Colors.green : Colors.orangeAccent),
                                    fontWeight: FontWeight.bold,
                                    fontSize: 13,
                                  ),
                                  textAlign: TextAlign.center,
                                ),
                                Text(
                                  'đ${diffVal > 0 ? "+" : ""}${diffVal.toInt()}',
                                  style: TextStyle(
                                    color: diffVal == 0 ? const Color(0xFF9AA3B2) : (diffVal > 0 ? Colors.green : Colors.orangeAccent),
                                    fontSize: 10,
                                  ),
                                ),
                              ],
                            ),
                          ),
                          IconButton(
                            icon: const Icon(Icons.delete, color: Color(0xFFFF7A7A), size: 18),
                            onPressed: () => _removeLine(index),
                          ),
                        ],
                      ),
                    );
                  },
                ),
        ),
        if (_error != null) ...[
          Text(_error!, style: const TextStyle(color: Color(0xFFFF7A7A), fontWeight: FontWeight.bold), textAlign: TextAlign.center),
          const SizedBox(height: 10),
        ],
        // Summary footer
        Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: const Color(0xFFF3F5F7),
            borderRadius: BorderRadius.circular(10),
            border: Border.all(color: const Color(0xFFE7EAEE)),
          ),
          child: Column(
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  const Text('Tổng số lượng lệch:', style: TextStyle(color: Color(0xFF677084))),
                  Text(
                    _totalVarianceQty.toStringAsFixed(1),
                    style: const TextStyle(color: Color(0xFF1A2230), fontWeight: FontWeight.bold),
                  ),
                ],
              ),
              const SizedBox(height: 8),
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  const Text('Giá trị chênh lệch:', style: TextStyle(color: Color(0xFF677084))),
                  Text(
                    'đ${_totalVarianceValue.toInt()}',
                    style: TextStyle(
                      color: _totalVarianceValue == 0
                          ? const Color(0xFF1A2230)
                          : (_totalVarianceValue > 0 ? Colors.green : Colors.orangeAccent),
                      fontWeight: FontWeight.bold,
                      fontSize: 16,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 16),
              FilledButton(
                style: FilledButton.styleFrom(
                  backgroundColor: const Color(0xFF0891B2),
                  padding: const EdgeInsets.symmetric(vertical: 14),
                  minimumSize: const Size(double.infinity, 44),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
                ),
                onPressed: _busy ? null : _submitStocktake,
                child: _busy
                    ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                    : const Text('CHỐT KIỂM KHO (CÂN BẰNG KHO)', style: TextStyle(fontWeight: FontWeight.bold)),
              ),
            ],
          ),
        ),
      ],
    );
  }
}
