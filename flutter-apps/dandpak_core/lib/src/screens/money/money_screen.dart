import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../services/api_service.dart';
import '../../ui/app_theme.dart';
import '../../ui/format.dart';
import '../../utils/translation.dart';
import '../management/management_widgets.dart';

String _s(dynamic v) => v?.toString() ?? '';
num _n(dynamic v) => v is num ? v : num.tryParse(_s(v)) ?? 0;
List<Map<String, dynamic>> _list(dynamic v) => v is List
    ? v.whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList()
    : <Map<String, dynamic>>[];
Map<String, dynamic> _map(dynamic v) =>
    v is Map ? Map<String, dynamic>.from(v) : <String, dynamic>{};

/// Cash Automation — Dòng tiền: dashboard realtime, đối soát bank (exception
/// queue) và rule engine phân loại. Chỉ TỔNG HỢP dữ liệu đã có (money ledger).
/// NHÚNG trong màn Quản lý (không phải màn riêng) — nên là panel không Scaffold.
class MoneyPanel extends StatefulWidget {
  const MoneyPanel({super.key});

  @override
  State<MoneyPanel> createState() => _MoneyPanelState();
}

class _MoneyPanelState extends State<MoneyPanel>
    with SingleTickerProviderStateMixin {
  late final TabController _tab = TabController(length: 4, vsync: this);

  @override
  void dispose() {
    _tab.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Material(
          color: DanColors.surface,
          child: TabBar(
            controller: _tab,
            isScrollable: true,
            tabAlignment: TabAlignment.start,
            labelColor: DanColors.brand,
            unselectedLabelColor: DanColors.muted,
            indicatorColor: DanColors.brand,
            tabs: [
              Tab(text: t('Tổng quan')),
              Tab(text: t('Dự báo')),
              Tab(text: t('Đối soát')),
              Tab(text: t('Quy tắc')),
            ],
          ),
        ),
        const Divider(height: 1, color: DanColors.border),
        Expanded(
          child: TabBarView(
            controller: _tab,
            children: const [
              _OverviewTab(),
              _ForecastTab(),
              _ExceptionTab(),
              _RulesTab(),
            ],
          ),
        ),
      ],
    );
  }
}

// ── TAB 1: Tổng quan (Cash Flow Dashboard) ──────────────────────────────────
class _OverviewTab extends StatefulWidget {
  const _OverviewTab();
  @override
  State<_OverviewTab> createState() => _OverviewTabState();
}

