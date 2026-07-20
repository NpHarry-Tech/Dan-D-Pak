import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../providers/auth_provider.dart';
import '../../services/api_service.dart';
import '../../services/socket_service.dart';
import '../../ui/app_theme.dart';
import '../../ui/debouncer.dart';
import '../../ui/format.dart';
import '../../widgets/dan_top_bar.dart';
import '../management/management_widgets.dart';
import '../../services/black_box.dart';
import '../../utils/translation.dart';

String _s(dynamic v) => v?.toString() ?? '';
num _n(dynamic v) => v is num ? v : num.tryParse(_s(v)) ?? 0;

({String name, String icon}) _channel(String key) {
  switch (key) {
    case 'grabfood':
    case 'grabmerchant':
      return (name: 'GrabFood', icon: '');
    case 'shopeefood':
      return (name: 'ShopeeFood', icon: '');
    case 'befood':
      return (name: 'beFood', icon: '');
    case 'grabmart':
      return (name: 'GrabMart', icon: '');
    default:
      return (name: 'Web', icon: '');
  }
}

List<List<String>> get _statusFilters => [
      ['', t('Tất cả')],
      ['unpaid', t('Chưa thanh toán')],
      ['paid', t('Đã thanh toán')],
      ['unshipped', t('Chưa giao')],
      ['shipped', t('Đã giao')],
    ];

/// Native port of the web Online (online.html): orders from GrabFood /
/// ShopeeFood / Web with payment + delivery confirmation.
class OnlineScreen extends StatefulWidget {
  OnlineScreen({super.key});

  @override
  State<OnlineScreen> createState() => _OnlineScreenState();
}

