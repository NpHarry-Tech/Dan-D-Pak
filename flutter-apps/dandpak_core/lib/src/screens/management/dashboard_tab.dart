import 'package:flutter/material.dart';

import '../../models/management_models.dart';
import '../../services/api_service.dart';
import '../../ui/app_theme.dart';
import '../../ui/format.dart';
import 'management_widgets.dart';
import '../../utils/translation.dart';

/// Management → Dashboard tab. Full parity with the web admin dashboard:
/// KPI cards, business-window note, top items, revenue-by-hour, revenue
/// trends (day/week/month/quarter/year), payment methods, revenue by channel
/// and live station load.
class DashboardTab extends StatefulWidget {
  final ApiService api;
  final Listenable refresh;

  DashboardTab({super.key, required this.api, required this.refresh});

  @override
  State<DashboardTab> createState() => _DashboardTabState();
}

class _DashboardTabState extends State<DashboardTab> {
  static final _trendKeys = [
    'byDay',
    'byWeek',
    'byMonth',
    'byQuarter',
    'byYear'
  ];
  static final _trendLabels = [
    t('Ngày'),
    t('Tuần'),
    t('Tháng'),
    t('Quý'),
    t('Năm')
  ];
  static final _trendSub = {
    'byDay': t('7 ngày gần nhất'),
    'byWeek': t('8 tuần gần nhất'),
    'byMonth': t('12 tháng gần nhất'),
    'byQuarter': t('8 quý gần nhất'),
    'byYear': t('5 năm gần nhất'),
  };

  DashboardData? _data;
  TrendsData? _trends;
  String? _error;
  bool _loading = true;
  int _trendIndex = 0;

  @override
  void initState() {
    super.initState();
    widget.refresh.addListener(_reload);
    _load();
  }

  @override
  void dispose() {
    widget.refresh.removeListener(_reload);
    super.dispose();
  }

  void _reload() => _load(silent: true);

  Future<void> _load({bool silent = false}) async {
    if (!silent) setState(() => _loading = true);
    try {
      final results = await Future.wait([
        widget.api.getDashboard(),
        widget.api.getDashboardTrends(),
      ]);
      if (!mounted) return;
      setState(() {
        _data = DashboardData.fromJson(results[0]);
        _trends = TrendsData.fromJson(results[1]);
        _error = null;
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

  @override
  Widget build(BuildContext context) {
    if (_loading && _data == null) {
      return Center(child: CircularProgressIndicator());
    }
    if (_error != null && _data == null) {
      return Padding(
        padding: EdgeInsets.all(40),
        child: InlineMessage(t('Không tải được số liệu ($_error)'),
            error: true, onRetry: _load),
      );
    }
    final d = _data!;

    return RefreshIndicator(
      onRefresh: _load,
      child: LayoutBuilder(
        builder: (context, constraints) {
          final wide = constraints.maxWidth >= 900;
          return ListView(
            padding: EdgeInsets.all(20),
            children: [
              _kpiRow(d, constraints.maxWidth),
              SizedBox(height: 10),
              _windowNote(d.window),
              SizedBox(height: 18),
              _topItemsPanel(d),
              SizedBox(height: 16),
              _twoCol(wide, _hourPanel(d), _trendPanel()),
              SizedBox(height: 16),
              _twoCol(wide, _payAndChannelPanel(d), _stationPanel(d)),
              SizedBox(height: 16),
              if (d.lowStock.isNotEmpty) _lowStockPanel(d),
            ],
          );
        },
      ),
    );
  }

  Widget _twoCol(bool wide, Widget a, Widget b) {
    if (!wide) {
      return Column(children: [a, SizedBox(height: 16), b]);
    }
    return IntrinsicHeight(
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Expanded(child: a),
          SizedBox(width: 16),
          Expanded(child: b),
        ],
      ),
    );
  }

  // ── KPIs ────────────────────────────────────────────────────────────
  Widget _kpiRow(DashboardData d, double maxWidth) {
    final cards = [
      KpiCard(
          label: t('Doanh thu ca hôm nay'),
          value: Fmt.money(d.revenue),
          valueColor: DanColors.brand),
      KpiCard(
          label: t('Số bill'),
          value: Fmt.int0(d.bills),
          valueColor: DanColors.done),
      KpiCard(label: t('Bill trung bình'), value: Fmt.money(d.avg)),
      KpiCard(
          label: t('Đơn đang mở'),
          value: Fmt.int0(d.openOrders),
          valueColor: DanColors.doing),
      KpiCard(
          label: t('Cảnh báo kho'),
          value: Fmt.int0(d.lowStock.length),
          valueColor: d.lowStock.isNotEmpty ? DanColors.late : DanColors.done),
    ];
    final gap = 14.0;

    if (maxWidth >= 1180) {
      return SizedBox(
        height: 112,
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            for (var i = 0; i < cards.length; i++) ...[
              if (i > 0) SizedBox(width: gap),
              Expanded(child: cards[i]),
            ],
          ],
        ),
      );
    }

    final columns = maxWidth >= 1000
        ? 4
        : maxWidth >= 760
            ? 4
            : maxWidth >= 560
                ? 3
                : maxWidth >= 380
                    ? 2
                    : 1;
    final cardWidth = (maxWidth - gap * (columns - 1)) / columns;
    return Wrap(
      spacing: gap,
      runSpacing: gap,
      children: [
        for (final c in cards) SizedBox(width: cardWidth, child: c),
      ],
    );
  }

