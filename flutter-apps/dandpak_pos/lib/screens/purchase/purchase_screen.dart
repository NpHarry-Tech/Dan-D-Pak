import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../providers/auth_provider.dart';
import '../../services/api_service.dart';
import '../../ui/app_theme.dart';
import '../../ui/format.dart';
import '../../widgets/dan_top_bar.dart';
import '../management/management_widgets.dart';

String _s(dynamic v) => v?.toString() ?? '';
num _n(dynamic v) => v is num ? v : num.tryParse(_s(v)) ?? 0;

const _statusLabels = {
  'draft': 'Nháp',
  'confirmed': 'Đã xác nhận',
  'received': 'Đã nhận',
  'cancelled': 'Đã hủy',
};

Color _statusColor(String s) {
  switch (s) {
    case 'confirmed':
      return DanColors.brand;
    case 'received':
      return DanColors.done;
    case 'cancelled':
      return DanColors.late;
    default:
      return DanColors.muted;
  }
}

const _statusFilters = [
  ['', 'Tất cả'],
  ['draft', 'Nháp'],
  ['confirmed', 'Đã xác nhận'],
  ['received', 'Đã nhận'],
  ['cancelled', 'Đã hủy'],
];

/// Native port of the web Mua hàng (purchase.html): purchase orders with
/// supplier debt summary, create/confirm/receive/pay/cancel.
class PurchaseScreen extends StatefulWidget {
  const PurchaseScreen({super.key});

  @override
  State<PurchaseScreen> createState() => _PurchaseScreenState();
}