class _OnlineScreenState extends State<OnlineScreen> {
  final SocketService _socketService = SocketService();
  final Debouncer _socketRefresh = Debouncer();
  List<Map<String, dynamic>> _orders = [];
  Map<String, dynamic> _channels = {};
  String _channelFilter = '';
  String _statusFilter = '';
  bool _loading = true;
  bool _disposed = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    BlackBox.screen = 'online';
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _connect();
      _loadChannels();
      _load();
    });
  }

  void _connect() {
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
    if (event == 'order:new' ||
        event == 'order:updated' ||
        event == 'order:customer_pending' ||
        event == 'payment:done' ||
        event == 'online:order' ||
        event == kSyncReconnected) {
      _socketRefresh(() {
        if (!_disposed && mounted) _load(silent: true);
      });
    }
  }

  @override
  void dispose() {
    _disposed = true;
    _socketRefresh.dispose();
    _socketService.removeListener(_onSocketEvent);
    super.dispose();
  }

  Future<void> _loadChannels() async {
    try {
      final c = await context.read<ApiService>().getOnlineChannels();
      if (mounted) setState(() => _channels = c);
    } catch (_) {}
  }

  Future<void> _load({bool silent = false}) async {
    if (!silent) setState(() => _loading = true);
    try {
      final rows = await context.read<ApiService>().getOnlineOrders();
      if (!mounted) return;
      setState(() {
        _orders = rows
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

  Future<void> _act(
      String id, Future<void> Function() action, String ok) async {
    try {
      await action();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text(ok), backgroundColor: DanColors.text));
      }
      _load(silent: true);
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(
            content: Text(e.toString().replaceFirst('Exception: ', '')),
            backgroundColor: DanColors.late));
      }
    }
  }

  List<Map<String, dynamic>> get _filtered {
    return _orders.where((o) {
      if (_channelFilter.isNotEmpty &&
          _s(o['online_channel']) != _channelFilter) {
        return false;
      }
      final paid = _s(o['status']) == 'paid';
      final shipped = _s(o['online_status']) == 'completed';
      switch (_statusFilter) {
        case 'unpaid':
          return !paid;
        case 'paid':
          return paid;
        case 'unshipped':
          return !shipped;
        case 'shipped':
          return shipped;
        default:
          return true;
      }
    }).toList();
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final user = auth.currentUser;
    final branch = auth.selectedBranch;

    return Scaffold(
      backgroundColor: DanColors.bg,
      appBar: DanModuleTopBar(
        brandName: branch.name.isNotEmpty ? branch.name : branch.id,
        title: t('Kênh online'),
        subtitle: '',
        titleIcon: Icons.public,
        userName: user?.name ?? '—',
        userRole: roleLabel(user?.role ?? ''),
        online: true,
        onBack: () => Navigator.of(context).maybePop(),
        onLogout: () => auth.logout(),
      ),
      body: Column(
        children: [
          _filterBar(),
          Divider(height: 1, color: DanColors.border),
          Expanded(child: _body()),
        ],
      ),
    );
  }

  Widget _filterBar() {
    return Padding(
      padding: EdgeInsets.all(14),
      child: Row(
        children: [
          SizedBox(
            width: 190,
            child: DropdownButtonFormField<String>(
              initialValue: _channelFilter,
              isExpanded: true,
              decoration: InputDecoration(isDense: true, labelText: t('Kênh')),
              items: [
                DropdownMenuItem(value: '', child: Text(t('Tất cả kênh'))),
                for (final e in _channels.entries)
                  DropdownMenuItem(value: e.key, child: Text(_s(e.value))),
              ],
              onChanged: (v) => setState(() => _channelFilter = v ?? ''),
            ),
          ),
          SizedBox(width: 12),
          Wrap(
            spacing: 8,
            children: [
              for (final f in _statusFilters)
                ChoiceChip(
                  label: Text(f[1]),
                  selected: _statusFilter == f[0],
                  onSelected: (_) => setState(() => _statusFilter = f[0]),
                ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _body() {
    if (_loading && _orders.isEmpty) {
      return Center(child: CircularProgressIndicator());
    }
    if (_error != null && _orders.isEmpty) {
      return Padding(
        padding: EdgeInsets.all(40),
        child: InlineMessage(t('Không tải được đơn online ($_error)'),
            error: true, onRetry: _load),
      );
    }
    final list = _filtered;
    if (list.isEmpty) {
      return Center(
          child: Text(t('Chưa có đơn online nào'),
              style: TextStyle(color: DanColors.faint)));
    }
    return RefreshIndicator(
      onRefresh: _load,
      child: GridView.builder(
        padding: EdgeInsets.all(16),
        gridDelegate: SliverGridDelegateWithMaxCrossAxisExtent(
          maxCrossAxisExtent: 380,
          mainAxisExtent: 190,
          crossAxisSpacing: 14,
          mainAxisSpacing: 14,
        ),
        itemCount: list.length,
        itemBuilder: (_, i) => _card(list[i]),
      ),
    );
  }

  Widget _card(Map<String, dynamic> o) {
    final paid = _s(o['status']) == 'paid';
    final shipped = _s(o['online_status']) == 'completed';
    final isVoid = _s(o['status']) == 'void';
    final ch = _channel(_s(o['online_channel']));
    final customer =
        o['customer'] is Map ? _s((o['customer'] as Map)['name']) : '';
    final created = DateTime.tryParse(_s(o['created_at']));
    final ref = _s(o['online_ref']).isNotEmpty
        ? _s(o['online_ref'])
        : (_s(o['id']).length >= 6
            ? _s(o['id']).substring(_s(o['id']).length - 6).toUpperCase()
            : _s(o['id']));
    final id = _s(o['id']);

    return Container(
      padding: EdgeInsets.all(13),
      decoration: BoxDecoration(
        color: DanColors.surface,
        border: Border.all(color: DanColors.border),
        borderRadius: BorderRadius.circular(DanRadius.lg),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              if (created != null)
                Text(Fmt.hm(created),
                    style: TextStyle(fontSize: 11.5, color: DanColors.faint)),
              Spacer(),
              _Badge(paid ? t('Đã thanh toán') : t('Chờ xử lý'), paid),
              SizedBox(width: 6),
              _Badge(shipped ? t('Đã giao') : t('Chưa giao'), shipped),
            ],
          ),
          SizedBox(height: 8),
          Row(
            children: [
              Text('#$ref',
                  style: TextStyle(
                      fontFamily: 'JetBrains Mono',
                      fontWeight: FontWeight.w800,
                      color: DanColors.brand)),
              SizedBox(width: 8),
              Expanded(
                child: Text(customer.isEmpty ? t('Khách hàng') : customer,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style:
                        TextStyle(fontSize: 13, fontWeight: FontWeight.w700)),
              ),
            ],
          ),
          SizedBox(height: 4),
          Row(
            children: [
              Text(ch.name,
                  style: TextStyle(fontSize: 12, color: DanColors.muted)),
              Spacer(),
              Text(Fmt.money(_n(o['total'])),
                  style: TextStyle(fontSize: 15, fontWeight: FontWeight.w900)),
            ],
          ),
          Spacer(),
          Row(
            children: [
              if (!paid)
                Expanded(
                  child: OutlinedButton(
                    onPressed: () => _act(
                        id,
                        () =>
                            context.read<ApiService>().onlineConfirmPayment(id),
                        t('Đã xác nhận thanh toán')),
                    style: OutlinedButton.styleFrom(
                        minimumSize: Size(0, 34),
                        padding: EdgeInsets.symmetric(horizontal: 4)),
                    child:
                        Text(t('Xác nhận TT'), style: TextStyle(fontSize: 12)),
                  ),
                ),
              if (!paid && !shipped) SizedBox(width: 6),
              if (!shipped)
                Expanded(
                  child: FilledButton(
                    onPressed: () => _act(
                        id,
                        () => context
                            .read<ApiService>()
                            .onlineConfirmDelivery(id),
                        t('Đã xác nhận giao hàng')),
                    style: FilledButton.styleFrom(
                        minimumSize: Size(0, 34),
                        padding: EdgeInsets.symmetric(horizontal: 4)),
                    child: Text(t('Giao hàng'), style: TextStyle(fontSize: 12)),
                  ),
                ),
              if (paid && shipped && !isVoid)
                Expanded(
                  child: OutlinedButton(
                    onPressed: () => _act(
                        id,
                        () => context.read<ApiService>().onlineReturn(id),
                        t('Đã trả đơn')),
                    style: OutlinedButton.styleFrom(
                        minimumSize: Size(0, 34),
                        foregroundColor: DanColors.late),
                    child: Text(t('Đổi trả'), style: TextStyle(fontSize: 12)),
                  ),
                ),
              if (isVoid)
                Expanded(
                  child: Text(t('Đã hủy/trả'),
                      style: TextStyle(
                          fontSize: 12,
                          color: DanColors.late,
                          fontWeight: FontWeight.w700)),
                ),
            ],
          ),
        ],
      ),
    );
  }
}

class _Badge extends StatelessWidget {
  final String label;
  final bool good;
  _Badge(this.label, this.good);

  @override
  Widget build(BuildContext context) {
    final c = good ? DanColors.done : DanColors.doing;
    return Container(
      padding: EdgeInsets.symmetric(horizontal: 7, vertical: 2),
      decoration: BoxDecoration(
          color: c.withValues(alpha: .15),
          borderRadius: BorderRadius.circular(5)),
      child: Text(label,
          style: TextStyle(
              fontSize: 10,
              fontWeight: FontWeight.w800,
              color: good ? Color(0xFF047857) : Color(0xFFB45309))),
    );
  }
}