  Widget _windowNote(DashboardWindow w) {
    final start = w.start;
    final startText = start != null ? Fmt.dmyHm(start) : '—';
    final endText =
        w.closed && w.end != null ? Fmt.dmyHm(w.end!) : t('hiện tại');
    final text = w.isShift
        ? '${t('Doanh thu được tính từ lúc mở ca đầu ngày')} $startText ${t('đến')} $endText.'
        : '${t('Chưa có ca được mở hôm nay, tạm tính theo ngày lịch từ')} $startText ${t('đến')} $endText.';
    return Text(text,
        style: TextStyle(
            fontSize: 12.5,
            color: DanColors.muted,
            fontWeight: FontWeight.w500));
  }

  // ── Top items ───────────────────────────────────────────────────────
  Widget _topItemsPanel(DashboardData d) {
    return Panel(
      title: t('🔥 Top món bán chạy hôm nay'),
      child: d.topItems.isEmpty
          ? Padding(
              padding: EdgeInsets.symmetric(vertical: 18),
              child: Center(
                  child: Text(t('Chưa bán món nào'),
                      style: TextStyle(color: DanColors.faint))),
            )
          : Column(
              children: [
                _TopItemHeader(),
                Divider(height: 14, color: DanColors.border),
                for (var i = 0; i < d.topItems.length; i++) ...[
                  _TopItemRow(rank: i + 1, item: d.topItems[i]),
                  if (i < d.topItems.length - 1)
                    Divider(height: 12, color: DanColors.border),
                ],
              ],
            ),
    );
  }

  // ── Revenue by hour ─────────────────────────────────────────────────
  Widget _hourPanel(DashboardData d) {
    final hours = _dashboardHours(d.window);
    final bars = [
      for (final h in hours)
        BarDatum(
          value: d.byHour[h],
          topLabel: d.byHour[h] > 0 ? Fmt.moneyShort(d.byHour[h]) : '',
          axisLabel: '${h}h',
          tooltip:
              '${h.toString().padLeft(2, '0')}:00 — ${Fmt.money(d.byHour[h])}',
        ),
    ];
    return Panel(
      title: t('Doanh thu theo giờ'),
      child: VerticalBarChart(
          bars: bars, emptyText: t('Chưa có doanh thu hôm nay')),
    );
  }

  List<int> _dashboardHours(DashboardWindow w) {
    final nowH = DateTime.now().hour;
    int from, to;
    if (w.start == null || w.end == null) {
      from = 8;
      to = nowH > 8 ? nowH : 8;
    } else {
      from = w.start!.hour;
      to = w.end!.hour;
      if (to < from) return List<int>.generate(24, (i) => i); // spans midnight
    }
    from = from.clamp(0, 23);
    to = to.clamp(from, 23);
    final minCols = 8;
    if (to - from + 1 < minCols) from = (to - (minCols - 1)).clamp(0, 23);
    return [for (var i = from; i <= to; i++) i];
  }

