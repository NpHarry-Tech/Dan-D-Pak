part of 'warehouse_screen.dart';

/// Receive / issue dialog.
class _MoveDialog extends StatefulWidget {
  final ApiService api;
  final Map<String, dynamic> item;
  final String warehouseId;
  final bool receive;

  _MoveDialog({
    required this.api,
    required this.item,
    required this.warehouseId,
    required this.receive,
  });

  @override
  State<_MoveDialog> createState() => _MoveDialogState();
}

class _MoveDialogState extends State<_MoveDialog> {
  final _qty = TextEditingController();
  final _lot = TextEditingController();
  final _expiry = TextEditingController();
  final _cost = TextEditingController(text: '0');
  final _supplier = TextEditingController();
  String _reason = 'manual_issue';
  bool _saving = false;

  @override
  void dispose() {
    _qty.dispose();
    _lot.dispose();
    _expiry.dispose();
    _cost.dispose();
    _supplier.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final qty = double.tryParse(_qty.text.trim()) ?? 0;
    if (qty <= 0) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text(t('Số lượng không hợp lệ')),
          backgroundColor: DanColors.late));
      return;
    }
    final body = <String, dynamic>{
      'warehouse_id': widget.warehouseId,
      'stock_type': _s(widget.item['stock_type']).isEmpty
          ? _s(widget.item['item_type'])
          : _s(widget.item['stock_type']),
      'item_id': _s(widget.item['id']),
      'qty': qty,
    };
    if (widget.receive) {
      body['lot_no'] = _lot.text.trim();
      body['expiry_date'] =
          _expiry.text.trim().isEmpty ? null : _expiry.text.trim();
      body['unit_cost'] = double.tryParse(_cost.text.trim()) ?? 0;
      body['supplier'] = _supplier.text.trim();
    } else {
      body['reason'] = _reason;
    }
    setState(() => _saving = true);
    try {
      if (widget.receive) {
        await widget.api.receiveStock(body);
      } else {
        await widget.api.issueStock(body);
      }
      if (mounted) Navigator.of(context).pop(true);
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
    final unit = _s(widget.item['unit']);
    return AlertDialog(
      backgroundColor: DanColors.surface,
      title: Text(
          '${widget.receive ? t('Phiếu nhập') : t('Phiếu xuất')} · ${_s(widget.item['name'])}',
          style: TextStyle(fontWeight: FontWeight.w900, fontSize: 17)),
      content: SizedBox(
        width: 380,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(
              controller: _qty,
              autofocus: true,
              keyboardType: TextInputType.number,
              decoration: InputDecoration(
                  labelText: t('Số lượng ($unit)'), isDense: true),
            ),
            SizedBox(height: 12),
            if (widget.receive) ...[
              TextField(
                  controller: _lot,
                  decoration: InputDecoration(
                      labelText: t('Số lô (tuỳ chọn)'), isDense: true)),
              SizedBox(height: 12),
              TextField(
                  controller: _expiry,
                  decoration: InputDecoration(
                      labelText: t('Hạn dùng (YYYY-MM-DD)'), isDense: true)),
              SizedBox(height: 12),
              TextField(
                  controller: _cost,
                  keyboardType: TextInputType.number,
                  decoration: InputDecoration(
                      labelText: t('Giá vốn / đơn vị'), isDense: true)),
              SizedBox(height: 12),
              TextField(
                  controller: _supplier,
                  decoration: InputDecoration(
                      labelText: t('Nhà cung cấp'), isDense: true)),
            ] else
              DropdownButtonFormField<String>(
                initialValue: _reason,
                decoration: InputDecoration(labelText: t('Lý do xuất')),
                items: [
                  for (final r in _issueReasons)
                    DropdownMenuItem(value: r[0], child: Text(r[1])),
                ],
                onChanged: (v) => setState(() => _reason = v ?? _reason),
              ),
          ],
        ),
      ),
      actions: [
        TextButton(
            onPressed: () => Navigator.of(context).pop(),
            child: Text(t('Hủy'))),
        FilledButton(
          onPressed: _saving ? null : _save,
          style: FilledButton.styleFrom(
              backgroundColor:
                  widget.receive ? DanColors.brand : DanColors.late),
          child: _saving
              ? SizedBox(
                  width: 18,
                  height: 18,
                  child: CircularProgressIndicator(
                      strokeWidth: 2, color: Colors.white))
              : Text(widget.receive ? t('Nhập kho') : t('Xuất kho')),
        ),
      ],
    );
  }
}

/// New inventory item (kitchen warehouse).
class _NewItemDialog extends StatefulWidget {
  final ApiService api;
  _NewItemDialog({required this.api});

  @override
  State<_NewItemDialog> createState() => _NewItemDialogState();
}

class _NewItemDialogState extends State<_NewItemDialog> {
  final _name = TextEditingController();
  final _unit = TextEditingController(text: t('cái'));
  final _cost = TextEditingController(text: '0');
  String _itemType = 'ingredient';
  bool _saving = false;

  @override
  void dispose() {
    _name.dispose();
    _unit.dispose();
    _cost.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (_name.text.trim().isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text(t('Nhập tên mặt hàng')),
          backgroundColor: DanColors.late));
      return;
    }
    setState(() => _saving = true);
    try {
      await widget.api.createInventoryItem({
        'name': _name.text.trim(),
        'unit': _unit.text.trim(),
        'cost': double.tryParse(_cost.text.trim()) ?? 0,
        'item_type': _itemType,
      });
      if (mounted) Navigator.of(context).pop(true);
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
      title: Text(t('Thêm mặt hàng kho'),
          style: TextStyle(fontWeight: FontWeight.w900, fontSize: 18)),
      content: SizedBox(
        width: 360,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(
                controller: _name,
                decoration: InputDecoration(labelText: t('Tên mặt hàng'))),
            SizedBox(height: 12),
            Row(
              children: [
                Expanded(
                  child: TextField(
                      controller: _unit,
                      decoration: InputDecoration(labelText: t('Đơn vị'))),
                ),
                SizedBox(width: 12),
                Expanded(
                  child: TextField(
                      controller: _cost,
                      keyboardType: TextInputType.number,
                      decoration: InputDecoration(labelText: t('Giá vốn'))),
                ),
              ],
            ),
            SizedBox(height: 12),
            DropdownButtonFormField<String>(
              initialValue: _itemType,
              decoration: InputDecoration(labelText: t('Loại')),
              items: [
                DropdownMenuItem(
                    value: 'ingredient', child: Text(t('Nguyên liệu FnB'))),
                DropdownMenuItem(
                    value: 'supply', child: Text(t('Vật dụng bếp'))),
              ],
              onChanged: (v) => setState(() => _itemType = v ?? _itemType),
            ),
          ],
        ),
      ),
      actions: [
        TextButton(
            onPressed: () => Navigator.of(context).pop(),
            child: Text(t('Hủy'))),
        FilledButton(
          onPressed: _saving ? null : _save,
          child: _saving
              ? SizedBox(
                  width: 18,
                  height: 18,
                  child: CircularProgressIndicator(
                      strokeWidth: 2, color: Colors.white))
              : Text(t('Tạo')),
        ),
      ],
    );
  }
}
