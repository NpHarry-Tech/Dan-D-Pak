import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../providers/auth_provider.dart';
import '../../services/api_service.dart';
import '../../ui/app_theme.dart';
import '../../ui/format.dart';
import '../../utils/translation.dart';
import '../warehouse/kv_excel.dart';
import '../warehouse/kv_shared.dart';

/// Form phiếu MUA HÀNG dùng chung cho 2 nghiệp vụ (KiotViet copy frontend của
/// nhau, chỉ đổi nhãn):
///   - [PurchaseDocMode.purchaseIn]  : Nhập hàng  (PN…, VAT nhập hàng)
///   - [PurchaseDocMode.purchaseReturn]: Trả hàng nhập (THN…, VAT hoàn lại)
///
/// Bố cục: trái = tìm hàng + bảng dòng hàng; phải = panel NCC + tổng tiền +
/// VAT + ghi chú + [Lưu tạm] [Hoàn thành].
enum PurchaseDocMode { purchaseIn, purchaseReturn }

class PurchaseDocFormPage extends StatefulWidget {
  final PurchaseDocMode mode;
  final List<Map<String, dynamic>> warehouses;

  /// Kho đang chọn ở thanh trên module Kho — mặc định cho phiếu mới.
  final String? initialWarehouseId;

  /// Phiếu nháp đang sửa (map từ API) — hoặc phiếu prefill (vd. tạo phiếu trả
  /// từ một phiếu nhập đã hoàn thành: truyền lines + supplier, không truyền id).
  final Map<String, dynamic>? existing;

  const PurchaseDocFormPage({
    super.key,
    required this.mode,
    required this.warehouses,
    this.initialWarehouseId,
    this.existing,
  });

  @override
  State<PurchaseDocFormPage> createState() => _PurchaseDocFormPageState();
}

class _PurchaseDocFormPageState extends State<PurchaseDocFormPage> {
  bool get _isReturn => widget.mode == PurchaseDocMode.purchaseReturn;

  String? _warehouseId;
  String? _supplierId;
  final _supplierManual = TextEditingController();
  final _note = TextEditingController();
  final _vatCtrl = TextEditingController();
  final _invoiceNo = TextEditingController(); // Số hóa đơn đầu vào (chỉ nhập)
  bool _vatOn = false;
  List<Map<String, dynamic>> _items = [];
  List<Map<String, dynamic>> _suppliers = [];
  final List<KvDocLine> _lines = [];
  final _tableHorizontal = ScrollController();
  bool _loadingItems = false;
  bool _busy = false;
  // "Ảnh" trạng thái form sau khi load — thoát mà khác ảnh này thì hỏi xác
  // nhận (sửa phiếu cũ nhưng không đổi gì sẽ KHÔNG bị hỏi oan).
  String _baseline = '';

  String _stateSig() => [
        _warehouseId ?? '',
        _supplierId ?? '',
        _supplierManual.text.trim(),
        _note.text.trim(),
        _invoiceNo.text.trim(),
        _vatOn ? _vatCtrl.text.trim() : '',
        for (final l in _lines)
          '${l.id}|${l.qty.text}|${l.cost.text}|${l.lotNo.text}|${l.expiry.text}',
      ].join('');

  bool get _dirty => _stateSig() != _baseline;

  @override
  void initState() {
    super.initState();
    final ex = widget.existing;
    _warehouseId = ex != null && kvs(ex['warehouse_id']).isNotEmpty
        ? kvs(ex['warehouse_id'])
        : (kvs(widget.initialWarehouseId).isNotEmpty &&
                widget.warehouses
                    .any((w) => kvs(w['id']) == widget.initialWarehouseId)
            ? widget.initialWarehouseId
            : (widget.warehouses.isNotEmpty
                ? kvs(widget.warehouses.first['id'])
                : null));
    if (ex != null) {
      _supplierId =
          kvs(ex['supplier_id']).isEmpty ? null : kvs(ex['supplier_id']);
      _note.text = kvs(ex['note']);
      _invoiceNo.text = kvs(ex['invoice_no']);
      final vat = kvn(ex[_isReturn ? 'vat_refund' : 'vat_amount']);
      if (vat > 0) {
        _vatOn = true;
        _vatCtrl.text = kvNumText(vat);
      }
    }
    _loadRefs().then((_) {
      if (ex != null) _prefillLines(ex);
      // Chụp baseline SAU khi prefill xong — từ đây mọi thay đổi mới là "dirty".
      if (mounted) _baseline = _stateSig();
    });
    _baseline = _stateSig();
  }

