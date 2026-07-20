import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../services/api_service.dart';
import '../../ui/app_theme.dart';
import '../../ui/format.dart';
import '../../utils/translation.dart';
import '../management/management_widgets.dart';
import 'kv_shared.dart';
import 'stocktake_form_page.dart';

/// Kiểm kho (KiotViet StockTakes): danh sách phiếu kiểm — Phiếu tạm / Đã cân
/// bằng kho / Đã hủy; bấm dòng mở chi tiết; tạo phiếu mới bằng nút "+ Kiểm kho".
class StocktakePage extends StatefulWidget {
  final List<Map<String, dynamic>> warehouses;

  /// Kho đang chọn ở thanh trên module Kho — làm mặc định khi tạo phiếu mới.
  final String? initialWarehouseId;
  const StocktakePage(
      {super.key, required this.warehouses, this.initialWarehouseId});

  @override
  State<StocktakePage> createState() => _StocktakePageState();
}

class _StocktakePageState extends State<StocktakePage> {
  List<Map<String, dynamic>> _rows = [];
  bool _loading = true;
  String? _error;
  bool _showFilters = true;
  String _search = '';
  String _whFilter = '';
  final Set<String> _statuses = {'draft', 'approved'};
  String? _expandedId;
  Map<String, dynamic>? _detail;
  bool _detailLoading = false;

  Map<String, String> get _statusLabels => {
        'draft': t('Phiếu tạm'),
        'approved': t('Đã cân bằng kho'),
        'cancelled': t('Đã hủy'),
      };

  Color _statusColor(String s) {
    switch (s) {
      case 'approved':
        return DanColors.done;
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
      final rows = await context.read<ApiService>().getStocktakes(
            status: _statuses.join(','),
            q: _search.trim(),
            warehouseId: _whFilter,
          );
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
      final d = await context.read<ApiService>().getStocktake(id);
      if (!mounted || _expandedId != id) return;
      setState(() {
        _detail = d;
        _detailLoading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() => _detailLoading = false);
      _toast(e.toString().replaceFirst('Exception: ', ''), error: true);
    }
  }

  void _toast(String m, {bool error = false}) =>
      appToast(context, m, isError: error);

  Future<void> _openForm({Map<String, dynamic>? existing}) async {
    final changed = await Navigator.of(context).push<bool>(MaterialPageRoute(
        builder: (_) => StocktakeFormPage(
            warehouses: widget.warehouses,
            initialWarehouseId: widget.initialWarehouseId,
            existing: existing)));
    if (changed == true) {
      _expandedId = null;
      _load();
    }
  }

  Future<void> _approve(String id) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: DanColors.surface,
        title: Text(t('Cân bằng kho'),
            style: TextStyle(fontWeight: FontWeight.w900, fontSize: 17)),
        content: Text(t(
            'Tồn kho sẽ được điều chỉnh theo số lượng thực tế trên phiếu. Thao tác này không hoàn tác được.')),
        actions: [
          TextButton(
              onPressed: () => Navigator.of(ctx).pop(false),
              child: Text(t('Hủy'))),
          FilledButton(
              onPressed: () => Navigator.of(ctx).pop(true),
              child: Text(t('Cân bằng kho'))),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await context.read<ApiService>().approveStocktake(id);
      _toast(t('Đã cân bằng kho'));
      _expandedId = null;
      _load();
    } catch (e) {
      _toast(e.toString().replaceFirst('Exception: ', ''), error: true);
    }
  }

