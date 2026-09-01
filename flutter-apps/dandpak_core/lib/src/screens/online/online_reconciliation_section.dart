import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../services/api_service.dart';
import '../../ui/app_theme.dart';
import '../../ui/format.dart';
import '../../utils/translation.dart';
import '../management/management_widgets.dart';
import 'online_shared.dart';

/// Đối soát — tổng hợp doanh thu online theo sàn. Phí sàn và số tiền sàn thanh
/// toán thật lấy từ báo cáo đối soát của sàn (đang chờ cấp quyền API).
class OnlineReconciliationSection extends StatefulWidget {
  const OnlineReconciliationSection({super.key});

  @override
  State<OnlineReconciliationSection> createState() =>
      _OnlineReconciliationSectionState();
}

class _OnlineReconciliationSectionState
    extends State<OnlineReconciliationSection> {
  String _provider = '';
  String _settled = '';
  Map<String, dynamic> _summary = {};
  List<Map<String, dynamic>> _rows = [];
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
      final api = context.read<ApiService>();
      final summary =
          await api.getOnlineReconciliationSummary(provider: _provider);
      final orders = await api.getOnlineReconciliationOrders(
          provider: _provider, settled: _settled, limit: 100);
      if (!mounted) return;
      setState(() {
        _summary = summary;
        _rows = oList(orders['rows']);
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

  @override
  Widget build(BuildContext context) {
    if (_loading) return const Center(child: CircularProgressIndicator());
    if (_error != null) {
      return Padding(
        padding: const EdgeInsets.all(40),
        child: InlineMessage(_error!, error: true, onRetry: _load),
      );
    }
    final totals = oMap(_summary['totals']);
    final providers = oList(_summary['providers']);
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Wrap(spacing: 14, runSpacing: 14, children: [
            _kpi('Tổng doanh thu', Fmt.money(oNum(totals['revenue'])),
                DanColors.text),
            _kpi('Đã thanh toán', Fmt.money(oNum(totals['settled'])),
                const Color(0xFF047857)),
            _kpi('Chưa thanh toán', Fmt.money(oNum(totals['unsettled'])),
                const Color(0xFFB45309)),
            _kpi(
                'Số đơn', '${oNum(totals['orders']).toInt()}', DanColors.brand),
          ]),
          const SizedBox(height: 8),
          if (oStr(_summary['note']).isNotEmpty)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 8),
              child: Text(oStr(_summary['note']),
                  style: const TextStyle(
                      fontSize: 11.5,
                      color: DanColors.faint,
                      fontStyle: FontStyle.italic)),
            ),
          const SizedBox(height: 8),
          for (final p in providers) _providerRow(p),
          const SizedBox(height: 20),
          Row(children: [
            Text(t('Chi tiết đối soát'),
                style:
                    const TextStyle(fontSize: 15, fontWeight: FontWeight.w800)),
            const Spacer(),
            _settledFilter(),
            const SizedBox(width: 8),
            _providerFilter(),
          ]),
          const SizedBox(height: 10),
          _table(),
        ],
      ),
    );
  }

  Widget _kpi(String label, String value, Color color) {
    return Container(
      width: 210,
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: DanColors.surface,
        border: Border.all(color: DanColors.border),
        borderRadius: BorderRadius.circular(DanRadius.lg),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(t(label),
              style: const TextStyle(fontSize: 12, color: DanColors.muted)),
          const SizedBox(height: 4),
          Text(value,
              style: TextStyle(
                  fontSize: 18, fontWeight: FontWeight.w900, color: color)),
        ],
      ),
    );
  }

  Widget _providerRow(Map<String, dynamic> p) {
    return Container(
      margin: const EdgeInsets.only(top: 8),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: DanColors.surface,
        border: Border.all(color: DanColors.border),
        borderRadius: BorderRadius.circular(DanRadius.md),
      ),
      child: Row(
        children: [
          SizedBox(width: 150, child: ProviderBadge(oStr(p['provider']))),
          _cell('Đơn', '${oNum(p['orders']).toInt()}'),
          _cell('Doanh thu', Fmt.money(oNum(p['revenue']))),
          _cell('Đã TT', Fmt.money(oNum(p['settled']))),
          _cell('Chưa TT', Fmt.money(oNum(p['unsettled']))),
        ],
      ),
    );
  }

  Widget _cell(String label, String value) {
    return Expanded(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(t(label),
              style: const TextStyle(fontSize: 11, color: DanColors.faint)),
          Text(value,
              style:
                  const TextStyle(fontSize: 13, fontWeight: FontWeight.w700)),
        ],
      ),
    );
  }

  Widget _settledFilter() {
    return DropdownButton<String>(
      value: _settled,
      underline: const SizedBox.shrink(),
      items: [
        DropdownMenuItem(value: '', child: Text(t('Tất cả'))),
        DropdownMenuItem(value: 'paid', child: Text(t('Đã thanh toán'))),
        DropdownMenuItem(value: 'unpaid', child: Text(t('Chưa thanh toán'))),
      ],
      onChanged: (v) {
        setState(() => _settled = v ?? '');
        _load();
      },
    );
  }

  Widget _providerFilter() {
    return DropdownButton<String>(
      value: _provider,
      underline: const SizedBox.shrink(),
      items: [
        DropdownMenuItem(value: '', child: Text(t('Tất cả sàn'))),
        for (final key in const [
          'haravan',
          'website',
          'shopee',
          'tiktokshop',
          'lazada',
          'tiki'
        ])
          DropdownMenuItem(value: key, child: Text(providerMeta(key).name)),
      ],
      onChanged: (v) {
        setState(() => _provider = v ?? '');
        _load();
      },
    );
  }

  Widget _table() {
    if (_rows.isEmpty) {
      return Padding(
        padding: const EdgeInsets.all(30),
        child: OnlineEmpty(t('Không có bản ghi đối soát'),
            icon: Icons.account_balance_outlined),
      );
    }
    return Container(
      decoration: BoxDecoration(
        color: DanColors.surface,
        border: Border.all(color: DanColors.border),
        borderRadius: BorderRadius.circular(DanRadius.md),
      ),
      child: Column(children: [
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
          color: DanColors.surface2,
          child: Row(children: [
            Expanded(flex: 3, child: _th('Mã đơn')),
            Expanded(flex: 2, child: _th('Sàn')),
            Expanded(flex: 2, child: _th('Khách trả')),
            Expanded(flex: 2, child: _th('Sàn thanh toán')),
            Expanded(flex: 2, child: _th('Trạng thái')),
          ]),
        ),
        for (final r in _rows) _tr(r),
      ]),
    );
  }

  Widget _th(String label) => Text(t(label),
      style: const TextStyle(
          fontSize: 11.5, fontWeight: FontWeight.w800, color: DanColors.muted));

  Widget _tr(Map<String, dynamic> r) {
    final settled = r['settled'] == true;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: const BoxDecoration(
        border: Border(top: BorderSide(color: DanColors.border)),
      ),
      child: Row(children: [
        Expanded(
            flex: 3,
            child: Text(
                oStr(r['external_order_code']).isNotEmpty
                    ? oStr(r['external_order_code'])
                    : oStr(r['bill_no']),
                style: const TextStyle(fontSize: 12))),
        Expanded(
            flex: 2,
            child: Text(providerMeta(oStr(r['provider'])).name,
                style: const TextStyle(fontSize: 12))),
        Expanded(
            flex: 2,
            child: Text(Fmt.money(oNum(r['customer_pays'])),
                style: const TextStyle(fontSize: 12))),
        Expanded(
            flex: 2,
            child: Text(Fmt.money(oNum(r['platform_pays'])),
                style: const TextStyle(fontSize: 12))),
        Expanded(
            flex: 2,
            child: OnlinePill(settled ? t('Đã TT') : t('Chưa TT'),
                settled ? DanColors.done : DanColors.doing)),
      ]),
    );
  }
}
