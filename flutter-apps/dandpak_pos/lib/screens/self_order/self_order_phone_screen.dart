import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../services/api_service.dart';
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
      // Chào khách 1.5s rồi vào menu.
      final name = (customer?['name'] ?? '').toString();
      final points = customer?['loyalty_points'] ?? 0;
      final hello = isNew || name.isEmpty || name == 'Khách hàng chưa đặt tên'
          ? L.memberNew
          : '${L.memberHello.replaceFirst('%s', name)}  ·  ${L.pointsLabel}: $points';
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        content: Text(hello),
        backgroundColor: const Color(0xFF0891B2),
        duration: const Duration(seconds: 2),
      ));
      _openMenu(customer: customer, favorites: favorites);
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text(e.toString().replaceFirst('Exception: ', '')),
          backgroundColor: const Color(0xFFFF7A7A)));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF0B1220),
      body: Stack(
        children: [
          Positioned.fill(
            child: Container(
              decoration: const BoxDecoration(
                gradient: LinearGradient(
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                  colors: [
                    Color(0xFF0B1220),
                    Color(0xFF0E2040),
                    Color(0xFF071830),
                  ],
                ),
              ),
            ),
          ),
          SafeArea(
            child: Center(
              child: SingleChildScrollView(
                padding:
                    const EdgeInsets.symmetric(horizontal: 24, vertical: 32),
                child: ConstrainedBox(
                  constraints: const BoxConstraints(maxWidth: 520),
                  child: Column(
                    children: [
                      Container(
                        padding: const EdgeInsets.all(14),
                        decoration: BoxDecoration(
                          color: const Color(0xFF0891B2).withValues(alpha: 0.15),
                          shape: BoxShape.circle,
                        ),
                        child: const Icon(Icons.card_giftcard_rounded,
                            color: Color(0xFF0891B2), size: 40),
                      ),
                      const SizedBox(height: 18),
                      Text(L.phoneTitle,
                          textAlign: TextAlign.center,
                          style: const TextStyle(
                              color: Colors.white,
                              fontSize: 28,
                              fontWeight: FontWeight.w900)),
                      const SizedBox(height: 8),
                      Text(L.phoneSub,
                          textAlign: TextAlign.center,
                          style: TextStyle(
                              color: Colors.white.withValues(alpha: 0.55),
                              fontSize: 14)),
                      const SizedBox(height: 28),
                      Container(
                        padding: const EdgeInsets.symmetric(
                            horizontal: 20, vertical: 8),
                        decoration: BoxDecoration(
                          color: Colors.white.withValues(alpha: 0.06),
                          borderRadius: BorderRadius.circular(18),
                          border: Border.all(
                              color: Colors.white.withValues(alpha: 0.12)),
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
                            color: Colors.white,
                            fontSize: 26,
                            fontWeight: FontWeight.bold,
                            letterSpacing: 3,
                          ),
                          cursorColor: const Color(0xFF0891B2),
                          decoration: InputDecoration(
                            hintText: L.phoneHint,
                            hintStyle: TextStyle(
                              color: Colors.white.withValues(alpha: 0.25),
                              fontSize: 17,
                              letterSpacing: 0,
                              fontWeight: FontWeight.w400,
                            ),
                            border: InputBorder.none,
                            prefixIcon: Icon(Icons.phone_outlined,
                                color: Colors.white.withValues(alpha: 0.4)),
                          ),
                          onSubmitted: (_) => _continue(),
                        ),
                      ),
                      const SizedBox(height: 26),
                      SizedBox(
                        width: double.infinity,
                        child: ElevatedButton(
                          onPressed: _busy ? null : _continue,
                          style: ElevatedButton.styleFrom(
                            backgroundColor: const Color(0xFF0891B2),
                            foregroundColor: Colors.white,
                            padding: const EdgeInsets.symmetric(vertical: 18),
                            shape: RoundedRectangleBorder(
                                borderRadius: BorderRadius.circular(16)),
                            elevation: 0,
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
                          foregroundColor:
                              Colors.white.withValues(alpha: 0.45),
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
