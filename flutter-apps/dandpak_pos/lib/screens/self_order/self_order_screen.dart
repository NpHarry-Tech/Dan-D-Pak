import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../providers/auth_provider.dart';
import '../../services/api_service.dart';
import '../../services/local_store.dart';
import '../../services/socket_service.dart';
import '../../ui/app_theme.dart';
import '../../ui/format.dart';
import '../../widgets/manager_pin_dialog.dart';

/// iPad Self-order — màn KHÁCH tự gọi món, viết NATIVE (không còn WebView /ipad).
///
/// Cùng backend với web: /menu, /tables/:id, /orders (source=customer_ipad),
/// /calls, /device/ipad/*. Realtime qua SocketService như POS/KDS. Kiosk: khách
/// không có nút thoát — nhân viên chạm 5 lần góc trên-trái trong 3 giây để ra.
class SelfOrderScreen extends StatefulWidget {
  final String serverUrl;
  const SelfOrderScreen({super.key, required this.serverUrl});

  @override
  State<SelfOrderScreen> createState() => _SelfOrderScreenState();
}

class _CartLine {
  final String key;
  final Map<String, dynamic> item;
  int qty;
  final List<Map<String, dynamic>> mods;
  final String note;
  _CartLine(this.item, {this.qty = 1, this.mods = const [], this.note = ''})
      : key = '${item['id']}_${DateTime.now().microsecondsSinceEpoch}';

  num get lineTotal {
    final base = _num(item['price']);
    final add = mods.fold<num>(0, (s, m) => s + _num(m['price']));
    return (base + add) * qty;
  }
}

num _num(dynamic v) => v is num ? v : num.tryParse('${v ?? ''}') ?? 0;
String _s(dynamic v) => v?.toString() ?? '';
bool _bool(dynamic v) => v == true || v == 1 || v == '1';

class _SelfOrderScreenState extends State<SelfOrderScreen> {
  final _api = _ApiHolder();
  Map<String, dynamic> _menu = {'categories': [], 'items': []};
  Map<String, dynamic>? _sentOrder;
  final List<_CartLine> _cart = [];
  String _activeCat = '';
  String? _tableId;
  String? _tableCode;
  bool _loading = true;
  String? _error;
  bool _tablePickUnlocked = false;

  // Kiosk exit
  int _exitTaps = 0;
  Timer? _exitWindow;

  void Function(String, dynamic)? _socketListener;

  List<Map<String, dynamic>> get _categories =>
      (_menu['categories'] as List? ?? [])
          .whereType<Map>()
          .map((e) => Map<String, dynamic>.from(e))
          .toList();

  List<Map<String, dynamic>> get _items => (_menu['items'] as List? ?? [])
      .whereType<Map>()
      .map((e) => Map<String, dynamic>.from(e))
      .toList();

  @override
  void initState() {
    super.initState();
    _api.api = context.read<ApiService>();
    _boot();
    _socketListener = _onSocket;
    SocketService().addListener(_socketListener!);
  }

  @override
  void dispose() {
    _exitWindow?.cancel();
    if (_socketListener != null) {
      SocketService().removeListener(_socketListener!);
    }
    super.dispose();
  }