class _OverviewTabState extends State<_OverviewTab>
    with AutomaticKeepAliveClientMixin {
  Map<String, dynamic> _data = {};
  bool _loading = true;
  String? _error;
  int _period = 0; // 0 hôm nay, 1 = 7 ngày, 2 = 30 ngày

  @override
  bool get wantKeepAlive => true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  ({String from, String to}) _range() {
    if (_period == 0) return (from: '', to: '');
    final now = DateTime.now();
    final days = _period == 1 ? 7 : 30;
    final from = DateTime(now.year, now.month, now.day)
        .subtract(Duration(days: days - 1));
    return (from: from.toUtc().toIso8601String(), to: '');
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    try {
      final r = _range();
      final d =
          await context.read<ApiService>().getCashFlow(from: r.from, to: r.to);
      if (!mounted) return;
      setState(() {
        _data = d;
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
    super.build(context);
    if (_loading) return const Center(child: CircularProgressIndicator());
    if (_error != null) {
      return Padding(
        padding: const EdgeInsets.all(40),
        child: InlineMessage(_error!, error: true, onRetry: _load),
      );
    }
    final inflow = _n(_data['inflow_period']);
    final outflow = _n(_data['outflow_period']);
    final net = _n(_data['net_period']);
    final cash = _n(_data['cash_on_hand']);
    final ap = _n(_data['accounts_payable']);
    final exceptions = _n(_data['exceptions_pending']).toInt();
    final byAccount = _list(_data['by_account']);
    final byCat = _list(_data['by_category_out']);
    final maxCat =
        byCat.fold<num>(1, (m, c) => _n(c['total']) > m ? _n(c['total']) : m);
    final periodLabel = _period == 0
        ? t('hôm nay')
        : _period == 1
            ? t('7 ngày')
            : t('30 ngày');

    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Wrap(
            spacing: 8,
            children: [
              for (final p in [
                [0, t('Hôm nay')],
                [1, t('7 ngày')],
                [2, t('30 ngày')],
              ])
                ChoiceChip(
                  label: Text(p[1] as String),
                  selected: _period == p[0],
                  onSelected: (_) {
                    setState(() => _period = p[0] as int);
                    _load();
                  },
                ),
            ],
          ),
          const SizedBox(height: 14),
          // KPI hàng 1
          Row(children: [
            Expanded(
                child: _kpi(t('Tiền mặt hiện có'), cash, DanColors.brand,
                    Icons.savings_outlined)),
            const SizedBox(width: 10),
            Expanded(
                child: _kpi(
                    '${t('Net')} ($periodLabel)',
                    net,
                    net >= 0 ? DanColors.done : DanColors.late,
                    Icons.trending_up)),
          ]),
          const SizedBox(height: 10),
          Row(children: [
            Expanded(
                child: _kpi('${t('Tiền vào')} ($periodLabel)', inflow,
                    DanColors.done, Icons.south_west)),
            const SizedBox(width: 10),
            Expanded(
                child: _kpi('${t('Tiền ra')} ($periodLabel)', outflow,
                    DanColors.late, Icons.north_east)),
          ]),
          const SizedBox(height: 10),
          Row(children: [
            Expanded(
                child: _kpi(t('Nợ nhà cung cấp'), ap, const Color(0xFFB45309),
                    Icons.request_quote_outlined)),
            const SizedBox(width: 10),
            Expanded(
                child: _infoTile(
                    t('Cần đối soát'),
                    '$exceptions ${t('giao dịch')}',
                    exceptions > 0 ? DanColors.late : DanColors.done,
                    Icons.rule_folder_outlined)),
          ]),
          const SizedBox(height: 16),
          _card(t('Tiền theo tài khoản ($periodLabel)'), [
            if (byAccount.isEmpty)
              Padding(
                  padding: const EdgeInsets.symmetric(vertical: 8),
                  child: Text(t('Chưa có dữ liệu'),
                      style: const TextStyle(color: DanColors.faint))),
            for (final a in byAccount)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 4),
                child: Row(children: [
                  Icon(
                      _s(a['direction']) == 'in'
                          ? Icons.south_west
                          : Icons.north_east,
                      size: 15,
                      color: _s(a['direction']) == 'in'
                          ? DanColors.done
                          : DanColors.late),
                  const SizedBox(width: 8),
                  Text(_accountLabel(_s(a['account'])),
                      style: const TextStyle(
                          fontSize: 13, fontWeight: FontWeight.w700)),
                  const Spacer(),
                  Text(Fmt.money(_n(a['total'])),
                      style: TextStyle(
                          fontSize: 13,
                          fontWeight: FontWeight.w800,
                          color: _s(a['direction']) == 'in'
                              ? DanColors.done
                              : DanColors.late)),
                ]),
              ),
          ]),
          const SizedBox(height: 12),
          _card(t('Chi theo danh mục ($periodLabel)'), [
            if (byCat.isEmpty)
              Padding(
                  padding: const EdgeInsets.symmetric(vertical: 8),
                  child: Text(t('Chưa có chi nào'),
                      style: const TextStyle(color: DanColors.faint))),
            for (final c in byCat)
              StatBarRow(
                label: _s(c['category']),
                value: _n(c['total']),
                total: maxCat,
                color: DanColors.late,
                valueText: Fmt.money(_n(c['total'])),
              ),
          ]),
          if (_data['bank_balance_needs_opening'] == true) ...[
            const SizedBox(height: 12),
            Text(
              t('* Số dư ngân hàng tuyệt đối cần khai số dư đầu kỳ (chưa có API số dư). Hiện chỉ tính biến động vào/ra.'),
              style: const TextStyle(fontSize: 11, color: DanColors.faint),
            ),
          ],
        ],
      ),
    );
  }

  String _accountLabel(String a) => switch (a) {
        'cash' => t('Tiền mặt'),
        'bank' => t('Ngân hàng / QR'),
        'card' => t('Thẻ / POS'),
        'online' => t('Ví sàn / online'),
        _ => a,
      };

  Widget _kpi(String label, num value, Color color, IconData icon) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: DanColors.surface,
        border: Border.all(color: DanColors.border),
        borderRadius: BorderRadius.circular(DanRadius.lg),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(children: [
            Icon(icon, size: 16, color: color),
            const SizedBox(width: 6),
            Expanded(
                child: Text(label,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style:
                        const TextStyle(fontSize: 12, color: DanColors.muted))),
          ]),
          const SizedBox(height: 8),
          Text(Fmt.money(value),
              style: TextStyle(
                  fontSize: 19, fontWeight: FontWeight.w900, color: color)),
        ],
      ),
    );
  }

  Widget _infoTile(String label, String value, Color color, IconData icon) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: DanColors.surface,
        border: Border.all(color: DanColors.border),
        borderRadius: BorderRadius.circular(DanRadius.lg),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(children: [
            Icon(icon, size: 16, color: color),
            const SizedBox(width: 6),
            Expanded(
                child: Text(label,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style:
                        const TextStyle(fontSize: 12, color: DanColors.muted))),
          ]),
          const SizedBox(height: 8),
          Text(value,
              style: TextStyle(
                  fontSize: 16, fontWeight: FontWeight.w900, color: color)),
        ],
      ),
    );
  }

  Widget _card(String title, List<Widget> children) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: DanColors.surface,
        border: Border.all(color: DanColors.border),
        borderRadius: BorderRadius.circular(DanRadius.lg),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(title,
              style:
                  const TextStyle(fontSize: 13, fontWeight: FontWeight.w800)),
          const SizedBox(height: 8),
          ...children,
        ],
      ),
    );
  }
}

