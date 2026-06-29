// Dan D Pak — KDS (Kitchen Display) prototype in Flutter.
//
// MỤC TIÊU: chứng minh Flutter render mượt trên máy POS yếu (≤4GB) trong khi
// dùng lại NGUYÊN backend hiện có — không viết lại server.
//
// Nó nói chuyện với local store server đang chạy:
//   - POST {base}/api/login            -> { token, user, perms }
//   - GET  {base}/api/kds/all          -> [ order_item ... ]   (header x-auth-token)
//   - POST {base}/api/orders/items/:id/status  { status }
//   - Socket.IO {base}  auth:{ token, device:'kds', branch } -> events realtime
//
// Đây là PROTOTYPE 1 màn hình (giai đoạn P0). Đăng nhập mỗi lần mở cho đơn giản.

import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:socket_io_client/socket_io_client.dart' as io;

void main() => runApp(const KdsApp());

class KdsApp extends StatelessWidget {
  const KdsApp({super.key});
  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Dan D Pak KDS',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        useMaterial3: true,
        brightness: Brightness.dark,
        colorSchemeSeed: const Color(0xFF2F7D6B),
        scaffoldBackgroundColor: const Color(0xFF11161B),
      ),
      home: const LoginScreen(),
    );
  }
}

/// Giữ thông tin phiên (chuyền tay giữa 2 màn hình, không cần package state).
class Session {
  final String base;
  final String token;
  final String branch;
  Session(this.base, this.token, this.branch);
}