  Future<void> _boot() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      _tableId = await LocalStore.instance.getString('ipad_table');
      _tableCode = await LocalStore.instance.getString('ipad_tablecode');
      _menu = await _api.api.getMenuFull();
      if (_activeCat.isEmpty && _categories.isNotEmpty) {
        _activeCat = _s(_categories.first['id']);
      }
      if (_tableId != null && _tableId!.isNotEmpty) {
        await _refreshOrder();
      }
    } catch (e) {
      _error = e.toString();
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _refreshOrder() async {
    final id = _tableId;
    if (id == null || id.isEmpty) return;
    try {
      final t = await _api.api.getTable(id);
      _sentOrder = t['order'] is Map
          ? Map<String, dynamic>.from(t['order'] as Map)
          : null;
      if (mounted) setState(() {});
    } catch (_) {}
  }

  void _onSocket(String event, dynamic payload) {
    if (!mounted) return;
    final sid = _s(_sentOrder?['id']);
    switch (event) {
      case 'menu:updated':
        _api.api.getMenuFull().then((m) {
          if (mounted) setState(() => _menu = m);
        });
        break;
      case 'order:item':
        if (payload is Map && _s(payload['order_id']) == sid) {
          _sentOrder = payload['order'] is Map
              ? Map<String, dynamic>.from(payload['order'] as Map)
              : _sentOrder;
          setState(() {});
        }
        break;
      case 'order:pending':
      case 'order:updated':
        _refreshOrder();
        break;
      case 'payment:done':
        if (payload is Map && _s(payload['order_id']) == sid) {
          setState(() {
            _sentOrder = null;
            _cart.clear();
          });
          _toast('Bàn đã thanh toán xong. Cảm ơn quý khách!');
        }
        break;
    }
  }

  void _toast(String msg, {bool err = false}) {
    if (!mounted) return;
    ScaffoldMessenger.of(context)
      ..clearSnackBars()
      ..showSnackBar(SnackBar(
        content: Text(msg),
        backgroundColor: err ? DanColors.late : DanColors.text,
        duration: const Duration(seconds: 2),
      ));
  }

  String _imageUrl(dynamic path) {
    final p = _s(path);
    if (p.isEmpty) return '';
    if (p.startsWith('http')) return p;
    final root = widget.serverUrl.replaceAll(RegExp(r'/+$'), '');
    return '$root${p.startsWith('/') ? '' : '/'}$p';
  }

  // ─── Kiosk exit gesture ───
  void _cornerTap() {
    _exitTaps++;
    _exitWindow ??= Timer(const Duration(seconds: 3), () {
      _exitTaps = 0;
      _exitWindow = null;
    });
    if (_exitTaps >= 5) {
      _exitWindow?.cancel();
      _exitWindow = null;
      _exitTaps = 0;
      Navigator.of(context).pop();
    }
  }

  // ─── Staff unlock to (re)pick a table ───
  Future<void> _staffUnlock() async {
    final pin = await requestManagerPin(
      context,
      'Nhân viên nhập PIN để chọn/đổi bàn cho iPad này.',
      label: 'PIN nhân viên',
    );
    if (pin == null) return;
    try {
      await _api.api.ipadUnlock(pin);
    } catch (e) {
      _toast('PIN không đúng', err: true);
      return;
    }
    await LocalStore.instance.remove('ipad_table');
    await LocalStore.instance.remove('ipad_tablecode');
    setState(() {
      _tablePickUnlocked = true;
      _tableId = null;
      _tableCode = null;
      _cart.clear();
      _sentOrder = null;
    });
  }

  Future<void> _assignTable(String id, String code) async {
    await LocalStore.instance.setString('ipad_table', id);
    await LocalStore.instance.setString('ipad_tablecode', code);
    setState(() {
      _tableId = id;
      _tableCode = code;
      _tablePickUnlocked = false;
    });
    await _refreshOrder();
  }

  // ─── Order actions ───
  Future<void> _sendOrder() async {
    if (_cart.isEmpty) return;
    try {
      final items = _cart
          .map((c) => {
                'menu_item_id': c.item['id'],
                'qty': c.qty,
                'note': c.note,
                'mods': c.mods,
              })
          .toList();
      final order = await _api.api.createOrUpdateOrder({
        'table_id': _tableId,
        'channel': 'dine_in',
        'source': 'customer_ipad',
        'items': items,
      });
      setState(() {
        _sentOrder = order;
        _cart.clear();
      });
      _toast('✅ Đã gửi yêu cầu! Nhân viên sẽ xác nhận với bàn $_tableCode');
    } catch (e) {
      _toast(_clean(e), err: true);
    }
  }

  Future<void> _callStaff() async {
    final reason = await showModalBottomSheet<String>(
      context: context,
      backgroundColor: DanColors.surface,
      builder: (ctx) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Padding(
              padding: EdgeInsets.all(16),
              child: Text('Gọi nhân viên',
                  style:
                      TextStyle(fontSize: 18, fontWeight: FontWeight.w900)),
            ),
            for (final r in const [
              'Gọi món thêm',
              'Thêm nước / đá',
              'Hỗ trợ',
              'Thanh toán'
            ])
              ListTile(
                leading: const Icon(Icons.room_service_outlined,
                    color: DanColors.brand),
                title: Text(r),
                onTap: () => Navigator.pop(ctx, r),
              ),
            const SizedBox(height: 8),
          ],
        ),
      ),
    );
    if (reason == null) return;
    try {
      await _api.api.callStaff(_tableId!, reason);
      _toast('🔔 Đã gọi nhân viên');
    } catch (e) {
      _toast(_clean(e), err: true);
    }
  }

  String _clean(Object e) =>
      e.toString().replaceFirst('Exception: ', '').trim();

  num get _cartTotal => _cart.fold<num>(0, (s, c) => s + c.lineTotal);

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: DanColors.surface2,
      body: Stack(
        children: [
          Positioned.fill(child: _content()),
          // Vùng thoát ẩn cho nhân viên (5 chạm / 3 giây, góc trên-trái).
          Positioned(
            top: 0,
            left: 0,
            width: 72,
            height: 72,
            child: GestureDetector(
              behavior: HitTestBehavior.translucent,
              onTap: _cornerTap,
            ),
          ),
        ],
      ),
    );
  }

  Widget _content() {
    if (_loading) {
      return const Center(child: CircularProgressIndicator());
    }
    if (_error != null) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.wifi_off, size: 48, color: DanColors.muted),
            const SizedBox(height: 12),
            Text('Không mở được màn tự gọi món\n${_clean(_error!)}',
                textAlign: TextAlign.center),
            const SizedBox(height: 14),
            FilledButton(onPressed: _boot, child: const Text('Thử lại')),
          ],
        ),
      );
    }
    if (_tableId == null || _tableId!.isEmpty) {
      return _tablePickUnlocked ? _TablePick(state: this) : _tableGate();
    }
    return _menuView();
  }

  // ─── Table gate (chưa gắn bàn) ───
  Widget _tableGate() {
    return Column(
      children: [
        _topBar(title: 'Chưa chọn bàn', showCall: false),
        Expanded(
          child: Center(
            child: Container(
              width: 420,
              padding: const EdgeInsets.all(28),
              decoration: BoxDecoration(
                color: DanColors.surface,
                borderRadius: BorderRadius.circular(18),
                border: Border.all(color: DanColors.border),
              ),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Image.asset('assets/web/assets/logo.png',
                      height: 60,
                      errorBuilder: (_, __, ___) =>
                          const SizedBox(height: 60)),
                  const SizedBox(height: 16),
                  const Text('Thiết bị chưa gắn bàn',
                      style: TextStyle(
                          fontSize: 18, fontWeight: FontWeight.w900)),
                  const SizedBox(height: 8),
                  const Text(
                    'Nhân viên chạm logo góc trái 3 lần (hoặc nút bên dưới), nhập PIN rồi chọn bàn cho iPad này.',
                    textAlign: TextAlign.center,
                    style: TextStyle(color: DanColors.muted, height: 1.4),
                  ),
                  const SizedBox(height: 18),
                  FilledButton.icon(
                    onPressed: _staffUnlock,
                    icon: const Icon(Icons.lock_open, size: 18),
                    label: const Text('Nhân viên chọn bàn'),
                  ),
                ],
              ),
            ),
          ),
        ),
      ],
    );
  }

  // ─── Top bar ───
  Widget _topBar({required String title, bool showCall = true}) {
    final branch = context.read<AuthProvider>().selectedBranch;
    return Container(
      height: 62,
      padding: const EdgeInsets.symmetric(horizontal: 16),
      decoration: const BoxDecoration(
        color: DanColors.surface,
        border: Border(bottom: BorderSide(color: DanColors.border)),
      ),
      child: Row(
        children: [
          // Logo = cổng nhân viên: chạm 3 lần mở PIN chọn bàn.
          _TripleTap(
            onTriple: _staffUnlock,
            child: Image.asset('assets/web/assets/DanOnLogo.png',
                height: 40,
                errorBuilder: (_, __, ___) => const Icon(Icons.restaurant)),
          ),
          const SizedBox(width: 12),
          Container(width: 1, height: 34, color: DanColors.border2),
          const SizedBox(width: 12),
          Column(
            mainAxisAlignment: MainAxisAlignment.center,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(title,
                  style: const TextStyle(
                      fontSize: 16, fontWeight: FontWeight.w900)),
              Text('Chi nhánh: ${branch.name} · Trực tiếp',
                  style: const TextStyle(
                      fontSize: 11.5, color: DanColors.muted)),
            ],
          ),
          const Spacer(),
          ValueListenableBuilder<bool>(
            valueListenable: SocketService().connected,
            builder: (_, online, __) => Row(
              children: [
                Container(
                  width: 8,
                  height: 8,
                  decoration: BoxDecoration(
                    color: online ? DanColors.done : DanColors.late,
                    shape: BoxShape.circle,
                  ),
                ),
                const SizedBox(width: 6),
                Text(online ? 'Online' : 'Mất kết nối',
                    style: TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.w700,
                        color: online ? DanColors.done : DanColors.late)),
              ],
            ),
          ),
          if (showCall) ...[
            const SizedBox(width: 14),
            FilledButton.icon(
              onPressed: _callStaff,
              style: FilledButton.styleFrom(
                  backgroundColor: DanColors.surface2,
                  foregroundColor: DanColors.text),
              icon: const Text('🔔', style: TextStyle(fontSize: 14)),
              label: const Text('Gọi nhân viên'),
            ),
          ],
        ],
      ),
    );
  }

  // ─── Menu (landscape: cats | items | cart) ───
  Widget _menuView() {
    final items = _sortItems(
        _items.where((i) => _s(i['category_id']) == _activeCat).toList());
    return Column(
      children: [
        _topBar(title: 'Bàn ${_s(_tableCode)}'),
        Expanded(
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              // Category rail
              SizedBox(
                width: 168,
                child: Container(
                  color: DanColors.surface,
                  child: ListView(
                    padding: const EdgeInsets.symmetric(vertical: 8),
                    children: [
                      for (final c in _categories)
                        _catTile(c),
                    ],
                  ),
                ),
              ),
              const VerticalDivider(width: 1, color: DanColors.border),
              // Item list
              Expanded(
                child: items.isEmpty
                    ? const Center(
                        child: Text('Chưa có món trong nhóm này',
                            style: TextStyle(color: DanColors.muted)))
                    : GridView.builder(
                        padding: const EdgeInsets.all(14),
                        gridDelegate:
                            const SliverGridDelegateWithMaxCrossAxisExtent(
                          maxCrossAxisExtent: 260,
                          mainAxisExtent: 300,
                          crossAxisSpacing: 12,
                          mainAxisSpacing: 12,
                        ),
                        itemCount: items.length,
                        itemBuilder: (_, i) => _itemCard(items[i]),
                      ),
              ),
              const VerticalDivider(width: 1, color: DanColors.border),
              // Cart pane
              SizedBox(width: 340, child: _cartPane()),
            ],
          ),
        ),
      ],
    );
  }

  List<Map<String, dynamic>> _sortItems(List<Map<String, dynamic>> items) => [
        ...items.where((i) => i['available'] != false),
        ...items.where((i) => i['available'] == false),
      ];

  Widget _catTile(Map<String, dynamic> c) {
    final active = _s(c['id']) == _activeCat;
    return InkWell(
      onTap: () => setState(() => _activeCat = _s(c['id'])),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
        decoration: BoxDecoration(
          color: active ? DanColors.brandDim : Colors.transparent,
          border: Border(
              left: BorderSide(
                  color: active ? DanColors.brand : Colors.transparent,
                  width: 3)),
        ),
        child: Row(
          children: [
            Text(_s(c['icon']).isEmpty ? '🍽️' : _s(c['icon']),
                style: const TextStyle(fontSize: 16)),
            const SizedBox(width: 8),
            Expanded(
              child: Text(_s(c['name']),
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                      fontSize: 13,
                      fontWeight: active ? FontWeight.w900 : FontWeight.w600,
                      color: active ? DanColors.brand : DanColors.text)),
            ),
          ],
        ),
      ),
    );
  }

  Widget _itemCard(Map<String, dynamic> it) {
    final available = it['available'] != false;
    final img = _imageUrl(it['image']);
    return Opacity(
      opacity: available ? 1 : 0.5,
      child: InkWell(
        onTap: available ? () => _openItem(it) : null,
        borderRadius: BorderRadius.circular(14),
        child: Container(
          decoration: BoxDecoration(
            color: DanColors.surface,
            borderRadius: BorderRadius.circular(14),
            border: Border.all(color: DanColors.border),
          ),
          clipBehavior: Clip.antiAlias,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              SizedBox(
                height: 150,
                child: img.isEmpty
                    ? Container(
                        color: DanColors.surface2,
                        alignment: Alignment.center,
                        child: Text(_s(it['emoji']).isEmpty ? '🍽️' : _s(it['emoji']),
                            style: const TextStyle(fontSize: 44)),
                      )
                    : Image.network(img,
                        fit: BoxFit.cover,
                        errorBuilder: (_, __, ___) => Container(
                              color: DanColors.surface2,
                              alignment: Alignment.center,
                              child: Text(
                                  _s(it['emoji']).isEmpty ? '🍽️' : _s(it['emoji']),
                                  style: const TextStyle(fontSize: 44)),
                            )),
              ),
              Expanded(
                child: Padding(
                  padding: const EdgeInsets.all(10),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(_s(it['name']),
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                              fontSize: 13.5, fontWeight: FontWeight.w800)),
                      const SizedBox(height: 3),
                      Text(Fmt.money(_num(it['price'])),
                          style: const TextStyle(
                              fontSize: 14,
                              fontWeight: FontWeight.w900,
                              color: DanColors.brand)),
                      const Spacer(),
                      Text(
                        '⏱ ${_s(it['sla_minutes'])}′ · ${_stationLabel(_s(it['station']))}',
                        style: const TextStyle(
                            fontSize: 11, color: DanColors.muted),
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  String _stationLabel(String s) =>
      {
        'kitchen': 'Bếp',
        'bar': 'Bar',
        'salad': 'Salad',
        'beverage': 'Beverage'
      }[s] ??
      s;

  // ─── Cart pane ───
  Widget _cartPane() {
    final active = ((_sentOrder?['items'] as List?) ?? [])
        .whereType<Map>()
        .where((i) => i['status'] != 'cancelled')
        .toList();
    return Container(
      color: DanColors.surface,
      child: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 14, 16, 8),
            child: Row(
              children: [
                const Text('🛒 Giỏ hàng',
                    style:
                        TextStyle(fontSize: 16, fontWeight: FontWeight.w900)),
                const SizedBox(width: 8),
                Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                  decoration: BoxDecoration(
                      color: DanColors.surface3,
                      borderRadius: BorderRadius.circular(99)),
                  child: Text(
                      '${_cart.fold<int>(0, (s, c) => s + c.qty)} món',
                      style: const TextStyle(
                          fontSize: 11.5, color: DanColors.muted)),
                ),
              ],
            ),
          ),
          Expanded(
            child: ListView(
              padding: const EdgeInsets.symmetric(horizontal: 12),
              children: [
                for (var i = 0; i < _cart.length; i++) _cartLine(_cart[i]),
                if (_cart.isEmpty && active.isEmpty)
                  Padding(
                    padding: const EdgeInsets.only(top: 40),
                    child: Column(
                      children: [
                        Image.asset('assets/web/assets/DanOnLogo.png',
                            height: 54,
                            errorBuilder: (_, __, ___) =>
                                const SizedBox.shrink()),
                        const SizedBox(height: 10),
                        const Text('Chọn món trên màn hình',
                            style: TextStyle(color: DanColors.muted)),
                      ],
                    ),
                  ),
                if (active.isNotEmpty) _sentList(active),
              ],
            ),
          ),
          _cartFooter(active.length),
        ],
      ),
    );
  }

  Widget _cartLine(_CartLine c) {
    final modTxt = c.mods.map((m) => _s(m['name'])).join(', ');
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: DanColors.surface2,
        borderRadius: BorderRadius.circular(10),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text('${_s(c.item['emoji'])} ${_s(c.item['name'])}',
                    style: const TextStyle(
                        fontWeight: FontWeight.w800, fontSize: 13)),
              ),
              Text(Fmt.money(c.lineTotal),
                  style: const TextStyle(
                      fontWeight: FontWeight.w900,
                      fontFamily: 'JetBrains Mono',
                      fontSize: 12.5)),
            ],
          ),
          if (modTxt.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(top: 2),
              child: Text('+ $modTxt',
                  style: const TextStyle(
                      fontSize: 11.5, color: DanColors.muted)),
            ),
          if (c.note.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(top: 2),
              child: Text('“${c.note}”',
                  style: const TextStyle(
                      fontSize: 11.5,
                      fontStyle: FontStyle.italic,
                      color: DanColors.muted)),
            ),
          const SizedBox(height: 6),
          Row(
            children: [
              _qtyBtn('−', () => setState(() {
                    c.qty = (c.qty - 1).clamp(1, 999);
                  })),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 12),
                child: Text('${c.qty}',
                    style: const TextStyle(fontWeight: FontWeight.w900)),
              ),
              _qtyBtn('+', () => setState(() => c.qty++)),
              const Spacer(),
              IconButton(
                onPressed: () => setState(() => _cart.remove(c)),
                icon: const Icon(Icons.close, size: 18, color: DanColors.late),
                visualDensity: VisualDensity.compact,
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _qtyBtn(String label, VoidCallback onTap) => InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(8),
        child: Container(
          width: 30,
          height: 30,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            color: DanColors.surface,
            borderRadius: BorderRadius.circular(8),
            border: Border.all(color: DanColors.border2),
          ),
          child: Text(label,
              style: const TextStyle(
                  fontSize: 18, fontWeight: FontWeight.w900)),
        ),
      );

  Widget _sentList(List active) {
    return Container(
      margin: const EdgeInsets.symmetric(vertical: 8),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: DanColors.brandDim,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            '${_sentHeader(active)} · bill #${_billNo()}',
            style: const TextStyle(
                fontSize: 12.5, fontWeight: FontWeight.w900),
          ),
          const SizedBox(height: 6),
          for (final i in active)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 2),
              child: Row(
                children: [
                  Text('${_s(i['qty'])}×',
                      style: const TextStyle(fontWeight: FontWeight.w900)),
                  const SizedBox(width: 6),
                  Expanded(
                      child: Text(_s(i['name']),
                          maxLines: 1, overflow: TextOverflow.ellipsis)),
                  _statusChip(_s(i['status'])),
                ],
              ),
            ),
          const Divider(height: 14),
          Row(
            children: [
              const Text('Tổng đã gọi',
                  style: TextStyle(fontWeight: FontWeight.w900)),
              const Spacer(),
              Text(Fmt.money(_num(_sentOrder?['total'])),
                  style: const TextStyle(
                      fontWeight: FontWeight.w900,
                      color: DanColors.brand,
                      fontFamily: 'JetBrains Mono')),
            ],
          ),
        ],
      ),
    );
  }

  String _billNo() {
    final b = _s(_sentOrder?['bill_no']);
    if (b.isNotEmpty) return b;
    final id = _s(_sentOrder?['id']);
    return (id.length > 6 ? id.substring(id.length - 6) : id).toUpperCase();
  }

  String _sentHeader(List active) {
    if (active.any((i) => i['status'] == 'pending_confirm')) {
      return 'Chờ nhân viên xác nhận';
    }
    if (active.any((i) =>
        ['new', 'accepted', 'preparing'].contains(i['status']))) {
      return 'Bếp đang chuẩn bị món của bạn';
    }
    if (active.isNotEmpty &&
        active.every((i) => ['ready', 'served'].contains(i['status']))) {
      return 'Món đã sẵn sàng — mời quý khách dùng bữa';
    }
    return 'Đơn của bàn';
  }

  Widget _statusChip(String s) {
    final map = {
      'pending_confirm': ('Chờ xác nhận', DanColors.doing),
      'new': ('Chờ bếp', DanColors.muted),
      'accepted': ('Đã nhận', DanColors.doing),
      'preparing': ('Đang làm', DanColors.doing),
      'ready': ('Sẵn sàng', DanColors.done),
      'served': ('Đã phục vụ', DanColors.muted),
    };
    final e = map[s];
    if (e == null) return const SizedBox.shrink();
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
          color: e.$2.withValues(alpha: .18),
          borderRadius: BorderRadius.circular(99)),
      child: Text(e.$1,
          style: TextStyle(
              fontSize: 10.5,
              fontWeight: FontWeight.w800,
              color: e.$2 == DanColors.doing
                  ? const Color(0xFF9A6800)
                  : (e.$2 == DanColors.done
                      ? const Color(0xFF047857)
                      : DanColors.muted))),
    );
  }

  Widget _cartFooter(int activeCount) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: const BoxDecoration(
        border: Border(top: BorderSide(color: DanColors.border)),
      ),
      child: Column(
        children: [
          Row(
            children: [
              const Text('Tạm tính',
                  style: TextStyle(color: DanColors.muted)),
              const Spacer(),
              Text(Fmt.money(_cartTotal),
                  style: const TextStyle(
                      fontWeight: FontWeight.w900, fontSize: 15)),
            ],
          ),
          const SizedBox(height: 10),
          if (_cart.isNotEmpty)
            SizedBox(
              width: double.infinity,
              height: 48,
              child: FilledButton(
                onPressed: _sendOrder,
                child: const Text('Gửi yêu cầu →',
                    style: TextStyle(
                        fontSize: 15, fontWeight: FontWeight.w900)),
              ),
            )
          else if (activeCount > 0)
            SizedBox(
              width: double.infinity,
              height: 48,
              child: FilledButton.icon(
                onPressed: _callStaff,
                style: FilledButton.styleFrom(
                    backgroundColor: const Color(0xFF047857)),
                icon: const Text('💳', style: TextStyle(fontSize: 15)),
                label: Text(
                    'Thanh toán${_num(_sentOrder?['total']) > 0 ? ' · ${Fmt.money(_num(_sentOrder?['total']))}' : ''}',
                    style: const TextStyle(
                        fontSize: 15, fontWeight: FontWeight.w900)),
              ),
            ),
        ],
      ),
    );
  }

  // ─── Item detail modal (modifiers/addons/note) ───
  Future<void> _openItem(Map<String, dynamic> it) async {
    final line = await showModalBottomSheet<_CartLine>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => _ItemSheet(state: this, item: it),
    );
    if (line != null) {
      setState(() => _cart.add(line));
      _toast('Đã thêm ${_s(it['name'])}');
    }
  }
}

