import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../services/api_service.dart';
import '../../ui/app_theme.dart';
import 'self_order_menu_screen.dart';
import 'self_order_models.dart';
import 'self_order_staff_exit.dart';
import 'self_order_strings.dart';

/// Màn NHẬP SỐ ĐIỆN THOẠI của khách (sau khi chọn ngôn ngữ).
/// - SĐT lạ → server tự tạo khách mới ("Khách hàng chưa đặt tên") và tích điểm
///   được ngay từ bữa này.
/// - Khách quen → chào bằng tên + hiện điểm; từ lần ăn thứ 3 màn menu sẽ có
///   mục "Món bạn hay gọi".
class SelfOrderPhoneScreen extends StatefulWidget {
  final String serverUrl;
  final String? branchId;
  final String? staffToken;
  final SoTableModel table;
  final SelfOrderLang lang;

  const SelfOrderPhoneScreen({
    super.key,
    required this.serverUrl,
    this.branchId,
    this.staffToken,
    required this.table,
    required this.lang,
  });

  @override
  State<SelfOrderPhoneScreen> createState() => _SelfOrderPhoneScreenState();
}

class _SelfOrderPhoneScreenState extends State<SelfOrderPhoneScreen> {
  late final ApiService _api;
  final _phoneCtrl = TextEditingController();
  bool _busy = false;

  SelfOrderLang get L => widget.lang;

  @override
  void initState() {
    super.initState();
    _api = ApiService(
      baseUrl: widget.serverUrl,
      token: widget.staffToken,
      branchId: widget.branchId,
    );
  }

  @override
  void dispose() {
    _phoneCtrl.dispose();
    super.dispose();
  }

  void _openMenu({Map<String, dynamic>? customer, List<dynamic>? favorites}) {
    Navigator.of(context).push(PageRouteBuilder(
      settings: const RouteSettings(name: '/so-menu'),
      pageBuilder: (_, __, ___) => SelfOrderMenuScreen(
        serverUrl: widget.serverUrl,
        branchId: widget.branchId,
        staffToken: widget.staffToken,
        table: widget.table,
        lang: L,
        customer: customer,
        favorites: favorites ?? const [],
      ),
      transitionsBuilder: (_, anim, __, child) =>
          FadeTransition(opacity: anim, child: child),
      transitionDuration: const Duration(milliseconds: 350),
    ));
  }

