// Nhật ký gọi món — một tab trong màn Nhật ký/Footprint (part of cùng library).
// Liệt kê đơn gần đây theo mã tham chiếu pay_ref, bấm vào xem dòng thời gian gọi
// món: thêm/sửa/ghi chú/huỷ món, trạng thái bếp, thời gian phục vụ từng món.
part of 'database_screen.dart';

// ── Nhãn sự kiện gọi món (dịch gọn theo event_type chuẩn hoá) ────────────────
String _kdsStatusLabel(String s) {
  switch (s) {
    case 'accepted':
      return t('Bếp nhận món');
    case 'preparing':
      return t('Đang chế biến');
    case 'ready':
      return t('Món đã xong');
    case 'served':
      return t('Đã phục vụ');
    case 'cancelled':
      return t('Đã huỷ');
    case 'new':
      return t('Chờ làm');
    default:
      return s.isEmpty ? t('Cập nhật') : s;
  }
}

String _orderEventLabel(Map<String, dynamic> e) {
  final type = _s(e['event_type']);
  final item = _s(e['item']);
  final suffix = item.isEmpty ? '' : ': $item';
  switch (type) {
    case 'order.item.added':
      return t('Thêm món') + suffix;
    case 'order.confirm':
      return t('Gửi món vào bếp');
    case 'order.item.status':
      return _kdsStatusLabel(_s(e['status'])) + suffix;
    case 'order.item.note':
      return t('Ghi chú món') + suffix;
    case 'order.item.cancel':
      return t('Huỷ món') + suffix;
    case 'order.reject':
      return t('Từ chối món');
    case 'order.split':
      return t('Tách bill');
    default:
      return type.isEmpty ? t('Sự kiện') : type;
  }
}

String _durLabel(dynamic seconds) {
  final s = _n(seconds).toInt();
  if (s <= 0) return '—';
  if (s < 60) return '${s}s';
  final m = s ~/ 60;
  final r = s % 60;
  return r == 0 ? '${m}p' : '${m}p ${r}s';
}

class _OrderLogTab extends StatefulWidget {
  _OrderLogTab();

  @override
  State<_OrderLogTab> createState() => _OrderLogTabState();
}

class _OrderLogTabState extends State<_OrderLogTab> {
  final _search = TextEditingController();
  List<Map<String, dynamic>> _orders = [];
  bool _loading = true;
  String? _error;
  Timer? _searchTimer;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _searchTimer?.cancel();
    _search.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    if (mounted) setState(() => _loading = true);
    try {
      final rows = await context
          .read<ApiService>()
          .getOrderHistory(limit: 80, q: _search.text.trim());
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

  Future<void> _openTimeline(String ref) async {
    if (ref.trim().isEmpty) return;
    await showDialog<void>(
      context: context,
      builder: (_) => _OrderTimelineDialog(
        refCode: ref.trim(),
        api: context.read<ApiService>(),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        padding: EdgeInsets.all(18),
        children: [
          _searchBar(),
          SizedBox(height: 16),
          if (_loading)
            SizedBox(
                height: 240,
                child: Center(child: CircularProgressIndicator()))
          else if (_error != null)
            InlineMessage(t('Không tải được nhật ký gọi món ($_error)'),
                error: true, onRetry: _load)
          else if (_orders.isEmpty)
            SizedBox(
              height: 220,
              child: Center(
                child: Text(t('Chưa có đơn nào trong bộ lọc này'),
                    style: TextStyle(color: DanColors.faint)),
              ),
            )
          else
            Panel(
              padding: EdgeInsets.fromLTRB(14, 6, 14, 8),
              child: Column(
                children: [
                  for (var i = 0; i < _orders.length; i++) ...[
                    _orderRow(_orders[i]),
                    if (i < _orders.length - 1)
                      Divider(height: 1, color: DanColors.border),
                  ],
                ],
              ),
            ),
        ],
      ),
    );
  }

  Widget _searchBar() {
    return Panel(
      child: TextField(
        controller: _search,
        onChanged: (_) {
          _searchTimer?.cancel();
          _searchTimer = Timer(Duration(milliseconds: 260), _load);
        },
        onSubmitted: (v) {
          // Enter trên một mã đầy đủ mở thẳng nhật ký (kể cả đơn đang mở, chưa
          // nằm trong lịch sử đã thanh toán).
          if (v.trim().isNotEmpty) _openTimeline(v);
        },
        decoration: InputDecoration(
          isDense: true,
          labelText: t('Tìm theo mã tham chiếu, số bill, bàn...'),
          hintText: t('VD: 001260926482 — Enter để mở nhật ký'),
          prefixIcon: Icon(Icons.search),
        ),
      ),
    );
  }

  Widget _orderRow(Map<String, dynamic> o) {
    final payRef = _s(o['pay_ref']);
    final billNo = _s(o['bill_no']);
    final table = _s(o['table_code']);
    final created = BusinessDateTime.parseApi(o['created_at']);
    final total = _n(o['total']);
    final count = _n(o['item_count']).toInt();
    return InkWell(
      onTap: () => _openTimeline(payRef.isNotEmpty ? payRef : _s(o['id'])),
      borderRadius: BorderRadius.circular(DanRadius.sm),
      child: Padding(
        padding: EdgeInsets.symmetric(vertical: 11, horizontal: 6),
        child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Text(payRef.isEmpty ? '—' : payRef,
                          style: TextStyle(
                              fontWeight: FontWeight.w900,
                              fontSize: 13.5,
                              fontFeatures: const [
                                FontFeature.tabularFigures()
                              ])),
                      if (billNo.isNotEmpty) ...[
                        SizedBox(width: 8),
                        _chip(billNo, DanColors.brand),
                      ],
                      if (table.isNotEmpty) ...[
                        SizedBox(width: 6),
                        _chip('${t('Bàn')} $table', DanColors.muted),
                      ],
                    ],
                  ),
                  SizedBox(height: 3),
                  Text(
                    '${created == null ? '' : '${_dmy(created)} ${_hm(created)} · '}$count ${t('món')}',
                    style: TextStyle(color: DanColors.faint, fontSize: 11.5),
                  ),
                ],
              ),
            ),
            Text('${_money(total)}đ',
                style: TextStyle(
                    fontWeight: FontWeight.w800, color: DanColors.muted)),
            Icon(Icons.chevron_right, color: DanColors.faint),
          ],
        ),
      ),
    );
  }
}