/// Giữ ApiService (đọc 1 lần trong initState, tránh gọi context sau dispose).
class _ApiHolder {
  late ApiService api;
}

/// Cụm chạm-3-lần để mở khoá nhân viên (logo/brand trên topbar).
class _TripleTap extends StatefulWidget {
  final Widget child;
  final VoidCallback onTriple;
  const _TripleTap({required this.child, required this.onTriple});
  @override
  State<_TripleTap> createState() => _TripleTapState();
}

class _TripleTapState extends State<_TripleTap> {
  int _taps = 0;
  Timer? _t;
  @override
  void dispose() {
    _t?.cancel();
    super.dispose();
  }

  void _tap() {
    _taps++;
    _t ??= Timer(const Duration(seconds: 2), () {
      _taps = 0;
      _t = null;
    });
    if (_taps >= 3) {
      _t?.cancel();
      _t = null;
      _taps = 0;
      widget.onTriple();
    }
  }

  @override
  Widget build(BuildContext context) =>
      GestureDetector(onTap: _tap, child: widget.child);
}

/// Màn chọn bàn (nhân viên đã mở khoá).
class _TablePick extends StatefulWidget {
  final _SelfOrderScreenState state;
  const _TablePick({required this.state});
  @override
  State<_TablePick> createState() => _TablePickState();
}

