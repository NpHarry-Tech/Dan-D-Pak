import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';


import '../../models/kds_models.dart';
import '../../providers/auth_provider.dart';
import '../../services/api_service.dart';
import '../../services/socket_service.dart';
import '../../ui/app_theme.dart';
import '../../ui/debouncer.dart';
import '../../widgets/dan_top_bar.dart';
import '../management/management_widgets.dart';
import '../../services/black_box.dart';

const _stations = [
  ['all', 'Tất cả'],
  ['kitchen', 'Bếp'],
  ['bar', 'Bar'],
  ['salad', 'Salad/Lạnh'],
  ['beverage', 'Beverage'],
];

/// Native port of the web KDS (kds.html): kitchen display with a station
/// filter bar, live ticket grid (timers + SLA), and status-transition actions.
class KdsScreen extends StatefulWidget {
  const KdsScreen({super.key});

  @override
  State<KdsScreen> createState() => _KdsScreenState();
}

class _KdsScreenState extends State<KdsScreen> {
  final SocketService _socketService = SocketService();
  final Debouncer _socketRefresh = Debouncer();
  Timer? _ticker;
  List<KdsTicket> _tickets = [];
  String _station = 'all';
  bool _loading = true;
  final bool _online = true;
  bool _disposed = false;
  String? _error;
  // The 1s ticker only bumps this notifier: each ticket card / station chip
  // listens to it individually, so the grid is NOT rebuilt+resorted every
  // second (that full-screen setState visibly janked weak POS hardware).
  final ValueNotifier<DateTime> _now = ValueNotifier(DateTime.now());