String _money(num v) {
  final s = v.round().toString();
  final b = StringBuffer();
  for (var i = 0; i < s.length; i++) {
    if (i > 0 && (s.length - i) % 3 == 0) b.write('.');
    b.write(s[i]);
  }
  return b.toString();
}

Widget _chip(String text, Color color) => Container(
      padding: EdgeInsets.symmetric(horizontal: 7, vertical: 2),
      decoration: BoxDecoration(
        color: color.withValues(alpha: .12),
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(text,
          style: TextStyle(
              color: color, fontSize: 10.5, fontWeight: FontWeight.w800)),
    );

class _OrderTimelineDialog extends StatefulWidget {
  final String refCode;
  final ApiService api;
  _OrderTimelineDialog({required this.refCode, required this.api});

  @override
  State<_OrderTimelineDialog> createState() => _OrderTimelineDialogState();
}

class _OrderTimelineDialogState extends State<_OrderTimelineDialog> {
  Map<String, dynamic>? _data;
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final d = await widget.api.getOrderTimeline(widget.refCode);
      if (!mounted) return;
      setState(() {
        _data = d;
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
    final d = _data;
    return AlertDialog(
      title: Text(t('Nhật ký gọi món'),
          style: TextStyle(fontSize: 16, fontWeight: FontWeight.w900)),
      content: SizedBox(
        width: dialogWidth(context, 720),
        child: _loading
            ? SizedBox(
                height: 160, child: Center(child: CircularProgressIndicator()))
            : _error != null
                ? InlineMessage(_error!, error: true)
                : SingleChildScrollView(child: _body(d!)),
      ),
      actions: [
        FilledButton(
            onPressed: () => Navigator.of(context).pop(),
            child: Text(t('Đóng'))),
      ],
    );
  }

  Widget _body(Map<String, dynamic> d) {
    final items = (d['items'] as List? ?? [])
        .whereType<Map>()
        .map((e) => Map<String, dynamic>.from(e))
        .toList();
    final events = (d['events'] as List? ?? [])
        .whereType<Map>()
        .map((e) => Map<String, dynamic>.from(e))
        .toList();
    final created = BusinessDateTime.parseApi(d['first_item_at'] ?? d['created_at']);
    final paid = BusinessDateTime.parseApi(d['paid_at']);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _headerCard(d, created, paid),
        SizedBox(height: 14),
        _sectionLabel(t('Món trong đơn')),
        for (final it in items) _itemRow(it),
        if (items.isEmpty)
          Text(t('Đơn chưa có món'),
              style: TextStyle(color: DanColors.faint, fontSize: 12)),
        SizedBox(height: 14),
        _sectionLabel(t('Dòng thời gian')),
        for (final e in events) _eventRow(e),
        if (events.isEmpty)
          Text(t('Chưa có sự kiện'),
              style: TextStyle(color: DanColors.faint, fontSize: 12)),
      ],
    );
  }

  Widget _headerCard(Map<String, dynamic> d, DateTime? created, DateTime? paid) {
    Widget kv(String k, String v) => v.isEmpty
        ? SizedBox.shrink()
        : Padding(
            padding: EdgeInsets.symmetric(vertical: 2),
            child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
              SizedBox(
                  width: 118,
                  child: Text(k,
                      style: TextStyle(
                          color: DanColors.muted,
                          fontSize: 12,
                          fontWeight: FontWeight.w800))),
              Expanded(
                  child: SelectableText(v,
                      style: TextStyle(fontSize: 12.5, color: DanColors.text))),
            ]),
          );
    return Container(
      padding: EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: DanColors.surface2,
        borderRadius: BorderRadius.circular(DanRadius.sm),
        border: Border.all(color: DanColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(_s(d['pay_ref']),
              style: TextStyle(
                  fontSize: 18,
                  fontWeight: FontWeight.w900,
                  fontFeatures: const [FontFeature.tabularFigures()])),
          SizedBox(height: 8),
          kv(t('Số hoá đơn'), _s(d['bill_no'])),
          kv(t('Số hoá đơn VAT'), _s(d['invoice_no'])),
          kv(t('Thu ngân'), _s(d['cashier'])),
          kv(t('Bàn'), _s(d['table_code'])),
          kv(t('Thời gian thêm món'),
              created == null ? '' : '${_dmy(created)} ${_hm(created)}'),
          kv(t('Thời gian thanh toán'),
              paid == null ? '' : '${_dmy(paid)} ${_hm(paid)}'),
          kv(t('Tổng thời gian phục vụ'), _durLabel(d['total_serve_seconds'])),
        ],
      ),
    );
  }

  Widget _sectionLabel(String s) => Padding(
        padding: EdgeInsets.only(bottom: 6),
        child: Text(s,
            style: TextStyle(
                fontSize: 12.5,
                fontWeight: FontWeight.w900,
                color: DanColors.muted)),
      );

  Widget _itemRow(Map<String, dynamic> it) {
    final cancelled = _s(it['status']) == 'cancelled';
    final note = _s(it['note']);
    return Padding(
      padding: EdgeInsets.symmetric(vertical: 6),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(children: [
                  Expanded(
                    child: Text('${_n(it['qty']).toInt()}× ${_s(it['name'])}',
                        style: TextStyle(
                            fontWeight: FontWeight.w800,
                            fontSize: 13,
                            decoration: cancelled
                                ? TextDecoration.lineThrough
                                : null,
                            color:
                                cancelled ? DanColors.faint : DanColors.text)),
                  ),
                  _chip(_kdsStatusLabel(_s(it['status'])),
                      cancelled ? DanColors.late : DanColors.brand),
                ]),
                if (note.isNotEmpty)
                  Text('${t('Ghi chú')}: $note',
                      style:
                          TextStyle(color: DanColors.faint, fontSize: 11.5)),
                Text(
                  '${t('Làm món')}: ${_durLabel(it['prep_seconds'])}  ·  ${t('Phục vụ')}: ${_durLabel(it['serve_seconds'])}',
                  style: TextStyle(color: DanColors.faint, fontSize: 11),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _eventRow(Map<String, dynamic> e) {
    final at = BusinessDateTime.parseApi(e['at']);
    final actor = _s(e['actor']);
    return Padding(
      padding: EdgeInsets.symmetric(vertical: 5),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 60,
            child: Text(at == null ? '' : _hm(at),
                style: TextStyle(
                    color: DanColors.faint,
                    fontSize: 11.5,
                    fontWeight: FontWeight.w800)),
          ),
          Expanded(
            child: Text(_orderEventLabel(e),
                style: TextStyle(fontSize: 12.5)),
          ),
          if (actor.isNotEmpty)
            _chip(actor.toUpperCase(), DanColors.muted),
        ],
      ),
    );
  }
}