class _TablePickState extends State<_TablePick> {
  List<Map<String, dynamic>> _tables = [];
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final rows = await widget.state._api.api.getTables();
      _tables = rows
          .whereType<Map>()
          .map((e) => Map<String, dynamic>.from(e))
          .toList();
    } catch (_) {}
    if (mounted) setState(() => _loading = false);
  }

  @override
  Widget build(BuildContext context) {
    final s = widget.state;
    return Column(
      children: [
        s._topBar(title: 'Chọn bàn cho iPad', showCall: false),
        Expanded(
          child: _loading
              ? const Center(child: CircularProgressIndicator())
              : GridView.builder(
                  padding: const EdgeInsets.all(16),
                  gridDelegate:
                      const SliverGridDelegateWithMaxCrossAxisExtent(
                    maxCrossAxisExtent: 150,
                    mainAxisExtent: 96,
                    crossAxisSpacing: 12,
                    mainAxisSpacing: 12,
                  ),
                  itemCount: _tables.length,
                  itemBuilder: (_, i) {
                    final t = _tables[i];
                    final free = _s(t['status']) == 'free';
                    return InkWell(
                      onTap: () =>
                          s._assignTable(_s(t['id']), _s(t['code'])),
                      borderRadius: BorderRadius.circular(12),
                      child: Container(
                        decoration: BoxDecoration(
                          color: DanColors.surface,
                          borderRadius: BorderRadius.circular(12),
                          border: Border.all(
                              color: free
                                  ? DanColors.border
                                  : DanColors.doing.withValues(alpha: .6)),
                        ),
                        child: Column(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            Text(_s(t['code']),
                                style: const TextStyle(
                                    fontSize: 20,
                                    fontWeight: FontWeight.w900)),
                            const SizedBox(height: 2),
                            Text(_s(t['zone']),
                                style: const TextStyle(
                                    fontSize: 11, color: DanColors.muted)),
                            const SizedBox(height: 2),
                            Text(free ? 'Trống' : 'Đang dùng',
                                style: TextStyle(
                                    fontSize: 11,
                                    fontWeight: FontWeight.w700,
                                    color: free
                                        ? const Color(0xFF047857)
                                        : const Color(0xFF9A6800))),
                          ],
                        ),
                      ),
                    );
                  },
                ),
        ),
      ],
    );
  }
}