class _PurchaseScreenState extends State<PurchaseScreen> {
  List<Map<String, dynamic>> _orders = [];
  Map<String, dynamic> _summary = {};
  List<Map<String, dynamic>> _suppliers = [];
  List<Map<String, dynamic>> _warehouses = [];
  String _status = '';
  String _search = '';
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _loadRefs();
    _load();
  }

  Future<void> _loadRefs() async {
    try {
      final api = context.read<ApiService>();
      final sup = await api.getPartners(type: 'supplier');
      final whs = await api.getWarehouses();
      if (!mounted) return;
      setState(() {
        _suppliers = (sup['partners'] is List)
            ? (sup['partners'] as List)
                .whereType<Map>()
                .map((e) => Map<String, dynamic>.from(e))
                .toList()
            : [];
        _warehouses = whs
            .whereType<Map>()
            .map((e) => Map<String, dynamic>.from(e))
            .toList();
      });
    } catch (_) {}
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    try {
      final res = await context
          .read<ApiService>()
          .getPurchaseOrders(status: _status, q: _search.trim());
      if (!mounted) return;
      setState(() {
        _orders = (res['orders'] is List)
            ? (res['orders'] as List)
                .whereType<Map>()
                .map((e) => Map<String, dynamic>.from(e))
                .toList()
            : [];
        _summary = res['summary'] is Map
            ? Map<String, dynamic>.from(res['summary'])
            : {};
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

  Future<void> _openCreate() async {
    final saved = await showDialog<String>(
      context: context,
      builder: (_) => _PurchaseFormDialog(
        api: context.read<ApiService>(),
        suppliers: _suppliers,
        warehouses: _warehouses,
      ),
    );
    if (saved != null) {
      _load();
      _openDetail(saved);
    }
  }

  Future<void> _openDetail(String id) async {
    final changed = await showDialog<bool>(
      context: context,
      builder: (_) => _PurchaseDetailDialog(
        api: context.read<ApiService>(),
        orderId: id,
        warehouses: _warehouses,
      ),
    );
    if (changed == true) _load();
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
        title: 'Mua hàng',
        subtitle: '',
        titleIcon: Icons.local_shipping_outlined,
        userName: user?.name ?? '—',
        userRole: roleLabel(user?.role ?? ''),
        online: true,
        onBack: () => Navigator.of(context).maybePop(),
        onLogout: () => auth.logout(),
        actions: [
          DanTopBarButton(
            onPressed: _openCreate,
            icon: Icons.add,
            label: 'Tạo đơn mua',
          ),
        ],
      ),
      body: Column(
        children: [
          _debtBanner(),
          _filterBar(),
          const Divider(height: 1, color: DanColors.border),
          Expanded(child: _body()),
        ],
      ),
    );
  }

  Widget _debtBanner() {
    final totalDue = _n(_summary['total_due']);
    final suppliers = (_summary['suppliers'] is List)
        ? (_summary['suppliers'] as List).whereType<Map>().take(4).toList()
        : [];
    if (totalDue <= 0 && suppliers.isEmpty) return const SizedBox.shrink();
    return Container(
      width: double.infinity,
      margin: const EdgeInsets.fromLTRB(14, 14, 14, 0),
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      decoration: BoxDecoration(
        color: const Color(0xFFFFF7ED),
        border: Border.all(color: const Color(0xFFFCD9A8)),
        borderRadius: BorderRadius.circular(DanRadius.md),
      ),
      child: Wrap(
        crossAxisAlignment: WrapCrossAlignment.center,
        spacing: 14,
        runSpacing: 6,
        children: [
          Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Text('Công nợ phải trả: ',
                  style: TextStyle(fontWeight: FontWeight.w700, fontSize: 13)),
              Text(Fmt.money(totalDue),
                  style: const TextStyle(
                      fontWeight: FontWeight.w900,
                      fontSize: 15,
                      color: Color(0xFFB45309))),
            ],
          ),
          for (final sup in suppliers)
            Text('${_s(sup['supplier_name'])}: ${Fmt.money(_n(sup['due']))}',
                style: const TextStyle(fontSize: 12, color: DanColors.muted)),
        ],
      ),
    );
  }

  Widget _filterBar() {
    return Padding(
      padding: const EdgeInsets.all(14),
      child: Row(
        children: [
          for (final f in _statusFilters) ...[
            ChoiceChip(
              label: Text(f[1]),
              selected: _status == f[0],
              onSelected: (_) {
                setState(() => _status = f[0]);
                _load();
              },
            ),
            const SizedBox(width: 8),
          ],
          const SizedBox(width: 4),
          Expanded(
            child: TextField(
              decoration: const InputDecoration(
                  hintText: 'Tìm mã đơn, NCC…',
                  prefixIcon: Icon(Icons.search),
                  isDense: true),
              onChanged: (v) => _search = v,
              onSubmitted: (_) => _load(),
            ),
          ),
        ],
      ),
    );
  }

  Widget _body() {
    if (_loading && _orders.isEmpty) {
      return const Center(child: CircularProgressIndicator());
    }
    if (_error != null && _orders.isEmpty) {
      return Padding(
        padding: const EdgeInsets.all(40),
        child: InlineMessage('Không tải được đơn mua ($_error)',
            error: true, onRetry: _load),
      );
    }
    if (_orders.isEmpty) {
      return const Center(
          child: Text('Chưa có đơn mua nào',
              style: TextStyle(color: DanColors.faint)));
    }
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView.separated(
        padding: const EdgeInsets.all(16),
        itemCount: _orders.length,
        separatorBuilder: (_, __) => const SizedBox(height: 8),
        itemBuilder: (_, i) => _row(_orders[i]),
      ),
    );
  }

  Widget _row(Map<String, dynamic> po) {
    final status = _s(po['status']);
    final due = _n(po['due']);
    final created = DateTime.tryParse(_s(po['created_at']));
    return InkWell(
      onTap: () => _openDetail(_s(po['id'])),
      borderRadius: BorderRadius.circular(DanRadius.md),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
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
                      Text('#${_s(po['code']).isEmpty ? _s(po['id']) : _s(po['code'])}',
                          style: const TextStyle(
                              fontFamily: 'JetBrains Mono',
                              fontWeight: FontWeight.w800,
                              color: DanColors.brand)),
                      const SizedBox(width: 8),
                      _StatusChip(status: status),
                    ],
                  ),
                  const SizedBox(height: 3),
                  Text(
                    '${_s(po['supplier_name']).isEmpty ? '— Mua chợ' : _s(po['supplier_name'])}${created != null ? '  ·  ${Fmt.dmyHm(created)}' : ''}',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontSize: 12, color: DanColors.faint),
                  ),
                ],
              ),
            ),
            Column(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Text(Fmt.money(_n(po['total'])),
                    style: const TextStyle(
                        fontSize: 14.5, fontWeight: FontWeight.w900)),
                if (due > 0)
                  Text('Còn nợ ${Fmt.money(due)}',
                      style: const TextStyle(
                          fontSize: 11.5,
                          color: Color(0xFFB45309),
                          fontWeight: FontWeight.w700)),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _StatusChip extends StatelessWidget {
  final String status;
  const _StatusChip({required this.status});

  @override
  Widget build(BuildContext context) {
    final c = _statusColor(status);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
      decoration: BoxDecoration(
          color: c.withValues(alpha: .13), borderRadius: BorderRadius.circular(5)),
      child: Text(_statusLabels[status] ?? status,
          style: TextStyle(fontSize: 11, fontWeight: FontWeight.w800, color: c)),
    );
  }
}

