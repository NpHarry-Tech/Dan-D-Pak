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
      _supplierId = kvs(ex['supplier_id']).isEmpty ? null : kvs(ex['supplier_id']);
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
    final leave = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: DanColors.surface,
        title: Text(t('Thoát mà không lưu?'),
            style: TextStyle(fontWeight: FontWeight.w900, fontSize: 17)),
        content: Text(t(
            'Phiếu đang nhập dở sẽ MẤT. Bấm "Lưu tạm" nếu muốn giữ lại làm tiếp sau.')),
        actions: [
          TextButton(
              onPressed: () => Navigator.of(ctx).pop(false),
              child: Text(t('Ở lại'))),
          FilledButton(
              style: FilledButton.styleFrom(backgroundColor: DanColors.late),
              onPressed: () => Navigator.of(ctx).pop(true),
              child: Text(t('Thoát, bỏ phiếu'))),
        ],
      ),
    );
    if (leave == true && mounted) Navigator.of(context).pop();
  }

  @override
  void dispose() {
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
    final wh = widget.warehouses
        .where((w) => kvs(w['id']) == _warehouseId)
        .toList();
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
  num get _vatAmount => !_vatOn
      ? 0
      : (kvParseNum(_vatCtrl.text) ?? 0);
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
    final bodyLines = <Map<String, dynamic>>[];
    for (final l in _lines) {
      if (l.qtyNum <= 0) continue;
      bodyLines.add({
        'item_type': l.stockType,
        'item_id': l.id,
        'name': l.name,
        'unit': l.unit,
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
                          labelText:
                              _isReturn ? t('Kho xuất hàng') : t('Kho nhận hàng'),
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
                                icon: Icon(Icons.file_copy_outlined, size: 18),
                                label: Text(t('Chọn file dữ liệu')),
                                style: OutlinedButton.styleFrom(
                                    minimumSize: Size(0, 42)),
                              ),
                            ],
                          ),
                        ),
                        SizedBox(height: 10),
                        KvTableHeader(cells: [
                          kvHeaderCell('#', width: 30),
                          kvHeaderCell(t('Mã hàng'), width: 104),
                          SizedBox(width: 8),
                          kvHeaderCell(t('Tên hàng'), flex: 1),
                          kvHeaderCell(t('ĐVT'), width: 52),
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
                        Divider(height: 1, color: DanColors.border),
                        Expanded(
                          child: _loadingItems
                              ? Center(child: CircularProgressIndicator())
                              : _lines.isEmpty
                                  ? KvExcelEmptyImport(
                                      message:
                                          t('Thêm sản phẩm từ file excel'),
                                      templateKind: _isReturn
                                          ? KvTemplateKind.issue
                                          : KvTemplateKind.purchaseIn,
                                      onPick: _importFromExcel)
                                  : ListView.separated(
                                      itemCount: _lines.length,
                                      separatorBuilder: (_, __) => Divider(
                                          height: 1, color: DanColors.border),
                                      itemBuilder: (_, i) => _lineRow(i),
                                    ),
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
                          label:
                              '${t('Tổng tiền hàng')} (${_lines.length})',
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
                  decoration:
                      InputDecoration(labelText: '${t('Tên NCC')} *')),
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
  /// (Nhập hàng: Mã hàng|Số lượng|Đơn giá|Lô|HSD; Trả hàng: Mã hàng|Số lượng).
  Future<void> _importFromExcel() async {
    try {
      final rows = await kvPickSpreadsheetRows();
      if (rows == null) return; // người dùng hủy
      final byCode = <String, Map<String, dynamic>>{};
      for (final it in _items) {
        for (final k in [kvs(it['code']), kvs(it['barcode']), kvs(it['id'])]) {
          if (k.isNotEmpty) byCode[k.toLowerCase()] = it;
        }
      }
      var added = 0;
      final missed = <String>[];
      setState(() {
        for (final r in rows) {
          String cell(int i) => i < r.length ? r[i].trim() : '';
          final code = cell(0);
          if (code.isEmpty) continue;
          final item = byCode[code.toLowerCase()];
          if (item == null) {
            missed.add(code);
            continue;
          }
          final qty = kvParseNum(cell(1)) ?? 1;
          final cost = kvParseNum(cell(2));
          _lines.add(KvDocLine(item, _isRetailWh ? 'sku' : 'inventory',
              initialQty: qty <= 0 ? 1 : qty,
              initialCost: cost ?? kvn(item['cost']),
              lot: _isReturn ? '' : cell(3),
              exp: _isReturn ? '' : cell(4)));
          added++;
        }
      });
      final msg = missed.isEmpty
          ? t('Đã nạp $added dòng từ file')
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
    return Container(
      color: DanColors.surface,
      padding: EdgeInsets.symmetric(horizontal: 20, vertical: 6),
      child: Row(
        children: [
          SizedBox(
              width: 30,
              child: Text('${i + 1}',
                  style: TextStyle(fontSize: 12, color: DanColors.faint))),
          SizedBox(
            width: 104,
            child: Text(l.code,
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
              width: 52,
              child: Text(l.unit,
                  style: TextStyle(fontSize: 12, color: DanColors.muted))),
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