/// Bottom-sheet chi tiết món: mô tả, nguyên liệu, dị ứng, modifiers, addons, ghi chú.
class _ItemSheet extends StatefulWidget {
  final _SelfOrderScreenState state;
  final Map<String, dynamic> item;
  const _ItemSheet({required this.state, required this.item});
  @override
  State<_ItemSheet> createState() => _ItemSheetState();
}

class _ItemSheetState extends State<_ItemSheet> {
  final _noteCtrl = TextEditingController();
  // group index -> selected option-name set
  final Map<int, Set<String>> _selMods = {};
  final Set<String> _selAddons = {};

  @override
  void dispose() {
    _noteCtrl.dispose();
    super.dispose();
  }

  List<Map<String, dynamic>> get _modGroups =>
      ((widget.item['modifiers'] as List?) ?? [])
          .whereType<Map>()
          .map((e) => Map<String, dynamic>.from(e))
          .toList();

  List<Map<String, dynamic>> get _addons =>
      ((widget.item['addons'] as List?) ?? [])
          .whereType<Map>()
          .map((e) => Map<String, dynamic>.from(e))
          .toList();

  List<Map<String, dynamic>> _gatherMods() {
    final out = <Map<String, dynamic>>[];
    for (var gi = 0; gi < _modGroups.length; gi++) {
      final g = _modGroups[gi];
      final opts = ((g['options'] as List?) ?? []).whereType<Map>();
      for (final o in opts) {
        if (_selMods[gi]?.contains(_s(o['name'])) == true) {
          out.add({
            'group': _s(g['group']),
            'name': _s(o['name']),
            'price': _num(o['price'])
          });
        }
      }
    }
    for (final a in _addons) {
      if (_selAddons.contains(_s(a['name']))) {
        final free = _s(a['type']) == 'free';
        out.add({
          'group': free ? 'Tặng kèm' : 'Thêm',
          'name': _s(a['name']),
          'price': free ? 0 : _num(a['price'])
        });
      }
    }
    return out;
  }