// ── TAB 2: Đối soát (Exception Queue) ───────────────────────────────────────
class _ExceptionTab extends StatefulWidget {
  const _ExceptionTab();
  @override
  State<_ExceptionTab> createState() => _ExceptionTabState();
}

class _ExceptionTabState extends State<_ExceptionTab>
    with AutomaticKeepAliveClientMixin {
  List<Map<String, dynamic>> _rows = [];
  Map<String, dynamic> _legend = {};
  bool _loading = true;
  String? _error;

  @override
  bool get wantKeepAlive => true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    try {
      final d = await context.read<ApiService>().getMoneyExceptions();
      if (!mounted) return;
      setState(() {
        _rows = _list(d['rows']);
        _legend = _map(d['legend']);
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

  Future<void> _ignore(Map<String, dynamic> r) async {
    try {
      await context
          .read<ApiService>()
          .resolveMoneyException(_s(r['id']), 'ignore');
      if (mounted) appToast(context, t('Đã bỏ qua giao dịch'));
      _load();
    } catch (e) {
      if (mounted)
        appToast(context, e.toString().replaceFirst('Exception: ', ''),
            isError: true);
    }
  }

  Color _statusColor(String s) => switch (s) {
        'unmatched' => DanColors.late,
        'underpaid' => const Color(0xFFB45309),
        'already_paid' => DanColors.doing,
        'error' => DanColors.late,
        _ => DanColors.muted,
      };

  @override
  Widget build(BuildContext context) {
    super.build(context);
    if (_loading) return const Center(child: CircularProgressIndicator());
    if (_error != null) {
      return Padding(
          padding: const EdgeInsets.all(40),
          child: InlineMessage(_error!, error: true, onRetry: _load));
    }
    if (_rows.isEmpty) {
      return RefreshIndicator(
        onRefresh: _load,
        child: ListView(children: [
          const SizedBox(height: 120),
          Icon(Icons.check_circle_outline, size: 48, color: DanColors.done),
          const SizedBox(height: 12),
          Center(
              child: Text(t('Không có giao dịch nào cần đối soát — 100% khớp'),
                  style: const TextStyle(color: DanColors.muted))),
        ]),
      );
    }
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView.separated(
        padding: const EdgeInsets.all(14),
        itemCount: _rows.length,
        separatorBuilder: (_, __) => const SizedBox(height: 8),
        itemBuilder: (_, i) {
          final r = _rows[i];
          final status = _s(r['status']);
          return Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: DanColors.surface,
              border: Border.all(color: DanColors.border),
              borderRadius: BorderRadius.circular(DanRadius.md),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(children: [
                  Container(
                    padding:
                        const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                    decoration: BoxDecoration(
                        color: _statusColor(status).withValues(alpha: .13),
                        borderRadius: BorderRadius.circular(6)),
                    child: Text(
                        _s(_legend[status]).isEmpty
                            ? status
                            : _s(_legend[status]),
                        style: TextStyle(
                            fontSize: 11,
                            fontWeight: FontWeight.w800,
                            color: _statusColor(status))),
                  ),
                  const Spacer(),
                  Text(Fmt.money(_n(r['amount'])),
                      style: const TextStyle(
                          fontSize: 15, fontWeight: FontWeight.w900)),
                ]),
                const SizedBox(height: 6),
                Text(
                    _s(r['content']).isEmpty
                        ? t('(Không có nội dung)')
                        : _s(r['content']),
                    style: const TextStyle(fontSize: 12.5)),
                const SizedBox(height: 3),
                Text(
                    '${_s(r['provider']).toUpperCase()} · ${_s(r['account_number'])}'
                    '${_s(r['external_id']).isNotEmpty ? ' · ${_s(r['external_id'])}' : ''}',
                    style:
                        const TextStyle(fontSize: 11, color: DanColors.faint)),
                const SizedBox(height: 8),
                Align(
                  alignment: Alignment.centerRight,
                  child: OutlinedButton.icon(
                    onPressed: () => _ignore(r),
                    icon: const Icon(Icons.visibility_off_outlined, size: 15),
                    label:
                        Text(t('Bỏ qua'), style: const TextStyle(fontSize: 12)),
                    style: OutlinedButton.styleFrom(
                        minimumSize: const Size(0, 32)),
                  ),
                ),
              ],
            ),
          );
        },
      ),
    );
  }
}