// ---------------------------------------------------------------------------
// Đăng nhập
// ---------------------------------------------------------------------------
class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});
  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _base = TextEditingController(text: 'http://127.0.0.1:3000');
  final _user = TextEditingController();
  final _pin = TextEditingController();
  final _branch = TextEditingController(text: 'br1');
  bool _busy = false;
  String? _error;

  Future<void> _login() async {
    setState(() { _busy = true; _error = null; });
    final base = _base.text.trim().replaceAll(RegExp(r'/+$'), '');
    try {
      final res = await http
          .post(
            Uri.parse('$base/api/login'),
            headers: {'Content-Type': 'application/json'},
            body: jsonEncode({
              'username': _user.text.trim(),
              'pin': _pin.text.trim(),
              'branch_id': _branch.text.trim(),
            }),
          )
          .timeout(const Duration(seconds: 10));
      final data = jsonDecode(res.body) as Map<String, dynamic>;
      if (res.statusCode != 200 || data['token'] == null) {
        throw Exception(data['error'] ?? data['message'] ?? 'Đăng nhập thất bại (HTTP ${res.statusCode})');
      }
      if (!mounted) return;
      Navigator.of(context).pushReplacement(MaterialPageRoute(
        builder: (_) => KdsScreen(session: Session(base, data['token'] as String, _branch.text.trim())),
      ));
    } catch (e) {
      setState(() => _error = e.toString().replaceFirst('Exception: ', ''));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 420),
          child: Card(
            margin: const EdgeInsets.all(20),
            child: Padding(
              padding: const EdgeInsets.all(22),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  const Text('Dan D Pak · KDS', style: TextStyle(fontSize: 22, fontWeight: FontWeight.bold)),
                  const SizedBox(height: 4),
                  const Text('Màn hình bếp (Flutter prototype)', style: TextStyle(color: Colors.white54)),
                  const SizedBox(height: 18),
                  TextField(controller: _base, decoration: const InputDecoration(labelText: 'Địa chỉ server', hintText: 'http://192.168.1.10:3000')),
                  const SizedBox(height: 10),
                  TextField(controller: _user, decoration: const InputDecoration(labelText: 'Tài khoản')),
                  const SizedBox(height: 10),
                  TextField(controller: _pin, obscureText: true, keyboardType: TextInputType.number, decoration: const InputDecoration(labelText: 'Mã PIN')),
                  const SizedBox(height: 10),
                  TextField(controller: _branch, decoration: const InputDecoration(labelText: 'Chi nhánh (branch_id)')),
                  if (_error != null) ...[
                    const SizedBox(height: 12),
                    Text(_error!, style: const TextStyle(color: Color(0xFFFF7A7A))),
                  ],
                  const SizedBox(height: 18),
                  FilledButton(
                    onPressed: _busy ? null : _login,
                    child: _busy
                        ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2))
                        : const Text('Vào màn hình bếp'),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Màn hình KDS
// ---------------------------------------------------------------------------
class KdsScreen extends StatefulWidget {
  final Session session;
  const KdsScreen({super.key, required this.session});
  @override
  State<KdsScreen> createState() => _KdsScreenState();
}

class _KdsScreenState extends State<KdsScreen> {
  List<dynamic> _items = [];
  String _station = 'all';
  io.Socket? _socket;
  Timer? _tick; // cập nhật đồng hồ SLA mỗi giây
  bool _connected = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
    _connectSocket();
    _tick = Timer.periodic(const Duration(seconds: 1), (_) { if (mounted) setState(() {}); });
  }

  @override
  void dispose() {
    _tick?.cancel();
    _socket?.dispose();
    super.dispose();
  }

  Map<String, String> get _headers => {
        'x-auth-token': widget.session.token,
        'x-branch-id': widget.session.branch,
      };

  Future<void> _load() async {
    try {
      final res = await http
          .get(Uri.parse('${widget.session.base}/api/kds/all'), headers: _headers)
          .timeout(const Duration(seconds: 10));
      if (res.statusCode != 200) throw Exception('HTTP ${res.statusCode}');
      if (!mounted) return;
      setState(() { _items = jsonDecode(res.body) as List<dynamic>; _error = null; });
    } catch (e) {
      if (mounted) setState(() => _error = e.toString().replaceFirst('Exception: ', ''));
    }
  }

  void _connectSocket() {
    final socket = io.io(
      widget.session.base,
      io.OptionBuilder()
          .setTransports(['websocket'])
          .setAuth({'token': widget.session.token, 'device': 'kds', 'branch': widget.session.branch})
          .enableReconnection()
          .build(),
    );
    socket.onConnect((_) { if (mounted) setState(() => _connected = true); });
    socket.onDisconnect((_) { if (mounted) setState(() => _connected = false); });
    for (final ev in ['order:new', 'order:confirmed', 'kds:refresh', 'order:item']) {
      socket.on(ev, (_) => _load());
    }
    _socket = socket;
  }

  Future<void> _setStatus(String itemId, String status) async {
    // Optimistic: bỏ/đổi ngay rồi đồng bộ lại.
    try {
      await http
          .post(
            Uri.parse('${widget.session.base}/api/orders/items/$itemId/status'),
            headers: {..._headers, 'Content-Type': 'application/json'},
            body: jsonEncode({'status': status}),
          )
          .timeout(const Duration(seconds: 10));
      _load();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Lỗi: $e')));
    }
  }

  List<String> get _stations {
    final s = <String>{};
    for (final it in _items) {
      final st = (it['station'] ?? '').toString();
      if (st.isNotEmpty) s.add(st);
    }
    return ['all', ...s];
  }

  List<dynamic> get _visible =>
      _station == 'all' ? _items : _items.where((it) => it['station'] == _station).toList();

  @override
  Widget build(BuildContext context) {
    final visible = _visible;
    return Scaffold(
      appBar: AppBar(
        title: Row(children: [
          const Text('KDS · Bếp'),
          const SizedBox(width: 10),
          Icon(Icons.circle, size: 11, color: _connected ? const Color(0xFF49D17F) : const Color(0xFFFF7A7A)),
          const SizedBox(width: 4),
          Text(_connected ? 'realtime' : 'mất kết nối', style: const TextStyle(fontSize: 12, color: Colors.white60)),
        ]),
        actions: [IconButton(onPressed: _load, icon: const Icon(Icons.refresh))],
      ),
      body: Column(
        children: [
          SizedBox(
            height: 52,
            child: ListView(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.symmetric(horizontal: 10),
              children: _stations.map((st) {
                final active = st == _station;
                final count = st == 'all' ? _items.length : _items.where((it) => it['station'] == st).length;
                return Padding(
                  padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 4),
                  child: ChoiceChip(
                    label: Text('${_stationLabel(st)} ($count)'),
                    selected: active,
                    onSelected: (_) => setState(() => _station = st),
                  ),
                );
              }).toList(),
            ),
          ),
          if (_error != null)
            Padding(padding: const EdgeInsets.all(8), child: Text(_error!, style: const TextStyle(color: Color(0xFFFF7A7A)))),
          Expanded(
            child: visible.isEmpty
                ? const Center(child: Text('Không có món nào đang chờ', style: TextStyle(color: Colors.white38, fontSize: 16)))
                : GridView.builder(
                    padding: const EdgeInsets.all(12),
                    gridDelegate: const SliverGridDelegateWithMaxCrossAxisExtent(
                      maxCrossAxisExtent: 280,
                      mainAxisExtent: 184,
                      crossAxisSpacing: 12,
                      mainAxisSpacing: 12,
                    ),
                    itemCount: visible.length,
                    itemBuilder: (_, i) => _TicketCard(item: visible[i], onStatus: _setStatus),
                  ),
          ),
        ],
      ),
    );
  }
}

