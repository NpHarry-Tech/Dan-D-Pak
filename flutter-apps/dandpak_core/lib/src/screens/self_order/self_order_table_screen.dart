import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../providers/auth_provider.dart';
import '../../services/api_service.dart';
import '../../services/local_store.dart';
import '../../services/socket_service.dart';
import '../../ui/app_theme.dart';
import '../../widgets/dan_top_bar.dart';
import 'self_order_menu_screen.dart';
import 'self_order_models.dart';
import 'self_order_welcome_screen.dart';
import '../../utils/translation.dart';

/// Màn CHỌN BÀN của iPad Self-Order — màn dành cho NHÂN VIÊN (cố định tiếng
/// Việt): chọn bàn cho khách rồi đưa iPad; chạm logo góc trái để về Admin.
class SelfOrderTableScreen extends StatefulWidget {
  final String serverUrl;
  final String? branchId;
  final String? staffToken;

  SelfOrderTableScreen({
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
  void Function(String, dynamic)? _socketListener;

  @override
  void initState() {
    super.initState();
    _api = ApiService(
      baseUrl: widget.serverUrl,
      token: widget.staffToken,
      branchId: widget.branchId,
    );
    // Sơ đồ bàn cập nhật LIVE: bàn được mở/giải phóng (vd. hủy hết món → về
    // 'free') phát 'table:updated' từ server → tải lại im lặng, không chờ ↻.
    _socketListener = _onSocket;
    SocketService().addListener(_socketListener!);
    _load();
  }

  @override
  void dispose() {
    if (_socketListener != null) {
      SocketService().removeListener(_socketListener!);
    }
    super.dispose();
  }

  void _onSocket(String event, dynamic payload) {
    if (!mounted) return;
    if (event == 'table:updated' ||
        event == 'order:updated' ||
        event == 'payment:done') {
      _reloadTablesSilent();
    }
  }

  /// Tải lại danh sách bàn KHÔNG bật spinner toàn màn (giữ nguyên lưới, chỉ đổi
  /// trạng thái từng bàn) — dùng cho cập nhật realtime & khi từ menu quay ra.
  Future<void> _reloadTablesSilent() async {
    try {
      final tables = await _api.fetchSoTables();
      if (!mounted) return;
      setState(() => _tables = tables);
    } catch (_) {/* lỗi mạng → giữ trạng thái cũ, sẽ tự cập nhật lần sau */}
  }

  // Bàn có cuộc gọi phục vụ đang mở → server trả status='calling' (đè lên
  // 'busy'/'serving', xem buildTableState() phía server) dù bàn vẫn có đơn
  // mở. Thiếu 'calling' ở đây khiến màn CHỌN BÀN của self-order hiện "Trống"
  // trong khi sơ đồ bàn bên POS Cashier vẫn hiện "Đang gọi" — 2 máy nhìn
  // cùng 1 trạng thái nhưng lệch nhau, đúng lỗi khách báo.
  bool _isBusy(String status) =>
      status == 'busy' ||
      status == 'serving' ||
      status == 'paying' ||
      status == 'calling';

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
    final busy = _isBusy(t.status);
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

    Navigator.of(context)
        .push(PageRouteBuilder(
      settings: RouteSettings(name: '/so-lang'),
      pageBuilder: (_, __, ___) => SelfOrderWelcomeScreen(
        serverUrl: widget.serverUrl,
        branchId: widget.branchId,
        staffToken: widget.staffToken,
        table: t,
      ),
      transitionsBuilder: (_, anim, __, child) =>
          FadeTransition(opacity: anim, child: child),
      transitionDuration: Duration(milliseconds: 350),
    ))
        .then((_) {
      if (mounted) _reloadTablesSilent();
    });
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

    // Best-effort: lấy lại điểm + t("món hay gọi") cho SĐT đã check-in.
    List<dynamic> favorites = [];
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

    Navigator.of(context)
        .push(PageRouteBuilder(
      settings: RouteSettings(name: '/so-menu'),
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
      transitionDuration: Duration(milliseconds: 350),
    ))
        .then((_) {
      if (mounted) _reloadTablesSilent();
    });
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
        title: t('Khách tự gọi món'),
        subtitle: t('Chọn bàn cho khách rồi đưa máy'),
        titleIcon: Icons.phone_iphone_rounded,
        userName: user?.name ?? '—',
        userRole: roleLabel(user?.role ?? ''),
        online: true,
        onBack: () => Navigator.of(context).maybePop(),
        actions: [
          IconButton(
            onPressed: _load,
            icon: Icon(Icons.refresh, color: DanColors.muted),
            tooltip: t('Tải lại'),
          ),
        ],
      ),
      body: _body(),
    );
  }

  Widget _body() {
    if (_loading) {
      return Center(child: CircularProgressIndicator(color: Color(0xFF0891B2)));
    }
    if (_error != null) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(t('Không tải được sơ đồ bàn\n$_error'),
                textAlign: TextAlign.center,
                style: TextStyle(color: Color(0xFFFF7A7A))),
            SizedBox(height: 12),
            OutlinedButton(onPressed: _load, child: Text(t('Thử lại'))),
          ],
        ),
      );
    }
    return ListView.builder(
      padding: EdgeInsets.all(16),
      itemCount: _zones.length,
      itemBuilder: (_, zi) {
        final zone = _zones[zi];
        final zoneTables =
            _tables.where((table) => table.zoneId == zone.id).toList();
        if (zoneTables.isEmpty) return SizedBox.shrink();
        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Padding(
              padding: EdgeInsets.symmetric(vertical: 8),
              child: Text(zone.name.toUpperCase(),
                  style: TextStyle(
                      color: Color(0xFF0891B2),
                      fontWeight: FontWeight.bold,
                      fontSize: 13,
                      letterSpacing: 1)),
            ),
            _zoneTablesLayout(zoneTables),
            SizedBox(height: 14),
          ],
        );
      },
    );
  }

  // Bàn ĐÃ XẾP VỊ TRÍ → đặt đúng ô lưới đã dựng ở Cài đặt (không kẻ lưới); bàn
  // chưa xếp → lưới đều như cũ. Khách nhìn sơ đồ giống thật để chọn đúng bàn.
  Widget _zoneTablesLayout(List<SoTableModel> zoneTables) {
    final placed = zoneTables.where((tb) => tb.posX >= 0).toList();
    final loose = zoneTables.where((tb) => tb.posX < 0).toList();

    Widget looseGrid() => GridView.builder(
          shrinkWrap: true,
          physics: NeverScrollableScrollPhysics(),
          gridDelegate: SliverGridDelegateWithMaxCrossAxisExtent(
            maxCrossAxisExtent: 150,
            crossAxisSpacing: 10,
            mainAxisSpacing: 10,
            childAspectRatio: 1.4,
          ),
          itemCount: loose.length,
          itemBuilder: (_, ti) => _soTableCard(loose[ti]),
        );

    if (placed.isEmpty) return looseGrid();
    return LayoutBuilder(builder: (context, c) {
      const cols = 12;
      const gap = 10.0;
      final cell = c.maxWidth / cols;
      final rowH = cell * 0.78;
      var maxY = 0.0;
      for (final tb in placed) {
        if (tb.posY > maxY) maxY = tb.posY;
      }
      return Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          SizedBox(
            width: double.infinity,
            height: (maxY + 1) * rowH,
            child: Stack(children: [
              for (final tb in placed)
                Positioned(
                  left: tb.posX.clamp(0, cols - 1) * cell,
                  top: tb.posY * rowH,
                  width: cell - gap,
                  height: rowH - gap,
                  child: _soTableCard(tb),
                ),
            ]),
          ),
          if (loose.isNotEmpty) ...[const SizedBox(height: 10), looseGrid()],
        ],
      );
    });
  }

  Widget _soTableCard(SoTableModel table) {
    final busy = _isBusy(table.status);
    return InkWell(
      onTap: () => _pickTable(table),
      borderRadius: BorderRadius.circular(12),
      child: Container(
        decoration: BoxDecoration(
          color:
              busy ? Color(0xFFFFC24D).withValues(alpha: 0.15) : Colors.white,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(
            color: busy ? Color(0xFFFFC24D) : Color(0xFFE7EAEE),
          ),
        ),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Text(table.name,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                    fontWeight: FontWeight.w800,
                    fontSize: 16,
                    color: Color(0xFF1A2230))),
            SizedBox(height: 2),
            Text(
                table.status == 'calling'
                    ? t('Đang gọi')
                    : (busy ? t('Đang phục vụ') : t('Trống')),
                style: TextStyle(
                    fontSize: 11,
                    color: busy ? Color(0xFFB8860B) : Color(0xFF49D17F),
                    fontWeight: FontWeight.w600)),
          ],
        ),
      ),
    );
  }
}