// ── TAB 3: Quy tắc (Rule engine) ────────────────────────────────────────────
class _RulesTab extends StatefulWidget {
  const _RulesTab();
  @override
  State<_RulesTab> createState() => _RulesTabState();
}

class _RulesTabState extends State<_RulesTab>
    with AutomaticKeepAliveClientMixin {
  List<Map<String, dynamic>> _rules = [];
  bool _loading = true;
  String? _error;

  @override
  bool get wantKeepAlive => true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    try {
      final rows = await context.read<ApiService>().getMoneyRules();
      if (!mounted) return;
      setState(() {
        _rules = rows
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

  Future<void> _edit([Map<String, dynamic>? rule]) async {
    final saved = await showDialog<bool>(
      context: context,
      builder: (_) => _RuleDialog(rule: rule),
    );
    if (saved == true) _load();
  }

  Future<void> _delete(Map<String, dynamic> r) async {
    try {
      await context.read<ApiService>().deleteMoneyRule(_s(r['id']));
      _load();
    } catch (e) {
      if (mounted)
        appToast(context, e.toString().replaceFirst('Exception: ', ''),
            isError: true);
    }
  }

  Future<void> _reclassify() async {
    try {
      final r = await context.read<ApiService>().reclassifyMoney();
      if (mounted) {
        appToast(context,
            '${t('Đã phân loại lại')} ${_n(r['reclassified']).toInt()} ${t('giao dịch')}');
      }
    } catch (e) {
      if (mounted)
        appToast(context, e.toString().replaceFirst('Exception: ', ''),
            isError: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    super.build(context);
    if (_loading) return const Center(child: CircularProgressIndicator());
    if (_error != null) {
      return Padding(
          padding: const EdgeInsets.all(40),
          child: InlineMessage(_error!, error: true, onRetry: _load));
    }
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(14, 10, 14, 6),
          child: Row(children: [
            Expanded(
                child: Text(
                    t(
                        'Tự phân loại giao dịch theo từ khoá trong nội dung (VD: Ahamove → Vận chuyển).'),
                    style:
                        const TextStyle(fontSize: 12, color: DanColors.muted))),
            const SizedBox(width: 8),
            OutlinedButton.icon(
              onPressed: _reclassify,
              icon: const Icon(Icons.auto_fix_high, size: 15),
              label: Text(t('Phân loại lại'),
                  style: const TextStyle(fontSize: 12)),
              style: OutlinedButton.styleFrom(minimumSize: const Size(0, 34)),
            ),
            const SizedBox(width: 6),
            FilledButton.icon(
              onPressed: () => _edit(),
              icon: const Icon(Icons.add, size: 16),
              label: Text(t('Thêm'), style: const TextStyle(fontSize: 12)),
              style: FilledButton.styleFrom(minimumSize: const Size(0, 34)),
            ),
          ]),
        ),
        const Divider(height: 1, color: DanColors.border),
        Expanded(
          child: _rules.isEmpty
              ? Center(
                  child: Text(t('Chưa có quy tắc'),
                      style: const TextStyle(color: DanColors.faint)))
              : ListView.separated(
                  padding: const EdgeInsets.all(14),
                  itemCount: _rules.length,
                  separatorBuilder: (_, __) => const SizedBox(height: 8),
                  itemBuilder: (_, i) {
                    final r = _rules[i];
                    final dir = _s(r['direction']);
                    return InkWell(
                      onTap: () => _edit(r),
                      borderRadius: BorderRadius.circular(DanRadius.md),
                      child: Container(
                        padding: const EdgeInsets.symmetric(
                            horizontal: 12, vertical: 10),
                        decoration: BoxDecoration(
                          color: DanColors.surface,
                          border: Border.all(color: DanColors.border),
                          borderRadius: BorderRadius.circular(DanRadius.md),
                        ),
                        child: Row(children: [
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                    '"${_s(r['pattern'])}" → ${_s(r['category']).isEmpty ? t('(không đổi danh mục)') : _s(r['category'])}',
                                    style: const TextStyle(
                                        fontSize: 13,
                                        fontWeight: FontWeight.w700)),
                                const SizedBox(height: 2),
                                Text(
                                    [
                                      dir == 'in'
                                          ? t('Chỉ tiền vào')
                                          : dir == 'out'
                                              ? t('Chỉ tiền ra')
                                              : t('Mọi chiều'),
                                      if (_s(r['cost_center']).isNotEmpty)
                                        'CC: ${_s(r['cost_center'])}',
                                      if (_s(r['branch_id']).isEmpty)
                                        t('Mọi chi nhánh'),
                                    ].join('  ·  '),
                                    style: const TextStyle(
                                        fontSize: 11, color: DanColors.faint)),
                              ],
                            ),
                          ),
                          IconButton(
                            onPressed: () => _delete(r),
                            visualDensity: VisualDensity.compact,
                            icon: const Icon(Icons.delete_outline,
                                size: 18, color: DanColors.faint),
                          ),
                        ]),
                      ),
                    );
                  },
                ),
        ),
      ],
    );
  }
}