// ── Create form ──────────────────────────────────────────────────────────

class _POLine {
  String name;
  num qty;
  num unitCost;
  _POLine(this.name, this.qty, this.unitCost);
}

class _PurchaseFormDialog extends StatefulWidget {
  final ApiService api;
  final List<Map<String, dynamic>> suppliers;
  final List<Map<String, dynamic>> warehouses;
  const _PurchaseFormDialog(
      {required this.api, required this.suppliers, required this.warehouses});

  @override
  State<_PurchaseFormDialog> createState() => _PurchaseFormDialogState();
}

class _PurchaseFormDialogState extends State<_PurchaseFormDialog> {
  String? _supplierId;
  final _supplierName = TextEditingController();
  String? _warehouseId;
  final _note = TextEditingController();
  final List<_POLine> _lines = [];
  final _lnName = TextEditingController();
  final _lnQty = TextEditingController(text: '1');
  final _lnCost = TextEditingController();
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    if (widget.warehouses.isNotEmpty) {
      _warehouseId = _s(widget.warehouses.first['id']);
    }
  }

  @override
  void dispose() {
    _supplierName.dispose();
    _note.dispose();
    _lnName.dispose();
    _lnQty.dispose();
    _lnCost.dispose();
    super.dispose();
  }

  num get _total => _lines.fold<num>(0, (s, l) => s + (l.qty * l.unitCost));

  void _addLine() {
    final name = _lnName.text.trim();
    final qty = num.tryParse(_lnQty.text.trim()) ?? 0;
    final cost = num.tryParse(_lnCost.text.trim()) ?? 0;
    if (name.isEmpty || qty <= 0) return;
    setState(() {
      _lines.add(_POLine(name, qty, cost));
      _lnName.clear();
      _lnQty.text = '1';
      _lnCost.clear();
    });
  }

  Future<void> _save() async {
    if (_supplierId == null && _supplierName.text.trim().isEmpty) {
      _err('Chọn NCC hoặc nhập tên nơi mua');
      return;
    }
    if (_lines.isEmpty) {
      _err('Thêm ít nhất một dòng hàng');
      return;
    }
    final body = {
      'supplier_id': _supplierId,
      'supplier_name_manual':
          _supplierId == null ? _supplierName.text.trim() : '',
      'warehouse_id': _warehouseId,
      'note': _note.text.trim(),
      'lines': [
        for (final l in _lines)
          {
            'item_type': 'adhoc',
            'item_id': '',
            'name': l.name,
            'unit': '',
            'qty': l.qty,
            'unit_cost': l.unitCost,
          },
      ],
    };
    setState(() => _saving = true);
    try {
      final po = await widget.api.savePurchaseOrder(body);
      if (mounted) Navigator.of(context).pop(_s(po['id']));
    } catch (e) {
      if (mounted) {
        setState(() => _saving = false);
        _err(e.toString().replaceFirst('Exception: ', ''));
      }
    }
  }

  void _err(String m) => ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(m), backgroundColor: DanColors.late));

  @override
  Widget build(BuildContext context) {
    // Chặn TRẦN cao theo khoảng trống CÒN LẠI phía trên bàn phím: khi bàn phím
    // mở, hộp thoại co lại vừa vặn nên phần header + footer (Tổng, nút "Tạo
    // đơn") luôn hiện, danh sách ở giữa tự cuộn thay vì bị bàn phím che.
    final maxH = (MediaQuery.sizeOf(context).height -
            MediaQuery.viewInsetsOf(context).bottom -
            48)
        .clamp(280.0, 740.0);
    return Dialog(
      backgroundColor: DanColors.surface,
      child: ConstrainedBox(
        constraints: BoxConstraints(maxWidth: 620, maxHeight: maxH),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 18, 12, 8),
              child: Row(
                children: [
                  const Expanded(
                    child: Text('Tạo đơn mua',
                        style:
                            TextStyle(fontSize: 19, fontWeight: FontWeight.w900)),
                  ),
                  IconButton(
                      onPressed: () => Navigator.of(context).pop(),
                      icon: const Icon(Icons.close)),
                ],
              ),
            ),
            const Divider(height: 1, color: DanColors.border),
            Flexible(
              child: ListView(
                padding: const EdgeInsets.all(20),
                children: [
                  DropdownButtonFormField<String?>(
                    initialValue: _supplierId,
                    isExpanded: true,
                    decoration: const InputDecoration(
                        labelText: 'Nhà cung cấp', isDense: true),
                    items: [
                      const DropdownMenuItem(
                          value: null, child: Text('— Mua chợ / nhập tên tay —')),
                      for (final s in widget.suppliers)
                        DropdownMenuItem(
                            value: _s(s['id']),
                            child: Text(
                                '${_s(s['company']).isNotEmpty ? '${_s(s['company'])} · ' : ''}${_s(s['name'])}',
                                overflow: TextOverflow.ellipsis)),
                    ],
                    onChanged: (v) => setState(() => _supplierId = v),
                  ),
                  if (_supplierId == null) ...[
                    const SizedBox(height: 12),
                    TextField(
                      controller: _supplierName,
                      decoration: const InputDecoration(
                          labelText: 'Tên nơi mua',
                          hintText: 'VD: Chợ Bình Điền',
                          isDense: true),
                    ),
                  ],
                  const SizedBox(height: 12),
                  DropdownButtonFormField<String>(
                    initialValue: _warehouseId,
                    isExpanded: true,
                    decoration: const InputDecoration(
                        labelText: 'Nhập vào kho', isDense: true),
                    items: [
                      for (final w in widget.warehouses)
                        DropdownMenuItem(
                            value: _s(w['id']), child: Text(_s(w['name']))),
                    ],
                    onChanged: (v) => setState(() => _warehouseId = v),
                  ),
                  const SizedBox(height: 16),
                  const Text('Dòng hàng',
                      style:
                          TextStyle(fontSize: 13, fontWeight: FontWeight.w800)),
                  const SizedBox(height: 8),
                  for (var i = 0; i < _lines.length; i++)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 6),
                      child: Row(
                        children: [
                          Expanded(
                              child: Text(_lines[i].name,
                                  maxLines: 1, overflow: TextOverflow.ellipsis)),
                          Text(
                              '${Fmt.int0(_lines[i].qty)} × ${Fmt.money(_lines[i].unitCost)}',
                              style: const TextStyle(
                                  fontSize: 12.5, color: DanColors.muted)),
                          const SizedBox(width: 8),
                          SizedBox(
                            width: 90,
                            child: Text(Fmt.money(_lines[i].qty * _lines[i].unitCost),
                                textAlign: TextAlign.right,
                                style: const TextStyle(
                                    fontWeight: FontWeight.w800, fontSize: 13)),
                          ),
                          IconButton(
                            onPressed: () => setState(() => _lines.removeAt(i)),
                            icon: const Icon(Icons.remove_circle_outline,
                                size: 18, color: DanColors.late),
                          ),
                        ],
                      ),
                    ),
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.end,
                    children: [
                      Expanded(
                        flex: 3,
                        child: TextField(
                          controller: _lnName,
                          decoration: const InputDecoration(
                              labelText: 'Tên hàng', isDense: true),
                        ),
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: TextField(
                          controller: _lnQty,
                          keyboardType: TextInputType.number,
                          decoration: const InputDecoration(
                              labelText: 'SL', isDense: true),
                        ),
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        flex: 2,
                        child: TextField(
                          controller: _lnCost,
                          keyboardType: TextInputType.number,
                          decoration: const InputDecoration(
                              labelText: 'Đơn giá', isDense: true),
                          onSubmitted: (_) => _addLine(),
                        ),
                      ),
                      IconButton(
                        onPressed: _addLine,
                        icon: const Icon(Icons.add_circle, color: DanColors.brand),
                      ),
                    ],
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: _note,
                    decoration: const InputDecoration(
                        labelText: 'Ghi chú', isDense: true),
                  ),
                ],
              ),
            ),
            const Divider(height: 1, color: DanColors.border),
            Padding(
              padding: const EdgeInsets.all(14),
              child: Row(
                children: [
                  Text('Tổng: ${Fmt.money(_total)}',
                      style: const TextStyle(
                          fontSize: 16, fontWeight: FontWeight.w900)),
                  const Spacer(),
                  TextButton(
                      onPressed: () => Navigator.of(context).pop(),
                      child: const Text('Hủy')),
                  const SizedBox(width: 8),
                  FilledButton(
                    onPressed: _saving ? null : _save,
                    child: _saving
                        ? const SizedBox(
                            width: 18,
                            height: 18,
                            child: CircularProgressIndicator(
                                strokeWidth: 2, color: Colors.white))
                        : const Text('Tạo đơn'),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

// ── Detail + actions ─────────────────────────────────────────────────────

class _PurchaseDetailDialog extends StatefulWidget {
  final ApiService api;
  final String orderId;
  final List<Map<String, dynamic>> warehouses;
  const _PurchaseDetailDialog(
      {required this.api, required this.orderId, required this.warehouses});

  @override
  State<_PurchaseDetailDialog> createState() => _PurchaseDetailDialogState();
}

class _PurchaseDetailDialogState extends State<_PurchaseDetailDialog> {
  Map<String, dynamic>? _po;
  bool _loading = true;
  bool _changed = false;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    try {
      final po = await widget.api.getPurchaseOrder(widget.orderId);
      if (!mounted) return;
      setState(() {
        _po = po;
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() => _loading = false);
      _toast(e.toString().replaceFirst('Exception: ', ''), error: true);
    }
  }

  void _toast(String m, {bool error = false}) =>
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text(m), backgroundColor: error ? DanColors.late : DanColors.text));

  Future<void> _run(Future<void> Function() action, String okMsg) async {
    setState(() => _busy = true);
    try {
      await action();
      _changed = true;
      _toast(okMsg);
      await _load();
    } catch (e) {
      _toast(e.toString().replaceFirst('Exception: ', ''), error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _receive() async {
    final po = _po!;
    final ok = await showDialog<bool>(
      context: context,
      builder: (_) => _ReceiveDialog(
        api: widget.api,
        po: po,
        warehouses: widget.warehouses,
      ),
    );
    if (ok == true) {
      _changed = true;
      _load();
    }
  }

  Future<void> _pay() async {
    final po = _po!;
    final ok = await showDialog<bool>(
      context: context,
      builder: (_) => _PayDialog(api: widget.api, po: po),
    );
    if (ok == true) {
      _changed = true;
      _load();
    }
  }

  @override
  Widget build(BuildContext context) {
    return Dialog(
      backgroundColor: DanColors.surface,
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 600, maxHeight: 720),
        child: _loading
            ? const SizedBox(
                height: 200, child: Center(child: CircularProgressIndicator()))
            : _po == null
                ? const SizedBox(
                    height: 200,
                    child: Center(child: Text('Không tải được đơn')))
                : _content(),
      ),
    );
  }

  Widget _content() {
    final po = _po!;
    final status = _s(po['status']);
    final lines = (po['lines'] is List) ? (po['lines'] as List) : const [];
    final total = _n(po['total']);
    final paid = _n(po['paid']);
    final due = _n(po['due']);

    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(20, 18, 12, 8),
          child: Row(
            children: [
              Text('#${_s(po['code'])}',
                  style: const TextStyle(
                      fontFamily: 'JetBrains Mono',
                      fontSize: 18,
                      fontWeight: FontWeight.w900,
                      color: DanColors.brand)),
              const SizedBox(width: 10),
              _StatusChip(status: status),
              const Spacer(),
              IconButton(
                  onPressed: () => Navigator.of(context).pop(_changed),
                  icon: const Icon(Icons.close)),
            ],
          ),
        ),
        const Divider(height: 1, color: DanColors.border),
        Flexible(
          child: ListView(
            padding: const EdgeInsets.all(20),
            children: [
              Text('NCC: ${_s(po['supplier_name']).isEmpty ? '— Mua chợ' : _s(po['supplier_name'])}',
                  style: const TextStyle(fontWeight: FontWeight.w700)),
              if (_s(po['note']).isNotEmpty) ...[
                const SizedBox(height: 4),
                Text(_s(po['note']),
                    style: const TextStyle(fontSize: 12.5, color: DanColors.muted)),
              ],
              const SizedBox(height: 14),
              Container(
                decoration: BoxDecoration(
                  border: Border.all(color: DanColors.border),
                  borderRadius: BorderRadius.circular(DanRadius.sm),
                ),
                child: Column(
                  children: [
                    for (var i = 0; i < lines.length; i++)
                      Container(
                        padding: const EdgeInsets.symmetric(
                            horizontal: 12, vertical: 9),
                        decoration: BoxDecoration(
                          border: i < lines.length - 1
                              ? const Border(
                                  bottom: BorderSide(color: DanColors.border))
                              : null,
                        ),
                        child: Row(
                          children: [
                            Expanded(child: Text(_s((lines[i] as Map)['name']))),
                            Text(
                                '${Fmt.int0(_n((lines[i] as Map)['qty']))} (nhận ${Fmt.int0(_n((lines[i] as Map)['received_qty']))}) × ${Fmt.money(_n((lines[i] as Map)['unit_cost']))}',
                                style: const TextStyle(
                                    fontSize: 11.5, color: DanColors.muted)),
                            const SizedBox(width: 8),
                            Text(
                                Fmt.money(_n((lines[i] as Map)['line_total'])),
                                style: const TextStyle(
                                    fontWeight: FontWeight.w800, fontSize: 12.5)),
                          ],
                        ),
                      ),
                  ],
                ),
              ),
              const SizedBox(height: 14),
              _totalRow('Tổng tiền', Fmt.money(total)),
              _totalRow('Đã trả', Fmt.money(paid)),
              _totalRow('Còn nợ', Fmt.money(due),
                  accent: due > 0 ? const Color(0xFFB45309) : null, big: true),
            ],
          ),
        ),
        const Divider(height: 1, color: DanColors.border),
        Padding(
          padding: const EdgeInsets.all(14),
          child: Row(
            children: [
              if (status == 'draft') ...[
                OutlinedButton(
                  onPressed: _busy
                      ? null
                      : () => _run(
                          () => widget.api.deletePurchase(_s(po['id'])).then((_) {
                                if (mounted) Navigator.of(context).pop(true);
                              }),
                          'Đã xóa đơn'),
                  style: OutlinedButton.styleFrom(
                      foregroundColor: DanColors.late),
                  child: const Text('Xóa'),
                ),
                const Spacer(),
                FilledButton(
                  onPressed: _busy
                      ? null
                      : () => _run(
                          () => widget.api.confirmPurchase(_s(po['id'])),
                          'Đã xác nhận đơn'),
                  child: const Text('Xác nhận đơn'),
                ),
              ] else if (status == 'confirmed') ...[
                OutlinedButton(
                  onPressed: _busy
                      ? null
                      : () => _run(() => widget.api.cancelPurchase(_s(po['id'])),
                          'Đã hủy đơn'),
                  style: OutlinedButton.styleFrom(
                      foregroundColor: DanColors.late),
                  child: const Text('Hủy đơn'),
                ),
                const Spacer(),
                if (due > 0)
                  OutlinedButton(
                      onPressed: _busy ? null : _pay,
                      child: const Text('Thanh toán')),
                const SizedBox(width: 8),
                FilledButton(
                    onPressed: _busy ? null : _receive,
                    child: const Text('Nhận hàng')),
              ] else if (status == 'received' && due > 0) ...[
                const Spacer(),
                FilledButton(
                    onPressed: _busy ? null : _pay,
                    child: const Text('Thanh toán công nợ')),
              ] else
                const Spacer(),
            ],
          ),
        ),
      ],
    );
  }

  Widget _totalRow(String label, String value, {Color? accent, bool big = false}) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 3),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label,
              style: TextStyle(
                  fontSize: big ? 14 : 13,
                  fontWeight: big ? FontWeight.w800 : FontWeight.w500,
                  color: DanColors.muted)),
          Text(value,
              style: TextStyle(
                  fontSize: big ? 16 : 13.5,
                  fontWeight: big ? FontWeight.w900 : FontWeight.w700,
                  color: accent ?? DanColors.text)),
        ],
      ),
    );
  }
}