  num get _price {
    final base = _num(widget.item['price']);
    return base + _gatherMods().fold<num>(0, (s, m) => s + _num(m['price']));
  }

  @override
  Widget build(BuildContext context) {
    final it = widget.item;
    final s = widget.state;
    final img = s._imageUrl(it['image']);
    final canAdd = it['available'] != false;
    return DraggableScrollableSheet(
      initialChildSize: 0.85,
      minChildSize: 0.5,
      maxChildSize: 0.95,
      expand: false,
      builder: (_, scrollCtrl) => Container(
        decoration: const BoxDecoration(
          color: DanColors.surface,
          borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
        ),
        child: Column(
          children: [
            Expanded(
              child: ListView(
                controller: scrollCtrl,
                padding: EdgeInsets.zero,
                children: [
                  if (img.isNotEmpty)
                    ClipRRect(
                      borderRadius:
                          const BorderRadius.vertical(top: Radius.circular(20)),
                      child: Image.network(img,
                          height: 220,
                          width: double.infinity,
                          fit: BoxFit.cover,
                          errorBuilder: (_, __, ___) => const SizedBox()),
                    ),
                  Padding(
                    padding: const EdgeInsets.all(18),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(_s(it['name']),
                            style: const TextStyle(
                                fontSize: 22, fontWeight: FontWeight.w900)),
                        const SizedBox(height: 6),
                        Row(
                          children: [
                            Text(Fmt.money(_num(it['price'])),
                                style: const TextStyle(
                                    fontSize: 18,
                                    fontWeight: FontWeight.w900,
                                    color: DanColors.brand)),
                            const SizedBox(width: 14),
                            Text('⏱ ${_s(it['sla_minutes'])}′',
                                style: const TextStyle(
                                    color: DanColors.muted)),
                          ],
                        ),
                        const SizedBox(height: 14),
                        if (_s(it['description']).isNotEmpty) ...[
                          const _Label('Giới thiệu'),
                          Text(_s(it['description']),
                              style: const TextStyle(height: 1.4)),
                          const SizedBox(height: 14),
                        ],
                        _chips('Nguyên liệu', it['ingredients']),
                        _chips('Dị ứng / allergen', it['allergens'],
                            danger: true),
                        for (var gi = 0; gi < _modGroups.length; gi++)
                          _modGroup(gi, _modGroups[gi]),
                        _addonSection(),
                        const SizedBox(height: 8),
                        const _Label('Ghi chú món'),
                        TextField(
                          controller: _noteCtrl,
                          maxLines: 2,
                          decoration: const InputDecoration(
                            hintText: 'VD: ít cay, không hành, tách sốt…',
                          ),
                        ),
                        const SizedBox(height: 8),
                      ],
                    ),
                  ),
                ],
              ),
            ),
            SafeArea(
              top: false,
              child: Padding(
                padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
                child: Row(
                  children: [
                    Expanded(
                      child: OutlinedButton(
                        onPressed: () => Navigator.pop(context),
                        child: const Text('Hủy'),
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      flex: 2,
                      child: FilledButton(
                        onPressed: canAdd
                            ? () {
                                Navigator.pop(
                                  context,
                                  _CartLine(widget.item,
                                      qty: 1,
                                      mods: _gatherMods(),
                                      note: _noteCtrl.text.trim()),
                                );
                              }
                            : null,
                        child: Text(
                            canAdd
                                ? 'Thêm · ${Fmt.money(_price)}'
                                : 'Tạm hết',
                            style: const TextStyle(
                                fontSize: 15, fontWeight: FontWeight.w900)),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _chips(String label, dynamic list, {bool danger = false}) {
    final arr = (list as List?)?.map(_s).where((e) => e.isNotEmpty).toList() ??
        <String>[];
    if (arr.isEmpty) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(bottom: 14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _Label(label),
          Wrap(
            spacing: 6,
            runSpacing: 6,
            children: [
              for (final x in arr)
                Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                  decoration: BoxDecoration(
                    color: danger
                        ? DanColors.late.withValues(alpha: .12)
                        : DanColors.surface2,
                    borderRadius: BorderRadius.circular(99),
                  ),
                  child: Text(x,
                      style: TextStyle(
                          fontSize: 12,
                          color:
                              danger ? DanColors.late : DanColors.muted)),
                ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _modGroup(int gi, Map<String, dynamic> g) {
    final multi = _bool(g['multi']);
    final opts = ((g['options'] as List?) ?? [])
        .whereType<Map>()
        .map((e) => Map<String, dynamic>.from(e))
        .toList();
    if (opts.isEmpty) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(bottom: 14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _Label('${_s(g['group'])}${multi ? '  (chọn nhiều)' : ''}'),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              for (final o in opts)
                _optChip(
                  '${_s(o['name'])}${_num(o['price']) != 0 ? ' +${(_num(o['price']) / 1000).toStringAsFixed(0)}k' : ''}',
                  _selMods[gi]?.contains(_s(o['name'])) == true,
                  () => setState(() {
                    final set = _selMods.putIfAbsent(gi, () => <String>{});
                    final name = _s(o['name']);
                    if (multi) {
                      set.contains(name) ? set.remove(name) : set.add(name);
                    } else {
                      set
                        ..clear()
                        ..add(name);
                    }
                  }),
                ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _addonSection() {
    if (_addons.isEmpty) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(bottom: 14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const _Label('➕ Món ăn kèm / Extra  (chọn nhiều)'),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              for (final a in _addons)
                _optChip(
                  () {
                    final free = _s(a['type']) == 'free';
                    final tag = a['available'] == false
                        ? 'Tạm hết'
                        : (free
                            ? 'Tặng kèm'
                            : (_num(a['price']) != 0
                                ? '+${(_num(a['price']) / 1000).toStringAsFixed(0)}k'
                                : 'Mua thêm'));
                    return '${_s(a['emoji'])} ${_s(a['name'])} · $tag';
                  }(),
                  _selAddons.contains(_s(a['name'])),
                  a['available'] == false
                      ? null
                      : () => setState(() {
                            final name = _s(a['name']);
                            _selAddons.contains(name)
                                ? _selAddons.remove(name)
                                : _selAddons.add(name);
                          }),
                ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _optChip(String label, bool sel, VoidCallback? onTap) => InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(10),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
          decoration: BoxDecoration(
            color: sel ? DanColors.brandDim : DanColors.surface,
            borderRadius: BorderRadius.circular(10),
            border: Border.all(
                color: sel ? DanColors.brand : DanColors.border2,
                width: sel ? 1.5 : 1),
          ),
          child: Text(label.trim(),
              style: TextStyle(
                  fontSize: 12.5,
                  fontWeight: sel ? FontWeight.w800 : FontWeight.w500,
                  color: onTap == null
                      ? DanColors.muted
                      : (sel ? DanColors.brand : DanColors.text))),
        ),
      );
}

class _Label extends StatelessWidget {
  final String text;
  const _Label(this.text);
  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(bottom: 6),
        child: Text(text,
            style: const TextStyle(
                fontSize: 12.5,
                fontWeight: FontWeight.w800,
                color: DanColors.muted)),
      );
}
