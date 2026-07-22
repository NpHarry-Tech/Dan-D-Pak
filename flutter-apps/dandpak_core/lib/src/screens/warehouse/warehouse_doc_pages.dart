import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../providers/auth_provider.dart';
import '../../services/api_service.dart';
import '../../ui/app_theme.dart';
import '../../ui/format.dart';
import '../../utils/translation.dart';
import '../management/management_widgets.dart';
import 'kv_excel.dart';
import 'kv_shared.dart';

/// Chuyển hàng (CH…) + Xuất dùng nội bộ (XDNB…) — hai trang copy chung một
/// layout: danh sách phiếu kho theo type + form tạo phiếu nhiều dòng.
/// Khác nhau duy nhất: chuyển hàng có KHO ĐÍCH, xuất nội bộ thì không.
enum WhDocType { transfer, internalUse }

extension WhDocTypeX on WhDocType {
  String get apiType => this == WhDocType.transfer ? 'transfer' : 'internal_use';
  String get title =>
      this == WhDocType.transfer ? t('Chuyển hàng') : t('Xuất dùng nội bộ');
  String get codeLabel =>
      this == WhDocType.transfer ? t('Mã chuyển hàng') : t('Mã xuất nội bộ');
}

class WarehouseDocPage extends StatefulWidget {
  final WhDocType docType;
  final List<Map<String, dynamic>> warehouses;

  /// Kho đang chọn ở thanh trên module Kho — mặc định làm kho xuất.
  final String? initialWarehouseId;
  const WarehouseDocPage(
      {super.key,
      required this.docType,
      required this.warehouses,
      this.initialWarehouseId});

  @override
  State<WarehouseDocPage> createState() => _WarehouseDocPageState();
}