class _ReceiveDialog extends StatefulWidget {
  final ApiService api;
  final Map<String, dynamic> po;
  final List<Map<String, dynamic>> warehouses;
  const _ReceiveDialog(
      {required this.api, required this.po, required this.warehouses});

  @override
  State<_ReceiveDialog> createState() => _ReceiveDialogState();
}

class _ReceiveDialogState extends State<_ReceiveDialog> {
  String? _warehouseId;
  late final Map<String, TextEditingController> _qty;
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    final poWh = _s(widget.po['warehouse_id']);
    final hasPoWh = widget.warehouses.any((w) => _s(w['id']) == poWh);
    _warehouseId = hasPoWh
        ? poWh
        : (widget.warehouses.isNotEmpty ? _s(widget.warehouses.first['id']) : null);
    _qty = {};
    final lines = (widget.po['lines'] is List) ? (widget.po['lines'] as List) : const [];
    for (final l in lines) {
      final m = l as Map;
      final remaining = _n(m['qty']) - _n(m['received_qty']);
      _qty[_s(m['id'])] = TextEditingController(
          text: remaining > 0 ? Fmt.int0(remaining) : '0');
    }
  }

  @override
  void dispose() {
    for (final c in _qty.values) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _save() async {
    final receipts = <Map<String, dynamic>>[];
    _qty.forEach((lineId, ctrl) {
      final q = num.tryParse(ctrl.text.trim()) ?? 0;
      if (q > 0) receipts.add({'line_id': lineId, 'qty': q});
    });
    if (receipts.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
          content: Text('Nhập số lượng nhận'),
          backgroundColor: DanColors.late));
      return;
    }
    setState(() => _saving = true);
    try {
      await widget.api.receivePurchase(_s(widget.po['id']),
          {'warehouse_id': _warehouseId, 'receipts': receipts});
      if (mounted) Navigator.of(context).pop(true);
    } catch (e) {
      if (mounted) {
        setState(() => _saving = false);
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(
            content: Text(e.toString().replaceFirst('Exception: ', '')),
            backgroundColor: DanColors.late));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final lines = (widget.po['lines'] is List) ? (widget.po['lines'] as List) : const [];
    return AlertDialog(
      backgroundColor: DanColors.surface,
      title: const Text('Nhận hàng vào kho',
          style: TextStyle(fontWeight: FontWeight.w900, fontSize: 18)),
      content: SizedBox(
        width: 420,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            DropdownButtonFormField<String>(
              initialValue: _warehouseId,
              isExpanded: true,
              decoration: const InputDecoration(labelText: 'Kho nhận'),
              items: [
                for (final w in widget.warehouses)
                  DropdownMenuItem(value: _s(w['id']), child: Text(_s(w['name']))),
              ],
              onChanged: (v) => setState(() => _warehouseId = v),
            ),
            const SizedBox(height: 12),
            for (final l in lines)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 5),
                child: Row(
                  children: [
                    Expanded(child: Text(_s((l as Map)['name']))),
                    SizedBox(
                      width: 90,
                      child: TextField(
                        controller: _qty[_s((l)['id'])],
                        keyboardType: TextInputType.number,
                        textAlign: TextAlign.right,
                        decoration: const InputDecoration(isDense: true),
                      ),
                    ),
                  ],
                ),
              ),
          ],
        ),
      ),
      actions: [
        TextButton(
            onPressed: () => Navigator.of(context).pop(), child: const Text('Hủy')),
        FilledButton(
          onPressed: _saving ? null : _save,
          child: _saving
              ? const SizedBox(
                  width: 18,
                  height: 18,
                  child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
              : const Text('Nhận hàng'),
        ),
      ],
    );
  }
}

