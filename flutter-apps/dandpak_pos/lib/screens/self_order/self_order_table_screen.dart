import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../providers/auth_provider.dart';
import '../../services/api_service.dart';
import '../../services/local_store.dart';
import '../../ui/app_theme.dart';
import '../../widgets/dan_top_bar.dart';
import 'self_order_menu_screen.dart';
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

  Future<void> _pickTable(SoTableModel t) async {
    // Bàn ĐANG CÓ KHÁCH với đơn mở (đã chọn ngôn ngữ + nhập SĐT đầu bữa) →
    // vào THẲNG menu tiếp tục phiên cũ: giữ ngôn ngữ đã lưu theo bàn, giữ
    // khách đã check-in trên đơn — không bắt chọn/điền lại.
    Map<String, dynamic>? openOrder;
    final busy =
        t.status == 'busy' || t.status == 'serving' || t.status == 'paying';
    if (busy) {
      try {
        final res = await _api.getTable(t.id);
        if (res['order'] is Map) {
          openOrder = Map<String, dynamic>.from(res['order'] as Map);
        }
      } catch (_) {/* lỗi mạng → rơi về flow chọn ngôn ngữ thường */}
    }
    if (!mounted) return;

    if (openOrder != null && (openOrder['id'] ?? '').toString().isNotEmpty) {
      await _resumeSession(t, openOrder);
      return;
    }

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

  /// Tiếp tục phiên gọi món của bàn đang có khách: khôi phục ngôn ngữ (đã lưu
  /// theo bàn) + khách (gắn trên đơn từ lúc check-in SĐT) rồi vào thẳng menu.
  Future<void> _resumeSession(
      SoTableModel t, Map<String, dynamic> openOrder) async {
    final langCode = await LocalStore.instance.getString('so_lang_${t.id}');
    final lang = kSelfOrderLangs.firstWhere(
      (l) => l.code == langCode,
      orElse: () => kSelfOrderLangs.first,
    );

    Map<String, dynamic>? customer;
    final cjson = openOrder['customer_json'];
    if (cjson is String && cjson.isNotEmpty) {
      try {
        final decoded = jsonDecode(cjson);
        if (decoded is Map) customer = Map<String, dynamic>.from(decoded);
      } catch (_) {/* JSON hỏng → coi như chưa có khách */}
    } else if (cjson is Map) {
      customer = Map<String, dynamic>.from(cjson);
    }

    // Best-effort: lấy lại điểm + "món hay gọi" cho SĐT đã check-in.
    List<dynamic> favorites = const [];
    final phone = (customer?['phone'] ?? '').toString();
    if (phone.isNotEmpty) {
      try {
        final r = await _api.selfOrderCheckin(phone);
        if (r['customer'] is Map) {
          customer = Map<String, dynamic>.from(r['customer'] as Map);
        }
        if (r['favorites'] is List) favorites = r['favorites'] as List;
      } catch (_) {/* không chặn khách gọi món */}
    }
    if (!mounted) return;

    Navigator.of(context).push(PageRouteBuilder(
      settings: const RouteSettings(name: '/so-menu'),
      pageBuilder: (_, __, ___) => SelfOrderMenuScreen(
        serverUrl: widget.serverUrl,
        branchId: widget.branchId,
        staffToken: widget.staffToken,
        table: t,
        lang: lang,
        customer: customer,
        favorites: favorites,
        resumeOrder: openOrder,
      ),
      transitionsBuilder: (_, anim, __, child) =>
          FadeTransition(opacity: anim, child: child),
      transitionDuration: const Duration(milliseconds: 350),
    ));
  }

  @override
  Widget build(BuildContext context) {
    // Topbar CHUẨN như mọi module khác (đồng bộ giao diện).
    final auth = context.watch<AuthProvider>();
    final user = auth.currentUser;
    final branch = auth.selectedBranch;
    return Scaffold(
      backgroundColor: DanColors.bg,
      appBar: DanModuleTopBar(
        brandName: branch.name.isNotEmpty ? branch.name : branch.id,
        title: 'Khách tự gọi món',
        subtitle: 'Chọn bàn cho khách rồi đưa máy',
        titleIcon: Icons.phone_iphone_rounded,
        userName: user?.name ?? '—',
        userRole: roleLabel(user?.role ?? ''),
        online: true,
        onBack: () => Navigator.of(context).maybePop(),
        actions: [
          IconButton(
            onPressed: _load,
            icon: const Icon(Icons.refresh, color: DanColors.muted),
            tooltip: 'Tải lại',
          ),
        ],
      ),
      body: _body(),
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
