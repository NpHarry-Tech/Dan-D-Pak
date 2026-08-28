import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';

import '../../providers/auth_provider.dart';
import '../../services/api_service.dart';
import '../../services/socket_service.dart';
import '../../ui/app_theme.dart';
import '../../ui/debouncer.dart';
import '../../ui/format.dart';
import '../../utils/business_datetime.dart';
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
  final Debouncer _searchDebounce = Debouncer();
  final TextEditingController _search = TextEditingController();

  int _tab = 0;
  String _provider = '';
  String _query = '';
  Map<String, dynamic> _summary = {};
  List<Map<String, dynamic>> _orders = [];
  final Set<String> _selected = {}; // id đơn đang chọn (bulk)
  bool _loading = true;
  bool _loadedOnce = false;
  bool _disposed = false;
  bool _busy = false; // đang xử lý hàng loạt
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
    _searchDebounce.dispose();
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
        // Bỏ chọn những đơn không còn trong danh sách sau khi tải lại.
        _selected.removeWhere((id) => !_orders.any((o) => oStr(o['id']) == id));
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
        if (_busy) const LinearProgressIndicator(minHeight: 2),
        _bulkBar(),
        Expanded(child: _body()),
      ],
    );
  }

  // Tab nào cho phép thao tác hàng loạt (hiện checkbox + thanh bulk).
  bool _hasBulk() {
    const k = ['pending', 'processed', 'shipping', 'delivered'];
    return k.contains(kOrderTabs[_tab].key);
  }

  Widget _bulkBar() {
    if (!_hasBulk() || _orders.isEmpty) return const SizedBox.shrink();
    final n = _selected.length;
    final allSelected = n == _orders.length;
    return Container(
      padding: const EdgeInsets.fromLTRB(10, 6, 14, 6),
      decoration: const BoxDecoration(
        color: DanColors.surface2,
        border: Border(bottom: BorderSide(color: DanColors.border)),
      ),
      child: Row(
        children: [
          SizedBox(
            width: 26,
            height: 26,
            child: Checkbox(
              value: allSelected && n > 0,
              onChanged: _busy
                  ? null
                  : (v) => setState(() {
                        _selected.clear();
                        if (v == true) {
                          _selected.addAll(_orders.map((o) => oStr(o['id'])));
                        }
                      }),
            ),
          ),
          const SizedBox(width: 6),
          Text(n > 0 ? '${t('Đã chọn')} $n ${t('đơn')}' : t('Chọn tất cả'),
              style:
                  const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700)),
          if (n > 0) ...[
            const SizedBox(width: 6),
            TextButton(
              onPressed: () => setState(() => _selected.clear()),
              style: TextButton.styleFrom(
                  minimumSize: const Size(0, 30),
                  padding: const EdgeInsets.symmetric(horizontal: 8)),
              child: Text(t('Bỏ chọn'), style: const TextStyle(fontSize: 12)),
            ),
          ],
          const Spacer(),
          ..._bulkActions(),
        ],
      ),
    );
  }

  List<Widget> _bulkActions() {
    final enabled = _selected.isNotEmpty && !_busy;
    final key = kOrderTabs[_tab].key;
    final btns = <Widget>[];
    if (key == 'pending') {
      btns.add(FilledButton.icon(
        onPressed: enabled ? () => _bulk('confirm', 'xác nhận') : null,
        icon: const Icon(Icons.check, size: 16),
        label: Text(t('Xác nhận đơn'), style: const TextStyle(fontSize: 12.5)),
        style: FilledButton.styleFrom(minimumSize: const Size(0, 34)),
      ));
    } else if (key == 'processed') {
      btns.add(OutlinedButton.icon(
        onPressed: enabled ? _bulkPrint : null,
        icon: const Icon(Icons.print_outlined, size: 16),
        label: Text(t('In phiếu giao'), style: const TextStyle(fontSize: 12.5)),
        style: OutlinedButton.styleFrom(minimumSize: const Size(0, 34)),
      ));
      btns.add(const SizedBox(width: 8));
      btns.add(FilledButton.icon(
        onPressed:
            enabled ? () => _bulk('ready_to_ship', 'sẵn sàng giao') : null,
        icon: const Icon(Icons.local_shipping_outlined, size: 16),
        label: Text(t('Sẵn sàng giao'), style: const TextStyle(fontSize: 12.5)),
        style: FilledButton.styleFrom(minimumSize: const Size(0, 34)),
      ));
    } else {
      btns.add(OutlinedButton.icon(
        onPressed: enabled ? _bulkPrint : null,
        icon: const Icon(Icons.print_outlined, size: 16),
        label: Text(t('In phiếu giao'), style: const TextStyle(fontSize: 12.5)),
        style: OutlinedButton.styleFrom(minimumSize: const Size(0, 34)),
      ));
    }
    return btns;
  }

  Future<void> _bulk(String action, String verb) async {
    final ids = _selected.toList();
    if (ids.isEmpty) return;
    setState(() => _busy = true);
    try {
      final res = await context
          .read<ApiService>()
          .bulkTransitionOnlineOperations(ids, action);
      final ok = oNum(res['ok_count']).toInt();
      final fail = oNum(res['fail_count']).toInt();
      if (mounted) {
        appToast(context,
            '${t('Đã')} $verb $ok ${t('đơn')}${fail > 0 ? ' · $fail ${t('lỗi')}' : ''}',
            isError: fail > 0 && ok == 0);
      }
      _selected.clear();
      _loadSummary();
      await _load(silent: true);
    } catch (e) {
      if (mounted) {
        appToast(context, e.toString().replaceFirst('Exception: ', ''),
            isError: true);
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _bulkPrint() async {
    final orders =
        _orders.where((o) => _selected.contains(oStr(o['id']))).toList();
    if (orders.isEmpty) return;
    setState(() => _busy = true);
    try {
      for (final o in orders) {
        await printOrderLabel(context, o);
      }
      if (mounted) {
        appToast(
            context, '${t('Đã gửi in')} ${orders.length} ${t('phiếu giao')}');
      }
    } catch (e) {
      if (mounted) {
        appToast(context, e.toString().replaceFirst('Exception: ', ''),
            isError: true);
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _copy(String text, String label) async {
    await Clipboard.setData(ClipboardData(text: text));
    if (mounted) appToast(context, '${t('Đã sao chép')} $label');
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
          setState(() {
            _tab = i;
            _selected.clear();
          });
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
                padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
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
              // Lọc real-time từng chữ (debounce nhẹ, tránh gọi server dồn dập).
              onChanged: (v) {
                final q = v.trim();
                _searchDebounce(() {
                  if (_disposed || !mounted || q == _query) return;
                  setState(() => _query = q);
                  _load();
                });
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
    final id = oStr(o['id']);
    final provider = oStr(o['provider']);
    final code = oStr(o['external_order_code']).isNotEmpty
        ? oStr(o['external_order_code'])
        : oStr(o['external_order_id']);
    final customer = oMap(o['customer']);
    final wf = workflowMeta(oStr(o['workflow_status']));
    final created = BusinessDateTime.parseApi(o['created_at']);
    final needsMap = o['needs_product_mapping'] == true;
    final total = oNum(o['total']);
    final items = oList(o['items']);
    final firstItem = items.isNotEmpty ? items.first : <String, dynamic>{};
    final itemCount = oNum(o['item_count']).toInt();
    final pay = oStr(o['payment_method']);
    final shipping = oMap(o['shipping']);
    final tracks = shipping['tracking_numbers'] is List
        ? (shipping['tracking_numbers'] as List)
            .map((e) => e.toString())
            .toList()
        : <String>[];
    final tracking = tracks.isNotEmpty ? tracks.first : '';
    final selected = _selected.contains(id);
    final showCheckbox = _hasBulk();

    return Container(
      decoration: BoxDecoration(
        color: DanColors.surface,
        border: Border.all(
            color: selected ? DanColors.brand : DanColors.border,
            width: selected ? 1.5 : 1),
        borderRadius: BorderRadius.circular(DanRadius.lg),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (showCheckbox)
            Padding(
              padding: const EdgeInsets.only(left: 6, top: 8),
              child: SizedBox(
                width: 26,
                height: 26,
                child: Checkbox(
                  value: selected,
                  onChanged: (v) => setState(() {
                    if (v == true) {
                      _selected.add(id);
                    } else {
                      _selected.remove(id);
                    }
                  }),
                ),
              ),
            ),
          Expanded(
            child: InkWell(
              onTap: () => _openDetail(id),
              borderRadius: BorderRadius.circular(DanRadius.lg),
              child: Padding(
                padding: EdgeInsets.fromLTRB(showCheckbox ? 4 : 14, 12, 14, 12),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    // Gian hàng (logo sàn) · mã đơn (copy) · trạng thái
                    Row(
                      children: [
                        ProviderBadge(provider, shop: oStr(o['shop_domain'])),
                        const SizedBox(width: 10),
                        if (code.isNotEmpty)
                          Flexible(
                              child: _copyChip('#$code', code, t('mã đơn'))),
                        const Spacer(),
                        OnlinePill(wf.label, wf.color),
                      ],
                    ),
                    // Mã đơn NỘI BỘ (POS) — link xanh, bấm mở chi tiết đơn của mình.
                    if (oStr(o['bill_no']).isNotEmpty) ...[
                      const SizedBox(height: 4),
                      InkWell(
                        onTap: () => _openDetail(id),
                        child: Row(mainAxisSize: MainAxisSize.min, children: [
                          const Icon(Icons.receipt_long_outlined,
                              size: 13, color: DanColors.brand),
                          const SizedBox(width: 4),
                          Text(oStr(o['bill_no']),
                              style: const TextStyle(
                                  fontSize: 11.5,
                                  fontWeight: FontWeight.w700,
                                  color: DanColors.brand,
                                  decoration: TextDecoration.underline,
                                  fontFamily: 'JetBrains Mono')),
                        ]),
                      ),
                    ],
                    const SizedBox(height: 10),
                    // Ảnh + tên hàng + số lượng
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        _thumb(oStr(o['first_item_image'])),
                        const SizedBox(width: 10),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                oStr(firstItem['name']).isEmpty
                                    ? t('(Không có tên hàng)')
                                    : oStr(firstItem['name']),
                                maxLines: 2,
                                overflow: TextOverflow.ellipsis,
                                style: const TextStyle(
                                    fontSize: 12.5,
                                    fontWeight: FontWeight.w700),
                              ),
                              const SizedBox(height: 2),
                              Text(
                                'SL: ${oNum(firstItem['qty']).toInt()}'
                                '${itemCount > 1 ? '  ·  +${itemCount - 1} ${t('sản phẩm khác')}' : ''}',
                                style: const TextStyle(
                                    fontSize: 11.5, color: DanColors.muted),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 10),
                    // Khách hàng · tổng tiền
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
                    // Ngày giờ · thanh toán · mã vận đơn (copy) · cảnh báo
                    Wrap(
                      spacing: 12,
                      runSpacing: 4,
                      crossAxisAlignment: WrapCrossAlignment.center,
                      children: [
                        if (created != null)
                          _meta(Icons.schedule, Fmt.dmyHm(created)),
                        if (pay.isNotEmpty) _meta(Icons.payments_outlined, pay),
                        if (tracking.isNotEmpty)
                          _copyChip('VĐ: $tracking', tracking, t('mã vận đơn')),
                        if (needsMap)
                          const OnlinePill(
                              'Chưa liên kết hàng', Color(0xFFB91C1C)),
                      ],
                    ),
                    const SizedBox(height: 8),
                    Align(
                        alignment: Alignment.centerRight,
                        child: _quickActions(o)),
                  ],
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _meta(IconData icon, String text) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icon, size: 13, color: DanColors.faint),
        const SizedBox(width: 4),
        Text(text,
            style: const TextStyle(fontSize: 11.5, color: DanColors.muted)),
      ],
    );
  }

  // Chip chữ + nút copy (mã đơn / mã vận đơn).
  Widget _copyChip(String label, String value, String what) {
    return InkWell(
      onTap: () => _copy(value, what),
      borderRadius: BorderRadius.circular(6),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Flexible(
            child: Text(label,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                    fontFamily: 'JetBrains Mono',
                    fontSize: 11.5,
                    fontWeight: FontWeight.w700,
                    color: DanColors.text)),
          ),
          const SizedBox(width: 3),
          const Icon(Icons.copy, size: 13, color: DanColors.faint),
        ],
      ),
    );
  }

  Widget _thumb(String url) {
    const size = 46.0;
    Widget placeholder() => Container(
          width: size,
          height: size,
          decoration: BoxDecoration(
            color: DanColors.surface2,
            borderRadius: BorderRadius.circular(8),
            border: Border.all(color: DanColors.border),
          ),
          child: const Icon(Icons.image_outlined,
              size: 20, color: DanColors.faint),
        );
    if (url.isEmpty || !url.startsWith('http')) return placeholder();
    return ClipRRect(
      borderRadius: BorderRadius.circular(8),
      child: Image.network(url,
          width: size,
          height: size,
          fit: BoxFit.cover,
          errorBuilder: (_, __, ___) => placeholder(),
          loadingBuilder: (ctx, child, progress) =>
              progress == null ? child : placeholder()),
    );
  }

  Widget _quickActions(Map<String, dynamic> o) {
    final status = oStr(o['workflow_status']);
    final id = oStr(o['id']);
    final btns = <Widget>[];
    if (status == 'pending') {
      btns.add(_smallBtn(
          t('Xác nhận đơn'),
          filled: true,
          () => _act(
              id,
              () => context
                  .read<ApiService>()
                  .transitionOnlineOperation(id, 'confirm'),
              t('Đã xác nhận đơn'))));
    } else if (status == 'processed' || status == 'preparing') {
      btns.add(_smallBtn(
          t('Sẵn sàng giao'),
          filled: true,
          () => _act(
              id,
              () => context
                  .read<ApiService>()
                  .transitionOnlineOperation(id, 'ready_to_ship'),
              t('Đã chuyển sẵn sàng giao'))));
    } else if (status == 'ready_to_ship') {
      btns.add(_smallBtn(
          t('Giao cho ĐVVC'),
          filled: true,
          () => _act(
              id,
              () => context
                  .read<ApiService>()
                  .transitionOnlineOperation(id, 'mark_shipping'),
              t('Đã bàn giao vận chuyển'))));
    }
    btns.add(_smallBtn(t('In tem'), () => printOrderLabel(context, o),
        icon: Icons.print_outlined));
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
}
