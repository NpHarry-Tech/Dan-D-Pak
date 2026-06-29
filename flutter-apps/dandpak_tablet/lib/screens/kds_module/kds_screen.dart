// lib/screens/kds_module/kds_screen.dart
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../../providers/app_provider.dart';
import '../../../providers/auth_provider.dart';
import '../../../services/api_service.dart';
import '../../../services/socket_service.dart';
import 'widgets/ticket_card.dart';

class KdsScreen extends StatefulWidget {
  const KdsScreen({super.key});

  @override
  State<KdsScreen> createState() => _KdsScreenState();
}

class _KdsScreenState extends State<KdsScreen> {
  List<dynamic> _items = [];
  String _activeStation = 'all';
  bool _loading = false;
  String? _error;
  SocketService? _socketService;
  bool _socketConnected = false;

  @override
  void initState() {
    super.initState();
    _loadTickets();
    _initSocket();
  }

  @override
  void dispose() {
    _socketService?.dispose();
    super.dispose();
  }

  Future<void> _loadTickets() async {
    if (mounted) setState(() => _loading = true);
    final appProv = Provider.of<AppProvider>(context, listen: false);
    final authProv = Provider.of<AuthProvider>(context, listen: false);
    final api = ApiService(baseUrl: appProv.serverUrl, token: authProv.token, branchId: appProv.activeBranch?.id);

    try {
      final data = await api.fetchKdsItems();
      if (mounted) {
        setState(() {
          _items = data;
          _error = null;
          _loading = false;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _error = e.toString().replaceFirst('Exception: ', '');
          _loading = false;
        });
      }
    }
  }

  void _initSocket() {
    final appProv = Provider.of<AppProvider>(context, listen: false);
    final authProv = Provider.of<AuthProvider>(context, listen: false);
    
    if (authProv.token == null || appProv.activeBranch == null) return;

    _socketService = SocketService(
      url: appProv.serverUrl,
      token: authProv.token!,
      branchId: appProv.activeBranch!.id,
    );

    _socketService!.connect(
      onConnectionChanged: (connected) {
        if (mounted) {
          setState(() {
            _socketConnected = connected;
          });
        }
      },
    );

    _socketService!.addListener(() {
      _loadTickets();
    });
  }

  Future<void> _changeStatus(String itemId, String status) async {
    final appProv = Provider.of<AppProvider>(context, listen: false);
    final authProv = Provider.of<AuthProvider>(context, listen: false);
    final api = ApiService(baseUrl: appProv.serverUrl, token: authProv.token, branchId: appProv.activeBranch?.id);

    // Optimistic UI updates
    setState(() {
      final index = _items.indexWhere((it) => it['id'].toString() == itemId);
      if (index != -1) {
        if (status == 'served') {
          _items.removeAt(index);
        } else {
          _items[index]['status'] = status;
        }
      }
    });

    try {
      await api.updateKdsItemStatus(itemId, status);
      _loadTickets();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Lỗi: $e')),
        );
      }
      _loadTickets(); // rollback
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

  List<dynamic> get _filteredItems {
    if (_activeStation == 'all') return _items;
    return _items.where((it) => it['station']?.toString() == _activeStation).toList();
  }

  String _stationLabel(String s) {
    return {
          'all': 'Tất cả',
          'kitchen': 'Bếp chính',
          'bar': 'Quầy Bar',
          'salad': 'Salad',
          'beverage': 'Pha chế',
        }[s] ?? s;
  }

  @override
  Widget build(BuildContext context) {
    final filtered = _filteredItems;

    return Scaffold(
      backgroundColor: const Color(0xFF11161B),
      appBar: AppBar(
        backgroundColor: const Color(0xFF161C23),
        title: Row(
          children: [
            const Text('Màn hình Bếp (KDS)', style: TextStyle(fontWeight: FontWeight.bold)),
            const SizedBox(width: 14),
            Container(
              width: 10,
              height: 10,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: _socketConnected ? const Color(0xFF49D17F) : const Color(0xFFFF7A7A),
              ),
            ),
            const SizedBox(width: 6),
            Text(
              _socketConnected ? 'Realtime' : 'Mất kết nối',
              style: const TextStyle(fontSize: 12, color: Colors.white54, fontWeight: FontWeight.w600),
            ),
          ],
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh, color: Colors.white70),
            onPressed: _loadTickets,
          ),
        ],
      ),
      body: Column(
        children: [
          // Station Selection Row
          Container(
            height: 58,
            color: const Color(0xFF161C23),
            child: ListView(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
              children: _stations.map((st) {
                final active = st == _activeStation;
                final count = st == 'all' ? _items.length : _items.where((it) => it['station']?.toString() == st).length;
                return Padding(
                  padding: const EdgeInsets.only(right: 8),
                  child: FilterChip(
                    label: Text('${_stationLabel(st)} ($count)', style: TextStyle(fontWeight: FontWeight.bold, color: active ? Colors.white : Colors.white70)),
                    selected: active,
                    selectedColor: const Color(0xFF2F7D6B),
                    checkmarkColor: Colors.white,
                    backgroundColor: const Color(0xFF1E2630),
                    onSelected: (_) => setState(() => _activeStation = st),
                  ),
                );
              }).toList(),
            ),
          ),
          if (_error != null)
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(12),
              color: const Color(0xFFFF7A7A).withOpacity(0.15),
              child: Text(
                'Lỗi: $_error',
                style: const TextStyle(color: Color(0xFFFF7A7A), fontWeight: FontWeight.bold),
                textAlign: TextAlign.center,
              ),
            ),
          Expanded(
            child: _loading && _items.isEmpty
                ? const Center(child: CircularProgressIndicator(color: Color(0xFF2F7D6B)))
                : filtered.isEmpty
                    ? const Center(
                        child: Text(
                          'Không có món nào đang chờ chế biến.',
                          style: TextStyle(color: Colors.white30, fontSize: 16, fontWeight: FontWeight.w600),
                        ),
                      )
                    : GridView.builder(
                        padding: const EdgeInsets.all(16),
                        gridDelegate: const SliverGridDelegateWithMaxCrossAxisExtent(
                          maxCrossAxisExtent: 320,
                          mainAxisExtent: 220,
                          crossAxisSpacing: 14,
                          mainAxisSpacing: 14,
                        ),
                        itemCount: filtered.length,
                        itemBuilder: (context, index) {
                          return TicketCard(
                            key: ValueKey(filtered[index]['id'].toString()),
                            item: filtered[index],
                            onStatusChanged: _changeStatus,
                          );
                        },
                      ),
          ),
        ],
      ),
    );
  }
}