String _stationLabel(String s) => {
      'all': 'Tất cả',
      'kitchen': 'Bếp',
      'bar': 'Bar',
      'salad': 'Salad',
      'beverage': 'Pha chế',
    }[s] ?? s;

// ---------------------------------------------------------------------------
// Thẻ một món
// ---------------------------------------------------------------------------
class _TicketCard extends StatelessWidget {
  final Map<String, dynamic> item;
  final void Function(String itemId, String status) onStatus;
  const _TicketCard({required this.item, required this.onStatus});

  int get _elapsedSec {
    try {
      final created = DateTime.parse(item['created_at'].toString()).toLocal();
      return DateTime.now().difference(created).inSeconds;
    } catch (_) {
      return 0;
    }
  }

  Color get _slaColor {
    final m = _elapsedSec / 60;
    if (m < 5) return const Color(0xFF49D17F);
    if (m < 10) return const Color(0xFFE0A93B);
    return const Color(0xFFE5584B);
  }

  String get _elapsedText {
    final s = _elapsedSec;
    final mm = (s ~/ 60).toString().padLeft(2, '0');
    final ss = (s % 60).toString().padLeft(2, '0');
    return '$mm:$ss';
  }

  // new -> accepted -> preparing -> ready -> served
  (String, String)? get _nextAction {
    switch (item['status']) {
      case 'new':
        return ('accepted', 'Nhận');
      case 'accepted':
        return ('preparing', 'Bắt đầu làm');
      case 'preparing':
        return ('ready', 'Xong món');
      case 'ready':
        return ('served', 'Đã phục vụ');
      default:
        return null;
    }
  }

  @override
  Widget build(BuildContext context) {
    final mods = (item['mods'] is List) ? item['mods'] as List : const [];
    final status = (item['status'] ?? '').toString();
    final action = _nextAction;
    final cancelled = status == 'cancelled';
    return Container(
      decoration: BoxDecoration(
        color: const Color(0xFF1A2128),
        borderRadius: BorderRadius.circular(12),
        border: Border(left: BorderSide(color: cancelled ? Colors.grey : _slaColor, width: 5)),
      ),
      padding: const EdgeInsets.all(12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text('Bàn ${item['table_code'] ?? '—'}', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 15)),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                decoration: BoxDecoration(color: _slaColor.withOpacity(0.18), borderRadius: BorderRadius.circular(20)),
                child: Text(_elapsedText, style: TextStyle(color: _slaColor, fontWeight: FontWeight.bold, fontFeatures: const [FontFeature.tabularFigures()])),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Text('${item['qty'] ?? 1}× ${item['name'] ?? ''}',
              style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600), maxLines: 2, overflow: TextOverflow.ellipsis),
          if (mods.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: Text(mods.map((m) => (m is Map ? (m['name'] ?? '') : m).toString()).where((s) => s.isNotEmpty).join(', '),
                  style: const TextStyle(color: Colors.white60, fontSize: 12), maxLines: 2, overflow: TextOverflow.ellipsis),
            ),
          const Spacer(),
          Row(
            children: [
              _StatusPill(status: status),
              const Spacer(),
              if (cancelled)
                TextButton(onPressed: () => onStatus(item['id'].toString(), 'served'), child: const Text('Ẩn'))
              else if (action != null)
                FilledButton(
                  style: FilledButton.styleFrom(padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8)),
                  onPressed: () => onStatus(item['id'].toString(), action.$1),
                  child: Text(action.$2),
                ),
            ],
          ),
        ],
      ),
    );
  }
}

class _StatusPill extends StatelessWidget {
  final String status;
  const _StatusPill({required this.status});
  @override
  Widget build(BuildContext context) {
    final map = {
      'new': ('Mới', const Color(0xFF4C8DFF)),
      'accepted': ('Đã nhận', const Color(0xFF49D17F)),
      'preparing': ('Đang làm', const Color(0xFFE0A93B)),
      'ready': ('Sẵn sàng', const Color(0xFF2F7D6B)),
      'cancelled': ('Đã hủy', Colors.grey),
    };
    final (label, color) = map[status] ?? (status, Colors.white54);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(color: color.withOpacity(0.18), borderRadius: BorderRadius.circular(6)),
      child: Text(label, style: TextStyle(color: color, fontSize: 12, fontWeight: FontWeight.w600)),
    );
  }
}