  @override
  void initState() {
    super.initState();
    BlackBox.screen = 'kds';
    _ticker = Timer.periodic(const Duration(seconds: 1), (_) {
      if (mounted) _now.value = DateTime.now();
    });
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _connect();
      _load();
    });
  }

  void _connect() {
    if (_disposed || !mounted) return;
    final auth = context.read<AuthProvider>();
    _socketService.connect(
      baseUrl: auth.serverUrl,
      branch: auth.selectedBranchId,
      token: auth.token ?? '',
    );
    _socketService.addListener(_onSocketEvent);
  }

  void _onSocketEvent(String event, dynamic payload) {
    if (_disposed || !mounted) return;
    if (event == 'order:item' ||
        event == 'order:updated' ||
        event == 'order:confirmed' ||
        event == 'table:updated' ||
        event == 'kds:updated' ||
        event == 'stats:dirty' ||
        event == kSyncReconnected) {
      _socketRefresh(() {
        if (!_disposed && mounted) _load(silent: true);
      });
    }
  }

  @override
  void dispose() {
    _disposed = true;
    _ticker?.cancel();
    _socketRefresh.dispose();
    _now.dispose();
    _socketService.removeListener(_onSocketEvent);
    super.dispose();
  }

  Future<void> _load({bool silent = false}) async {
    if (!silent) setState(() => _loading = true);
    try {
      final rows = await context.read<ApiService>().getKdsTickets('all');
      if (!mounted) return;
      setState(() {
        _tickets = rows
            .whereType<Map>()
            .map((e) => KdsTicket.fromJson(Map<String, dynamic>.from(e)))
            .toList();
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

  Future<void> _act(KdsTicket t, String action) async {
    final api = context.read<ApiService>();
    try {
      if (action == 'dismiss') {
        await api.kdsDismiss(t.id);
      } else {
        await api.setItemStatus(t.id, action);
      }
      _load(silent: true);
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text(e.toString().replaceFirst('Exception: ', '')),
          backgroundColor: DanColors.late,
        ));
      }
    }
  }

  int _stationActiveCount(String k) => _tickets
      .where((t) => t.isActive && !t.isReady)
      .where((t) => k == 'all' || t.station == k)
      .length;

  int _stationLateCount(String k, DateTime now) => _tickets
      .where((t) => t.isActive && !t.isReady && t.isLate(now))
      .where((t) => k == 'all' || t.station == k)
      .length;

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final user = auth.currentUser;
    final branch = auth.selectedBranch;

    // Visible = everything the server returned (active + cancelled-not-dismissed),
    // filtered by the selected station, oldest first. Computed only when the
    // ticket data / station filter change — not on the per-second clock tick.
    final fallback = DateTime.now();
    final visible = _tickets
        .where((t) => t.status != 'served')
        .where((t) => _station == 'all' || t.station == _station)
        .toList()
      ..sort((a, b) =>
          (a.createdAt ?? fallback).compareTo(b.createdAt ?? fallback));

    return Scaffold(
      backgroundColor: DanColors.bg,
      appBar: DanModuleTopBar(
        brandName: branch.name.isNotEmpty ? branch.name : branch.id,
        title: 'Màn hình bếp (KDS)',
        subtitle: '',
        titleIcon: Icons.soup_kitchen_outlined,
        userName: user?.name ?? '—',
        userRole: roleLabel(user?.role ?? ''),
        online: _online,
        onBack: () => Navigator.of(context).maybePop(),
        onLogout: () => auth.logout(),
      ),
      body: Column(
        children: [
          _stationBar(),
          const Divider(height: 1, color: DanColors.border),
          Expanded(child: _body(visible)),
        ],
      ),
    );
  }

  Widget _stationBar() {
    return Container(
      width: double.infinity,
      color: DanColors.surface,
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      child: SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        // Late counts depend on the clock — rebuild just this small chip row
        // per second, never the ticket grid above/below it.
        child: ValueListenableBuilder<DateTime>(
          valueListenable: _now,
          builder: (_, now, __) => Row(
            children: [
              for (final s in _stations) ...[
                _StationButton(
                  label: s[1],
                  active: _station == s[0],
                  count: _stationActiveCount(s[0]),
                  lateCount: _stationLateCount(s[0], now),
                  onTap: () => setState(() => _station = s[0]),
                ),
                const SizedBox(width: 8),
              ],
            ],
          ),
        ),
      ),
    );
  }

  Widget _body(List<KdsTicket> visible) {
    if (_loading && _tickets.isEmpty) {
      return const Center(child: CircularProgressIndicator());
    }
    if (_error != null && _tickets.isEmpty) {
      return Padding(
        padding: const EdgeInsets.all(40),
        child: InlineMessage('Không tải được phiếu bếp ($_error)',
            error: true, onRetry: _load),
      );
    }
    if (visible.isEmpty) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              'Không có món nào đang chờ${_station != 'all' ? ' ở station này' : ''}',
              style: const TextStyle(
                  fontSize: 16, fontWeight: FontWeight.w700, color: DanColors.muted),
            ),
            const SizedBox(height: 4),
            const Text('Order mới sẽ hiện ở đây realtime',
                style: TextStyle(fontSize: 13, color: DanColors.faint)),
          ],
        ),
      );
    }
    return RefreshIndicator(
      onRefresh: _load,
      child: GridView.builder(
        padding: const EdgeInsets.all(16),
        gridDelegate: const SliverGridDelegateWithMaxCrossAxisExtent(
          maxCrossAxisExtent: 320,
          mainAxisExtent: 230,
          crossAxisSpacing: 14,
          mainAxisSpacing: 14,
        ),
        itemCount: visible.length,
        itemBuilder: (_, i) =>
            _TicketCard(ticket: visible[i], now: _now, onAction: _act),
      ),
    );
  }
}

class _StationButton extends StatelessWidget {
  final String label;
  final bool active;
  final int count;
  final int lateCount;
  final VoidCallback onTap;

