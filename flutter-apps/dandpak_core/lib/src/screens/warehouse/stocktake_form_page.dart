import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../providers/auth_provider.dart';
import '../../services/api_service.dart';
import '../../ui/app_theme.dart';
import '../../ui/format.dart';
import '../../utils/translation.dart';
import 'kv_excel.dart';
import 'kv_shared.dart';

/// Form tạo/sửa phiếu KIỂM KHO (Phiếu tạm). Bố cục KiotViet: trái = tìm hàng +
/// bảng dòng kiểm (SL thực tế, Lô, HSD); phải = panel thông tin + Lưu tạm /
/// Hoàn thành (= lưu + cân bằng kho ngay).
///
/// "Nhập từ file": dán bảng từ Excel/CSV/Markdown theo đúng file mẫu KiotViet
/// (Mã hàng | Số lượng | Lô 1 | Hạn sử dụng 1 | Số lượng 1 | Lô 2 | …).
class StocktakeFormPage extends StatefulWidget {
  final List<Map<String, dynamic>> warehouses;
  final String? initialWarehouseId;
  final Map<String, dynamic>? existing;
  const StocktakeFormPage(
      {super.key,
      required this.warehouses,
      this.initialWarehouseId,
      this.existing});

  @override
  State<StocktakeFormPage> createState() => _StocktakeFormPageState();
}

class _StocktakeLine {
  final Map<String, dynamic> item;
  final String stockType;
  final TextEditingController counted;
  final TextEditingController lotNo;
  final TextEditingController expiry;

  _StocktakeLine(this.item, this.stockType,
      {num? initialCounted, String? lot, String? exp})
      : counted = TextEditingController(
            text: initialCounted == null ? '' : kvNumText(initialCounted)),
        lotNo = TextEditingController(text: lot ?? ''),
        expiry = TextEditingController(text: exp ?? '');

  String get id => kvs(item['id']);
  String get code =>
      kvs(item['code']).isEmpty ? kvs(item['barcode']) : kvs(item['code']);
  String get name => kvs(item['name']);
  String get unit => kvs(item['unit']);
  num get stock => kvn(item['stock']);
  num? get countedNum =>
      kvParseNum(counted.text);

  void dispose() {
    counted.dispose();
    lotNo.dispose();
    expiry.dispose();
  }
}

class _StocktakeFormPageState extends State<StocktakeFormPage> {
  String? _warehouseId;
  List<Map<String, dynamic>> _items = [];
  final List<_StocktakeLine> _lines = [];
  final _note = TextEditingController();
  bool _loadingItems = false;
  bool _busy = false;
  // "Ảnh" trạng thái sau khi load/prefill — thoát mà khác ảnh thì hỏi.
  // Đã bấm Lưu tạm = form pop luôn nên không bao giờ hỏi lại (đúng spec).
  String _baseline = '';

  String _stateSig() => [
        _warehouseId ?? '',
        _note.text.trim(),
        for (final l in _lines)
          '${l.id}|${l.counted.text}|${l.lotNo.text}|${l.expiry.text}',
      ].join('');

  bool get _dirty => _stateSig() != _baseline;