  // ── Revenue trends ──────────────────────────────────────────────────
  Widget _trendPanel() {
    final key = _trendKeys[_trendIndex];
    final series = _trends?.range(key) ?? [];
    final total = series.fold<num>(0, (a, s) => a + s.value);
    final active = series.where((s) => s.value > 0).toList();
    final avg = active.isNotEmpty ? (total / active.length) : 0;
    final maxV = series.fold<num>(1, (a, s) => s.value > a ? s.value : a);
    final bars = [
      for (final s in series)
        BarDatum(
          value: s.value,
          topLabel: s.value > 0 ? Fmt.moneyShort(s.value) : '',
          axisLabel: s.label,
          tooltip: '${s.label} — ${Fmt.money(s.value)}',
        ),
    ];

    return Panel(
      title: t('Doanh thu theo thời gian'),
      trailing: SegmentedTabs(
        labels: _trendLabels,
        selected: _trendIndex,
        onChanged: (i) => setState(() => _trendIndex = i),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(Fmt.money(total),
                        style: TextStyle(
                            fontSize: 24, fontWeight: FontWeight.w900)),
                    Text(_trendSub[key] ?? '',
                        style:
                            TextStyle(fontSize: 11.5, color: DanColors.muted)),
                  ],
                ),
              ),
              _trendStat(t('TB/KỲ'), Fmt.moneyShort(avg)),
              SizedBox(width: 16),
              _trendStat(t('CAO NHẤT'), Fmt.moneyShort(maxV > 1 ? maxV : 0)),
            ],
          ),
          SizedBox(height: 14),
          VerticalBarChart(
              bars: bars, emptyText: t('Chưa có doanh thu trong kỳ này')),
        ],
      ),
    );
  }

  Widget _trendStat(String label, String value) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.end,
      children: [
        Text(label,
            style: TextStyle(
                fontSize: 10,
                color: DanColors.faint,
                fontWeight: FontWeight.w800,
                letterSpacing: .3)),
        SizedBox(height: 2),
        Text(value,
            style: TextStyle(fontSize: 14, fontWeight: FontWeight.w900)),
      ],
    );
  }

  // ── Payment methods + channels ──────────────────────────────────────
  Widget _payAndChannelPanel(DashboardData d) {
    final timeRef = d.window.isShift ? t('(Ca hôm nay)') : t('(Trong ngày)');

    final methodLabels = {
      'cash': t('Tiền mặt'),
      'card': t('Thẻ'),
      'qr': 'QR',
      'voucher': 'Voucher',
      'bank_transfer': t('Chuyển khoản'),
      'online': 'Online',
    };
    final methodColors = {
      'cash': Color(0xFF3FE08F),
      'card': Color(0xFF5EA3FF),
      'qr': Color(0xFFB58CFF),
      'voucher': Color(0xFFFFC24D),
      'bank_transfer': Color(0xFF34D2EE),
      'online': Color(0xFFFF8F70),
    };
    final methodTotal = d.methods.fold<num>(0, (a, m) => a + m.amount);

    final channelLabels = {
      'dine_in': t('Tại bàn'),
      'retail': 'Retail',
      'online': 'Online',
    };
    final channelColors = {
      'dine_in': Color(0xFF3FE08F),
      'retail': Color(0xFF34D2EE),
      'online': Color(0xFFB58CFF),
    };
    final channels = d.byChannel.entries.toList();
    final channelTotal = channels.fold<num>(0, (a, e) => a + e.value);

    return Panel(
      title: '${t('Phương thức thanh toán')}  $timeRef',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (d.methods.isEmpty)
            _EmptyData()
          else
            for (final m in d.methods)
              StatBarRow(
                label: methodLabels[m.method] ?? m.method,
                value: m.amount,
                total: methodTotal,
                color: methodColors[m.method] ?? Color(0xFF34D2EE),
                valueText: Fmt.money(m.amount),
              ),
          SizedBox(height: 16),
          Text(t('Doanh thu theo kênh'),
              style: TextStyle(fontSize: 13.5, fontWeight: FontWeight.w800)),
          SizedBox(height: 8),
          if (channels.isEmpty)
            _EmptyData()
          else
            for (final e in channels)
              StatBarRow(
                label: channelLabels[e.key] ?? e.key,
                value: e.value,
                total: channelTotal,
                color: channelColors[e.key] ?? Color(0xFF34D2EE),
                valueText: Fmt.money(e.value),
              ),
        ],
      ),
    );
  }

  // ── Station load ────────────────────────────────────────────────────
  Widget _stationPanel(DashboardData d) {
    final stations = ['kitchen', 'bar', 'salad', 'beverage'];
    final labels = {
      'kitchen': t('🍳 Bếp'),
      'bar': '🍸 Bar',
      'salad': '🥗 Salad',
      'beverage': '🥤 Beverage',
    };
    int countFor(String s) => d.stations
        .firstWhere((x) => x.station == s, orElse: () => StationLoad('', 0))
        .count;

    return Panel(
      title: t('Tải các station'),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          for (final s in stations)
            Builder(builder: (_) {
              final n = countFor(s);
              return StatBarRow(
                label: labels[s]!,
                value: n,
                total: 0,
                fraction: (n * 0.2).clamp(0.0, 1.0),
                color: n > 4 ? DanColors.late : DanColors.done,
                valueText: n > 0 ? '$n ${t('món')}' : t('Nhàn rỗi'),
                idle: n == 0,
              );
            }),
        ],
      ),
    );
  }

  // ── Low stock ───────────────────────────────────────────────────────
  Widget _lowStockPanel(DashboardData d) {
    return Panel(
      title: '⚠️ ${t('Cảnh báo tồn kho')} (${d.lowStock.length})',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          for (final s in d.lowStock.take(20))
            Padding(
              padding: EdgeInsets.symmetric(vertical: 5),
              child: Row(
                children: [
                  Expanded(
                    child: Text(s.name,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                            fontSize: 13, fontWeight: FontWeight.w600)),
                  ),
                  Text(
                      '${Fmt.int0(s.stock)} / ${Fmt.int0(s.minStock)} ${s.unit}',
                      style: TextStyle(
                          fontSize: 12.5,
                          fontWeight: FontWeight.w800,
                          color:
                              s.stock <= 0 ? DanColors.late : DanColors.doing)),
                ],
              ),
            ),
        ],
      ),
    );
  }
}