class _RuleDialog extends StatefulWidget {
  final Map<String, dynamic>? rule;
  const _RuleDialog({this.rule});
  @override
  State<_RuleDialog> createState() => _RuleDialogState();
}

class _RuleDialogState extends State<_RuleDialog> {
  final _pattern = TextEditingController();
  final _category = TextEditingController();
  final _costCenter = TextEditingController();
  String _direction = '';
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    final r = widget.rule;
    _pattern.text = _s(r?['pattern']);
    _category.text = _s(r?['category']);
    _costCenter.text = _s(r?['cost_center']);
    _direction = _s(r?['direction']);
  }

  @override
  void dispose() {
    _pattern.dispose();
    _category.dispose();
    _costCenter.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (_pattern.text.trim().isEmpty) {
      appToast(context, t('Nhập từ khoá'), isError: true);
      return;
    }
    setState(() => _saving = true);
    try {
      await context.read<ApiService>().saveMoneyRule({
        if (widget.rule != null) 'id': _s(widget.rule!['id']),
        'pattern': _pattern.text.trim(),
        'category': _category.text.trim(),
        'cost_center': _costCenter.text.trim(),
        'direction': _direction,
      });
      if (mounted) Navigator.of(context).pop(true);
    } catch (e) {
      if (mounted) {
        setState(() => _saving = false);
        appToast(context, e.toString().replaceFirst('Exception: ', ''),
            isError: true);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      backgroundColor: DanColors.surface,
      title: Text(widget.rule == null ? t('Thêm quy tắc') : t('Sửa quy tắc')),
      content: SizedBox(
        width: dialogWidth(context, 380),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(
              controller: _pattern,
              autofocus: true,
              decoration: InputDecoration(
                labelText: t('Từ khoá trong nội dung'),
                hintText: 'ahamove, evn, luong...',
              ),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _category,
              decoration: InputDecoration(labelText: t('Gán danh mục')),
            ),
            const SizedBox(height: 12),
            DropdownButtonFormField<String>(
              initialValue: _direction,
              decoration: InputDecoration(labelText: t('Áp dụng cho')),
              items: [
                DropdownMenuItem(value: '', child: Text(t('Mọi chiều'))),
                DropdownMenuItem(value: 'out', child: Text(t('Chỉ tiền ra'))),
                DropdownMenuItem(value: 'in', child: Text(t('Chỉ tiền vào'))),
              ],
              onChanged: (v) => setState(() => _direction = v ?? ''),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _costCenter,
              decoration: InputDecoration(
                labelText: t('Cost center (tuỳ chọn)'),
                hintText: 'retail, fnb, online...',
              ),
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
              ? const SizedBox(
                  width: 18,
                  height: 18,
                  child: CircularProgressIndicator(
                      strokeWidth: 2, color: Colors.white))
              : Text(t('Lưu')),
        ),
      ],
    );
  }
}

