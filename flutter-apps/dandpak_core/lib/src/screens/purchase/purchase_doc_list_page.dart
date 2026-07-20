import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../services/api_service.dart';
import '../../ui/app_theme.dart';
import '../../ui/format.dart';
import '../../utils/translation.dart';
import '../management/management_widgets.dart';
import '../warehouse/kv_excel.dart';
import '../warehouse/kv_shared.dart';
import 'purchase_doc_form_page.dart';

/// Danh sách phiếu MUA HÀNG kiểu KiotViet, dùng chung cho 2 nghiệp vụ:
///   - Nhập hàng (PurchaseOrder):  Phiếu tạm / Đã xác nhận / Đã nhập hàng / Đã hủy
///   - Trả hàng nhập (PurchaseReturns): Phiếu tạm / Đã trả hàng / Đã hủy
/// Bấm dòng để mở chi tiết ngay dưới dòng (giống KiotViet).
class PurchaseDocListPage extends StatefulWidget {
  final PurchaseDocMode mode;
  final List<Map<String, dynamic>> warehouses;

  /// Kho đang chọn ở thanh trên module Kho — mặc định cho phiếu mới.
  final String? initialWarehouseId;
  const PurchaseDocListPage(
      {super.key,
      required this.mode,
      required this.warehouses,
      this.initialWarehouseId});

  @override
  State<PurchaseDocListPage> createState() => _PurchaseDocListPageState();
}

class _PurchaseDocListPageState extends State<PurchaseDocListPage> {
  bool get _isReturn => widget.mode == PurchaseDocMode.purchaseReturn;

  List<Map<String, dynamic>> _rows = [];
  Map<String, dynamic> _summary = {};
  bool _loading = true;
  String? _error;
  bool _showFilters = true;
  String _search = '';
  late final Set<String> _statuses = _isReturn
      ? {'draft', 'returned'}
      : {'draft', 'confirmed', 'received'};
  // Lọc thời gian (KiotViet: Tháng này / Tùy chỉnh) + người tạo.
  String _timeFilter = 'month'; // today | 7d | month | all | custom
  DateTimeRange? _customRange;
  String _creatorFilter = ''; // '' = tất cả
  String? _expandedId;

  Map<String, String> get _statusLabels => _isReturn
      ? {
          'draft': t('Phiếu tạm'),
          'returned': t('Đã trả hàng'),
          'cancelled': t('Đã hủy'),
        }
      : {
          'draft': t('Phiếu tạm'),
          'confirmed': t('Đã xác nhận'),
          'received': t('Đã nhập hàng'),
          'cancelled': t('Đã hủy'),
        };