class _TopItemHeader extends StatelessWidget {
  _TopItemHeader();
  @override
  Widget build(BuildContext context) {
    final style = TextStyle(
        fontSize: 11,
        color: DanColors.faint,
        fontWeight: FontWeight.w800,
        letterSpacing: .3);
    return Row(
      children: [
        Expanded(child: Text(t('MÓN'), style: style)),
        SizedBox(
            width: 56,
            child: Text('SL', style: style, textAlign: TextAlign.right)),
        SizedBox(
            width: 120,
            child: Text('DOANH THU', style: style, textAlign: TextAlign.right)),
      ],
    );
  }
}

class _TopItemRow extends StatelessWidget {
  final int rank;
  final TopItem item;
  _TopItemRow({required this.rank, required this.item});

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        RankBadge(rank),
        SizedBox(width: 10),
        Expanded(
          child: Text(
            '${item.emoji.isNotEmpty ? '${item.emoji} ' : ''}${item.name}',
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(fontSize: 13.5, fontWeight: FontWeight.w600),
          ),
        ),
        SizedBox(
          width: 56,
          child: Text(Fmt.int0(item.qty),
              textAlign: TextAlign.right,
              style: TextStyle(fontSize: 13, fontWeight: FontWeight.w700)),
        ),
        SizedBox(
          width: 120,
          child: Text(
            Fmt.money(item.revenue),
            textAlign: TextAlign.right,
            style: TextStyle(
                fontSize: 13,
                fontWeight: FontWeight.w800,
                color: DanColors.brand),
          ),
        ),
      ],
    );
  }
}

class _EmptyData extends StatelessWidget {
  _EmptyData();
  @override
  Widget build(BuildContext context) => Padding(
        padding: EdgeInsets.symmetric(vertical: 10),
        child: Text(t('Chưa có dữ liệu'),
            style: TextStyle(color: DanColors.faint, fontSize: 13)),
      );
}