  /// Chặn thoát khi đang kiểm dở: mời LƯU TẠM trước, hoặc bỏ, hoặc ở lại.
  Future<void> _confirmExit() async {
    if (_busy) return;
    if (!_dirty) {
      Navigator.of(context).pop();
      return;
    }
    // 'save' | 'discard' | null (ở lại)
    final choice = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: DanColors.surface,
        title: Text(t('Phiếu kiểm chưa lưu'),
            style: TextStyle(fontWeight: FontWeight.w900, fontSize: 17)),
        content: Text(t(
            'Bạn chưa lưu tạm phiếu kiểm này. Lưu tạm để kiểm tiếp sau, hay thoát và bỏ hết?')),
        actions: [
          TextButton(
              onPressed: () => Navigator.of(ctx).pop(null),
              child: Text(t('Ở lại'))),
          TextButton(
              style: TextButton.styleFrom(foregroundColor: DanColors.late),
              onPressed: () => Navigator.of(ctx).pop('discard'),
              child: Text(t('Thoát, bỏ phiếu'))),
          FilledButton(
              onPressed: () => Navigator.of(ctx).pop('save'),
              child: Text(t('Lưu tạm & thoát'))),
        ],
      ),
    );
    if (!mounted || choice == null) return;
    if (choice == 'discard') {
      Navigator.of(context).pop();
      return;
    }
    await _save(approve: false); // lưu OK sẽ tự pop; lỗi thì ở lại + báo
  }

  bool get _isRetail {
    final wh = widget.warehouses
        .where((w) => kvs(w['id']) == _warehouseId)
        .toList();
    return wh.isEmpty || kvs(wh.first['type']) == 'retail';
  }

  @override
  void initState() {
    super.initState();
    final ex = widget.existing;
    _warehouseId = ex != null
        ? kvs(ex['warehouse_id'])
        : (kvs(widget.initialWarehouseId).isNotEmpty &&
                widget.warehouses
                    .any((w) => kvs(w['id']) == widget.initialWarehouseId)
            ? widget.initialWarehouseId
            : (widget.warehouses.isNotEmpty
                ? kvs(widget.warehouses.first['id'])
                : null));
    if (ex != null) _note.text = kvs(ex['note']);
    _loadItems().then((_) {
      if (ex != null) _prefillFromExisting(ex);
      // Baseline SAU prefill: mở phiếu cũ xem mà không sửa → thoát êm.
      if (mounted) _baseline = _stateSig();
    });
    _baseline = _stateSig();
  }

  @override
  void dispose() {
    _note.dispose();
    for (final l in _lines) {
      l.dispose();
    }
    super.dispose();
  }

  void _prefillFromExisting(Map<String, dynamic> ex) {
    final byId = {for (final it in _items) kvs(it['id']): it};
    setState(() {
      for (final l in kvMapList(ex['lines'])) {
        final item = byId[kvs(l['item_id'])];
        if (item == null) continue;
        _lines.add(_StocktakeLine(item, kvs(l['item_type']),
            initialCounted: kvn(l['counted_qty']),
            lot: kvs(l['lot_no']),
            exp: kvs(l['expiry_date'])));
      }
    });
  }

  Future<void> _loadItems() async {
    if (_warehouseId == null) return;
    setState(() => _loadingItems = true);
    try {
      final api = context.read<ApiService>();
      final rows = _isRetail
          ? await api.getWarehouseSkus(_warehouseId!)
          : await api.getInventory(warehouseId: _warehouseId);
      if (!mounted) return;
      setState(() {
        _items = kvMapList(rows);
        _loadingItems = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() => _loadingItems = false);
      _toast(e.toString().replaceFirst('Exception: ', ''), error: true);
    }
  }

  void _toast(String m, {bool error = false}) =>
      appToast(context, m, isError: error);

  void _addItem(Map<String, dynamic> item) {
    setState(() {
      _lines.add(_StocktakeLine(item, _isRetail ? 'sku' : 'inventory',
          initialCounted: kvn(item['stock'])));
    });
  }

  num get _totalCounted =>
      _lines.fold<num>(0, (s, l) => s + (l.countedNum ?? 0));
  num get _totalDelta {
    num d = 0;
    for (final l in _lines) {
      // Dòng có lô: server so với tồn của đúng lô — client chỉ ước lượng cho
      // dòng không lô để hiển thị nhanh.
      if (l.lotNo.text.trim().isEmpty && l.countedNum != null) {
        d += l.countedNum! - l.stock;
      }
    }
    return d;
  }

  List<Map<String, dynamic>> _buildBodyLines() {
    final out = <Map<String, dynamic>>[];
    for (final l in _lines) {
      final counted = l.countedNum;
      if (counted == null || counted < 0) continue;
      out.add({
        'stock_type': l.stockType,
        'item_id': l.id,
        'counted_qty': counted,
        if (l.lotNo.text.trim().isNotEmpty) 'lot_no': l.lotNo.text.trim(),
        if (l.expiry.text.trim().isNotEmpty)
          'expiry_date': _normalizeDate(l.expiry.text.trim()),
      });
    }
    return out;
  }

  /// dd/MM/yyyy (file mẫu KiotViet) -> yyyy-MM-dd; giữ nguyên nếu đã ISO.
  static String _normalizeDate(String v) {
    final m = RegExp(r'^(\d{1,2})/(\d{1,2})/(\d{4})$').firstMatch(v);
    if (m == null) return v;
    return '${m.group(3)}-${m.group(2)!.padLeft(2, '0')}-${m.group(1)!.padLeft(2, '0')}';
  }

  Future<void> _save({required bool approve}) async {
    if (_warehouseId == null) {
      _toast(t('Chọn kho kiểm'), error: true);
      return;
    }
    final lines = _buildBodyLines();
    if (lines.isEmpty) {
      _toast(t('Thêm ít nhất một dòng kiểm và nhập SL thực tế'), error: true);
      return;
    }
    setState(() => _busy = true);
    try {
      final api = context.read<ApiService>();
      final body = {
        if (widget.existing != null) 'id': kvs(widget.existing!['id']),
        'warehouse_id': _warehouseId,
        'note': _note.text.trim(),
        'lines': lines,
      };
      final saved = await api.saveStocktake(body);
      if (approve) {
        await api.approveStocktake(kvs(saved['id']));
      }
      if (!mounted) return;
      Navigator.of(context).pop(true);
    } catch (e) {
      if (!mounted) return;
      setState(() => _busy = false);
      _toast(e.toString().replaceFirst('Exception: ', ''), error: true);
    }
  }

  // ── Nhập từ file Excel (.xlsx theo MauFileKiemKho) ────────────────────────
  Future<void> _importFromFile() async {
    try {
      final rows = await kvPickSpreadsheetRows();
      if (rows == null) return; // người dùng hủy
      // Tái dùng parser dán-từ-Excel: ghép cell bằng TAB.
      _applyImport(rows.map((r) => r.join('\t')).join('\n'));
    } catch (e) {
      _toast(
          '${t('Không đọc được file')}: ${e.toString().replaceFirst('Exception: ', '')}',
          error: true);
    }
  }

  // ── Nhập từ file mẫu (dán từ Excel/CSV/Markdown) ──────────────────────────
  Future<void> _importFromPaste() async {
    final ctrl = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: DanColors.surface,
        title: Text(t('Nhập kiểm kho từ file'),
            style: TextStyle(fontWeight: FontWeight.w900, fontSize: 17)),
        content: SizedBox(
          width: dialogWidth(context, 620),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                t('Mở file mẫu (Excel/CSV) → copy toàn bộ bảng → dán vào đây. Cột: Mã hàng | Số lượng | Lô 1 | Hạn sử dụng 1 | Số lượng 1 | Lô 2 | …'),
                style: TextStyle(fontSize: 12.5, color: DanColors.muted),
              ),
              SizedBox(height: 10),
              TextField(
                controller: ctrl,
                autofocus: true,
                maxLines: 12,
                style: TextStyle(fontFamily: 'JetBrains Mono', fontSize: 12),
                decoration: InputDecoration(
                  hintText:
                      'Mã hàng\tSố lượng\tLô 1\tHạn sử dụng 1\tSố lượng 1\n00060\t\tL001\t15/10/2020\t1',
                  filled: true,
                  fillColor: DanColors.surface2,
                  border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(DanRadius.sm),
                      borderSide: BorderSide.none),
                ),
              ),
            ],
          ),
        ),
        actions: [
          TextButton(
              onPressed: () => Navigator.of(ctx).pop(false),
              child: Text(t('Hủy'))),
          FilledButton(
              onPressed: () => Navigator.of(ctx).pop(true),
              child: Text(t('Nhập vào phiếu'))),
        ],
      ),
    );
    final raw = ctrl.text;
    ctrl.dispose();
    if (ok != true || raw.trim().isEmpty) return;
    _applyImport(raw);
  }

  void _applyImport(String raw) {
    final byCode = <String, Map<String, dynamic>>{};
    for (final it in _items) {
      final code = kvs(it['code']).trim();
      final barcode = kvs(it['barcode']).trim();
      if (code.isNotEmpty) byCode[code.toLowerCase()] = it;
      if (barcode.isNotEmpty) byCode.putIfAbsent(barcode.toLowerCase(), () => it);
    }

    int added = 0;
    final missing = <String>[];
    final lines = raw.split(RegExp(r'\r?\n'));
    for (var line in lines) {
      line = line.trim();
      if (line.isEmpty) continue;
      // Markdown: bỏ dòng phân cách |---|; bỏ pipe 2 đầu.
      if (RegExp(r'^\|?[\s\-|]+\|?$').hasMatch(line)) continue;
      List<String> cells;
      if (line.contains('|')) {
        cells = line.split('|');
        if (cells.isNotEmpty && cells.first.trim().isEmpty) cells.removeAt(0);
        if (cells.isNotEmpty && cells.last.trim().isEmpty) cells.removeLast();
      } else if (line.contains('\t')) {
        cells = line.split('\t');
      } else {
        cells = line.split(',');
      }
      cells = cells.map((c) => c.trim()).toList();
      if (cells.isEmpty) continue;
      final code = cells[0];
      if (code.isEmpty) continue;
      // Bỏ dòng tiêu đề.
      if (code.toLowerCase().contains('mã hàng') ||
          code.toLowerCase() == 'ma hang') {
        continue;
      }
      final item = byCode[code.toLowerCase()];
      if (item == null) {
        missing.add(code);
        continue;
      }
      final stockType = _isRetail ? 'sku' : 'inventory';
      String cell(int i) => i < cells.length ? cells[i] : '';
      final baseQty = kvParseNum(cell(1));
      bool anyLot = false;
      // Cột lô lặp theo bộ 3: Lô i | Hạn sử dụng i | Số lượng i (bắt đầu ở cột 2).
      for (var i = 2; i + 2 < cells.length + 3; i += 3) {
        final lot = cell(i);
        final exp = cell(i + 1);
        final qty = kvParseNum(cell(i + 2));
        if (lot.isEmpty && exp.isEmpty && qty == null) continue;
        if (lot.isEmpty && qty == null) continue;
        anyLot = true;
        _lines.add(_StocktakeLine(item, stockType,
            initialCounted: qty ?? 0, lot: lot, exp: exp));
        added++;
      }
      if (!anyLot) {
        _lines.add(_StocktakeLine(item, stockType, initialCounted: baseQty));
        added++;
      }
    }
    setState(() {});
    if (missing.isNotEmpty) {
      _toast(
          t('Đã thêm $added dòng. Không tìm thấy mã: ${missing.take(5).join(', ')}${missing.length > 5 ? '…' : ''}'),
          error: true);
    } else {
      _toast(t('Đã thêm $added dòng kiểm'));
    }
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final ex = widget.existing;
    // Chặn back hệ thống/nút ← khi kiểm dở — mời Lưu tạm trước khi thoát.
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
              // Chừa hàng trên cùng cho nút cửa sổ (thu nhỏ/đóng) — KHÔNG đặt
              // nút chức năng ở góc phải trên; padding rộng cho thoáng viền.
              padding: EdgeInsets.fromLTRB(16, 12, 160, 10),
              child: Row(
                children: [
                  IconButton(
                      onPressed: () => Navigator.of(context).maybePop(),
                      icon: Icon(Icons.arrow_back)),
                  SizedBox(width: 4),
                  Text(
                      ex == null
                          ? t('Kiểm kho')
                          : '${t('Kiểm kho')} ${kvs(ex['code'])}',
                      style: TextStyle(
                          fontSize: 17, fontWeight: FontWeight.w900)),
                  SizedBox(width: 18),
                  SizedBox(
                    width: 250,
                    child: DropdownButtonFormField<String>(
                      initialValue: _warehouseId,
                      isExpanded: true,
                      decoration: InputDecoration(
                          labelText: t('Kho kiểm'),
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
                          ? null // đổi kho giữa chừng làm sai tồn dự kiến
                          : (v) {
                              setState(() => _warehouseId = v);
                              _loadItems();
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
                                onPressed:
                                    _loadingItems ? null : _importFromFile,
                                icon: Icon(Icons.file_copy_outlined, size: 18),
                                label: Text(t('Chọn file dữ liệu')),
                                style: OutlinedButton.styleFrom(
                                    minimumSize: Size(0, 42)),
                              ),
                              SizedBox(width: 8),
                              OutlinedButton.icon(
                                onPressed:
                                    _loadingItems ? null : _importFromPaste,
                                icon: Icon(Icons.content_paste_go_outlined,
                                    size: 18),
                                label: Text(t('Dán từ Excel')),
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
                          kvHeaderCell(t('ĐVT'), width: 56),
                          kvHeaderCell(t('Tồn kho'),
                              width: 72, align: TextAlign.right),
                          SizedBox(width: 10),
                          kvHeaderCell(t('SL thực tế'), width: 86),
                          SizedBox(width: 8),
                          kvHeaderCell(t('Lô'), width: 86),
                          SizedBox(width: 8),
                          kvHeaderCell(t('HSD (dd/mm/yyyy)'), width: 118),
                          kvHeaderCell(t('Lệch'),
                              width: 64, align: TextAlign.right),
                          SizedBox(width: 40),
                        ]),
                        Divider(height: 1, color: DanColors.border),
                        Expanded(
                          child: _loadingItems
                              ? Center(child: CircularProgressIndicator())
                              : _lines.isEmpty
                                  ? KvExcelEmptyImport(
                                      message:
                                          t('Nhập kiểm kho từ file excel'),
                                      templateKind: KvTemplateKind.stocktake,
                                      onPick: _importFromFile)
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
                    codeHint: t('Mã kiểm kho'),
                    statusLabel: t('Phiếu tạm'),
                    noteCtrl: _note,
                    busy: _busy,
                    onSaveDraft: () => _save(approve: false),
                    onComplete: () => _save(approve: true),
                    completeLabel: t('Hoàn thành'),
                    children: [
                      KvMetaTotalRow(
                          label: t('Tổng SL thực tế'),
                          value: Fmt.int0(_totalCounted)),
                      KvMetaTotalRow(
                          label: t('Tổng lệch (tạm tính)'),
                          value:
                              '${_totalDelta > 0 ? '+' : ''}${Fmt.int0(_totalDelta)}',
                          accent: _totalDelta == 0
                              ? null
                              : _totalDelta > 0
                                  ? DanColors.done
                                  : DanColors.late),
                      SizedBox(height: 2),
                      Text(
                          t('Hoàn thành = lưu phiếu và cân bằng kho ngay. Lưu tạm để kiểm tiếp sau.'),
                          style: TextStyle(
                              fontSize: 11.5, color: DanColors.faint)),
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

  Widget _lineRow(int i) {
    final l = _lines[i];
    final counted = l.countedNum;
    final hasLot = l.lotNo.text.trim().isNotEmpty;
    final delta = (counted == null || hasLot) ? null : counted - l.stock;
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
              width: 56,
              child: Text(l.unit,
                  style: TextStyle(fontSize: 12, color: DanColors.muted))),
          SizedBox(
            width: 72,
            child: Text(Fmt.int0(l.stock),
                textAlign: TextAlign.right,
                style: TextStyle(fontSize: 12.5, color: DanColors.muted)),
          ),
          SizedBox(width: 10),
          KvCellInput(
              controller: l.counted,
              width: 86,
              onChanged: (_) => setState(() {})),
          SizedBox(width: 8),
          KvCellInput(
              controller: l.lotNo,
              width: 86,
              align: TextAlign.left,
              number: false,
              hint: t('Lô'),
              onChanged: (_) => setState(() {})),
          SizedBox(width: 8),
          KvCellInput(
              controller: l.expiry,
              width: 118,
              align: TextAlign.left,
              number: false,
              hint: 'dd/mm/yyyy'),
          SizedBox(
            width: 64,
            child: Text(
                delta == null
                    ? '—'
                    : '${delta > 0 ? '+' : ''}${Fmt.int0(delta)}',
                textAlign: TextAlign.right,
                style: TextStyle(
                    fontSize: 12.5,
                    fontWeight: FontWeight.w800,
                    color: delta == null || delta == 0
                        ? DanColors.faint
                        : delta > 0
                            ? DanColors.done
                            : DanColors.late)),
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
