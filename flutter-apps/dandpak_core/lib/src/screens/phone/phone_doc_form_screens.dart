import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../models/retail_models.dart';
import '../../services/api_service.dart';
import '../../ui/app_theme.dart';
import '../../utils/translation.dart';
import 'phone_kit.dart';
import 'phone_scaffolds.dart';

/// BIỂU MẪU CHỨNG TỪ bản điện thoại: hàng hóa mới, phiếu nhập, phiếu chuyển.
///
/// Thân request đối chiếu trực tiếp với server:
///   - Hàng hóa   : createSku()        cần `name`; đọc code, barcode, price,
///                  vat, price_includes_vat, cost, unit, opening_stock,
///                  warehouse_id, category.
///   - Phiếu nhập : savePurchaseOrder() cần ÍT NHẤT 1 dòng hàng; mỗi dòng cần
///                  item_id + qty > 0 + unit_cost. Tổng do SERVER tính.
///   - Phiếu chuyển: transferStock()   cần from_warehouse_id ≠ to_warehouse_id
///                  và mỗi dòng có item_id + qty. Server CHẶN vượt tồn nguồn.

num _n(dynamic v) {
  if (v is num) return v;
  return num.tryParse('${v ?? ''}'.replaceAll('.', '').replaceAll(',', '')) ??
      0;
}

String _s(dynamic v) => '${v ?? ''}';

/// Một dòng hàng đang soạn trong phiếu.
class _DocLine {
  final Sku sku;
  num qty;
  num unitCost;
  _DocLine(this.sku, {this.unitCost = 0}) : qty = 1;
}

/// Bảng chọn mặt hàng dùng chung cho phiếu nhập và phiếu chuyển — tìm theo tên
/// hoặc mã vạch, đọc thẳng `/api/skus`.
Future<Sku?> _pickSku(BuildContext context) async {
  return showModalBottomSheet<Sku>(
    context: context,
    isScrollControlled: true,
    backgroundColor: DanColors.surface,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
    ),
    builder: (ctx) => const _SkuPickerSheet(),
  );
}

class _SkuPickerSheet extends StatefulWidget {
  const _SkuPickerSheet();

  @override
  State<_SkuPickerSheet> createState() => _SkuPickerSheetState();
}