  /// Chặn thoát khi đang nhập dở: hỏi xác nhận trước khi bỏ phiếu.
  Future<void> _confirmExit() async {
    if (_busy) return; // đang lưu — không thoát giữa chừng
    if (!_dirty) {
      Navigator.of(context).pop();
      return;
    }
    final action = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: DanColors.surface,
        title: Text(t('Lưu tạm hay xóa phiếu?'),
            style: TextStyle(fontWeight: FontWeight.w900, fontSize: 17)),
        content: Text(t(
            'Phiếu nhập đang làm dở. "Lưu tạm" để giữ lại làm tiếp sau, hoặc "Xóa phiếu" để bỏ hẳn.')),
        actions: [
          TextButton(
              onPressed: () => Navigator.of(ctx).pop('stay'),
              child: Text(t('Ở lại'))),
          OutlinedButton(
              onPressed: () => Navigator.of(ctx).pop('draft'),
              child: Text(t('Lưu tạm'))),
          FilledButton(
              style: FilledButton.styleFrom(backgroundColor: DanColors.late),
              onPressed: () => Navigator.of(ctx).pop('discard'),
              child: Text(t('Xóa phiếu'))),
        ],
      ),
    );
    if (!mounted) return;
    if (action == 'draft') {
      await _save(complete: false); // lưu nháp; _save tự pop khi thành công
    } else if (action == 'discard') {
      Navigator.of(context).pop();
    }
    // 'stay' hoặc null → ở lại, không làm gì
  }

  @override
  void dispose() {
    _tableHorizontal.dispose();
    _supplierManual.dispose();
    _note.dispose();
    _vatCtrl.dispose();
    _invoiceNo.dispose();
    for (final l in _lines) {
      l.dispose();
    }
    super.dispose();
  }

  bool get _isRetailWh {
    final wh =
        widget.warehouses.where((w) => kvs(w['id']) == _warehouseId).toList();
    return wh.isEmpty || kvs(wh.first['type']) == 'retail';
  }

  Future<void> _loadRefs() async {
    setState(() => _loadingItems = true);
    try {
      final api = context.read<ApiService>();
      final sup = await api.getPartners(type: 'supplier');
      final rows = _warehouseId == null
          ? <dynamic>[]
          : (_isRetailWh
              ? await api.getWarehouseSkus(_warehouseId!)
              : await api.getInventory(warehouseId: _warehouseId));
      if (!mounted) return;
      setState(() {
        _suppliers = kvMapList(sup['partners']);
        _items = kvMapList(rows);
        _loadingItems = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() => _loadingItems = false);
      _toast(e.toString().replaceFirst('Exception: ', ''), error: true);
    }
  }

  void _prefillLines(Map<String, dynamic> ex) {
    final byId = {for (final it in _items) kvs(it['id']): it};
    setState(() {
      for (final l in kvMapList(ex['lines'])) {
        final itemId = kvs(l['item_id']);
        final item = byId[itemId] ??
            {
              'id': itemId,
              'name': kvs(l['name']),
              'unit': kvs(l['unit']),
              'code': '',
              'barcode': '',
              'stock': 0,
            };
        _lines.add(KvDocLine(item, kvs(l['item_type']),
            initialQty: kvn(l['qty']),
            initialCost: kvn(l['unit_cost']),
            initialUnit: kvs(l['unit']),
            lot: kvs(l['lot_no']),
            exp: kvs(l['expiry_date'])));
      }
    });
  }

  void _toast(String m, {bool error = false}) =>
      appToast(context, m, isError: error);

  void _addItem(Map<String, dynamic> item) {
    setState(() {
      _lines.add(KvDocLine(item, _isRetailWh ? 'sku' : 'inventory',
          initialQty: 1, initialCost: kvn(item['cost'])));
    });
  }

  num get _subtotal => _lines.fold<num>(0, (s, l) => s + l.lineTotal);
  num get _vatAmount => !_vatOn ? 0 : (kvParseNum(_vatCtrl.text) ?? 0);
  num get _total => _subtotal + _vatAmount;

  static String _normalizeDate(String v) {
    final m = RegExp(r'^(\d{1,2})/(\d{1,2})/(\d{4})$').firstMatch(v);
    if (m == null) return v;
    return '${m.group(3)}-${m.group(2)!.padLeft(2, '0')}-${m.group(1)!.padLeft(2, '0')}';
  }

  Future<void> _save({required bool complete}) async {
    if (_supplierId == null && _supplierManual.text.trim().isEmpty) {
      _toast(t('Chọn nhà cung cấp hoặc nhập tên nơi mua'), error: true);
      return;
    }
    // Chưa khớp mã thì item_id rỗng → không nhập kho được. Bắt khớp hết trước.
    final unmatched = _lines.where((l) => l.item['_unmatched'] == true).length;
    if (unmatched > 0) {
      _toast(
          t('Còn $unmatched dòng CHƯA KHỚP MÃ — bấm "Khớp mã" trên từng dòng trước khi Hoàn thành'),
          error: true);
      return;
    }
    final bodyLines = <Map<String, dynamic>>[];
    for (final l in _lines) {
      if (l.qtyNum <= 0) continue;
      bodyLines.add({
        'item_type': l.stockType,
        'item_id': l.id,
        'name': l.name,
        'unit': l.unit,
        'uom': l.unit,
        'qty': l.qtyNum,
        'unit_cost': l.costNum,
        if (!_isReturn && l.lotNo.text.trim().isNotEmpty)
          'lot_no': l.lotNo.text.trim(),
        if (!_isReturn && l.expiry.text.trim().isNotEmpty)
          'expiry_date': _normalizeDate(l.expiry.text.trim()),
      });
    }
    if (bodyLines.isEmpty) {
      _toast(t('Thêm ít nhất một dòng hàng'), error: true);
      return;
    }
    setState(() => _busy = true);
    try {
      final api = context.read<ApiService>();
      final existingId =
          widget.existing != null ? kvs(widget.existing!['id']) : '';
      final body = {
        if (existingId.isNotEmpty) 'id': existingId,
        'supplier_id': _supplierId,
        'supplier_name_manual':
            _supplierId == null ? _supplierManual.text.trim() : '',
        'warehouse_id': _warehouseId,
        'note': _note.text.trim(),
        'lines': bodyLines,
        if (_isReturn) 'vat_refund': _vatAmount,
        if (!_isReturn) 'vat_amount': _vatAmount,
        if (!_isReturn) 'invoice_no': _invoiceNo.text.trim(),
      };
      if (_isReturn) {
        final saved = await api.savePurchaseReturn(body);
        if (complete) {
          await api.completePurchaseReturn(kvs(saved['id']),
              warehouseId: _warehouseId);
        }
      } else {
        final saved = await api.savePurchaseOrder(body);
        if (complete) {
          await api.completePurchase(kvs(saved['id']),
              warehouseId: _warehouseId);
        }
      }
      if (!mounted) return;
      Navigator.of(context).pop(true);
    } catch (e) {
      if (!mounted) return;
      setState(() => _busy = false);
      _toast(e.toString().replaceFirst('Exception: ', ''), error: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final title = _isReturn ? t('Trả hàng nhập') : t('Nhập hàng');
    final isEdit = widget.existing != null &&
        kvs(widget.existing!['id']).isNotEmpty &&
        kvs(widget.existing!['code']).isNotEmpty;
    // PopScope chặn CẢ back hệ thống lẫn nút ← (maybePop): phiếu nhập dở
    // phải qua _confirmExit; Navigator.pop() sau khi lưu vẫn thoát thẳng.
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) _confirmExit();
      },
      child: Scaffold(
        backgroundColor: DanColors.bg,
        body: SafeArea(
          child: Column(
            children: [
              Container(
                color: DanColors.surface,
                // Chừa góc phải trên cho nút cửa sổ — không đặt nút ở hàng này.
                padding: EdgeInsets.fromLTRB(16, 12, 160, 10),
                child: Row(
                  children: [
                    IconButton(
                        onPressed: () => Navigator.of(context).maybePop(),
                        icon: Icon(Icons.arrow_back)),
                    SizedBox(width: 4),
                    Text(
                        isEdit
                            ? '$title ${kvs(widget.existing!['code'])}'
                            : title,
                        style: TextStyle(
                            fontSize: 17, fontWeight: FontWeight.w900)),
                    SizedBox(width: 18),
                    SizedBox(
                      width: 250,
                      child: DropdownButtonFormField<String>(
                        initialValue: _warehouseId,
                        isExpanded: true,
                        decoration: InputDecoration(
                            labelText: _isReturn
                                ? t('Kho xuất hàng')
                                : t('Kho nhận hàng'),
                            isDense: true,
                            contentPadding: EdgeInsets.symmetric(
                                horizontal: 10, vertical: 8)),
                        items: [
                          for (final w in widget.warehouses)
                            DropdownMenuItem(
                                value: kvs(w['id']),
                                child: Text(kvs(w['name']),
                                    overflow: TextOverflow.ellipsis)),
                        ],
                        onChanged: _lines.isNotEmpty
                            ? null
                            : (v) {
                                setState(() => _warehouseId = v);
                                _loadRefs();
                              },
                      ),
                    ),
                  ],
                ),
              ),
              Divider(height: 1, color: DanColors.border),
              Expanded(
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Expanded(
                      child: Column(
                        children: [
                          Padding(
                            padding: EdgeInsets.fromLTRB(20, 16, 20, 0),
                            child: Row(
                              children: [
                                Expanded(
                                  child: KvItemSearchField(
                                    items: _items,
                                    onPick: _addItem,
                                    hint:
                                        t('Tìm hàng hóa theo mã hoặc tên (F3)'),
                                  ),
                                ),
                                SizedBox(width: 10),
                                OutlinedButton.icon(
                                  onPressed: _importFromExcel,
                                  icon:
                                      Icon(Icons.file_copy_outlined, size: 18),
                                  label: Text(t('Chọn file dữ liệu')),
                                  style: OutlinedButton.styleFrom(
                                      minimumSize: Size(0, 42)),
                                ),
                              ],
                            ),
                          ),
                          SizedBox(height: 10),
                          Expanded(
                            child: LayoutBuilder(builder: (context, box) {
                              if (_loadingItems) {
                                return Center(
                                    child: CircularProgressIndicator());
                              }
                              if (_lines.isEmpty) {
                                return KvExcelEmptyImport(
                                  message: t('Thêm sản phẩm từ file excel'),
                                  templateKind: _isReturn
                                      ? KvTemplateKind.issue
                                      : KvTemplateKind.purchaseIn,
                                  onPick: _importFromExcel,
                                );
                              }
                              final tableWidth = _isReturn ? 820.0 : 1040.0;
                              return Scrollbar(
                                controller: _tableHorizontal,
                                thumbVisibility: tableWidth > box.maxWidth,
                                child: SingleChildScrollView(
                                  controller: _tableHorizontal,
                                  scrollDirection: Axis.horizontal,
                                  child: SizedBox(
                                    width: tableWidth,
                                    child: Column(children: [
                                      KvTableHeader(cells: [
                                        kvHeaderCell('#', width: 30),
                                        kvHeaderCell(t('Mã hàng'), width: 104),
                                        SizedBox(width: 8),
                                        kvHeaderCell(t('Tên hàng'), flex: 1),
                                        kvHeaderCell(t('ĐVT'), width: 92),
                                        kvHeaderCell(t('Số lượng'), width: 78),
                                        SizedBox(width: 8),
                                        kvHeaderCell(t('Đơn giá'), width: 96),
                                        if (!_isReturn) ...[
                                          SizedBox(width: 8),
                                          kvHeaderCell(t('Lô'), width: 78),
                                          SizedBox(width: 8),
                                          kvHeaderCell('HSD', width: 106),
                                        ],
                                        kvHeaderCell(t('Thành tiền'),
                                            width: 104, align: TextAlign.right),
                                        SizedBox(width: 40),
                                      ]),
                                      Divider(
                                          height: 1, color: DanColors.border),
                                      Expanded(
                                          child: ListView.separated(
                                        itemCount: _lines.length,
                                        separatorBuilder: (_, __) => Divider(
                                            height: 1, color: DanColors.border),
                                        itemBuilder: (_, i) => _lineRow(i),
                                      )),
                                    ]),
                                  ),
                                ),
                              );
                            }),
                          ),
                        ],
                      ),
                    ),
                    KvDocMetaPanel(
                      userName: auth.currentUser?.name ?? '—',
                      codeHint: _isReturn
                          ? t('Mã trả hàng nhập')
                          : t('Mã phiếu nhập'),
                      statusLabel: t('Phiếu tạm'),
                      noteCtrl: _note,
                      busy: _busy,
                      onSaveDraft: () => _save(complete: false),
                      onComplete: () => _save(complete: true),
                      completeLabel: t('Hoàn thành'),
                      children: [
                        _supplierPicker(),
                        if (!_isReturn) ...[
                          SizedBox(height: 8),
                          TextField(
                            controller: _invoiceNo,
                            decoration: InputDecoration(
                                labelText: t('Số hóa đơn đầu vào'),
                                hintText: t('Nhập số hóa đơn'),
                                isDense: true,
                                contentPadding: EdgeInsets.symmetric(
                                    horizontal: 10, vertical: 8)),
                          ),
                        ],
                        SizedBox(height: 10),
                        KvMetaTotalRow(
                            label: '${t('Tổng tiền hàng')} (${_lines.length})',
                            value: Fmt.money(_subtotal)),
                        Padding(
                          padding: EdgeInsets.symmetric(vertical: 4),
                          child: Row(
                            children: [
                              Expanded(
                                child: Text(
                                    _isReturn
                                        ? t('VAT hoàn lại')
                                        : t('VAT nhập hàng'),
                                    style: TextStyle(
                                        fontSize: 12.5,
                                        color: DanColors.muted)),
                              ),
                              if (_vatOn)
                                KvCellInput(
                                    controller: _vatCtrl,
                                    width: 96,
                                    hint: 'đ',
                                    onChanged: (_) => setState(() {})),
                              SizedBox(width: 6),
                              SizedBox(
                                height: 26,
                                child: Switch(
                                  value: _vatOn,
                                  activeThumbColor: DanColors.brand,
                                  onChanged: (v) => setState(() => _vatOn = v),
                                ),
                              ),
                            ],
                          ),
                        ),
                        Divider(height: 16, color: DanColors.border),
                        KvMetaTotalRow(
                            label: _isReturn
                                ? t('NCC cần hoàn trả')
                                : t('Cần trả nhà cung cấp'),
                            value: Fmt.money(_total),
                            big: true,
                            accent: DanColors.brand),
                      ],
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _supplierPicker() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            Expanded(
              child: DropdownButtonFormField<String?>(
                initialValue: _supplierId,
                isExpanded: true,
                decoration: InputDecoration(
                    labelText: t('Tìm nhà cung cấp'),
                    isDense: true,
                    contentPadding:
                        EdgeInsets.symmetric(horizontal: 10, vertical: 8)),
                items: [
                  DropdownMenuItem(
                      value: null,
                      child: Text(t('— Mua chợ / nhập tên tay —'))),
                  for (final s in _suppliers)
                    DropdownMenuItem(
                        value: kvs(s['id']),
                        child: Text(
                            '${kvs(s['company']).isNotEmpty ? '${kvs(s['company'])} · ' : ''}${kvs(s['name'])}',
                            overflow: TextOverflow.ellipsis)),
                ],
                onChanged: (v) => setState(() => _supplierId = v),
              ),
            ),
            SizedBox(width: 6),
            IconButton(
              tooltip: t('Thêm nhà cung cấp mới'),
              onPressed: _quickCreateSupplier,
              icon: Icon(Icons.add_circle_outline,
                  size: 22, color: DanColors.brand),
            ),
          ],
        ),
        if (_supplierId == null) ...[
          SizedBox(height: 8),
          TextField(
            controller: _supplierManual,
            decoration: InputDecoration(
                labelText: t('Tên nơi mua'),
                hintText: t('VD: Chợ Bình Điền'),
                isDense: true,
                contentPadding:
                    EdgeInsets.symmetric(horizontal: 10, vertical: 8)),
          ),
        ],
      ],
    );
  }

  /// Nút "+" cạnh ô NCC — tạo nhanh nhà cung cấp không phải rời phiếu
  /// (KiotViet: dấu + trên ô "Tìm nhà cung cấp").
  Future<void> _quickCreateSupplier() async {
    final name = TextEditingController();
    final phone = TextEditingController();
    final company = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: DanColors.surface,
        title: Text(t('Thêm nhà cung cấp'),
            style: TextStyle(fontWeight: FontWeight.w900, fontSize: 18)),
        content: SizedBox(
          width: 380,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              TextField(
                  controller: name,
                  autofocus: true,
                  decoration: InputDecoration(labelText: '${t('Tên NCC')} *')),
              SizedBox(height: 12),
              TextField(
                  controller: phone,
                  keyboardType: TextInputType.phone,
                  decoration: InputDecoration(labelText: t('Điện thoại'))),
              SizedBox(height: 12),
              TextField(
                  controller: company,
                  decoration: InputDecoration(labelText: t('Công ty'))),
            ],
          ),
        ),
        actions: [
          TextButton(
              onPressed: () => Navigator.of(ctx).pop(false),
              child: Text(t('Hủy'))),
          FilledButton(
              onPressed: () => Navigator.of(ctx).pop(true),
              child: Text(t('Tạo NCC'))),
        ],
      ),
    );
    final nm = name.text.trim();
    final ph = phone.text.trim();
    final co = company.text.trim();
    name.dispose();
    phone.dispose();
    company.dispose();
    if (ok != true) return;
    if (nm.isEmpty) {
      _toast(t('Tên NCC không được trống'), error: true);
      return;
    }
    try {
      final saved = await context.read<ApiService>().upsertPartner({
        'name': nm,
        'phone': ph,
        'company': co,
        'is_supplier': true,
      });
      final p = saved['partner'] is Map
          ? Map<String, dynamic>.from(saved['partner'])
          : saved;
      if (!mounted) return;
      setState(() {
        _suppliers.insert(0, p);
        _supplierId = kvs(p['id']);
      });
      _toast(t('Đã thêm NCC "$nm"'));
    } catch (e) {
      _toast(e.toString().replaceFirst('Exception: ', ''), error: true);
    }
  }

  /// "Chọn file dữ liệu" — nạp dòng hàng từ file Excel theo file mẫu
  /// Header-aware; vẫn tương thích mẫu 5 cột cũ.
  String _matchText(Object? value) => kvs(value)
      .toLowerCase()
      .trim()
      .replaceAll(RegExp(r'[^a-z0-9à-ỹ]+', unicode: true), ' ')
      .replaceAll(RegExp(r'\s+'), ' ');

  double _similarity(Map<String, dynamic> item, Map<String, String> row) {
    final a =
        _matchText(item['name']).split(' ').where((x) => x.isNotEmpty).toSet();
    final b =
        _matchText(row['name']).split(' ').where((x) => x.isNotEmpty).toSet();
    if (a.isEmpty || b.isEmpty) return 0;
    return a.intersection(b).length / a.union(b).length;
  }

  Future<Map<String, dynamic>?> _resolveUnmatched(
      Map<String, String> row) async {
    final ranked = [..._items]
      ..sort((a, b) => _similarity(b, row).compareTo(_similarity(a, row)));
    final candidates =
        ranked.where((x) => _similarity(x, row) >= .35).take(6).toList();
    String? choice;
    final result = await showDialog<String>(
      context: context,
      barrierDismissible: false,
      builder: (ctx) => StatefulBuilder(
          builder: (ctx, setLocal) => AlertDialog(
                title: Text(t('Cân bằng mặt hàng nhập')),
                content: SizedBox(
                  width: 560,
                  child: Column(
                      mainAxisSize: MainAxisSize.min,
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                            '${row['code']!.isEmpty ? row['barcode'] : row['code']} — ${row['name']}',
                            style:
                                const TextStyle(fontWeight: FontWeight.w800)),
                        const SizedBox(height: 8),
                        Text(t(
                            'Không tìm thấy mã chính xác. Hãy xác nhận đây là hàng cũ hay tạo mặt hàng mới; hệ thống không tự tạo bản trùng.')),
                        const SizedBox(height: 14),
                        DropdownButtonFormField<String>(
                          initialValue: choice,
                          isExpanded: true,
                          decoration: InputDecoration(
                              labelText: t('Mặt hàng cần liên kết')),
                          items: [
                            for (final item in candidates)
                              DropdownMenuItem(
                                  value: kvs(item['id']),
                                  child: Text(
                                      '${kvs(item['code'])} — ${kvs(item['name'])}')),
                            if ((row['name'] ?? '').trim().isNotEmpty)
                              DropdownMenuItem(
                                  value: '__new__',
                                  child: Text(
                                      t('Tạo mặt hàng mới từ dòng Excel'))),
                            DropdownMenuItem(
                                value: '__skip__',
                                child: Text(t('Bỏ qua dòng này'))),
                          ],
                          onChanged: (v) => setLocal(() => choice = v),
                        ),
                      ]),
                ),
                actions: [
                  FilledButton(
                      onPressed: choice == null
                          ? null
                          : () => Navigator.pop(ctx, choice),
                      child: Text(t('Xác nhận'))),
                ],
              )),
    );
    if (result == null || result == '__skip__') return null;
    if (result != '__new__')
      return _items
          .cast<Map<String, dynamic>?>()
          .firstWhere((x) => kvs(x?['id']) == result, orElse: () => null);
    final body = <String, dynamic>{
      'code': row['code'],
      'barcode': row['barcode'],
      'name': row['name'],
      'brand': row['brand'],
      'category': row['category'],
      'unit': row['unit'],
      'cost': kvParseNum(row['cost'] ?? '') ?? 0,
      'price': kvParseNum(row['price'] ?? '') ?? 0,
      'price_pre_tax': kvParseNum(row['price_pre_tax'] ?? '') ?? 0,
      'vat': kvParseNum(row['vat'] ?? '') ?? 0,
      'warehouse_id': _warehouseId,
      'opening_stock': 0,
      'track_lot':
          (row['lot'] ?? '').isNotEmpty || (row['expiry'] ?? '').isNotEmpty,
      'expiry_required': (row['expiry'] ?? '').isNotEmpty,
    };
    final created = _isRetailWh
        ? await context.read<ApiService>().createSku(body)
        : await context.read<ApiService>().createInventoryItem(body);
    final item = created['item'] is Map
        ? Map<String, dynamic>.from(created['item'])
        : Map<String, dynamic>.from(created);
    if (_isRetailWh) {
      final books =
          (await context.read<ApiService>().getPriceBooks()).whereType<Map>();
      for (final book in books) {
        final id = kvs(book['id']);
        if (id.isEmpty || id == 'default') continue;
        final price =
            kvParseNum(row['price_book:${_matchText(book['name'])}'] ?? '');
        if (price != null && price >= 0) {
          await context.read<ApiService>().setPriceBookEntry(
              bookId: id, skuId: kvs(item['id']), price: price);
        }
      }
    }
    _items.add(item);
    return item;
  }

  void _mergeImportedLine(Map<String, dynamic> item, num qty, num? cost,
      String lot, String expiry) {
    final same = _lines
        .where((line) =>
            line.id == kvs(item['id']) &&
            _matchText(line.lotNo.text) == _matchText(lot) &&
            line.expiry.text.trim() == expiry.trim())
        .toList();
    if (same.isEmpty) {
      _lines.add(KvDocLine(item, _isRetailWh ? 'sku' : 'inventory',
          initialQty: qty,
          initialCost: cost ?? kvn(item['cost']),
          lot: lot,
          exp: expiry));
      return;
    }
    final line = same.first;
    final oldQty = line.qtyNum;
    final newQty = oldQty + qty;
    final newCost = cost == null || cost <= 0
        ? line.costNum
        : ((oldQty * line.costNum) + (qty * cost)) / newQty;
    line.qty.text = kvNumText(newQty);
    line.cost.text = kvNumText(newCost);
  }

  // Dòng "chưa khớp mã" mang nguyên dữ liệu Excel (id rỗng) — hiển thị trên
  // bảng ngay, chờ người dùng bấm "Khớp mã" trước khi Hoàn thành.
  KvDocLine _unmatchedLine(Map<String, String> row, num qty) {
    final placeholder = <String, dynamic>{
      'id': '',
      'name': row['name'] ?? '',
      'code': row['code'] ?? '',
      'barcode': row['barcode'] ?? '',
      'unit': row['unit'] ?? '',
      'cost': kvParseNum(row['cost'] ?? '') ?? 0,
      '_unmatched': true,
      '_excel': Map<String, String>.from(row),
    };
    return KvDocLine(placeholder, _isRetailWh ? 'sku' : 'inventory',
        initialQty: qty,
        initialCost: kvParseNum(row['cost'] ?? ''),
        lot: _isReturn ? '' : row['lot'],
        exp: _isReturn ? '' : row['expiry']);
  }

  // Bấm "Khớp mã" trên một dòng chưa khớp: mở hộp chọn/tạo mặt hàng, rồi thay
  // dòng cũ bằng dòng đã gắn mặt hàng (GIỮ NGUYÊN SL/giá/lô/HSD đã nhập).
  Future<void> _matchLine(int i) async {
    final l = _lines[i];
    final excel = l.item['_excel'];
    final row = excel is Map
        ? excel.map((k, v) => MapEntry(k.toString(), v?.toString() ?? ''))
        : <String, String>{'name': l.name, 'code': l.code};
    final item = await _resolveUnmatched(Map<String, String>.from(row));
    if (item == null || !mounted) return;
    final replaced = KvDocLine(item, _isRetailWh ? 'sku' : 'inventory',
        initialQty: l.qtyNum,
        initialCost: l.costNum,
        lot: l.lotNo.text,
        exp: l.expiry.text);
    setState(() {
      _lines[i].dispose();
      _lines[i] = replaced;
    });
  }

  Future<void> _importFromExcel() async {
    final api = context.read<ApiService>();
    try {
      final data = await kvPickSpreadsheetData();
      if (data == null) return;
      try {
        await kvArchiveImportFile(api, data, sourceScreen: 'Kho — Nhập hàng');
      } catch (_) {
        if (mounted) _toast(t('Đã nhập; chưa lưu được file gốc vào Tài liệu'), error: true);
      }
      final byCode = <String, Map<String, dynamic>>{};
      for (final it in _items) {
        for (final k in [kvs(it['code']), kvs(it['barcode']), kvs(it['id'])]) {
          if (k.isNotEmpty) byCode[k.toLowerCase()] = it;
        }
      }
      var added = 0;
      final missed = <String>[];
      for (final r in data.rows) {
        String value(List<String> names, int old) =>
            data.cell(r, names, fallback: old);
        final row = <String, String>{
          'code': value(['Mã sản phẩm', 'Mã hàng', 'Product code'], 0),
          'barcode': value(['Mã vạch', 'Barcode'], -1),
          'name': value(['Tên sản phẩm', 'Tên hàng', 'Product name'], -1),
          'brand': value(['Thương hiệu', 'Brand'], -1),
          'category': value(['Phân loại', 'Nhóm hàng', 'Category'], -1),
          'unit': value(['ĐVT', 'Đơn vị', 'Unit'], -1),
          'qty': value(['Số lượng', 'Quantity'], 1),
          'cost': value(['Đơn giá nhập', 'Đơn giá', 'Unit cost'], 2),
          'price': value(['Giá bán mặc định', 'Giá bán', 'Sale price'], -1),
          'price_pre_tax': value(['Giá bán trước VAT', 'Pre-tax price'], -1),
          'vat': value(['VAT (%)', 'VAT'], -1),
          'lot': value(['Lô', 'Số lô', 'Lot'], 3),
          'expiry': value(['Hạn sử dụng', 'HSD', 'Expiry date'], 4),
        };
        for (var column = 0; column < data.headers.length; column++) {
          final header = data.headers[column].trim();
          final lowerHeader = header.toLowerCase();
          if (lowerHeader.startsWith('giá theo bảng giá —') ||
              lowerHeader.startsWith('gia theo bang gia —') ||
              lowerHeader.startsWith('giá bán —') ||
              lowerHeader.startsWith('gia ban —')) {
            final name = header.split('—').skip(1).join('—').trim();
            row['price_book:${_matchText(name)}'] =
                column < r.length ? r[column].trim() : '';
          }
        }
        // Mỗi dòng xử lý ĐỘC LẬP: một dòng lỗi (vd tạo mặt hàng trùng mã, API
        // lỗi) KHÔNG được làm hỏng cả file → những dòng hợp lệ vẫn nạp lên trang.
        // KHÔNG hỏi khớp mã ngay lúc import — LIỆT KÊ HẾT ra bảng. Dòng khớp mã
        // thì gắn luôn mặt hàng; dòng chưa khớp thêm dạng "chưa khớp" (có nút
        // "Khớp mã" trên dòng để xử lý sau, trước khi Hoàn thành).
        try {
          final lookup = [row['code'], row['barcode']]
              .whereType<String>()
              .where((x) => x.isNotEmpty);
          Map<String, dynamic>? item;
          for (final key in lookup) {
            item = byCode[key.toLowerCase()];
            if (item != null) break;
          }
          final rawQty = kvParseNum(row['qty'] ?? '') ?? 0;
          final qty = rawQty > 0 ? rawQty : 1;
          if (item != null) {
            _mergeImportedLine(item, qty, kvParseNum(row['cost'] ?? ''),
                _isReturn ? '' : row['lot']!, _isReturn ? '' : row['expiry']!);
          } else {
            _lines.add(_unmatchedLine(row, qty));
          }
          added++;
        } catch (rowErr) {
          final label = (row['code']?.isNotEmpty ?? false)
              ? row['code']!
              : (row['name'] ?? '?');
          missed.add(
              '$label (${rowErr.toString().replaceFirst('Exception: ', '')})');
        }
      }
      if (mounted) setState(() {});
      final unmatched =
          _lines.where((l) => l.item['_unmatched'] == true).length;
      final msg = missed.isEmpty
          ? (unmatched > 0
              ? t('Đã nạp $added dòng — $unmatched dòng CHƯA KHỚP MÃ, bấm "Khớp mã" trên từng dòng')
              : t('Đã nạp $added dòng từ file'))
          : t('Đã nạp $added dòng; không thấy mã: ${missed.take(5).join(", ")}${missed.length > 5 ? "…" : ""}');
      _toast(msg, error: missed.isNotEmpty && added == 0);
    } catch (e) {
      _toast(
          '${t('Không đọc được file')}: ${e.toString().replaceFirst('Exception: ', '')}',
          error: true);
    }
  }

  Widget _lineRow(int i) {
    final l = _lines[i];
    final unmatched = l.item['_unmatched'] == true;
    return Container(
      color:
          unmatched ? DanColors.late.withValues(alpha: .06) : DanColors.surface,
      padding: EdgeInsets.symmetric(horizontal: 20, vertical: 6),
      child: Row(
        children: [
          SizedBox(
              width: 30,
              child: Text('${i + 1}',
                  style: TextStyle(fontSize: 12, color: DanColors.faint))),
          SizedBox(
            width: 104,
            child: unmatched
                ? OutlinedButton(
                    onPressed: () => _matchLine(i),
                    style: OutlinedButton.styleFrom(
                        minimumSize: const Size(0, 30),
                        padding: const EdgeInsets.symmetric(horizontal: 6),
                        foregroundColor: DanColors.late,
                        side: const BorderSide(color: DanColors.late)),
                    child: Row(mainAxisSize: MainAxisSize.min, children: [
                      const Icon(Icons.link, size: 13),
                      const SizedBox(width: 3),
                      Text(t('Khớp mã'), style: const TextStyle(fontSize: 11)),
                    ]),
                  )
                : Text(l.code,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                        fontFamily: 'JetBrains Mono',
                        fontSize: 11.5,
                        fontWeight: FontWeight.w700,
                        color: DanColors.brand)),
          ),
          SizedBox(width: 8),
          Expanded(
            child: Text(l.name,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                    fontSize: 12.5, fontWeight: FontWeight.w600, height: 1.2)),
          ),
          SizedBox(
            width: 92,
            child: DropdownButton<String>(
              value: l.unit,
              isDense: true,
              isExpanded: true,
              underline: SizedBox.shrink(),
              items: [
                for (final u in l.availableUnits)
                  DropdownMenuItem(value: u, child: Text(u)),
              ],
              onChanged: (v) => setState(() => l.selectUnit(v ?? l.unit)),
            ),
          ),
          KvCellInput(
              controller: l.qty, width: 78, onChanged: (_) => setState(() {})),
          SizedBox(width: 8),
          KvCellInput(
              controller: l.cost, width: 96, onChanged: (_) => setState(() {})),
          if (!_isReturn) ...[
            SizedBox(width: 8),
            KvCellInput(
                controller: l.lotNo,
                width: 78,
                align: TextAlign.left,
                number: false,
                hint: t('Lô')),
            SizedBox(width: 8),
            KvCellInput(
                controller: l.expiry,
                width: 106,
                align: TextAlign.left,
                number: false,
                hint: 'dd/mm/yyyy'),
          ],
          SizedBox(
            width: 104,
            child: Text(Fmt.money(l.lineTotal),
                textAlign: TextAlign.right,
                style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w800)),
          ),
          SizedBox(
            width: 40,
            child: IconButton(
              tooltip: t('Xóa dòng'),
              onPressed: () => setState(() => _lines.removeAt(i).dispose()),
              icon: Icon(Icons.close, size: 16, color: DanColors.faint),
            ),
          ),
        ],
      ),
    );
  }
}