// ── TAB: Dự báo dòng tiền (Phase 3) ─────────────────────────────────────────
class _ForecastTab extends StatefulWidget {
  const _ForecastTab();
  @override
  State<_ForecastTab> createState() => _ForecastTabState();
}

class _ForecastTabState extends State<_ForecastTab>
    with AutomaticKeepAliveClientMixin {
  Map<String, dynamic> _data = {};
  List<Map<String, dynamic>> _obligations = [];
  bool _loading = true;
  String? _error;

  @override
  bool get wantKeepAlive => true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    try {
      final api = context.read<ApiService>();
      final f = await api.getCashForecast();
      final obs = await api.getObligations();
      if (!mounted) return;
      setState(() {
        _data = f;
        _obligations = obs
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

  Future<void> _editObligation([Map<String, dynamic>? o]) async {
    final saved = await showDialog<bool>(
      context: context,
      builder: (_) => _ObligationDialog(obligation: o),
    );
    if (saved == true) _load();
  }

  Future<void> _deleteObligation(Map<String, dynamic> o) async {
    try {
      await context.read<ApiService>().deleteObligation(_s(o['id']));
      _load();
    } catch (e) {
      if (mounted)
        appToast(context, e.toString().replaceFirst('Exception: ', ''),
            isError: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    super.build(context);
    if (_loading) return const Center(child: CircularProgressIndicator());
    if (_error != null) {
      return Padding(
          padding: const EdgeInsets.all(40),
          child: InlineMessage(_error!, error: true, onRetry: _load));
    }
    final forecast = _list(_data['forecast']);
    final avgIn = _n(_data['avg_daily_inflow']);
    final avgOut = _n(_data['avg_daily_outflow']);
    final worst = forecast.any((f) => _n(f['shortfall']) > 0);

    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          if (worst)
            Container(
              margin: const EdgeInsets.only(bottom: 14),
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(
                color: DanColors.late.withValues(alpha: .1),
                border: Border.all(color: DanColors.late),
                borderRadius: BorderRadius.circular(DanRadius.md),
              ),
              child: Row(children: [
                const Icon(Icons.warning_amber_rounded, color: DanColors.late),
                const SizedBox(width: 10),
                Expanded(
                    child: Text(_shortfallMessage(forecast),
                        style: const TextStyle(
                            fontSize: 13,
                            fontWeight: FontWeight.w700,
                            color: DanColors.late))),
              ]),
            ),
          Row(children: [
            Expanded(
                child: _mini(t('TB tiền vào/ngày'), avgIn, DanColors.done)),
            const SizedBox(width: 10),
            Expanded(
                child: _mini(t('TB tiền ra/ngày'), avgOut, DanColors.late)),
          ]),
          const SizedBox(height: 14),
          for (final f in forecast) _horizonCard(f),
          const SizedBox(height: 16),
          _obligationsCard(),
          const SizedBox(height: 10),
          Text(
            t('* Dự báo tính bảo toàn: tiền vào/ra trung bình 30 ngày gần nhất + nghĩa vụ định kỳ + toàn bộ nợ NCC coi như phải trả trong kỳ.'),
            style: const TextStyle(fontSize: 11, color: DanColors.faint),
          ),
        ],
      ),
    );
  }

  String _shortfallMessage(List<Map<String, dynamic>> forecast) {
    final f = forecast.firstWhere((x) => _n(x['shortfall']) > 0,
        orElse: () => forecast.isNotEmpty ? forecast.last : {});
    final d = _n(f['horizon_days']).toInt();
    final s = _n(f['shortfall']);
    return '${t('Cảnh báo')}: trong $d ${t('ngày tới dự kiến THIẾU HỤT')} ${Fmt.money(s)} — ${t('cân đối thu/chi hoặc giãn thanh toán')}.';
  }

  Widget _mini(String label, num value, Color color) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: DanColors.surface,
        border: Border.all(color: DanColors.border),
        borderRadius: BorderRadius.circular(DanRadius.md),
      ),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(label,
            style: const TextStyle(fontSize: 11.5, color: DanColors.muted)),
        const SizedBox(height: 4),
        Text(Fmt.money(value),
            style: TextStyle(
                fontSize: 16, fontWeight: FontWeight.w900, color: color)),
      ]),
    );
  }

  Widget _horizonCard(Map<String, dynamic> f) {
    final days = _n(f['horizon_days']).toInt();
    final projected = _n(f['projected_cash']);
    final shortfall = _n(f['shortfall']) > 0;
    final color = shortfall ? DanColors.late : DanColors.done;
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: DanColors.surface,
        border: Border.all(
            color: shortfall ? DanColors.late : DanColors.border,
            width: shortfall ? 1.5 : 1),
        borderRadius: BorderRadius.circular(DanRadius.lg),
      ),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          Text('${t('Sau')} $days ${t('ngày')}',
              style:
                  const TextStyle(fontSize: 14, fontWeight: FontWeight.w900)),
          const Spacer(),
          Text('${t('Tồn dự kiến')}: ${Fmt.money(projected)}',
              style: TextStyle(
                  fontSize: 15, fontWeight: FontWeight.w900, color: color)),
        ]),
        const SizedBox(height: 8),
        _fline(t('Tiền hiện có'), _n(f['opening_cash']), DanColors.text),
        _fline(
            '+ ${t('Dự kiến thu')}', _n(f['expected_inflow']), DanColors.done),
        _fline(
            '− ${t('Dự kiến chi')}', _n(f['expected_outflow']), DanColors.late),
        if (_n(f['recurring_due']) > 0)
          _fline('   ${t('trong đó nghĩa vụ định kỳ')}', _n(f['recurring_due']),
              DanColors.muted),
        if (_n(f['accounts_payable']) > 0)
          _fline('   ${t('trong đó nợ NCC')}', _n(f['accounts_payable']),
              DanColors.muted),
      ]),
    );
  }

  Widget _fline(String label, num value, Color color) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 2),
      child: Row(children: [
        Text(label,
            style: const TextStyle(fontSize: 12.5, color: DanColors.muted)),
        const Spacer(),
        Text(Fmt.money(value),
            style: TextStyle(
                fontSize: 12.5, fontWeight: FontWeight.w700, color: color)),
      ]),
    );
  }

  Widget _obligationsCard() {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: DanColors.surface,
        border: Border.all(color: DanColors.border),
        borderRadius: BorderRadius.circular(DanRadius.lg),
      ),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Row(children: [
          Expanded(
              child: Text(t('Nghĩa vụ định kỳ (lương, thuê, điện…)'),
                  style: const TextStyle(
                      fontSize: 13, fontWeight: FontWeight.w800))),
          FilledButton.icon(
            onPressed: () => _editObligation(),
            icon: const Icon(Icons.add, size: 16),
            label: Text(t('Thêm'), style: const TextStyle(fontSize: 12)),
            style: FilledButton.styleFrom(minimumSize: const Size(0, 32)),
          ),
        ]),
        const SizedBox(height: 8),
        if (_obligations.isEmpty)
          Padding(
              padding: const EdgeInsets.symmetric(vertical: 6),
              child: Text(
                  t('Chưa khai nghĩa vụ định kỳ nào — thêm để dự báo chính xác hơn.'),
                  style: const TextStyle(fontSize: 12, color: DanColors.faint)))
        else
          for (final o in _obligations)
            InkWell(
              onTap: () => _editObligation(o),
              child: Padding(
                padding: const EdgeInsets.symmetric(vertical: 6),
                child: Row(children: [
                  Expanded(
                    child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(_s(o['name']),
                              style: const TextStyle(
                                  fontSize: 13, fontWeight: FontWeight.w700)),
                          Text(
                              '${t('Ngày')} ${_n(o['day_of_month']).toInt()} ${t('hàng tháng')}'
                              '${_s(o['category']).isNotEmpty ? ' · ${_s(o['category'])}' : ''}',
                              style: const TextStyle(
                                  fontSize: 11, color: DanColors.faint)),
                        ]),
                  ),
                  Text(Fmt.money(_n(o['amount'])),
                      style: const TextStyle(
                          fontSize: 13,
                          fontWeight: FontWeight.w800,
                          color: DanColors.late)),
                  IconButton(
                    onPressed: () => _deleteObligation(o),
                    visualDensity: VisualDensity.compact,
                    icon: const Icon(Icons.delete_outline,
                        size: 18, color: DanColors.faint),
                  ),
                ]),
              ),
            ),
      ]),
    );
  }
}