  Future<void> _cancel(String id) async {
    try {
      await context.read<ApiService>().cancelStocktake(id);
      _toast(t('Đã hủy phiếu kiểm'));
      _expandedId = null;
      _load();
    } catch (e) {
      _toast(e.toString().replaceFirst('Exception: ', ''), error: true);
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
        child: InlineMessage(t('Không tải được phiếu kiểm kho ($_error)'),
            error: true, onRetry: _load),
      );
    }
    return Row(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (_showFilters) _sidebar(),
        Expanded(
          child: Column(
            children: [
              KvToolbar(
                hint: t('Theo mã phiếu kiểm'),
                onSearch: (v) {
                  _search = v;
                  _load();
                },
                showFilterToggle: true,
                filtersShown: _showFilters,
                onToggleFilters: () =>
                    setState(() => _showFilters = !_showFilters),
                actions: [
                  FilledButton.icon(
                    onPressed: () => _openForm(),
                    icon: Icon(Icons.add, size: 18),
                    label: Text(t('Kiểm kho')),
                    style: FilledButton.styleFrom(minimumSize: Size(0, 40)),
                  ),
                ],
              ),
              Divider(height: 1, color: DanColors.border),
              KvTableHeader(cells: [
                kvHeaderCell(t('Mã kiểm kho'), width: 116),
                SizedBox(width: 10),
                kvHeaderCell(t('Thời gian'), width: 118),
                kvHeaderCell(t('Ngày cân bằng'), width: 118),
                kvHeaderCell(t('SL thực tế'), width: 84, align: TextAlign.right),
                kvHeaderCell(t('Tổng chênh lệch'),
                    width: 108, align: TextAlign.right),
                kvHeaderCell(t('SL lệch tăng'),
                    width: 92, align: TextAlign.right),
                kvHeaderCell(t('SL lệch giảm'),
                    width: 92, align: TextAlign.right),
                SizedBox(width: 10),
                kvHeaderCell(t('Trạng thái'), flex: 1),
              ]),
              Divider(height: 1, color: DanColors.border),
              Expanded(
                child: _rows.isEmpty
                    ? KvEmptyState(
                        message: t('Không tìm thấy kết quả'),
                        hint: t('Bấm "+ Kiểm kho" để tạo phiếu kiểm mới'))
                    : RefreshIndicator(
                        onRefresh: _load,
                        child: ListView.separated(
                          itemCount: _rows.length,
                          separatorBuilder: (_, __) =>
                              Divider(height: 1, color: DanColors.border),
                          itemBuilder: (_, i) => _row(_rows[i]),
                        ),
                      ),
              ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _sidebar() {
    return KvSidebar(
      children: [
        KvFilterGroup(
          title: t('Trạng thái'),
          child: Column(
            children: [
              for (final s in ['draft', 'approved', 'cancelled'])
                KvCheckOption(
                  label: _statusLabels[s]!,
                  checked: _statuses.contains(s),
                  onChanged: (v) {
                    setState(() {
                      if (v) {
                        _statuses.add(s);
                      } else if (_statuses.length > 1) {
                        _statuses.remove(s);
                      }
                    });
                    _load();
                  },
                ),
            ],
          ),
        ),
        KvFilterGroup(
          title: t('Kho hàng'),
          child: Column(
            children: [
              KvRadioOption(
                  label: t('Tất cả'),
                  selected: _whFilter.isEmpty,
                  onTap: () {
                    setState(() => _whFilter = '');
                    _load();
                  }),
              for (final w in widget.warehouses)
                KvRadioOption(
                    label: kvs(w['name']),
                    selected: _whFilter == kvs(w['id']),
                    onTap: () {
                      setState(() => _whFilter = kvs(w['id']));
                      _load();
                    }),
            ],
          ),
        ),
      ],
    );
  }

  Widget _row(Map<String, dynamic> r) {
    final id = kvs(r['id']);
    final status = kvs(r['status']);
    final expanded = _expandedId == id;
    num deltaDec = kvn(r['delta_dec']);
    Widget numCell(num v, double w, {Color? color, bool signed = false}) =>
        SizedBox(
          width: w,
          child: Text(
            signed && v > 0 ? '+${Fmt.int0(v)}' : Fmt.int0(v),
            textAlign: TextAlign.right,
            style: TextStyle(
                fontSize: 12.5,
                fontWeight: FontWeight.w700,
                color: color ?? DanColors.text),
          ),
        );
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
                  width: 116,
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
                SizedBox(
                  width: 118,
                  child: Text(
                      kvs(r['approved_at']).isEmpty
                          ? '—'
                          : kvDateTime(kvs(r['approved_at'])),
                      style: TextStyle(fontSize: 12, color: DanColors.muted)),
                ),
                numCell(kvn(r['total_counted']), 84),
                numCell(kvn(r['total_delta']), 108,
                    signed: true,
                    color: kvn(r['total_delta']) == 0
                        ? DanColors.text
                        : kvn(r['total_delta']) > 0
                            ? DanColors.done
                            : DanColors.late),
                numCell(kvn(r['delta_inc']), 92,
                    signed: true, color: DanColors.done),
                numCell(deltaDec, 92,
                    color: deltaDec < 0 ? DanColors.late : DanColors.text),
                SizedBox(width: 10),
                Expanded(
                  child: Row(
                    children: [
                      KvStatusChip(
                          label: _statusLabels[status] ?? status,
                          color: _statusColor(status)),
                      Spacer(),
                      Icon(expanded ? Icons.expand_less : Icons.expand_more,
                          size: 18, color: DanColors.faint),
                    ],
                  ),
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
    final d = _detail;
    return Container(
      width: double.infinity,
      color: DanColors.surface,
      padding: EdgeInsets.fromLTRB(24, 6, 24, 14),
      child: _detailLoading || d == null
          ? Padding(
              padding: EdgeInsets.all(20),
              child: Center(
                  child: SizedBox(
                      width: 22,
                      height: 22,
                      child: CircularProgressIndicator(strokeWidth: 2))),
            )
          : Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Text(kvs(d['code']).isEmpty ? kvs(d['id']) : kvs(d['code']),
                        style: TextStyle(
                            fontFamily: 'JetBrains Mono',
                            fontSize: 15,
                            fontWeight: FontWeight.w900,
                            color: DanColors.text)),
                    SizedBox(width: 8),
                    KvStatusChip(
                        label: _statusLabels[status] ?? status,
                        color: _statusColor(status)),
                    SizedBox(width: 14),
                    Text(
                        '${t('Kho')}: ${kvs(d['warehouse_name'])}'
                        '${kvs(d['created_by']).isEmpty ? '' : '  ·  ${t('Người tạo')}: ${kvs(d['created_by'])}'}',
                        style:
                            TextStyle(fontSize: 12.5, color: DanColors.muted)),
                  ],
                ),
                if (kvs(d['note']).isNotEmpty) ...[
                  SizedBox(height: 4),
                  Text(kvs(d['note']),
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
                        padding:
                            EdgeInsets.symmetric(horizontal: 12, vertical: 7),
                        child: Row(children: [
                          kvHeaderCell(t('Mã hàng'), width: 110),
                          SizedBox(width: 8),
                          kvHeaderCell(t('Tên hàng'), flex: 1),
                          kvHeaderCell(t('Lô'), width: 90),
                          kvHeaderCell(t('HSD'), width: 86),
                          kvHeaderCell(t('Tồn kho'),
                              width: 76, align: TextAlign.right),
                          kvHeaderCell(t('Thực tế'),
                              width: 76, align: TextAlign.right),
                          kvHeaderCell(t('Lệch'),
                              width: 70, align: TextAlign.right),
                        ]),
                      ),
                      for (final l in kvMapList(d['lines']))
                        Container(
                          padding: EdgeInsets.symmetric(
                              horizontal: 12, vertical: 7),
                          decoration: BoxDecoration(
                              border: Border(
                                  top: BorderSide(color: DanColors.border))),
                          child: Row(
                            children: [
                              SizedBox(
                                width: 110,
                                child: Text(
                                    kvs(l['item_code']).isEmpty
                                        ? kvs(l['barcode'])
                                        : kvs(l['item_code']),
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                    style: TextStyle(
                                        fontFamily: 'JetBrains Mono',
                                        fontSize: 11.5,
                                        color: DanColors.brand)),
                              ),
                              SizedBox(width: 8),
                              Expanded(
                                child: Text(kvs(l['item_name']),
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                    style: TextStyle(fontSize: 12.5)),
                              ),
                              SizedBox(
                                  width: 90,
                                  child: Text(
                                      kvs(l['lot_no']).isEmpty
                                          ? '—'
                                          : kvs(l['lot_no']),
                                      style: TextStyle(
                                          fontSize: 11.5,
                                          color: DanColors.muted))),
                              SizedBox(
                                  width: 86,
                                  child: Text(
                                      kvs(l['expiry_date']).isEmpty
                                          ? '—'
                                          : kvShortDate(kvs(l['expiry_date'])),
                                      style: TextStyle(
                                          fontSize: 11.5,
                                          color: DanColors.muted))),
                              SizedBox(
                                  width: 76,
                                  child: Text(Fmt.int0(kvn(l['expected_qty'])),
                                      textAlign: TextAlign.right,
                                      style: TextStyle(fontSize: 12))),
                              SizedBox(
                                  width: 76,
                                  child: Text(Fmt.int0(kvn(l['counted_qty'])),
                                      textAlign: TextAlign.right,
                                      style: TextStyle(
                                          fontSize: 12,
                                          fontWeight: FontWeight.w700))),
                              SizedBox(
                                width: 70,
                                child: Text(
                                    '${kvn(l['delta_qty']) > 0 ? '+' : ''}${Fmt.int0(kvn(l['delta_qty']))}',
                                    textAlign: TextAlign.right,
                                    style: TextStyle(
                                        fontSize: 12,
                                        fontWeight: FontWeight.w800,
                                        color: kvn(l['delta_qty']) == 0
                                            ? DanColors.faint
                                            : kvn(l['delta_qty']) > 0
                                                ? DanColors.done
                                                : DanColors.late)),
                              ),
                            ],
                          ),
                        ),
                    ],
                  ),
                ),
                SizedBox(height: 10),
                if (status == 'draft')
                  Row(
                    children: [
                      OutlinedButton.icon(
                        onPressed: () => _cancel(kvs(d['id'])),
                        icon: Icon(Icons.delete_outline, size: 17),
                        label: Text(t('Hủy phiếu')),
                        style: OutlinedButton.styleFrom(
                            foregroundColor: DanColors.late),
                      ),
                      Spacer(),
                      OutlinedButton.icon(
                        onPressed: () => _openForm(existing: d),
                        icon: Icon(Icons.open_in_new, size: 17),
                        label: Text(t('Mở phiếu')),
                      ),
                      SizedBox(width: 8),
                      FilledButton.icon(
                        onPressed: () => _approve(kvs(d['id'])),
                        icon: Icon(Icons.balance, size: 17),
                        label: Text(t('Cân bằng kho')),
                      ),
                    ],
                  ),
              ],
            ),
    );
  }
}
