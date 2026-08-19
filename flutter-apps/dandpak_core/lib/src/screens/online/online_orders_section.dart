import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../providers/auth_provider.dart';
import '../../services/api_service.dart';
import '../../services/socket_service.dart';
import '../../ui/app_theme.dart';
import '../../ui/debouncer.dart';
import '../../ui/format.dart';
import '../../utils/translation.dart';
import '../management/management_widgets.dart';
import 'online_order_detail.dart';
import 'online_shared.dart';

/// Đơn hàng — bàn xử lý đơn Retail Online đa kênh, bố cục tab theo KiotViet.
class OnlineOrdersSection extends StatefulWidget {
  const OnlineOrdersSection({super.key});

  @override
  State<OnlineOrdersSection> createState() => _OnlineOrdersSectionState();
}

class _OnlineOrdersSectionState extends State<OnlineOrdersSection> {
  final SocketService _socket = SocketService();
  final Debouncer _refresh = Debouncer();
  final TextEditingController _search = TextEditingController();

  int _tab = 0;
  String _provider = '';
  String _query = '';
  Map<String, dynamic> _summary = {};
  List<Map<String, dynamic>> _orders = [];
  bool _loading = true;
  bool _loadedOnce = false;
  bool _disposed = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _connectSocket();
      _loadSummary();
      _load();
    });
  }

  void _connectSocket() {
    final auth = context.read<AuthProvider>();
    _socket.connect(
        baseUrl: auth.serverUrl,
        branch: auth.selectedBranchId,
        token: auth.token ?? '');
    _socket.addListener(_onSocket);
  }

  void _onSocket(String event, dynamic payload) {
    if (_disposed || !mounted) return;
    if (event.startsWith('online:') ||
        event.startsWith('order:') ||
        event == 'payment:done' ||
        event == kSyncReconnected) {
      _refresh(() {
        if (!_disposed && mounted) {
          _loadSummary();
          _load(silent: true);
        }
      });
    }
  }

  @override
  void dispose() {
    _disposed = true;
    _refresh.dispose();
    _search.dispose();
    _socket.removeListener(_onSocket);
    super.dispose();
  }

  Future<void> _loadSummary() async {
    try {
      final s = await context.read<ApiService>().getOnlineOperationsSummary();
      if (mounted) setState(() => _summary = s);
    } catch (_) {}
  }

  Future<void> _load({bool silent = false}) async {
    if (!silent) setState(() => _loading = true);
    try {
      final res = await context.read<ApiService>().getOnlineOperations(
            status: kOrderTabs[_tab].key,
            provider: _provider,
            q: _query,
            limit: 100,
          );
      if (!mounted) return;
      setState(() {
        _orders = oList(res['rows']);
        _loading = false;
        _loadedOnce = true;
        _error = null;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.toString().replaceFirst('Exception: ', '');
        _loading = false;
        _loadedOnce = true;
      });
    }
  }

  int _bucketCount(OnlineOrderTab tab) {
    final buckets = oMap(_summary['buckets']);
    var n = 0;
    for (final b in tab.countBuckets) {
      n += oNum(buckets[b]).toInt();
    }
    return n;
  }

  Future<void> _openDetail(String id) async {
    await showDialog<void>(
      context: context,
      builder: (_) => OnlineOrderDetailDialog(orderId: id),
    );
    if (!_disposed && mounted) {
      _loadSummary();
      _load(silent: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        _tabBar(),
        _filterBar(),
        const Divider(height: 1, color: DanColors.border),
        Expanded(child: _body()),
      ],
    );
  }

  Widget _tabBar() {
    return SizedBox(
      height: 48,
      child: ListView(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: 12),
        children: [
          for (var i = 0; i < kOrderTabs.length; i++)
            _tabChip(i, kOrderTabs[i]),
        ],
      ),
    );
  }

  Widget _tabChip(int i, OnlineOrderTab tab) {
    final selected = _tab == i;
    final count = _bucketCount(tab);
    return InkWell(
      onTap: () {
        if (_tab != i) {
          setState(() => _tab = i);
          _load();
        }
      },
      child: Container(
        alignment: Alignment.center,
        padding: const EdgeInsets.symmetric(horizontal: 14),
        decoration: BoxDecoration(
          border: Border(
            bottom: BorderSide(
                color: selected ? DanColors.brand : Colors.transparent,
                width: 2.5),
          ),
        ),
        child: Row(
          children: [
            Text(t(tab.label),
                style: TextStyle(
                    fontSize: 13.5,
                    fontWeight: selected ? FontWeight.w800 : FontWeight.w600,
                    color: selected ? DanColors.brand : DanColors.muted)),
            if (count > 0) ...[
              const SizedBox(width: 6),
              Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
                decoration: BoxDecoration(
                    color: selected ? DanColors.brand : DanColors.surface3,
                    borderRadius: BorderRadius.circular(9)),
                child: Text('$count',
                    style: TextStyle(
                        fontSize: 11,
                        fontWeight: FontWeight.w800,
                        color: selected ? Colors.white : DanColors.muted)),
              ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _filterBar() {
    return Padding(
      padding: const EdgeInsets.fromLTRB(14, 10, 14, 10),
      child: Row(
        children: [
          SizedBox(
            width: 180,
            child: DropdownButtonFormField<String>(
              initialValue: _provider,
              isExpanded: true,
              decoration:
                  const InputDecoration(isDense: true, labelText: 'Kênh'),
              items: [
                const DropdownMenuItem(value: '', child: Text('Tất cả kênh')),
                for (final key in const [
                  'haravan',
                  'website',
                  'shopee',
                  'tiktokshop',
                  'lazada',
                  'tiki'
                ])
                  DropdownMenuItem(
                      value: key, child: Text(providerMeta(key).name)),
              ],
              onChanged: (v) {
                setState(() => _provider = v ?? '');
                _load();
              },
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: TextField(
              controller: _search,
              decoration: InputDecoration(
                isDense: true,
                hintText: t('Tìm mã đơn, tên khách…'),
                prefixIcon: const Icon(Icons.search, size: 18),
              ),
              onSubmitted: (v) {
                setState(() => _query = v.trim());
                _load();
              },
            ),
          ),
          const SizedBox(width: 8),
          IconButton(
            tooltip: t('Làm mới'),
            onPressed: () {
              _loadSummary();
              _load();
            },
            icon: const Icon(Icons.refresh),
          ),
        ],
      ),
    );
  }

  Widget _body() {
    if (_loading && !_loadedOnce) {
      return const Center(child: CircularProgressIndicator());
    }
    if (_error != null && !_loadedOnce) {
      return Padding(
        padding: const EdgeInsets.all(40),
        child: InlineMessage(t('Không tải được đơn ($_error)'),
            error: true, onRetry: _load),
      );
    }
    if (_orders.isEmpty) {
      return OnlineEmpty(t('Không có đơn nào ở mục này'));
    }
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView.separated(
        padding: const EdgeInsets.all(14),
        itemCount: _orders.length,
        separatorBuilder: (_, __) => const SizedBox(height: 10),
        itemBuilder: (_, i) => _orderCard(_orders[i]),
      ),
    );
  }

  Widget _orderCard(Map<String, dynamic> o) {
    final provider = oStr(o['provider']);
    final code = oStr(o['external_order_code']).isNotEmpty
        ? oStr(o['external_order_code'])
        : oStr(o['external_order_id']);
    final customer = oMap(o['customer']);
    final wf = workflowMeta(oStr(o['workflow_status']));
    final created = DateTime.tryParse(oStr(o['created_at']))?.toLocal();
    final needsMap = o['needs_product_mapping'] == true;
    final total = oNum(o['total']);

    return InkWell(
      onTap: () => _openDetail(oStr(o['id'])),
      borderRadius: BorderRadius.circular(DanRadius.lg),
      child: Container(
        padding: const EdgeInsets.all(14),
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
                ProviderBadge(provider, shop: oStr(o['shop_domain'])),
                const SizedBox(width: 10),
                if (code.isNotEmpty)
                  Text('#$code',
                      style: const TextStyle(
                          fontFamily: 'JetBrains Mono',
                          fontSize: 12.5,
                          fontWeight: FontWeight.w700)),
                const Spacer(),
                OnlinePill(wf.label, wf.color),
              ],
            ),
            const SizedBox(height: 8),
            Row(
              children: [
                const Icon(Icons.person_outline,
                    size: 15, color: DanColors.faint),
                const SizedBox(width: 5),
                Expanded(
                  child: Text(
                    '${oStr(customer['name']).isEmpty ? t('Khách hàng') : oStr(customer['name'])}'
                    '${oStr(customer['phone']).isNotEmpty ? ' · ${oStr(customer['phone'])}' : ''}',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontSize: 12.5),
                  ),
                ),
                Text(Fmt.money(total),
                    style: const TextStyle(
                        fontSize: 15, fontWeight: FontWeight.w900)),
              ],
            ),
            const SizedBox(height: 8),
            Row(
              children: [
                if (created != null)
                  Text(Fmt.dmyHm(created),
                      style: const TextStyle(
                          fontSize: 11.5, color: DanColors.faint)),
                if (needsMap) ...[
                  const SizedBox(width: 10),
                  const OnlinePill('Chưa liên kết hàng', Color(0xFFB91C1C)),
                ],
                const Spacer(),
                _quickActions(o),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _quickActions(Map<String, dynamic> o) {
    final status = oStr(o['workflow_status']);
    final id = oStr(o['id']);
    final btns = <Widget>[];
    if (status == 'pending') {
      btns.add(_smallBtn(t('Xác nhận đơn'), filled: true,
          () => _act(id, () => context.read<ApiService>()
              .transitionOnlineOperation(id, 'confirm'), t('Đã xác nhận đơn'))));
    } else if (status == 'processed' || status == 'preparing') {
      btns.add(_smallBtn(t('Sẵn sàng giao'), filled: true,
          () => _act(id, () => context.read<ApiService>()
              .transitionOnlineOperation(id, 'ready_to_ship'),
              t('Đã chuyển sẵn sàng giao'))));
    } else if (status == 'ready_to_ship') {
      btns.add(_smallBtn(t('Giao cho ĐVVC'), filled: true,
          () => _act(id, () => context.read<ApiService>()
              .transitionOnlineOperation(id, 'mark_shipping'),
              t('Đã bàn giao vận chuyển'))));
    }
    btns.add(_smallBtn(t('In tem'),
        () => _printLabelDialog(id), icon: Icons.print_outlined));
    btns.add(_smallBtn(t('Chi tiết'), () => _openDetail(id)));
    return Wrap(spacing: 6, runSpacing: 6, children: btns);
  }

  Widget _smallBtn(String label, VoidCallback onTap,
      {bool filled = false, IconData? icon}) {
    final child = Row(mainAxisSize: MainAxisSize.min, children: [
      if (icon != null) ...[Icon(icon, size: 14), const SizedBox(width: 4)],
      Text(label, style: const TextStyle(fontSize: 12)),
    ]);
    return filled
        ? FilledButton(
            onPressed: onTap,
            style: FilledButton.styleFrom(
                minimumSize: const Size(0, 32),
                padding: const EdgeInsets.symmetric(horizontal: 12)),
            child: child)
        : OutlinedButton(
            onPressed: onTap,
            style: OutlinedButton.styleFrom(
                minimumSize: const Size(0, 32),
                padding: const EdgeInsets.symmetric(horizontal: 12)),
            child: child);
  }

  Future<void> _act(
      String id, Future<dynamic> Function() action, String ok) async {
    try {
      await action();
      if (mounted) appToast(context, ok);
      _loadSummary();
      _load(silent: true);
    } catch (e) {
      if (mounted) {
        appToast(context, e.toString().replaceFirst('Exception: ', ''),
            isError: true);
      }
    }
  }

  Future<void> _printLabelDialog(String id) async {
    await showShippingLabelDialog(context, id);
  }
}