  const _StationButton({
    required this.label,
    required this.active,
    required this.count,
    required this.lateCount,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(DanRadius.sm),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 9),
        decoration: BoxDecoration(
          color: active ? DanColors.brand : DanColors.surface2,
          borderRadius: BorderRadius.circular(DanRadius.sm),
          border: Border.all(
              color: lateCount > 0 ? DanColors.late : Colors.transparent,
              width: 1.5),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(label,
                style: TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w800,
                    color: active ? Colors.white : DanColors.text)),
            if (count > 0) ...[
              const SizedBox(width: 7),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 1),
                decoration: BoxDecoration(
                  color: active ? Colors.white24 : DanColors.brand,
                  borderRadius: BorderRadius.circular(99),
                ),
                child: Text('$count',
                    style: TextStyle(
                        fontSize: 11.5,
                        fontWeight: FontWeight.w900,
                        color: active ? Colors.white : Colors.white)),
              ),
            ],
            if (lateCount > 0) ...[
              const SizedBox(width: 5),
              Text('$lateCount trễ',
                  style: const TextStyle(
                      fontSize: 11,
                      fontWeight: FontWeight.w800,
                      color: DanColors.late)),
            ],
          ],
        ),
      ),
    );
  }
}

class _TicketCard extends StatelessWidget {
  final KdsTicket ticket;
  final ValueListenable<DateTime> now;
  final void Function(KdsTicket, String) onAction;

  const _TicketCard(
      {required this.ticket, required this.now, required this.onAction});

  @override
  Widget build(BuildContext context) {
    // Each card re-renders itself once per second for its timer/SLA bar —
    // the parent grid does not.
    return ValueListenableBuilder<DateTime>(
      valueListenable: now,
      builder: (context, tick, _) => _build(context, tick),
    );
  }