class _PayDialog extends StatefulWidget {
  final ApiService api;
  final Map<String, dynamic> po;
  const _PayDialog({required this.api, required this.po});

  @override
  State<_PayDialog> createState() => _PayDialogState();
}

class _PayDialogState extends State<_PayDialog> {
  late final TextEditingController _amount;
  final _note = TextEditingController();
  String _source = 'direct';
  String _method = 'cash';
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    _amount = TextEditingController(text: Fmt.int0(_n(widget.po['due'])));
  }

  @override
  void dispose() {
    _amount.dispose();
    _note.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final amount = num.tryParse(_amount.text.trim()) ?? 0;
    if (amount <= 0) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
          content: Text('Số tiền không hợp lệ'),
          backgroundColor: DanColors.late));
      return;
    }
    setState(() => _saving = true);
    try {
      await widget.api.payPurchase(_s(widget.po['id']), {
        'amount': amount,
        'source': _source,
        'method': _source == 'direct' ? _method : 'cash',
        'note': _note.text.trim(),
      });
      if (mounted) Navigator.of(context).pop(true);
    } catch (e) {
      if (mounted) {
        setState(() => _saving = false);
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(
            content: Text(e.toString().replaceFirst('Exception: ', '')),
            backgroundColor: DanColors.late));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      backgroundColor: DanColors.surface,
      title: const Text('Thanh toán NCC',
          style: TextStyle(fontWeight: FontWeight.w900, fontSize: 18)),
      content: SizedBox(
        width: 380,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(
              controller: _amount,
              autofocus: true,
              keyboardType: TextInputType.number,
              decoration: const InputDecoration(labelText: 'Số tiền'),
            ),
            const SizedBox(height: 12),
            DropdownButtonFormField<String>(
              initialValue: _source,
              decoration: const InputDecoration(labelText: 'Nguồn tiền'),
              items: const [
                DropdownMenuItem(value: 'direct', child: Text('Chi trực tiếp (kế toán)')),
                DropdownMenuItem(value: 'drawer', child: Text('Chi từ két tiền')),
              ],
              onChanged: (v) => setState(() => _source = v ?? 'direct'),
            ),
            if (_source == 'direct') ...[
              const SizedBox(height: 12),
              DropdownButtonFormField<String>(
                initialValue: _method,
                decoration: const InputDecoration(labelText: 'Hình thức'),
                items: const [
                  DropdownMenuItem(value: 'cash', child: Text('Tiền mặt')),
                  DropdownMenuItem(value: 'transfer', child: Text('Chuyển khoản')),
                ],
                onChanged: (v) => setState(() => _method = v ?? 'cash'),
              ),
            ],
            const SizedBox(height: 12),
            TextField(
                controller: _note,
                decoration: const InputDecoration(labelText: 'Ghi chú')),
          ],
        ),
      ),
      actions: [
        TextButton(
            onPressed: () => Navigator.of(context).pop(), child: const Text('Hủy')),
        FilledButton(
          onPressed: _saving ? null : _save,
          child: _saving
              ? const SizedBox(
                  width: 18,
                  height: 18,
                  child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
              : const Text('Ghi thanh toán'),
        ),
      ],
    );
  }
}
