import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../providers/auth_provider.dart';
import '../../services/api_service.dart';
import '../../ui/app_theme.dart';
import '../../ui/format.dart';
import '../../widgets/dan_top_bar.dart';
import '../management/management_widgets.dart';
import '../../utils/translation.dart';

String _s(dynamic v) => v?.toString() ?? '';
num _n(dynamic v) => v is num ? v : num.tryParse(_s(v)) ?? 0;

List<List<String>> get _statusFilters => [
      ['', t('Tất cả')],
      ['issued', t('Đã phát hành')],
      ['cancelled', t('Đã hủy')],
    ];

/// Native port of the web Hóa đơn (invoices.html): e-invoice list with status
/// filter, search, summary and cancel.
class InvoicesScreen extends StatefulWidget {
  InvoicesScreen({super.key});

  @override
  State<InvoicesScreen> createState() => _InvoicesScreenState();
}

class _InvoicesScreenState extends State<InvoicesScreen> {
  List<Map<String, dynamic>> _invoices = [];
  String _status = '';
  String _search = '';
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    try {
      final rows = await context.read<ApiService>().getInvoices();
      if (!mounted) return;
      setState(() {
        _invoices = rows
            .whereType<Map>()
            .map((e) => Map<String, dynamic>.from(e))
            .toList();
        _loading = false;
        _error = null;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.toString().replaceFirst('Exception: ', '');
        _loading = false;
      });
    }
  }

  Future<void> _cancel(Map<String, dynamic> inv) async {
    final ctrl = TextEditingController();
    final reason = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: DanColors.surface,
        title: Text(t('Hủy hóa đơn')),
        content: TextField(
            controller: ctrl,
            autofocus: true,
            decoration: InputDecoration(labelText: t('Lý do hủy'))),
        actions: [
          TextButton(
              onPressed: () => Navigator.of(ctx).pop(), child: Text(t('Đóng'))),
          FilledButton(
            onPressed: () => Navigator.of(ctx).pop(ctrl.text.trim()),
            style: FilledButton.styleFrom(backgroundColor: DanColors.late),
            child: Text(t('Hủy hóa đơn')),
          ),
        ],
      ),
    );
    if (reason == null || !mounted) return;
    try {
      await context
          .read<ApiService>()
          .cancelInvoice(_s(inv['id']), reason: reason);
      _load();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(
            content: Text(e.toString().replaceFirst('Exception: ', '')),
            backgroundColor: DanColors.late));
      }
    }
  }

  List<Map<String, dynamic>> get _filtered {
    final q = foldSearch(_search);
    return _invoices.where((i) {
      if (_status.isNotEmpty && _s(i['status']) != _status) return false;
      if (q.isEmpty) return true;
      final c = i['customer'] is Map ? (i['customer'] as Map) : {};
      return [
        i['invoice_no'],
        i['lookup_code'],
        c['name'],
        c['company'],
        c['tax_code'],
        c['phone'],
      ].any((v) => searchMatches(v, q));
    }).toList();
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final user = auth.currentUser;
    final branch = auth.selectedBranch;

    final issued = _invoices.where((i) => _s(i['status']) == 'issued').toList();
    final cancelled =
        _invoices.where((i) => _s(i['status']) == 'cancelled').toList();
    final totalIssued = issued.fold<num>(0, (s, i) => s + _n(i['total']));

    return Scaffold(
      backgroundColor: DanColors.bg,
      appBar: DanModuleTopBar(
        brandName: branch.name.isNotEmpty ? branch.name : branch.id,
        title: t('Hóa đơn'),
        subtitle: '',
        titleIcon: Icons.description_outlined,
        userName: user?.name ?? '—',
        userRole: roleLabel(user?.role ?? ''),
        online: true,
        onBack: () => Navigator.of(context).maybePop(),
        onLogout: () => auth.logout(),
      ),
      body: Column(
        children: [
          Padding(
            padding: EdgeInsets.fromLTRB(16, 16, 16, 0),
            child: Row(
              children: [
                Expanded(
                    child: KpiCard(
                        label: t('Đã phát hành'),
                        value: Fmt.int0(issued.length),
                        valueColor: DanColors.done)),
                SizedBox(width: 12),
                Expanded(
                    child: KpiCard(
                        label: t('Tổng tiền HĐ'),
                        value: Fmt.money(totalIssued))),
                SizedBox(width: 12),
                Expanded(
                    child: KpiCard(
                        label: t('Đã hủy'),
                        value: Fmt.int0(cancelled.length),
                        valueColor: cancelled.isEmpty
                            ? DanColors.muted
                            : DanColors.late)),
              ],
            ),
          ),
          Padding(
            padding: EdgeInsets.all(14),
            child: Row(
              children: [
                for (final f in _statusFilters) ...[
                  ChoiceChip(
                    label: Text(f[1]),
                    selected: _status == f[0],
                    onSelected: (_) => setState(() => _status = f[0]),
                  ),
                  SizedBox(width: 8),
                ],
                SizedBox(width: 4),
                Expanded(
                  child: TextField(
                    decoration: InputDecoration(
                        hintText: t('Tìm số HĐ, khách, MST…'),
                        prefixIcon: Icon(Icons.search),
                        isDense: true),
                    onChanged: (v) => setState(() => _search = v),
                  ),
                ),
              ],
            ),
          ),
          Divider(height: 1, color: DanColors.border),
          Expanded(child: _body()),
        ],
      ),
    );
  }

  Widget _body() {
    if (_loading && _invoices.isEmpty) {
      return Center(child: CircularProgressIndicator());
    }
    if (_error != null && _invoices.isEmpty) {
      return Padding(
        padding: EdgeInsets.all(40),
        child: InlineMessage(t('Không tải được hóa đơn ($_error)'),
            error: true, onRetry: _load),
      );
    }
    final list = _filtered;
    if (list.isEmpty) {
      return Center(
          child: Text(t('Chưa có hóa đơn nào'),
              style: TextStyle(color: DanColors.faint)));
    }
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView.separated(
        padding: EdgeInsets.all(16),
        itemCount: list.length,
        separatorBuilder: (_, __) => SizedBox(height: 8),
        itemBuilder: (_, i) => _row(list[i]),
      ),
    );
  }

  Widget _row(Map<String, dynamic> inv) {
    final cancelled = _s(inv['status']) == 'cancelled';
    final c = inv['customer'] is Map ? (inv['customer'] as Map) : {};
    final created = DateTime.tryParse(_s(inv['created_at']));
    return Container(
      padding: EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      decoration: BoxDecoration(
        color: DanColors.surface,
        border: Border.all(color: DanColors.border),
        borderRadius: BorderRadius.circular(DanRadius.md),
      ),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Text(
                        _s(inv['invoice_no']).isEmpty
                            ? t('(chưa cấp số)')
                            : '#${_s(inv['invoice_no'])}',
                        style: TextStyle(
                            fontFamily: 'JetBrains Mono',
                            fontWeight: FontWeight.w800,
                            color: DanColors.brand)),
                    SizedBox(width: 8),
                    Container(
                      padding: EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                      decoration: BoxDecoration(
                          color: (cancelled ? DanColors.late : DanColors.done)
                              .withValues(alpha: .13),
                          borderRadius: BorderRadius.circular(5)),
                      child: Text(cancelled ? t('Đã hủy') : t('Đã phát hành'),
                          style: TextStyle(
                              fontSize: 11,
                              fontWeight: FontWeight.w800,
                              color: cancelled
                                  ? DanColors.late
                                  : Color(0xFF047857))),
                    ),
                  ],
                ),
                SizedBox(height: 3),
                Text(
                  [
                    if (_s(c['name']).isNotEmpty) _s(c['name']),
                    if (_s(c['tax_code']).isNotEmpty)
                      'MST ${_s(c['tax_code'])}',
                    if (created != null) Fmt.dmyHm(created),
                  ].join('  ·  '),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(fontSize: 12, color: DanColors.faint),
                ),
              ],
            ),
          ),
          Text(Fmt.money(_n(inv['total'])),
              style: TextStyle(fontSize: 14.5, fontWeight: FontWeight.w900)),
          if (!cancelled)
            TextButton(
              onPressed: () => _cancel(inv),
              style: TextButton.styleFrom(foregroundColor: DanColors.late),
              child: Text(t('Hủy')),
            ),
        ],
      ),
    );
  }
}
