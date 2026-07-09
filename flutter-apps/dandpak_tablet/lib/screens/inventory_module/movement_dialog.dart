// lib/screens/inventory_module/movement_dialog.dart
import 'package:flutter/material.dart';
import '../../models/tablet_models.dart';
import '../../services/api_service.dart';

class MovementDialog extends StatefulWidget {
  final InventoryItem item;
  final String mode; // 'receipt' or 'issue'
  final String warehouseId;
  final ApiService api;
  final VoidCallback onSuccess;

  const MovementDialog({
    super.key,
    required this.item,
    required this.mode,
    required this.warehouseId,
    required this.api,
    required this.onSuccess,
  });

  @override
  State<MovementDialog> createState() => _MovementDialogState();
}

class _MovementDialogState extends State<MovementDialog> {
  final _qtyController = TextEditingController();
  final _lotController = TextEditingController();
  final _expiryController = TextEditingController();
  final _costController = TextEditingController();
  final _supplierController = TextEditingController();
  
  String _issueReason = 'manual_issue'; // 'manual_issue', 'waste', 'damaged', 'sample'
  bool _busy = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _costController.text = widget.item.cost.toString();
    _lotController.text = widget.item.trackLot ? 'LOT-' : '';
  }

  @override
  void dispose() {
    _qtyController.dispose();
    _lotController.dispose();
    _expiryController.dispose();
    _costController.dispose();
    _supplierController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final qty = double.tryParse(_qtyController.text) ?? 0.0;
    if (qty <= 0) {
      setState(() => _error = 'Số lượng phải lớn hơn 0');
      return;
    }

    setState(() {
      _busy = true;
      _error = null;
    });

    try {
      if (widget.mode == 'receipt') {
        await widget.api.receiveStock(
          warehouseId: widget.warehouseId,
          stockType: widget.item.stockType,
          itemId: widget.item.id,
          qty: qty,
          lotNo: _lotController.text.trim(),
          expiryDate: _expiryController.text.isEmpty ? null : _expiryController.text,
          cost: double.tryParse(_costController.text) ?? 0.0,
          supplier: _supplierController.text.trim(),
        );
      } else {
        await widget.api.issueStock(
          warehouseId: widget.warehouseId,
          stockType: widget.item.stockType,
          itemId: widget.item.id,
          qty: qty,
          reason: _issueReason,
        );
      }

      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(widget.mode == 'receipt' ? 'Nhập kho thành công!' : 'Xuất kho thành công!'),
            backgroundColor: Colors.green,
          ),
        );
        widget.onSuccess();
        Navigator.of(context).pop();
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
    final isReceipt = widget.mode == 'receipt';
    return Dialog(
      backgroundColor: const Color(0xFFFFFFFF),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: const BorderSide(color: Color(0xFFE7EAEE)),
      ),
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 500),
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text(
                    isReceipt ? 'Phiếu Nhập: ${widget.item.name}' : 'Phiếu Xuất: ${widget.item.name}',
                    style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: Color(0xFF1A2230)),
                  ),
                  IconButton(
                    icon: const Icon(Icons.close, color: Color(0xFF677084)),
                    onPressed: () => Navigator.of(context).pop(),
                  )
                ],
              ),
              const Divider(color: Color(0xFFE7EAEE)),
              const SizedBox(height: 10),
              Text(
                'Tồn kho hiện tại: ${widget.item.stock} ${widget.item.unit}',
                style: const TextStyle(color: Color(0xFF677084), fontSize: 13),
              ),
              const SizedBox(height: 18),
              TextField(
                controller: _qtyController,
                keyboardType: const TextInputType.numberWithOptions(decimal: true),
                style: const TextStyle(color: Color(0xFF1A2230)),
                decoration: InputDecoration(
                  labelText: 'Số lượng cần ${isReceipt ? 'nhập' : 'xuất'} (${widget.item.unit})',
                  labelStyle: const TextStyle(color: Color(0xFF677084)),
                  filled: true,
                  fillColor: const Color(0xFFF3F5F7),
                  border: OutlineInputBorder(borderRadius: BorderRadius.circular(10), borderSide: BorderSide.none),
                ),
              ),
              const SizedBox(height: 14),
              if (isReceipt) ...[
                Row(
                  children: [
                    Expanded(
                      child: TextField(
                        controller: _lotController,
                        style: const TextStyle(color: Color(0xFF1A2230)),
                        decoration: InputDecoration(
                          labelText: 'Lô sản xuất / Lot',
                          labelStyle: const TextStyle(color: Color(0xFF677084)),
                          filled: true,
                          fillColor: const Color(0xFFF3F5F7),
                          border: OutlineInputBorder(borderRadius: BorderRadius.circular(10), borderSide: BorderSide.none),
                        ),
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: TextField(
                        controller: _expiryController,
                        style: const TextStyle(color: Color(0xFF1A2230)),
                        decoration: InputDecoration(
                          labelText: 'Hạn sử dụng (HSD)',
                          labelStyle: const TextStyle(color: Color(0xFF677084)),
                          hintText: 'YYYY-MM-DD',
                          hintStyle: const TextStyle(color: Color(0xFF9AA3B2)),
                          filled: true,
                          fillColor: const Color(0xFFF3F5F7),
                          border: OutlineInputBorder(borderRadius: BorderRadius.circular(10), borderSide: BorderSide.none),
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 14),
                Row(
                  children: [
                    Expanded(
                      child: TextField(
                        controller: _costController,
                        keyboardType: TextInputType.number,
                        style: const TextStyle(color: Color(0xFF1A2230)),
                        decoration: InputDecoration(
                          labelText: 'Giá vốn nhập hàng',
                          labelStyle: const TextStyle(color: Color(0xFF677084)),
                          filled: true,
                          fillColor: const Color(0xFFF3F5F7),
                          border: OutlineInputBorder(borderRadius: BorderRadius.circular(10), borderSide: BorderSide.none),
                        ),
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: TextField(
                        controller: _supplierController,
                        style: const TextStyle(color: Color(0xFF1A2230)),
                        decoration: InputDecoration(
                          labelText: 'Nhà cung cấp',
                          labelStyle: const TextStyle(color: Color(0xFF677084)),
                          filled: true,
                          fillColor: const Color(0xFFF3F5F7),
                          border: OutlineInputBorder(borderRadius: BorderRadius.circular(10), borderSide: BorderSide.none),
                        ),
                      ),
                    ),
                  ],
                ),
              ] else ...[
                DropdownButtonFormField<String>(
                  dropdownColor: const Color(0xFFFFFFFF),
                  initialValue: _issueReason,
                  style: const TextStyle(color: Color(0xFF1A2230), fontSize: 15),
                  decoration: InputDecoration(
                    labelText: 'Lý do xuất kho',
                    labelStyle: const TextStyle(color: Color(0xFF677084)),
                    filled: true,
                    fillColor: const Color(0xFFF3F5F7),
                    border: OutlineInputBorder(borderRadius: BorderRadius.circular(10), borderSide: BorderSide.none),
                  ),
                  items: const [
                    DropdownMenuItem(value: 'manual_issue', child: Text('Xuất dùng nội bộ', style: TextStyle(color: Color(0xFF1A2230)))),
                    DropdownMenuItem(value: 'waste', child: Text('Hao hụt / Hủy bỏ', style: TextStyle(color: Color(0xFF1A2230)))),
                    DropdownMenuItem(value: 'damaged', child: Text('Hao hụt hỏng vỡ', style: TextStyle(color: Color(0xFF1A2230)))),
                    DropdownMenuItem(value: 'sample', child: Text('Hàng mẫu', style: TextStyle(color: Color(0xFF1A2230)))),
                  ],
                  onChanged: (val) {
                    if (val != null) {
                      setState(() => _issueReason = val);
                    }
                  },
                ),
              ],
              if (_error != null) ...[
                const SizedBox(height: 14),
                Text(
                  _error!,
                  style: const TextStyle(color: Color(0xFFFF7A7A), fontWeight: FontWeight.bold),
                  textAlign: TextAlign.center,
                ),
              ],
              const SizedBox(height: 24),
              Row(
                children: [
                  Expanded(
                    child: OutlinedButton(
                      style: OutlinedButton.styleFrom(
                        side: const BorderSide(color: Color(0xFFD3D8DF)),
                        padding: const EdgeInsets.symmetric(vertical: 14),
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                      ),
                      onPressed: () => Navigator.of(context).pop(),
                      child: const Text('Hủy', style: TextStyle(color: Color(0xFF677084))),
                    ),
                  ),
                  const SizedBox(width: 14),
                  Expanded(
                    child: FilledButton(
                      style: FilledButton.styleFrom(
                        backgroundColor: widget.mode == 'receipt' ? const Color(0xFF0891B2) : const Color(0xFFFF7A7A),
                        padding: const EdgeInsets.symmetric(vertical: 14),
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                      ),
                      onPressed: _busy ? null : _submit,
                      child: _busy
                          ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                          : Text(isReceipt ? 'Nhập kho' : 'Xuất kho', style: const TextStyle(fontWeight: FontWeight.bold)),
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}