class _WarehouseDocPageState extends State<WarehouseDocPage> {
  List<Map<String, dynamic>> _rows = [];
  bool _loading = true;
  String? _error;
  String _search = '';
  String? _expandedId;
  Map<String, dynamic>? _detail;
  bool _detailLoading = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final rows = await context
          .read<ApiService>()
          .getWarehouseDocuments(type: widget.docType.apiType);
      if (!mounted) return;
      setState(() {
        _rows = kvMapList(rows);
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.toString().replaceFirst('Exception: ', '');
        _loading = false;
      });
    }
  }

  List<Map<String, dynamic>> get _filtered {
    if (foldSearch(_search).isEmpty) return _rows;
    return _rows
        .where((r) => searchMatchesAny(
            [r['code'], r['id'], r['note'], r['reason']], _search))
        .toList();
  }

  Future<void> _toggleExpand(Map<String, dynamic> row) async {
    final id = kvs(row['id']);
    if (_expandedId == id) {
      setState(() => _expandedId = null);
      return;
    }
    setState(() {
      _expandedId = id;
      _detail = null;
      _detailLoading = true;
    });
    try {
      final d = await context.read<ApiService>().getWarehouseDocument(id);
      if (!mounted || _expandedId != id) return;
      setState(() {
        _detail = d;
        _detailLoading = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() => _detailLoading = false);
    }
  }

  Future<void> _openForm() async {
    final changed = await Navigator.of(context).push<bool>(MaterialPageRoute(
        builder: (_) => WarehouseDocFormPage(
            docType: widget.docType,
            warehouses: widget.warehouses,
            initialWarehouseId: widget.initialWarehouseId)));
    if (changed == true) {
      _expandedId = null;
      _load();
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loading && _rows.isEmpty) {
      return Center(child: CircularProgressIndicator());
    }
    if (_error != null && _rows.isEmpty) {
      return Padding(
        padding: EdgeInsets.all(40),
        child: InlineMessage(t('Không tải được phiếu ($_error)'),
            error: true, onRetry: _load),
      );
    }
    final list = _filtered;
    final isTransfer = widget.docType == WhDocType.transfer;
    return Column(
      children: [
        KvToolbar(
          hint: t('Theo mã phiếu'),
          onSearch: (v) => setState(() => _search = v),
          actions: [
            FilledButton.icon(
              onPressed: _openForm,
              icon: Icon(Icons.add, size: 18),
              label: Text(widget.docType.title),
              style: FilledButton.styleFrom(minimumSize: Size(0, 40)),
            ),
          ],
        ),
        Divider(height: 1, color: DanColors.border),
        KvTableHeader(cells: [
          kvHeaderCell(widget.docType.codeLabel, width: 122),
          SizedBox(width: 10),
          kvHeaderCell(t('Thời gian'), width: 118),
          kvHeaderCell(isTransfer ? t('Từ kho') : t('Kho'), flex: 1),
          if (isTransfer) kvHeaderCell(t('Tới kho'), flex: 1),
          kvHeaderCell(t('Số dòng'), width: 66, align: TextAlign.right),
          kvHeaderCell(t('Giá trị'), width: 104, align: TextAlign.right),
          SizedBox(width: 12),
          kvHeaderCell(t('Người tạo'), width: 110),
          SizedBox(width: 22),
        ]),
        Divider(height: 1, color: DanColors.border),
        Expanded(
          child: list.isEmpty
              ? KvEmptyState(
                  message: t('Không tìm thấy kết quả'),
                  hint: t('Bấm "+ ${widget.docType.title}" để tạo phiếu mới'))
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView.separated(
                    itemCount: list.length,
                    separatorBuilder: (_, __) =>
                        Divider(height: 1, color: DanColors.border),
                    itemBuilder: (_, i) => _row(list[i]),
                  ),
                ),
        ),
      ],
    );
  }

  Widget _row(Map<String, dynamic> r) {
    final id = kvs(r['id']);
    final expanded = _expandedId == id;
    final isTransfer = widget.docType == WhDocType.transfer;
    // Phiếu chuyển ghi 2 dòng (xuất + nhận) cho mỗi mặt hàng.
    final lineCount = isTransfer
        ? (kvn(r['line_count']) / 2).ceil()
        : kvn(r['line_count']).toInt();
    final totalValue =
        isTransfer ? kvn(r['total_value']) / 2 : kvn(r['total_value']);
    return Column(
      children: [
        InkWell(
          onTap: () => _toggleExpand(r),
          child: Container(
            color: expanded ? DanColors.brandDim : DanColors.surface,
            padding: EdgeInsets.symmetric(horizontal: 12, vertical: 10),
            child: Row(
              children: [
                SizedBox(
                  width: 122,
                  child: Text(kvs(r['code']).isEmpty ? id : kvs(r['code']),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                          fontFamily: 'JetBrains Mono',
                          fontSize: 12,
                          fontWeight: FontWeight.w800,
                          color: DanColors.brand)),
                ),
                SizedBox(width: 10),
                SizedBox(
                  width: 118,
                  child: Text(kvDateTime(kvs(r['created_at'])),
                      style: TextStyle(fontSize: 12, color: DanColors.muted)),
                ),
                Expanded(
                  child: Text(kvs(r['warehouse_name']),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                          fontSize: 12.5, fontWeight: FontWeight.w600)),
                ),
                if (isTransfer)
                  Expanded(
                    child: Text(kvs(r['to_warehouse_name']),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                            fontSize: 12.5, fontWeight: FontWeight.w600)),
                  ),
                SizedBox(
                  width: 66,
                  child: Text('$lineCount',
                      textAlign: TextAlign.right,
                      style: TextStyle(fontSize: 12.5)),
                ),
                SizedBox(
                  width: 104,
                  child: Text(totalValue > 0 ? Fmt.money(totalValue) : '—',
                      textAlign: TextAlign.right,
                      style: TextStyle(
                          fontSize: 12.5, fontWeight: FontWeight.w700)),
                ),
                SizedBox(width: 12),
                SizedBox(
                  width: 110,
                  child: Text(
                      kvs(r['created_by']).isEmpty ? '—' : kvs(r['created_by']),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(fontSize: 12, color: DanColors.muted)),
                ),
                SizedBox(
                  width: 22,
                  child: Icon(expanded ? Icons.expand_less : Icons.expand_more,
                      size: 18, color: DanColors.faint),
                ),
              ],
            ),
          ),
        ),
        if (expanded) _detailPanel(),
      ],
    );
  }

  Widget _detailPanel() {
    final d = _detail;
    if (_detailLoading || d == null) {
      return Padding(
        padding: EdgeInsets.all(18),
        child: Center(
            child: SizedBox(
                width: 22,
                height: 22,
                child: CircularProgressIndicator(strokeWidth: 2))),
      );
    }
    final lines = kvMapList(d['lines']);
    final isTransfer = widget.docType == WhDocType.transfer;
    // Chuyển hàng: chỉ hiện dòng xuất (qty âm) — dòng nhận là bản sao ở kho đích.
    final visible = isTransfer
        ? lines.where((l) => kvn(l['qty']) < 0).toList()
        : lines;
    return Container(
      width: double.infinity,
      color: DanColors.surface,
      padding: EdgeInsets.fromLTRB(24, 4, 24, 14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (kvs(d['note']).isNotEmpty || kvs(d['reason']).isNotEmpty)
            Padding(
              padding: EdgeInsets.only(bottom: 8),
              child: Text(
                  kvs(d['note']).isEmpty ? kvs(d['reason']) : kvs(d['note']),
                  style: TextStyle(fontSize: 12.5, color: DanColors.muted)),
            ),
          Container(
            decoration: BoxDecoration(
              border: Border.all(color: DanColors.border),
              borderRadius: BorderRadius.circular(DanRadius.sm),
            ),
            child: Column(
              children: [
                Container(
                  color: DanColors.surface2,
                  padding: EdgeInsets.symmetric(horizontal: 12, vertical: 7),
                  child: Row(children: [
                    kvHeaderCell(t('Tên hàng'), flex: 1),
                    kvHeaderCell(t('Lô'), width: 100),
                    kvHeaderCell('HSD', width: 92),
                    kvHeaderCell(t('Số lượng'),
                        width: 84, align: TextAlign.right),
                    kvHeaderCell(t('Giá vốn'),
                        width: 96, align: TextAlign.right),
                  ]),
                ),
                for (final l in visible)
                  Container(
                    padding: EdgeInsets.symmetric(horizontal: 12, vertical: 7),
                    decoration: BoxDecoration(
                        border:
                            Border(top: BorderSide(color: DanColors.border))),
                    child: Row(
                      children: [
                        Expanded(
                          child: Text(kvs(l['item_name']),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: TextStyle(fontSize: 12.5)),
                        ),
                        SizedBox(
                            width: 100,
                            child: Text(
                                kvs(l['lot_no']).isEmpty
                                    ? '—'
                                    : kvs(l['lot_no']),
                                style: TextStyle(
                                    fontSize: 11.5, color: DanColors.muted))),
                        SizedBox(
                            width: 92,
                            child: Text(
                                kvs(l['expiry_date']).isEmpty
                                    ? '—'
                                    : kvShortDate(kvs(l['expiry_date'])),
                                style: TextStyle(
                                    fontSize: 11.5, color: DanColors.muted))),
                        SizedBox(
                            width: 84,
                            child: Text(Fmt.int0(kvn(l['qty']).abs()),
                                textAlign: TextAlign.right,
                                style: TextStyle(
                                    fontSize: 12,
                                    fontWeight: FontWeight.w700))),
                        SizedBox(
                            width: 96,
                            child: Text(
                                kvn(l['unit_cost']) > 0
                                    ? Fmt.money(kvn(l['unit_cost']))
                                    : '—',
                                textAlign: TextAlign.right,
                                style: TextStyle(fontSize: 12))),
                      ],
                    ),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// Form tạo phiếu Chuyển hàng / Xuất dùng nội bộ.
class WarehouseDocFormPage extends StatefulWidget {
  final WhDocType docType;
  final List<Map<String, dynamic>> warehouses;
  final String? initialWarehouseId;
  const WarehouseDocFormPage(
      {super.key,
      required this.docType,
      required this.warehouses,
      this.initialWarehouseId});

  @override
  State<WarehouseDocFormPage> createState() => _WarehouseDocFormPageState();
}

class _WarehouseDocFormPageState extends State<WarehouseDocFormPage> {
  String? _fromId;
  String? _toId;
  List<Map<String, dynamic>> _items = [];
  final List<KvDocLine> _lines = [];
  final _note = TextEditingController();
  bool _loadingItems = false;
  bool _busy = false;
  // "Ảnh" trạng thái sau khi mở form — thoát mà khác ảnh thì hỏi xác nhận.
  String _baseline = '';

  bool get _isTransfer => widget.docType == WhDocType.transfer;

  String _stateSig() => [
        _fromId ?? '',
        _toId ?? '',
        _note.text.trim(),
        for (final l in _lines) '${l.id}|${l.qty.text}|${l.lotNo.text}',
      ].join('');

  bool get _dirty => _stateSig() != _baseline;

  @override
  void initState() {
    super.initState();
    if (widget.warehouses.isNotEmpty) {
      final wanted = kvs(widget.initialWarehouseId);
      _fromId = widget.warehouses.any((w) => kvs(w['id']) == wanted)
          ? wanted
          : kvs(widget.warehouses.first['id']);
      if (_isTransfer && widget.warehouses.length > 1) {
        // Kho nhận mặc định = kho đầu tiên KHÁC kho xuất.
        _toId = kvs(widget.warehouses
            .firstWhere((w) => kvs(w['id']) != _fromId)['id']);
      }
    }
    _loadItems();
    _baseline = _stateSig();
  }

  /// Chặn thoát khi phiếu đang nhập dở — xác nhận rồi mới bỏ.
  Future<void> _confirmExit() async {
    if (_busy) return;
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
        content: Text(t('Phiếu đang nhập dở sẽ MẤT nếu thoát bây giờ.')),
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
    _note.dispose();
    for (final l in _lines) {
      l.dispose();
    }
    super.dispose();
  }

  bool get _isRetailWh {
    final wh =
        widget.warehouses.where((w) => kvs(w['id']) == _fromId).toList();
    return wh.isEmpty || kvs(wh.first['type']) == 'retail';
  }

  Future<void> _loadItems() async {
    if (_fromId == null) return;
    setState(() => _loadingItems = true);
    try {
      final api = context.read<ApiService>();
      final rows = _isRetailWh
          ? await api.getWarehouseSkus(_fromId!)
          : await api.getInventory(warehouseId: _fromId);
      if (!mounted) return;
      setState(() {
        _items = kvMapList(rows);
        _loadingItems = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() => _loadingItems = false);
    }
  }

  void _toast(String m, {bool error = false}) =>
      appToast(context, m, isError: error);

  num get _totalQty => _lines.fold<num>(0, (s, l) => s + l.qtyNum);

  /// "Chọn file dữ liệu" — nạp dòng từ .xlsx theo MauFileXuatHang
  /// (Mã hàng | Số lượng | Lô).
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
          _lines.add(KvDocLine(item, _isRetailWh ? 'sku' : 'inventory',
              initialQty: qty <= 0 ? 1 : qty, lot: cell(2)));
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

  Future<void> _save() async {
    if (_fromId == null) {
      _toast(t('Chọn kho'), error: true);
      return;
    }
    if (_isTransfer && (_toId == null || _toId == _fromId)) {
      _toast(t('Kho đích phải khác kho nguồn'), error: true);
      return;
    }
    final lines = _lines
        .where((l) => l.qtyNum > 0)
        .map((l) => {
              'stock_type': l.stockType,
              'item_id': l.id,
              'qty': l.qtyNum,
            })
        .toList();
    if (lines.isEmpty) {
      _toast(t('Thêm ít nhất một dòng hàng'), error: true);
      return;
    }
    setState(() => _busy = true);
    try {
      final api = context.read<ApiService>();
      if (_isTransfer) {
        await api.transferStock({
          'from_warehouse_id': _fromId,
          'to_warehouse_id': _toId,
          'note': _note.text.trim(),
          'lines': lines,
        });
      } else {
        await api.issueInternalUse({
          'warehouse_id': _fromId,
          'note': _note.text.trim(),
          'reason': _note.text.trim().isEmpty
              ? 'internal_use'
              : _note.text.trim(),
          'lines': lines,
        });
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
    // Chặn back hệ thống/nút ← khi phiếu nhập dở — pop() sau lưu vẫn thoát thẳng.
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
                  Text(widget.docType.title,
                      style:
                          TextStyle(fontSize: 17, fontWeight: FontWeight.w900)),
                  SizedBox(width: 18),
                  SizedBox(
                    width: 220,
                    child: DropdownButtonFormField<String>(
                      initialValue: _fromId,
                      isExpanded: true,
                      decoration: InputDecoration(
                          labelText:
                              _isTransfer ? t('Từ kho') : t('Kho xuất'),
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
                              setState(() => _fromId = v);
                              _loadItems();
                            },
                    ),
                  ),
                  if (_isTransfer) ...[
                    Padding(
                      padding: EdgeInsets.symmetric(horizontal: 8),
                      child: Icon(Icons.arrow_forward,
                          size: 18, color: DanColors.muted),
                    ),
                    SizedBox(
                      width: 220,
                      child: DropdownButtonFormField<String>(
                        initialValue: _toId,
                        isExpanded: true,
                        decoration: InputDecoration(
                            labelText: t('Tới kho'),
                            isDense: true,
                            contentPadding: EdgeInsets.symmetric(
                                horizontal: 10, vertical: 8)),
                        items: [
                          for (final w in widget.warehouses)
                            if (kvs(w['id']) != _fromId)
                              DropdownMenuItem(
                                  value: kvs(w['id']),
                                  child: Text(kvs(w['name']),
                                      overflow: TextOverflow.ellipsis)),
                        ],
                        onChanged: (v) => setState(() => _toId = v),
                      ),
                    ),
                  ],
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
                                  onPick: (item) => setState(() => _lines.add(
                                      KvDocLine(
                                          item,
                                          _isRetailWh ? 'sku' : 'inventory',
                                          initialQty: 1))),
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
                          kvHeaderCell(t('ĐVT'), width: 56),
                          kvHeaderCell(t('Tồn kho'),
                              width: 76, align: TextAlign.right),
                          SizedBox(width: 10),
                          kvHeaderCell(
                              _isTransfer ? t('SL chuyển') : t('SL xuất'),
                              width: 90),
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
                                      templateKind: KvTemplateKind.issue,
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
                    codeHint: widget.docType.codeLabel,
                    statusLabel: '',
                    noteCtrl: _note,
                    busy: _busy,
                    onComplete: _save,
                    completeLabel: _isTransfer
                        ? t('Chuyển hàng')
                        : t('Hoàn thành'),
                    children: [
                      KvMetaTotalRow(
                          label: t('Số mặt hàng'), value: '${_lines.length}'),
                      KvMetaTotalRow(
                          label: t('Tổng số lượng'),
                          value: Fmt.int0(_totalQty)),
                      SizedBox(height: 2),
                      Text(
                          _isTransfer
                              ? t('Hàng chuyển đi giữ nguyên lô/HSD ở kho đích.')
                              : t('Xuất cho cửa hàng tự dùng — trừ tồn theo lô gần hết hạn trước (FEFO).'),
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
    final over = l.qtyNum > l.stock;
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
            width: 76,
            child: Tooltip(
              message: over ? t('Vượt tồn kho') : '',
              child: Text(Fmt.int0(l.stock),
                  textAlign: TextAlign.right,
                  style: TextStyle(
                      fontSize: 12.5,
                      fontWeight: over ? FontWeight.w800 : FontWeight.w400,
                      color: over ? DanColors.late : DanColors.muted)),
            ),
          ),
          SizedBox(width: 10),
          KvCellInput(
              controller: l.qty, width: 90, onChanged: (_) => setState(() {})),
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