class _SkuPickerSheetState extends State<_SkuPickerSheet> {
  final _q = TextEditingController();
  List<Sku> _items = [];
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _q.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    try {
      final res = await context
          .read<ApiService>()
          .getSkusPaginated(page: 1, limit: 50, q: _q.text.trim());
      final raw = (res['items'] ?? res['skus'] ?? res['data']) as List? ?? [];
      if (!mounted) return;
      setState(() {
        _items = raw
            .whereType<Map>()
            .map((e) => Sku.fromJson(Map<String, dynamic>.from(e)))
            .toList();
        _loading = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding:
          EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
      child: SafeArea(
        top: false,
        child: SizedBox(
          height: MediaQuery.of(context).size.height * .72,
          child: Column(
            children: [
              const SizedBox(height: 10),
              Container(
                width: 38,
                height: 4,
                decoration: BoxDecoration(
                    color: DanColors.border2,
                    borderRadius: BorderRadius.circular(99)),
              ),
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 14, 16, 10),
                child: PhoneSearchBar(
                  controller: _q,
                  hint: t('Tìm tên hoặc mã vạch'),
                  onChanged: (_) => _load(),
                  onSubmit: _load,
                ),
              ),
              Expanded(
                child: _loading
                    ? const Center(child: CircularProgressIndicator())
                    : _items.isEmpty
                        ? PhoneEmpty(
                            title: t('Không tìm thấy hàng hóa'),
                            hint: t('Thử từ khóa khác'))
                        : ListView.builder(
                            itemCount: _items.length,
                            itemBuilder: (_, i) => PhoneListRow(
                              title: _items[i].name,
                              subtitle:
                                  '${_items[i].barcode} · ${t('Tồn')} ${phoneInt(_items[i].stock)} ${_items[i].unit}',
                              amount: phoneMoney(_items[i].price),
                              onTap: () => Navigator.of(context).pop(_items[i]),
                            ),
                          ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Hàng dòng-hàng có nút sửa số lượng, dùng chung cho hai loại phiếu.
class _LineTile extends StatelessWidget {
  final _DocLine line;
  final bool showCost;
  final VoidCallback onChanged;
  final VoidCallback onRemove;

  const _LineTile({
    required this.line,
    required this.onChanged,
    required this.onRemove,
    this.showCost = false,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.fromLTRB(16, 0, 16, 10),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: DanColors.surface,
        border: Border.all(color: DanColors.border),
        borderRadius: BorderRadius.circular(10),
      ),
      child: Column(
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(line.sku.name,
                        style: const TextStyle(
                            fontSize: 13.5, fontWeight: FontWeight.w800)),
                    const SizedBox(height: 3),
                    Text(
                        '${t('Tồn')} ${phoneInt(line.sku.stock)} ${line.sku.unit}',
                        style: const TextStyle(
                            fontSize: 10.5, color: DanColors.faint)),
                  ],
                ),
              ),
              PhoneIconButton(
                  icon: Icons.delete_outline,
                  color: DanColors.faint,
                  onTap: onRemove),
            ],
          ),
          Row(
            children: [
              Expanded(
                child: TextFormField(
                  initialValue: line.qty.toString(),
                  keyboardType: TextInputType.number,
                  decoration: InputDecoration(
                    isDense: true,
                    labelText: t('Số lượng'),
                    labelStyle: const TextStyle(fontSize: 11),
                  ),
                  style: const TextStyle(
                      fontSize: 14, fontWeight: FontWeight.w700),
                  onChanged: (v) {
                    line.qty = _n(v);
                    onChanged();
                  },
                ),
              ),
              if (showCost) ...[
                const SizedBox(width: 10),
                Expanded(
                  child: TextFormField(
                    initialValue: line.unitCost.round().toString(),
                    keyboardType: TextInputType.number,
                    decoration: InputDecoration(
                      isDense: true,
                      labelText: t('Giá nhập'),
                      labelStyle: const TextStyle(fontSize: 11),
                    ),
                    style: const TextStyle(
                        fontSize: 14, fontWeight: FontWeight.w700),
                    onChanged: (v) {
                      line.unitCost = _n(v);
                      onChanged();
                    },
                  ),
                ),
              ],
            ],
          ),
        ],
      ),
    );
  }
}

// ── HÀNG HÓA MỚI ────────────────────────────────────────────────────────────
class PhoneProductFormScreen extends StatefulWidget {
  const PhoneProductFormScreen({super.key});

  @override
  State<PhoneProductFormScreen> createState() => _PhoneProductFormScreenState();
}

class _PhoneProductFormScreenState extends State<PhoneProductFormScreen> {
  final _name = TextEditingController();
  final _code = TextEditingController();
  final _barcode = TextEditingController();
  final _category = TextEditingController();
  final _brand = TextEditingController();
  final _price = TextEditingController();
  final _cost = TextEditingController();
  final _unit = TextEditingController(text: 'cái');
  final _opening = TextEditingController();
  final _minStock = TextEditingController();
  final _vat = TextEditingController(text: '8');
  bool _trackLot = false;
  bool _expiryRequired = false;
  bool _saving = false;

  /// HSD của lô tồn đầu kỳ — server bắt buộc khi hàng quản lý hạn sử dụng mà
  /// có tồn đầu kỳ. Thiếu ô này thì bấm Lưu chỉ nhận lại câu báo lỗi.
  DateTime? _expiryDate;