class _ObligationDialog extends StatefulWidget {
  final Map<String, dynamic>? obligation;
  const _ObligationDialog({this.obligation});
  @override
  State<_ObligationDialog> createState() => _ObligationDialogState();
}

class _ObligationDialogState extends State<_ObligationDialog> {
  final _name = TextEditingController();
  final _amount = TextEditingController();
  final _category = TextEditingController();
  int _day = 1;
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    final o = widget.obligation;
    _name.text = _s(o?['name']);
    _amount.text =
        _n(o?['amount']) > 0 ? _n(o?['amount']).round().toString() : '';
    _category.text = _s(o?['category']);
    _day = _n(o?['day_of_month']).toInt().clamp(1, 31);
    if (_day < 1) _day = 1;
  }

  @override
  void dispose() {
    _name.dispose();
    _amount.dispose();
    _category.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (_name.text.trim().isEmpty ||
        (int.tryParse(_amount.text.trim()) ?? 0) <= 0) {
      appToast(context, t('Nhập tên và số tiền'), isError: true);
      return;
    }
    setState(() => _saving = true);
    try {
      await context.read<ApiService>().saveObligation({
        if (widget.obligation != null) 'id': _s(widget.obligation!['id']),
        'name': _name.text.trim(),
        'amount': int.tryParse(_amount.text.trim()) ?? 0,
        'category': _category.text.trim(),
        'day_of_month': _day,
      });
      if (mounted) Navigator.of(context).pop(true);
    } catch (e) {
      if (mounted) {
        setState(() => _saving = false);
        appToast(context, e.toString().replaceFirst('Exception: ', ''),
            isError: true);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      backgroundColor: DanColors.surface,
      title: Text(widget.obligation == null
          ? t('Thêm nghĩa vụ định kỳ')
          : t('Sửa nghĩa vụ')),
      content: SizedBox(
        width: dialogWidth(context, 380),
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          TextField(
              controller: _name,
              autofocus: true,
              decoration:
                  InputDecoration(labelText: t('Tên (lương, thuê mặt bằng…)'))),
          const SizedBox(height: 12),
          TextField(
              controller: _amount,
              keyboardType: TextInputType.number,
              decoration: InputDecoration(labelText: t('Số tiền / tháng'))),
          const SizedBox(height: 12),
          TextField(
              controller: _category,
              decoration: InputDecoration(labelText: t('Danh mục (tuỳ chọn)'))),
          const SizedBox(height: 12),
          DropdownButtonFormField<int>(
            initialValue: _day,
            decoration: InputDecoration(labelText: t('Ngày trong tháng')),
            items: [
              for (var d = 1; d <= 31; d++)
                DropdownMenuItem(value: d, child: Text('$d'))
            ],
            onChanged: (v) => setState(() => _day = v ?? 1),
          ),
        ]),
      ),
      actions: [
        TextButton(
            onPressed: () => Navigator.of(context).pop(),
            child: Text(t('Hủy'))),
        FilledButton(
          onPressed: _saving ? null : _save,
          child: _saving
              ? const SizedBox(
                  width: 18,
                  height: 18,
                  child: CircularProgressIndicator(
                      strokeWidth: 2, color: Colors.white))
              : Text(t('Lưu')),
        ),
      ],
    );
  }
}