  Widget _build(BuildContext context, DateTime now) {
    final t = ticket;
    final elapsed = t.elapsedMinutes(now);
    final late = t.isLate(now);
    final mm = elapsed.floor();
    final ss = ((elapsed - mm) * 60).floor();
    final pct = (elapsed / t.slaMinutes).clamp(0.0, 1.0);

    Color borderColor = DanColors.border;
    if (t.isCancelled || late) {
      borderColor = DanColors.late;
    } else if (t.isReady) {
      borderColor = DanColors.done;
    }

    final order5 = t.orderId.length >= 5
        ? t.orderId.substring(t.orderId.length - 5).toUpperCase()
        : t.orderId.toUpperCase();

    Color slaColor() {
      if (t.isCancelled) return DanColors.faint;
      if (late) return DanColors.late;
      return pct > 0.7 ? DanColors.doing : DanColors.done;
    }

    return Container(
      decoration: BoxDecoration(
        color: t.isCancelled ? const Color(0xFFFFF5F5) : DanColors.surface,
        border: Border.all(color: borderColor, width: late || t.isReady ? 1.5 : 1),
        borderRadius: BorderRadius.circular(13),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // header
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
            decoration: BoxDecoration(
              color: t.isCancelled ? const Color(0xFFFFEBEE) : DanColors.surface2,
              border: const Border(bottom: BorderSide(color: DanColors.border)),
              borderRadius: const BorderRadius.vertical(top: Radius.circular(12)),
            ),
            child: Row(
              children: [
                Text('#$order5',
                    style: const TextStyle(
                        fontFamily: 'JetBrains Mono',
                        fontWeight: FontWeight.w700,
                        fontSize: 12,
                        color: DanColors.brand)),
                const SizedBox(width: 8),
                Flexible(
                  child: Text(t.tableCode.isEmpty ? '—' : t.tableCode,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                          fontFamily: 'JetBrains Mono',
                          fontSize: 11,
                          color: DanColors.muted)),
                ),
                const Spacer(),
                Text('${late ? '⚠ ' : ''}$mm:${ss.toString().padLeft(2, '0')}',
                    style: TextStyle(
                        fontFamily: 'JetBrains Mono',
                        fontSize: 13,
                        fontWeight: FontWeight.w700,
                        color: late ? DanColors.late : DanColors.text)),
              ],
            ),
          ),
          // body
          Expanded(
            child: Padding(
              padding: const EdgeInsets.fromLTRB(13, 11, 13, 8),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('${t.qty}× ',
                          style: const TextStyle(
                              fontFamily: 'JetBrains Mono',
                              fontWeight: FontWeight.w800,
                              fontSize: 15,
                              color: DanColors.brand)),
                      Expanded(
                        child: Text(t.name,
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                                fontWeight: FontWeight.w700, fontSize: 15)),
                      ),
                    ],
                  ),
                  if (t.isCancelled)
                    Container(
                      margin: const EdgeInsets.only(top: 4),
                      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                      decoration: BoxDecoration(
                        color: const Color(0xFFFFEBEE),
                        border: Border.all(color: DanColors.late.withValues(alpha: .4)),
                        borderRadius: BorderRadius.circular(4),
                      ),
                      child: const Text('MÓN ĐÃ HỦY',
                          style: TextStyle(
                              fontSize: 11,
                              fontWeight: FontWeight.w800,
                              color: DanColors.late)),
                    ),
                  if (t.mods.isNotEmpty)
                    Padding(
                      padding: const EdgeInsets.only(top: 3),
                      child: Text('+ ${t.mods.join(', ')}',
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                              fontSize: 12, color: DanColors.doing)),
                    ),
                  if (t.note.isNotEmpty)
                    Container(
                      margin: const EdgeInsets.only(top: 7),
                      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 6),
                      decoration: const BoxDecoration(
                        color: Color(0x1AFFC24D),
                        border: Border(
                            left: BorderSide(color: DanColors.doing, width: 3)),
                        borderRadius: BorderRadius.only(
                            topRight: Radius.circular(7),
                            bottomRight: Radius.circular(7)),
                      ),
                      child: Text(t.note,
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(fontSize: 12, color: DanColors.text)),
                    ),
                  const Spacer(),
                  Row(
                    children: [
                      Text('⏱ SLA ${t.slaMinutes}′',
                          style: const TextStyle(
                              fontSize: 10.5, color: DanColors.faint)),
                      const SizedBox(width: 8),
                      Expanded(
                        child: ClipRRect(
                          borderRadius: BorderRadius.circular(4),
                          child: LinearProgressIndicator(
                            value: pct,
                            minHeight: 5,
                            backgroundColor: DanColors.surface3,
                            valueColor: AlwaysStoppedAnimation(slaColor()),
                          ),
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ),
          // action
          Padding(
            padding: const EdgeInsets.fromLTRB(11, 0, 11, 11),
            child: _actionButton(),
          ),
        ],
      ),
    );
  }

  Widget _actionButton() {
    final t = ticket;
    String label;
    String act;
    Color color;
    switch (t.status) {
      case 'cancelled':
        label = 'Xác nhận đã hủy';
        act = 'dismiss';
        color = DanColors.late;
        break;
      case 'new':
        label = 'Nhận món';
        act = 'accepted';
        color = DanColors.brand;
        break;
      case 'accepted':
        label = 'Bắt đầu làm';
        act = 'preparing';
        color = DanColors.doing;
        break;
      case 'preparing':
        label = 'Xong';
        act = 'ready';
        color = DanColors.done;
        break;
      case 'ready':
        label = 'Đã giao';
        act = 'served';
        color = DanColors.muted;
        break;
      default:
        return const SizedBox.shrink();
    }
    return SizedBox(
      width: double.infinity,
      height: 38,
      child: FilledButton(
        onPressed: () => onAction(t, act),
        style: FilledButton.styleFrom(
          backgroundColor: color,
          foregroundColor: Colors.white,
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
        ),
        child: Text(label,
            style: const TextStyle(fontSize: 13.5, fontWeight: FontWeight.w800)),
      ),
    );
  }
}