  Color _statusColor(String s) {
    switch (s) {
      case 'received':
      case 'returned':
        return DanColors.done;
      case 'confirmed':
        return DanColors.brand;
      case 'cancelled':
        return DanColors.late;
      default:
        return DanColors.muted;
    }
  }

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
      final api = context.read<ApiService>();
      List<Map<String, dynamic>> rows;
      if (_isReturn) {
        rows = kvMapList(await api.getPurchaseReturns(q: _search.trim()));
        _summary = {};
      } else {
        final res = await api.getPurchaseOrders(q: _search.trim());
        rows = kvMapList(res['orders']);
        _summary =
            res['summary'] is Map ? Map<String, dynamic>.from(res['summary']) : {};
      }
      if (!mounted) return;
      setState(() {
        _rows = rows;
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

  bool _inTimeRange(Map<String, dynamic> r) {
    if (_timeFilter == 'all') return true;
    final ts = DateTime.tryParse(kvs(r['created_at']))?.toLocal();
    if (ts == null) return true;
    final now = DateTime.now();
    final today = DateTime(now.year, now.month, now.day);
    switch (_timeFilter) {
      case 'today':
        return !ts.isBefore(today);
      case '7d':
        return !ts.isBefore(today.subtract(Duration(days: 6)));
      case 'custom':
        final rg = _customRange;
        if (rg == null) return true;
        return !ts.isBefore(rg.start) &&
            ts.isBefore(rg.end.add(Duration(days: 1)));
      default: // month
        return ts.year == now.year && ts.month == now.month;
    }
  }

  List<String> get _creators => {
        for (final r in _rows)
          if (kvs(r['created_by']).isNotEmpty) kvs(r['created_by'])
      }.toList()
        ..sort();

  List<Map<String, dynamic>> get _filtered => _rows
      .where((r) =>
          _statuses.contains(kvs(r['status'])) &&
          _inTimeRange(r) &&
          (_creatorFilter.isEmpty || kvs(r['created_by']) == _creatorFilter))
      .toList();

  void _toast(String m, {bool error = false}) =>
      appToast(context, m, isError: error);

  Future<void> _openForm({Map<String, dynamic>? existing, PurchaseDocMode? mode}) async {
    final changed = await Navigator.of(context).push<bool>(MaterialPageRoute(
        builder: (_) => PurchaseDocFormPage(
              mode: mode ?? widget.mode,
              warehouses: widget.warehouses,
              initialWarehouseId: widget.initialWarehouseId,
              existing: existing,
            )));
    if (changed == true) {
      _expandedId = null;
      _load();
    }
  }

  Future<void> _run(Future<void> Function() action, String okMsg) async {
    try {
      await action();
      _toast(okMsg);
      _expandedId = null;
      _load();
    } catch (e) {
      _toast(e.toString().replaceFirst('Exception: ', ''), error: true);
    }
  }

  /// Tạo phiếu TRẢ HÀNG NHẬP từ một phiếu nhập đã hoàn thành: prefill NCC +
  /// các dòng đã nhận (đúng kiểu nút "Trả hàng nhập" trên phiếu KiotViet).
  void _returnFromPO(Map<String, dynamic> po) {
    final lines = kvMapList(po['lines'])
        .where((l) => kvn(l['received_qty']) > 0 && kvs(l['item_type']) != 'adhoc')
        .map((l) => {
              'item_type': l['item_type'],
              'item_id': l['item_id'],
              'name': l['name'],
              'unit': l['unit'],
              'qty': l['received_qty'],
              'unit_cost': l['unit_cost'],
            })
        .toList();
    if (lines.isEmpty) {
      _toast(t('Phiếu này chưa có dòng hàng đã nhận để trả'), error: true);
      return;
    }
    _openForm(mode: PurchaseDocMode.purchaseReturn, existing: {
      'supplier_id': po['supplier_id'],
      'warehouse_id': po['warehouse_id'],
      'note': '${t('Trả hàng từ phiếu')} ${kvs(po['code'])}',
      'lines': lines,
    });
  }

  Future<void> _pay(Map<String, dynamic> po) async {
    final amount = TextEditingController(text: kvNumText(kvn(po['amount_due'])));
    final note = TextEditingController();
    String source = 'direct';
    String method = 'cash';
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setLocal) => AlertDialog(
          backgroundColor: DanColors.surface,
          title: Text(t('Thanh toán NCC'),
              style: TextStyle(fontWeight: FontWeight.w900, fontSize: 18)),
          content: SizedBox(
            width: 380,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                TextField(
                  controller: amount,
                  autofocus: true,
                  keyboardType: TextInputType.number,
                  decoration: InputDecoration(labelText: t('Số tiền')),
                ),
                SizedBox(height: 12),
                DropdownButtonFormField<String>(
                  initialValue: source,
                  decoration: InputDecoration(labelText: t('Nguồn tiền')),
                  items: [
                    DropdownMenuItem(
                        value: 'direct',
                        child: Text(t('Chi trực tiếp (kế toán)'))),
                    DropdownMenuItem(
                        value: 'drawer', child: Text(t('Chi từ két tiền'))),
                  ],
                  onChanged: (v) => setLocal(() => source = v ?? 'direct'),
                ),
                if (source == 'direct') ...[
                  SizedBox(height: 12),
                  DropdownButtonFormField<String>(
                    initialValue: method,
                    decoration: InputDecoration(labelText: t('Hình thức')),
                    items: [
                      DropdownMenuItem(
                          value: 'cash', child: Text(t('Tiền mặt'))),
                      DropdownMenuItem(
                          value: 'transfer', child: Text(t('Chuyển khoản'))),
                    ],
                    onChanged: (v) => setLocal(() => method = v ?? 'cash'),
                  ),
                ],
                SizedBox(height: 12),
                TextField(
                    controller: note,
                    decoration: InputDecoration(labelText: t('Ghi chú'))),
              ],
            ),
          ),
          actions: [
            TextButton(
                onPressed: () => Navigator.of(ctx).pop(false),
                child: Text(t('Hủy'))),
            FilledButton(
                onPressed: () => Navigator.of(ctx).pop(true),
                child: Text(t('Ghi thanh toán'))),
          ],
        ),
      ),
    );
    final amt = kvParseNum(amount.text) ?? 0;
    final noteTxt = note.text.trim();
    amount.dispose();
    note.dispose();
    if (ok != true || amt <= 0) return;
    await _run(
        () => context.read<ApiService>().payPurchase(kvs(po['id']), {
              'amount': amt,
              'source': source,
              'method': source == 'direct' ? method : 'cash',
              'note': noteTxt,
            }),
        t('Đã ghi thanh toán'));
  }

  @override
  Widget build(BuildContext context) {
    if (_loading && _rows.isEmpty) {
      return Center(child: CircularProgressIndicator());
    }
    if (_error != null && _rows.isEmpty) {
      return Padding(
        padding: EdgeInsets.all(40),
        child: InlineMessage(t('Không tải được dữ liệu ($_error)'),
            error: true, onRetry: _load),
      );
    }
    final list = _filtered;
    return Row(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (_showFilters) _sidebar(),
        Expanded(
          child: Column(
            children: [
              KvToolbar(
                hint: _isReturn
                    ? t('Theo mã phiếu trả')
                    : t('Theo mã phiếu nhập'),
                onSearch: (v) {
                  _search = v;
                  _load();
                },
                showFilterToggle: true,
                filtersShown: _showFilters,
                onToggleFilters: () =>
                    setState(() => _showFilters = !_showFilters),
                actions: [
                  OutlinedButton.icon(
                    onPressed: _exportList,
                    icon: Icon(Icons.file_download_outlined, size: 18),
                    label: Text(t('Xuất file')),
                    style: OutlinedButton.styleFrom(minimumSize: Size(0, 40)),
                  ),
                  SizedBox(width: 8),
                  FilledButton.icon(
                    onPressed: () => _openForm(),
                    icon: Icon(Icons.add, size: 18),
                    label:
                        Text(_isReturn ? t('Trả hàng nhập') : t('Nhập hàng')),
                    style: FilledButton.styleFrom(minimumSize: Size(0, 40)),
                  ),
                ],
              ),
              if (!_isReturn) _debtBanner(),
              Divider(height: 1, color: DanColors.border),
              KvTableHeader(cells: [
                kvHeaderCell(
                    _isReturn ? t('Mã trả hàng nhập') : t('Mã nhập hàng'),
                    width: 122),
                SizedBox(width: 10),
                kvHeaderCell(t('Thời gian'), width: 118),
                kvHeaderCell(t('Nhà cung cấp'), flex: 1),
                kvHeaderCell(t('Tổng tiền'), width: 104, align: TextAlign.right),
                kvHeaderCell(
                    _isReturn ? t('VAT hoàn lại') : t('VAT nhập hàng'),
                    width: 96,
                    align: TextAlign.right),
                SizedBox(width: 12),
                kvHeaderCell(t('Trạng thái'), width: 128),
                SizedBox(width: 22),
              ]),
              Divider(height: 1, color: DanColors.border),
              Expanded(
                child: list.isEmpty
                    ? KvEmptyState(
                        message: t('Không tìm thấy kết quả'),
                        hint: _isReturn
                            ? t('Bấm "+ Trả hàng nhập" để tạo phiếu trả')
                            : t('Bấm "+ Nhập hàng" để tạo phiếu nhập'))
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
          ),
        ),
      ],
    );
  }

  Widget _debtBanner() {
    final totalDue = kvn(_summary['total_due']);
    if (totalDue <= 0) return SizedBox.shrink();
    final suppliers = kvMapList(_summary['suppliers']).take(3).toList();
    return Container(
      width: double.infinity,
      color: Color(0xFFFFF7ED),
      padding: EdgeInsets.symmetric(horizontal: 14, vertical: 8),
      child: Wrap(
        crossAxisAlignment: WrapCrossAlignment.center,
        spacing: 14,
        runSpacing: 4,
        children: [
          Text('${t('Công nợ phải trả')}: ${Fmt.money(totalDue)}',
              style: TextStyle(
                  fontWeight: FontWeight.w800,
                  fontSize: 12.5,
                  color: Color(0xFFB45309))),
          for (final sup in suppliers)
            Text(
                '${kvs(sup['supplier_name'])}: ${Fmt.money(kvn(sup['due']))}',
                style: TextStyle(fontSize: 11.5, color: DanColors.muted)),
        ],
      ),
    );
  }

  Widget _sidebar() {
    final timeOptions = [
      ['today', t('Hôm nay')],
      ['7d', t('7 ngày qua')],
      ['month', t('Tháng này')],
      ['all', t('Tất cả')],
      ['custom', t('Tùy chỉnh…')],
    ];
    return KvSidebar(
      children: [
        KvFilterGroup(
          title: t('Trạng thái'),
          child: Column(
            children: [
              for (final s in _statusLabels.keys)
                KvCheckOption(
                  label: _statusLabels[s]!,
                  checked: _statuses.contains(s),
                  onChanged: (v) => setState(() {
                    if (v) {
                      _statuses.add(s);
                    } else if (_statuses.length > 1) {
                      _statuses.remove(s);
                    }
                  }),
                ),
            ],
          ),
        ),
        KvFilterGroup(
          title: t('Thời gian'),
          child: Column(
            children: [
              for (final o in timeOptions)
                KvRadioOption(
                  label: o[0] == 'custom' && _customRange != null
                      ? '${kvShortDate(_customRange!.start.toIso8601String())} → ${kvShortDate(_customRange!.end.toIso8601String())}'
                      : o[1],
                  selected: _timeFilter == o[0],
                  onTap: () async {
                    if (o[0] == 'custom') {
                      final picked = await showDateRangePicker(
                        context: context,
                        firstDate: DateTime(2024),
                        lastDate: DateTime.now().add(Duration(days: 1)),
                        initialDateRange: _customRange,
                      );
                      if (picked == null) return;
                      setState(() {
                        _customRange = picked;
                        _timeFilter = 'custom';
                      });
                      return;
                    }
                    setState(() => _timeFilter = o[0]);
                  },
                ),
            ],
          ),
        ),
        KvFilterGroup(
          title: t('Người tạo'),
          child: Column(
            children: [
              KvRadioOption(
                label: t('Tất cả'),
                selected: _creatorFilter.isEmpty,
                onTap: () => setState(() => _creatorFilter = ''),
              ),
              for (final c in _creators)
                KvRadioOption(
                  label: c,
                  selected: _creatorFilter == c,
                  onTap: () => setState(() => _creatorFilter = c),
                ),
            ],
          ),
        ),
      ],
    );
  }

  /// "Xuất file" — xuất danh sách đang lọc ra .xlsx.
  Future<void> _exportList() async {
    final list = _filtered;
    if (list.isEmpty) {
      _toast(t('Không có dữ liệu để xuất'), error: true);
      return;
    }
    final ok = await kvExportXlsx(
      context,
      fileName: _isReturn ? 'TraHangNhap.xlsx' : 'NhapHang.xlsx',
      header: [
        _isReturn ? 'Mã trả hàng nhập' : 'Mã nhập hàng',
        'Thời gian',
        'Nhà cung cấp',
        'Tổng tiền',
        _isReturn ? 'VAT hoàn lại' : 'VAT nhập hàng',
        'Trạng thái',
        'Người tạo',
        'Ghi chú',
      ],
      rows: [
        for (final r in list)
          [
            kvs(r['code']),
            kvDateTime(kvs(r['created_at'])),
            kvs(r['supplier_name']),
            kvn(r['total']).toString(),
            kvn(r[_isReturn ? 'vat_refund' : 'vat_amount']).toString(),
            _statusLabels[kvs(r['status'])] ?? kvs(r['status']),
            kvs(r['created_by']),
            kvs(r['note']),
          ],
      ],
    );
    if (ok) _toast(t('Đã xuất ${list.length} phiếu'));
  }

  Widget _row(Map<String, dynamic> r) {
    final id = kvs(r['id']);
    final status = kvs(r['status']);
    final expanded = _expandedId == id;
    final vat = kvn(r[_isReturn ? 'vat_refund' : 'vat_amount']);
    return Column(
      children: [
        InkWell(
          onTap: () => setState(() => _expandedId = expanded ? null : id),
          child: Container(
            color: expanded ? DanColors.brandDim : DanColors.surface,
            padding: EdgeInsets.symmetric(horizontal: 12, vertical: 10),
            child: Row(
              children: [
                SizedBox(
                  width: 122,
                  child: Text(kvs(r['code']).isEmpty ? id : kvs(r['code']),
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
                  child: Text(
                      kvs(r['supplier_name']).isEmpty
                          ? '— ${t('Mua chợ')}'
                          : kvs(r['supplier_name']),
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                          fontSize: 12.5,
                          fontWeight: FontWeight.w600,
                          height: 1.2)),
                ),
                SizedBox(
                  width: 104,
                  child: Text(Fmt.money(kvn(r['total'])),
                      textAlign: TextAlign.right,
                      style: TextStyle(
                          fontSize: 12.5, fontWeight: FontWeight.w800)),
                ),
                SizedBox(
                  width: 96,
                  child: Text(vat > 0 ? Fmt.money(vat) : '---',
                      textAlign: TextAlign.right,
                      style: TextStyle(
                          fontSize: 12,
                          color:
                              vat > 0 ? DanColors.text : DanColors.faint)),
                ),
                SizedBox(width: 12),
                SizedBox(
                  width: 128,
                  child: Align(
                    alignment: Alignment.centerLeft,
                    child: KvStatusChip(
                        label: _statusLabels[status] ?? status,
                        color: _statusColor(status)),
                  ),
                ),
                SizedBox(
                  width: 22,
                  child: Icon(
                      expanded ? Icons.expand_less : Icons.expand_more,
                      size: 18,
                      color: DanColors.faint),
                ),
              ],
            ),
          ),
        ),
        if (expanded) _detailPanel(r),
      ],
    );
  }

  Widget _detailPanel(Map<String, dynamic> r) {
    final status = kvs(r['status']);
    final lines = kvMapList(r['lines']);
    final due = kvn(r['amount_due']);
    return Container(
      width: double.infinity,
      color: DanColors.surface,
      padding: EdgeInsets.fromLTRB(24, 6, 24, 14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Text(kvs(r['code']),
                  style: TextStyle(
                      fontFamily: 'JetBrains Mono',
                      fontSize: 15,
                      fontWeight: FontWeight.w900)),
              SizedBox(width: 8),
              KvStatusChip(
                  label: _statusLabels[status] ?? status,
                  color: _statusColor(status)),
              SizedBox(width: 14),
              if (kvs(r['created_by']).isNotEmpty)
                Text('${t('Người tạo')}: ${kvs(r['created_by'])}',
                    style: TextStyle(fontSize: 12.5, color: DanColors.muted)),
            ],
          ),
          if (kvs(r['note']).isNotEmpty) ...[
            SizedBox(height: 4),
            Text(kvs(r['note']),
                style: TextStyle(fontSize: 12.5, color: DanColors.muted)),
          ],
          SizedBox(height: 10),
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
                    kvHeaderCell(t('Mã hàng'), width: 130),
                    SizedBox(width: 8),
                    kvHeaderCell(t('Tên hàng'), flex: 1),
                    kvHeaderCell(t('Số lượng'),
                        width: 80, align: TextAlign.right),
                    if (!_isReturn)
                      kvHeaderCell(t('Đã nhận'),
                          width: 80, align: TextAlign.right),
                    kvHeaderCell(t('Đơn giá'),
                        width: 96, align: TextAlign.right),
                    kvHeaderCell(t('Thành tiền'),
                        width: 104, align: TextAlign.right),
                  ]),
                ),
                for (final l in lines)
                  Container(
                    padding: EdgeInsets.symmetric(horizontal: 12, vertical: 7),
                    decoration: BoxDecoration(
                        border:
                            Border(top: BorderSide(color: DanColors.border))),
                    child: Row(
                      children: [
                        SizedBox(
                          width: 130,
                          child: Text(kvs(l['item_id']),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: TextStyle(
                                  fontFamily: 'JetBrains Mono',
                                  fontSize: 11.5,
                                  color: DanColors.brand)),
                        ),
                        SizedBox(width: 8),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(kvs(l['name']),
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  style: TextStyle(fontSize: 12.5)),
                              if (kvs(l['lot_no']).isNotEmpty ||
                                  kvs(l['expiry_date']).isNotEmpty)
                                Container(
                                  margin: EdgeInsets.only(top: 2),
                                  padding: EdgeInsets.symmetric(
                                      horizontal: 6, vertical: 2),
                                  decoration: BoxDecoration(
                                      color: DanColors.surface2,
                                      borderRadius: BorderRadius.circular(5)),
                                  child: Text(
                                      '${kvs(l['lot_no'])}${kvs(l['expiry_date']).isNotEmpty ? ' - ${kvShortDate(kvs(l['expiry_date']))}' : ''} - SL: ${Fmt.int0(kvn(l['qty']))}',
                                      style: TextStyle(
                                          fontSize: 10.5,
                                          color: DanColors.muted)),
                                ),
                            ],
                          ),
                        ),
                        SizedBox(
                            width: 80,
                            child: Text(Fmt.int0(kvn(l['qty'])),
                                textAlign: TextAlign.right,
                                style: TextStyle(
                                    fontSize: 12,
                                    fontWeight: FontWeight.w700))),
                        if (!_isReturn)
                          SizedBox(
                              width: 80,
                              child: Text(Fmt.int0(kvn(l['received_qty'])),
                                  textAlign: TextAlign.right,
                                  style: TextStyle(
                                      fontSize: 12, color: DanColors.muted))),
                        SizedBox(
                            width: 96,
                            child: Text(Fmt.money(kvn(l['unit_cost'])),
                                textAlign: TextAlign.right,
                                style: TextStyle(fontSize: 12))),
                        SizedBox(
                            width: 104,
                            child: Text(Fmt.money(kvn(l['line_total'])),
                                textAlign: TextAlign.right,
                                style: TextStyle(
                                    fontSize: 12,
                                    fontWeight: FontWeight.w800))),
                      ],
                    ),
                  ),
              ],
            ),
          ),
          SizedBox(height: 10),
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(child: _actions(r, status, due)),
              SizedBox(width: 20),
              SizedBox(
                width: 280,
                child: Column(
                  children: [
                    KvMetaTotalRow(
                        label: t('Tổng tiền hàng'),
                        value: Fmt.money(kvn(r['subtotal']))),
                    KvMetaTotalRow(
                        label: _isReturn
                            ? t('VAT hoàn lại')
                            : t('VAT nhập hàng'),
                        value: Fmt.money(
                            kvn(r[_isReturn ? 'vat_refund' : 'vat_amount']))),
                    KvMetaTotalRow(
                        label: t('Tổng cộng'),
                        value: Fmt.money(kvn(r['total'])),
                        big: true),
                    if (!_isReturn) ...[
                      KvMetaTotalRow(
                          label: t('Đã trả NCC'),
                          value: Fmt.money(kvn(r['amount_paid']))),
                      if (due > 0)
                        KvMetaTotalRow(
                            label: t('Còn nợ'),
                            value: Fmt.money(due),
                            accent: Color(0xFFB45309)),
                    ] else if (status == 'returned')
                      KvMetaTotalRow(
                          label: t('NCC đã hoàn trả'),
                          value: Fmt.money(kvn(r['refund_received']))),
                  ],
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _actions(Map<String, dynamic> r, String status, num due) {
    final api = context.read<ApiService>();
    final id = kvs(r['id']);
    final buttons = <Widget>[];
    if (status == 'draft') {
      buttons.addAll([
        OutlinedButton.icon(
          onPressed: () => _run(
              () => _isReturn
                  ? api.deletePurchaseReturn(id)
                  : api.deletePurchase(id),
              t('Đã xóa phiếu')),
          icon: Icon(Icons.delete_outline, size: 17),
          label: Text(t('Xóa')),
          style: OutlinedButton.styleFrom(foregroundColor: DanColors.late),
        ),
        OutlinedButton.icon(
          onPressed: () => _openForm(existing: r),
          icon: Icon(Icons.open_in_new, size: 17),
          label: Text(t('Mở phiếu')),
        ),
        FilledButton.icon(
          onPressed: () => _run(
              () async => _isReturn
                  ? await api.completePurchaseReturn(id)
                  : await api.completePurchase(id),
              _isReturn ? t('Đã trả hàng NCC') : t('Đã nhập hàng vào kho')),
          icon: Icon(Icons.check, size: 17),
          label: Text(t('Hoàn thành')),
        ),
      ]);
    } else if (!_isReturn && status == 'confirmed') {
      buttons.addAll([
        OutlinedButton(
          onPressed: () =>
              _run(() => api.cancelPurchase(id), t('Đã hủy phiếu')),
          style: OutlinedButton.styleFrom(foregroundColor: DanColors.late),
          child: Text(t('Hủy phiếu')),
        ),
        if (due > 0)
          OutlinedButton(
              onPressed: () => _pay(r), child: Text(t('Thanh toán'))),
        FilledButton.icon(
          onPressed: () => _run(() async => await api.completePurchase(id),
              t('Đã nhập hàng vào kho')),
          icon: Icon(Icons.check, size: 17),
          label: Text(t('Nhận đủ hàng')),
        ),
      ]);
    } else if (!_isReturn && status == 'received') {
      buttons.addAll([
        OutlinedButton.icon(
          onPressed: () => _returnFromPO(r),
          icon: Icon(Icons.keyboard_return, size: 17),
          label: Text(t('Trả hàng nhập')),
        ),
        if (due > 0)
          FilledButton(
              onPressed: () => _pay(r),
              child: Text(t('Thanh toán công nợ'))),
      ]);
    } else if (_isReturn && status == 'draft') {
      // đã xử lý ở nhánh draft chung phía trên
    }
    if (buttons.isEmpty) return SizedBox.shrink();
    return Wrap(spacing: 8, runSpacing: 8, children: buttons);
  }
}