  Future<void> _continue() async {
    final phone = _phoneCtrl.text.trim();
    if (phone.length < 8) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text(L.phoneInvalid),
          backgroundColor: const Color(0xFFFF7A7A)));
      return;
    }
    setState(() => _busy = true);
    try {
      final r = await _api.selfOrderCheckin(phone);
      if (!mounted) return;
      final customer = r['customer'] is Map
          ? Map<String, dynamic>.from(r['customer'] as Map)
          : null;
      final favorites = r['favorites'] is List ? r['favorites'] as List : [];
      final isNew = r['is_new'] == true;
      final name = (customer?['name'] ?? '').toString();
      final points = customer?['loyalty_points'] ?? 0;
      final hello = isNew || name.isEmpty || name == 'Khách hàng chưa đặt tên'
          ? L.memberNew
          : '${L.memberHello.replaceFirst('%s', name)}  ·  ${L.pointsLabel}: $points';
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        content: Text(hello),
        backgroundColor: DanColors.brand,
        duration: const Duration(seconds: 2),
      ));
      _openMenu(customer: customer, favorites: favorites);
    } catch (e) {
      // Kiosk KHÔNG được kẹt: nếu tích điểm lỗi (server chưa có route, mạng
      // chớp…) vẫn cho khách vào gọi món bình thường, chỉ là chưa gắn thẻ.
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
        content: Text('Chưa kết nối được tích điểm — bạn vẫn có thể gọi món bình thường.'),
        backgroundColor: DanColors.late,
        duration: Duration(seconds: 2),
      ));
      _openMenu();
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: DanColors.bg,
      body: Stack(
        children: [
          SafeArea(
            child: Center(
              child: SingleChildScrollView(
                padding:
                    const EdgeInsets.symmetric(horizontal: 24, vertical: 32),
                child: ConstrainedBox(
                  constraints: const BoxConstraints(maxWidth: 520),
                  child: Column(
                    children: [
                      // Chip bàn đang phục vụ
                      Container(
                        padding: const EdgeInsets.symmetric(
                            horizontal: 14, vertical: 7),
                        decoration: BoxDecoration(
                          color: DanColors.brand.withValues(alpha: 0.10),
                          borderRadius: BorderRadius.circular(20),
                          border: Border.all(
                              color: DanColors.brand.withValues(alpha: 0.35)),
                        ),
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            const Icon(Icons.table_bar_rounded,
                                size: 16, color: DanColors.brand),
                            const SizedBox(width: 6),
                            Text(widget.table.name,
                                style: const TextStyle(
                                    color: DanColors.brand,
                                    fontWeight: FontWeight.bold)),
                          ],
                        ),
                      ),
                      const SizedBox(height: 24),
                      Container(
                        padding: const EdgeInsets.all(14),
                        decoration: BoxDecoration(
                          color: DanColors.brand.withValues(alpha: 0.10),
                          shape: BoxShape.circle,
                        ),
                        child: const Icon(Icons.card_giftcard_rounded,
                            color: DanColors.brand, size: 40),
                      ),
                      const SizedBox(height: 18),
                      Text(L.phoneTitle,
                          textAlign: TextAlign.center,
                          style: const TextStyle(
                              color: DanColors.text,
                              fontSize: 28,
                              fontWeight: FontWeight.w900)),
                      const SizedBox(height: 8),
                      Text(L.phoneSub,
                          textAlign: TextAlign.center,
                          style: const TextStyle(
                              color: DanColors.muted, fontSize: 14)),
                      const SizedBox(height: 28),
                      Container(
                        padding: const EdgeInsets.symmetric(
                            horizontal: 20, vertical: 4),
                        decoration: BoxDecoration(
                          color: Colors.white,
                          borderRadius: BorderRadius.circular(18),
                          border: Border.all(color: DanColors.border),
                        ),
                        child: TextField(
                          controller: _phoneCtrl,
                          autofocus: true,
                          keyboardType: TextInputType.phone,
                          inputFormatters: [
                            FilteringTextInputFormatter.digitsOnly,
                            LengthLimitingTextInputFormatter(12),
                          ],
                          style: const TextStyle(
                            color: DanColors.text,
                            fontSize: 26,
                            fontWeight: FontWeight.bold,
                            letterSpacing: 3,
                          ),
                          cursorColor: DanColors.brand,
                          decoration: InputDecoration(
                            hintText: L.phoneHint,
                            hintStyle: const TextStyle(
                              color: DanColors.faint,
                              fontSize: 17,
                              letterSpacing: 0,
                              fontWeight: FontWeight.w400,
                            ),
                            border: InputBorder.none,
                            prefixIcon: const Icon(Icons.phone_outlined,
                                color: DanColors.muted),
                          ),
                          onSubmitted: (_) => _continue(),
                        ),
                      ),
                      const SizedBox(height: 26),
                      SizedBox(
                        width: double.infinity,
                        child: FilledButton(
                          onPressed: _busy ? null : _continue,
                          style: FilledButton.styleFrom(
                            backgroundColor: DanColors.brand,
                            foregroundColor: Colors.white,
                            padding: const EdgeInsets.symmetric(vertical: 18),
                            shape: RoundedRectangleBorder(
                                borderRadius: BorderRadius.circular(16)),
                          ),
                          child: _busy
                              ? const SizedBox(
                                  width: 22,
                                  height: 22,
                                  child: CircularProgressIndicator(
                                      strokeWidth: 2, color: Colors.white))
                              : Text(L.btnContinue,
                                  style: const TextStyle(
                                      fontSize: 16,
                                      fontWeight: FontWeight.bold)),
                        ),
                      ),
                      const SizedBox(height: 8),
                      TextButton(
                        onPressed: _busy ? null : () => _openMenu(),
                        style: TextButton.styleFrom(
                          foregroundColor: DanColors.muted,
                          padding: const EdgeInsets.symmetric(vertical: 10),
                        ),
                        child: Text(L.btnSkip,
                            style: const TextStyle(
                                fontSize: 14, fontWeight: FontWeight.w500)),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
          Positioned(
            top: 12,
            left: 12,
            child: SafeArea(child: SelfOrderStaffLogo(api: _api)),
          ),
        ],
      ),
    );
  }
}
