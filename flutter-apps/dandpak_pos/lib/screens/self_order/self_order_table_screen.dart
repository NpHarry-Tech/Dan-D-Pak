import 'package:flutter/material.dart';

import '../../services/api_service.dart';
import 'self_order_models.dart';
import 'self_order_welcome_screen.dart';

/// Màn CHỌN BÀN của iPad Self-Order — màn dành cho NHÂN VIÊN (cố định tiếng
/// Việt): chọn bàn cho khách rồi đưa iPad; chạm logo góc trái để về Admin.
class SelfOrderTableScreen extends StatefulWidget {
  final String serverUrl;
  final String? branchId;
  final String? staffToken;

  const SelfOrderTableScreen({
    super.key,
    required this.serverUrl,
    this.branchId,
    this.staffToken,
  });

  @override
  State<SelfOrderTableScreen> createState() => _SelfOrderTableScreenState();
}

class _SelfOrderTableScreenState extends State<SelfOrderTableScreen> {
  late final ApiService _api;
  List<SoZone> _zones = [];
  List<SoTableModel> _tables = [];
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _api = ApiService(
      baseUrl: widget.serverUrl,
      token: widget.staffToken,
      branchId: widget.branchId,
    );
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final zonesFuture = _api.fetchSoZones();
      final tablesFuture = _api.fetchSoTables();
      _zones = await zonesFuture;
      _tables = await tablesFuture;
      if (!mounted) return;
      setState(() => _loading = false);
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.toString().replaceFirst('Exception: ', '');
        _loading = false;
      });
    }
  }

  void _pickTable(SoTableModel t) {
    Navigator.of(context).push(PageRouteBuilder(
      settings: const RouteSettings(name: '/so-lang'),
      pageBuilder: (_, __, ___) => SelfOrderWelcomeScreen(
        serverUrl: widget.serverUrl,
        branchId: widget.branchId,
        staffToken: widget.staffToken,
        table: t,
      ),
      transitionsBuilder: (_, anim, __, child) =>
          FadeTransition(opacity: anim, child: child),
      transitionDuration: const Duration(milliseconds: 350),
    ));
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF7F8FA),
      body: SafeArea(
        child: Column(
          children: [
            // Header nhân viên: logo (chạm 1 lần → về Admin) + tiêu đề + refresh
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
              color: Colors.white,
              child: Row(
                children: [
                  GestureDetector(
                    onTap: () => Navigator.of(context).pop(),
                    child: Container(
                      width: 40,
                      height: 40,
                      decoration: BoxDecoration(
                        color: const Color(0xFF0891B2),
                        borderRadius: BorderRadius.circular(10),
                      ),
                      child: const Center(
                        child: Text('D',
                            style: TextStyle(
                                color: Colors.white,
                                fontSize: 20,
                                fontWeight: FontWeight.w900)),
                      ),
                    ),
                  ),
                  const SizedBox(width: 12),
                  const Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('iPad Self-Order — Chọn bàn',
                            style: TextStyle(
                                fontSize: 17,
                                fontWeight: FontWeight.bold,
                                color: Color(0xFF1A2230))),
                        Text('Chọn bàn cho khách rồi đưa máy — chạm logo để về Admin',
                            style: TextStyle(
                                fontSize: 12, color: Color(0xFF9AA3B2))),
                      ],
                    ),
                  ),
                  IconButton(
                    onPressed: _load,
                    icon: const Icon(Icons.refresh, color: Color(0xFF677084)),
                    tooltip: 'Tải lại',
                  ),
                ],
              ),
            ),
            const Divider(height: 1, color: Color(0xFFE7EAEE)),
            Expanded(child: _body()),
          ],
        ),
      ),
    );
  }

  Widget _body() {
    if (_loading) {
      return const Center(
          child: CircularProgressIndicator(color: Color(0xFF0891B2)));
    }
    if (_error != null) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text('Không tải được sơ đồ bàn\n$_error',
                textAlign: TextAlign.center,
                style: const TextStyle(color: Color(0xFFFF7A7A))),
            const SizedBox(height: 12),
            OutlinedButton(onPressed: _load, child: const Text('Thử lại')),
          ],
        ),
      );
    }
    return ListView.builder(
      padding: const EdgeInsets.all(16),
      itemCount: _zones.length,
      itemBuilder: (_, zi) {
        final zone = _zones[zi];
        final zoneTables =
            _tables.where((t) => t.zoneId == zone.id).toList();
        if (zoneTables.isEmpty) return const SizedBox.shrink();
        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 8),
              child: Text(zone.name.toUpperCase(),
                  style: const TextStyle(
                      color: Color(0xFF0891B2),
                      fontWeight: FontWeight.bold,
                      fontSize: 13,
                      letterSpacing: 1)),
            ),
            GridView.builder(
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              gridDelegate: const SliverGridDelegateWithMaxCrossAxisExtent(
                maxCrossAxisExtent: 150,
                crossAxisSpacing: 10,
                mainAxisSpacing: 10,
                childAspectRatio: 1.4,
              ),
              itemCount: zoneTables.length,
              itemBuilder: (_, ti) {
                final t = zoneTables[ti];
                final busy = t.status == 'busy' ||
                    t.status == 'serving' ||
                    t.status == 'paying';
                return InkWell(
                  onTap: () => _pickTable(t),
                  borderRadius: BorderRadius.circular(12),
                  child: Container(
                    decoration: BoxDecoration(
                      color: busy
                          ? const Color(0xFFFFC24D).withValues(alpha: 0.15)
                          : Colors.white,
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(
                        color: busy
                            ? const Color(0xFFFFC24D)
                            : const Color(0xFFE7EAEE),
                      ),
                    ),
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Text(t.name,
                            style: const TextStyle(
                                fontWeight: FontWeight.w800,
                                fontSize: 16,
                                color: Color(0xFF1A2230))),
                        const SizedBox(height: 2),
                        Text(busy ? 'Đang phục vụ' : 'Trống',
                            style: TextStyle(
                                fontSize: 11,
                                color: busy
                                    ? const Color(0xFFB8860B)
                                    : const Color(0xFF49D17F),
                                fontWeight: FontWeight.w600)),
                      ],
                    ),
                  ),
                );
              },
            ),
            const SizedBox(height: 14),
          ],
        );
      },
    );
  }
}