  @override
  void dispose() {
    for (final c in [
      _name,
      _code,
      _barcode,
      _category,
      _brand,
      _price,
      _cost,
      _unit,
      _opening,
      _minStock,
      _vat
    ]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _save() async {
    if (_name.text.trim().isEmpty) {
      appToast(context, t('Thiếu tên hàng hóa'), isError: true);
      return;
    }
    if (_expiryRequired && _n(_opening.text) > 0 && _expiryDate == null) {
      appToast(context,
          t('Hàng bắt buộc hạn sử dụng: phải chọn HSD cho lô tồn đầu kỳ'),
          isError: true);
      return;
    }
    setState(() => _saving = true);
    try {
      await context.read<ApiService>().createSku({
        'name': _name.text.trim(),
        'code': _code.text.trim(),
        'barcode': _barcode.text.trim(),
        'category': _category.text.trim(),
        'brand': _brand.text.trim(),
        'price': _n(_price.text).round(),
        'cost': _n(_cost.text).round(),
        'unit': _unit.text.trim().isEmpty ? 'cái' : _unit.text.trim(),
        'vat': _n(_vat.text),
        // Giá nhập bằng tay ở cửa hàng luôn là giá ĐÃ gồm VAT.
        'price_includes_vat': 1,
        // createSku() nhận opening_stock rồi tự tạo lô 'OPENING' — không tự ghi
        // thẳng vào cột stock, nếu không tồn sẽ lệch với sổ lô.
        'opening_stock': _n(_opening.text),
        'min_stock': _n(_minStock.text),
        'track_lot': _trackLot,
        'expiry_required': _expiryRequired,
        if (_expiryDate != null)
          'expiry_date': _expiryDate!.toIso8601String().split('T').first,
      });
      if (!mounted) return;
      Navigator.of(context).pop(true);
    } catch (e) {
      if (!mounted) return;
      setState(() => _saving = false);
      appToast(context, e.toString().replaceFirst('Exception: ', ''),
          isError: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: DanColors.bg,
      body: SafeArea(
        bottom: false,
        child: Column(
          children: [
            PhoneHeader(
                title: t('Hàng hóa mới'),
                onBack: () => Navigator.of(context).maybePop()),
            Expanded(
              child: ListView(
                padding: const EdgeInsets.only(top: 12, bottom: 20),
                children: [
                  PhoneField(
                      label: 'Tên hàng',
                      required: true,
                      hint: 'Bắt buộc',
                      controller: _name),
                  PhoneField(
                      label: 'Mã hàng',
                      hint: 'Để trống để tạo tự động',
                      controller: _code),
                  PhoneField(
                      label: 'Mã vạch',
                      hint: 'Quét hoặc gõ',
                      controller: _barcode),
                  PhoneField(label: 'Nhóm hàng', controller: _category),
                  PhoneField(label: 'Thương hiệu', controller: _brand),
                  PhoneField(
                      label: 'Giá bán',
                      hint: '0',
                      controller: _price,
                      keyboardType: TextInputType.number),
                  PhoneField(
                      label: 'Giá vốn',
                      hint: '0',
                      controller: _cost,
                      keyboardType: TextInputType.number),
                  PhoneField(label: 'Đơn vị', controller: _unit),
                  PhoneField(
                      label: 'VAT (%)',
                      controller: _vat,
                      keyboardType: TextInputType.number),
                  PhoneField(
                      label: 'Tồn đầu kỳ',
                      hint: '0',
                      controller: _opening,
                      keyboardType: TextInputType.number,
                      // Ô HSD bên dưới chỉ hiện khi tồn đầu kỳ > 0.
                      onChanged: (_) => setState(() {})),
                  PhoneField(
                      label: 'Định mức tồn thấp nhất',
                      hint: '0',
                      controller: _minStock,
                      keyboardType: TextInputType.number),
                  SwitchListTile(
                    contentPadding: const EdgeInsets.symmetric(horizontal: 16),
                    title: Text(t('Quản lý theo lô')),
                    value: _trackLot,
                    onChanged: (v) => setState(() {
                      _trackLot = v;
                      if (!v) _expiryRequired = false;
                    }),
                  ),
                  if (_trackLot)
                    SwitchListTile(
                      contentPadding:
                          const EdgeInsets.symmetric(horizontal: 16),
                      title: Text(t('Bắt buộc hạn sử dụng')),
                      value: _expiryRequired,
                      onChanged: (v) => setState(() => _expiryRequired = v),
                    ),
                  if (_expiryRequired && _n(_opening.text) > 0)
                    ListTile(
                      contentPadding:
                          const EdgeInsets.symmetric(horizontal: 16),
                      title: Text(t('Hạn sử dụng lô tồn đầu kỳ')),
                      subtitle: Text(_expiryDate == null
                          ? t('Chưa chọn — bắt buộc')
                          : '${_expiryDate!.day.toString().padLeft(2, '0')}/'
                              '${_expiryDate!.month.toString().padLeft(2, '0')}/'
                              '${_expiryDate!.year}'),
                      trailing: const Icon(Icons.event_outlined),
                      onTap: () async {
                        final now = DateTime.now();
                        final picked = await showDatePicker(
                          context: context,
                          initialDate:
                              _expiryDate ?? now.add(const Duration(days: 180)),
                          firstDate: now,
                          lastDate: DateTime(now.year + 10),
                        );
                        if (picked != null) {
                          setState(() => _expiryDate = picked);
                        }
                      },
                    ),
                  Padding(
                    padding: const EdgeInsets.all(16),
                    child: Text(
                        t(
                            'Tồn đầu kỳ được ghi thành một lô "OPENING" để sổ lô và tồn kho luôn khớp nhau.'),
                        style: const TextStyle(
                            fontSize: 11.5,
                            height: 1.5,
                            color: DanColors.faint)),
                  ),
                ],
              ),
            ),
            PhoneActionBar(
              child: PhoneCta(
                  label: t('Lưu hàng hóa'),
                  busy: _saving,
                  onPressed: _saving ? null : _save),
            ),
          ],
        ),
      ),
    );
  }
}

// ── PHIẾU NHẬP MỚI ──────────────────────────────────────────────────────────
class PhonePurchaseFormScreen extends StatefulWidget {
  const PhonePurchaseFormScreen({super.key});

  @override
  State<PhonePurchaseFormScreen> createState() =>
      _PhonePurchaseFormScreenState();
}

class _PhonePurchaseFormScreenState extends State<PhonePurchaseFormScreen> {
  final List<_DocLine> _lines = [];
  final _note = TextEditingController();
  String _supplierId = '';
  String _supplierName = '';
  List<Map<String, dynamic>> _suppliers = [];
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    _loadSuppliers();
  }

  @override
  void dispose() {
    _note.dispose();
    super.dispose();
  }

  Future<void> _loadSuppliers() async {
    try {
      final res =
          await context.read<ApiService>().getPartners(type: 'supplier');
      final raw = (res['partners'] ?? res['items']) as List? ?? const [];
      if (!mounted) return;
      setState(() => _suppliers = raw
          .whereType<Map>()
          .map((e) => Map<String, dynamic>.from(e))
          .toList());
    } catch (_) {/* không có NCC vẫn lập được phiếu */}
  }

  num get _subtotal => _lines.fold<num>(0, (a, l) => a + l.qty * l.unitCost);

  Future<void> _save() async {
    if (_lines.isEmpty) {
      appToast(context, t('Cần ít nhất một dòng hàng'), isError: true);
      return;
    }
    setState(() => _saving = true);
    try {
      await context.read<ApiService>().savePurchaseOrder({
        if (_supplierId.isNotEmpty) 'supplier_id': _supplierId,
        if (_supplierId.isEmpty && _supplierName.isNotEmpty)
          'supplier_name_manual': _supplierName,
        'note': _note.text.trim(),
        // TỔNG TIỀN do server tự tính lại từ các dòng (savePurchaseOrder) —
        // gửi tổng từ máy chỉ tạo cơ hội lệch số.
        'lines': [
          for (final l in _lines)
            {
              'item_type': 'sku',
              'item_id': l.sku.id,
              'name': l.sku.name,
              'unit': l.sku.unit,
              'qty': l.qty,
              'unit_cost': l.unitCost.round(),
            },
        ],
      });
      if (!mounted) return;
      Navigator.of(context).pop(true);
    } catch (e) {
      if (!mounted) return;
      setState(() => _saving = false);
      appToast(context, e.toString().replaceFirst('Exception: ', ''),
          isError: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: DanColors.bg,
      body: SafeArea(
        bottom: false,
        child: Column(
          children: [
            PhoneHeader(
              title: t('Phiếu nhập mới'),
              subtitle: '${_lines.length} ${t('dòng hàng')}',
              onBack: () => Navigator.of(context).maybePop(),
              actions: [
                PhoneIconButton(
                  icon: Icons.add,
                  onTap: () async {
                    final sku = await _pickSku(context);
                    if (sku != null) {
                      setState(
                          () => _lines.add(_DocLine(sku, unitCost: sku.price)));
                    }
                  },
                ),
              ],
            ),
            Expanded(
              child: ListView(
                padding: const EdgeInsets.only(top: 12, bottom: 20),
                children: [
                  PhoneField(
                    label: 'Nhà cung cấp',
                    value: _supplierName,
                    hint: 'Chọn nhà cung cấp',
                    onTap: _suppliers.isEmpty
                        ? null
                        : () async {
                            await showPhoneSheet<void>(
                              context: context,
                              title: t('Nhà cung cấp'),
                              builder: (c) => PhonePickList(
                                options: _suppliers
                                    .map((e) => _s(e['name']))
                                    .toList(),
                                selected: _supplierName,
                                onPick: (v) {
                                  Navigator.of(c).pop();
                                  final hit = _suppliers
                                      .firstWhere((e) => _s(e['name']) == v);
                                  setState(() {
                                    _supplierName = v;
                                    _supplierId = _s(hit['id']);
                                  });
                                },
                              ),
                            );
                          },
                  ),
                  PhoneField(label: 'Ghi chú', controller: _note),
                  const SizedBox(height: 12),
                  if (_lines.isEmpty)
                    PhoneEmpty(
                        title: t('Chưa có dòng hàng nào'),
                        hint: t('Bấm dấu + ở trên để thêm hàng vào phiếu'),
                        icon: Icons.playlist_add)
                  else ...[
                    PhoneSectionTitle(t('Dòng hàng')),
                    for (final l in _lines)
                      _LineTile(
                        line: l,
                        showCost: true,
                        onChanged: () => setState(() {}),
                        onRemove: () => setState(() => _lines.remove(l)),
                      ),
                    Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 16),
                      child: PhoneKv(t('TỔNG TIỀN HÀNG'), phoneMoney(_subtotal),
                          big: true),
                    ),
                  ],
                ],
              ),
            ),
            PhoneActionBar(
              child: PhoneCta(
                label: t('Lưu phiếu nhập'),
                trailing: _lines.isEmpty ? null : phoneMoney(_subtotal),
                busy: _saving,
                onPressed: _saving || _lines.isEmpty ? null : _save,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

// ── PHIẾU CHUYỂN KHO MỚI ────────────────────────────────────────────────────
class PhoneTransferFormScreen extends StatefulWidget {
  const PhoneTransferFormScreen({super.key});

  @override
  State<PhoneTransferFormScreen> createState() =>
      _PhoneTransferFormScreenState();
}

class _PhoneTransferFormScreenState extends State<PhoneTransferFormScreen> {
  final List<_DocLine> _lines = [];
  List<Map<String, dynamic>> _warehouses = [];
  String _fromId = '';
  String _fromName = '';
  String _toId = '';
  String _toName = '';
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    _loadWarehouses();
  }

  Future<void> _loadWarehouses() async {
    try {
      final rows = await context.read<ApiService>().getWarehouses();
      if (!mounted) return;
      setState(() => _warehouses = rows
          .whereType<Map>()
          .map((e) => Map<String, dynamic>.from(e))
          .toList());
    } catch (_) {/* báo lỗi khi bấm Lưu */}
  }

  Future<void> _pickWarehouse(bool isFrom) async {
    if (_warehouses.isEmpty) return;
    await showPhoneSheet<void>(
      context: context,
      title: isFrom ? t('Kho xuất') : t('Kho nhận'),
      builder: (c) => PhonePickList(
        options: _warehouses.map((e) => _s(e['name'])).toList(),
        selected: isFrom ? _fromName : _toName,
        onPick: (v) {
          Navigator.of(c).pop();
          final hit = _warehouses.firstWhere((e) => _s(e['name']) == v);
          setState(() {
            if (isFrom) {
              _fromName = v;
              _fromId = _s(hit['id']);
            } else {
              _toName = v;
              _toId = _s(hit['id']);
            }
          });
        },
      ),
    );
  }

  Future<void> _save() async {
    // Server ném "Phiếu chuyển kho thiếu thông tin" cho cả ba trường hợp này,
    // nhưng chặn tại chỗ để người dùng biết ngay sai ở đâu.
    if (_fromId.isEmpty || _toId.isEmpty) {
      appToast(context, t('Chọn cả kho xuất và kho nhận'), isError: true);
      return;
    }
    if (_fromId == _toId) {
      appToast(context, t('Kho xuất và kho nhận phải khác nhau'),
          isError: true);
      return;
    }
    if (_lines.isEmpty) {
      appToast(context, t('Cần ít nhất một dòng hàng'), isError: true);
      return;
    }
    setState(() => _saving = true);
    try {
      await context.read<ApiService>().transferStock({
        'from_warehouse_id': _fromId,
        'to_warehouse_id': _toId,
        'lines': [
          for (final l in _lines)
            {'stock_type': 'sku', 'item_id': l.sku.id, 'qty': l.qty},
        ],
      });
      if (!mounted) return;
      Navigator.of(context).pop(true);
    } catch (e) {
      if (!mounted) return;
      setState(() => _saving = false);
      // Server chặn vượt tồn kho nguồn và trả câu tiếng Việt kèm số tồn còn
      // lại — hiện nguyên văn cho thủ kho biết phải sửa dòng nào.
      appToast(context, e.toString().replaceFirst('Exception: ', ''),
          isError: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: DanColors.bg,
      body: SafeArea(
        bottom: false,
        child: Column(
          children: [
            PhoneHeader(
              title: t('Phiếu chuyển mới'),
              subtitle: '${_lines.length} ${t('dòng hàng')}',
              onBack: () => Navigator.of(context).maybePop(),
              actions: [
                PhoneIconButton(
                  icon: Icons.add,
                  onTap: () async {
                    final sku = await _pickSku(context);
                    if (sku != null) setState(() => _lines.add(_DocLine(sku)));
                  },
                ),
              ],
            ),
            Expanded(
              child: ListView(
                padding: const EdgeInsets.only(top: 12, bottom: 20),
                children: [
                  PhoneField(
                      label: 'Kho xuất',
                      required: true,
                      value: _fromName,
                      hint: 'Chọn kho nguồn',
                      onTap: () => _pickWarehouse(true)),
                  PhoneField(
                      label: 'Kho nhận',
                      required: true,
                      value: _toName,
                      hint: 'Chọn kho đích',
                      onTap: () => _pickWarehouse(false)),
                  const SizedBox(height: 12),
                  if (_lines.isEmpty)
                    PhoneEmpty(
                        title: t('Chưa có dòng hàng nào'),
                        hint: t('Bấm dấu + ở trên để thêm hàng cần chuyển'),
                        icon: Icons.playlist_add)
                  else ...[
                    PhoneSectionTitle(t('Dòng hàng')),
                    for (final l in _lines)
                      _LineTile(
                        line: l,
                        onChanged: () => setState(() {}),
                        onRemove: () => setState(() => _lines.remove(l)),
                      ),
                  ],
                  Padding(
                    padding: const EdgeInsets.all(16),
                    child: Text(
                        t(
                            'Số lượng chuyển không được vượt tồn thực tế ở kho xuất — máy chủ sẽ từ chối cả phiếu nếu có một dòng vượt.'),
                        style: const TextStyle(
                            fontSize: 11.5,
                            height: 1.5,
                            color: DanColors.faint)),
                  ),
                ],
              ),
            ),
            PhoneActionBar(
              child: PhoneCta(
                label: t('Xuất chuyển'),
                busy: _saving,
                onPressed: _saving || _lines.isEmpty ? null : _save,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
