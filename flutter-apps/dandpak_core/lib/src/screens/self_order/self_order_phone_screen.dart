import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../services/api_service.dart';
import '../../ui/app_theme.dart';
import 'self_order_menu_screen.dart';
import 'self_order_models.dart';
import 'self_order_staff_exit.dart';
import 'self_order_strings.dart';
import '../../utils/translation.dart';

/// Màn NHẬP SỐ ĐIỆN THOẠI của khách (sau khi chọn ngôn ngữ).
/// - SĐT lạ → server tự tạo khách mới (t("Khách hàng chưa đặt tên")) và tích điểm
///   được ngay từ bữa này.
/// - Khách quen → chào bằng tên + hiện điểm; từ lần ăn thứ 3 màn menu sẽ có
///   mục t("Món bạn hay gọi").
class SelfOrderPhoneScreen extends StatefulWidget {
  final String serverUrl;
  final String? branchId;
  final String? staffToken;
  final SoTableModel table;
  final SelfOrderLang lang;

  SelfOrderPhoneScreen({
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
      settings: RouteSettings(name: '/so-menu'),
      pageBuilder: (_, __, ___) => SelfOrderMenuScreen(
        serverUrl: widget.serverUrl,
        branchId: widget.branchId,
        staffToken: widget.staffToken,
        table: widget.table,
        lang: L,
        customer: customer,
        favorites: favorites ?? [],
      ),
      transitionsBuilder: (_, anim, __, child) =>
          FadeTransition(opacity: anim, child: child),
      transitionDuration: Duration(milliseconds: 350),
    ));
  }

  Future<void> _continue() async {
    final phone = _phoneCtrl.text.trim();
    if (phone.length < 8) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text(L.phoneInvalid), backgroundColor: Color(0xFFFF7A7A)));
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
      // Tên placeholder (khách tự lưu từ SĐT, chưa có tên thật) → chào như
      // khách mới thay vì đọc nguyên câu placeholder.
      final placeholders = {
        t('Khách hàng chưa đăng ký thành viên'),
        t('Khách hàng chưa đặt tên'),
      };
      final hello = isNew || name.isEmpty || placeholders.contains(name)
          ? L.memberNew
          : '${L.memberHello.replaceFirst('%s', name)}  ·  ${L.pointsLabel}: $points';
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        content: Text(hello),
        backgroundColor: DanColors.brand,
        duration: Duration(seconds: 2),
      ));
      _openMenu(customer: customer, favorites: favorites);
    } catch (e) {
      // Kiosk KHÔNG được kẹt: nếu tích điểm lỗi (server chưa có route, mạng
      // chớp…) vẫn cho khách vào gọi món bình thường, chỉ là chưa gắn thẻ.
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        content: Text(t(
            'Chưa kết nối được tích điểm — bạn vẫn có thể gọi món bình thường.')),
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
                padding: EdgeInsets.symmetric(horizontal: 24, vertical: 32),
                child: ConstrainedBox(
                  constraints: BoxConstraints(maxWidth: 520),
                  child: Column(
                    children: [
                      // Chip bàn đang phục vụ
                      Container(
                        padding:
                            EdgeInsets.symmetric(horizontal: 14, vertical: 7),
                        decoration: BoxDecoration(
                          color: DanColors.brand.withValues(alpha: 0.10),
                          borderRadius: BorderRadius.circular(20),
                          border: Border.all(
                              color: DanColors.brand.withValues(alpha: 0.35)),
                        ),
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Icon(Icons.table_bar_rounded,
                                size: 16, color: DanColors.brand),
                            SizedBox(width: 6),
                            Text(widget.table.name,
                                style: TextStyle(
                                    color: DanColors.brand,
                                    fontWeight: FontWeight.bold)),
                          ],
                        ),
                      ),
                      SizedBox(height: 24),
                      Container(
                        padding: EdgeInsets.all(14),
                        decoration: BoxDecoration(
                          color: DanColors.brand.withValues(alpha: 0.10),
                          shape: BoxShape.circle,
                        ),
                        child: Icon(Icons.card_giftcard_rounded,
                            color: DanColors.brand, size: 40),
                      ),
                      SizedBox(height: 18),
                      Text(L.phoneTitle,
                          textAlign: TextAlign.center,
                          style: TextStyle(
                              color: DanColors.text,
                              fontSize: 28,
                              fontWeight: FontWeight.w900)),
                      SizedBox(height: 8),
                      Text(L.phoneSub,
                          textAlign: TextAlign.center,
                          style:
                              TextStyle(color: DanColors.muted, fontSize: 14)),
                      SizedBox(height: 28),
                      Container(
                        padding:
                            EdgeInsets.symmetric(horizontal: 20, vertical: 4),
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
                          style: TextStyle(
                            color: DanColors.text,
                            fontSize: 26,
                            fontWeight: FontWeight.bold,
                            letterSpacing: 3,
                          ),
                          cursorColor: DanColors.brand,
                          decoration: InputDecoration(
                            hintText: L.phoneHint,
                            hintStyle: TextStyle(
                              color: DanColors.faint,
                              fontSize: 17,
                              letterSpacing: 0,
                              fontWeight: FontWeight.w400,
                            ),
                            border: InputBorder.none,
                            prefixIcon: Icon(Icons.phone_outlined,
                                color: DanColors.muted),
                          ),
                          onSubmitted: (_) => _continue(),
                        ),
                      ),
                      SizedBox(height: 26),
                      SizedBox(
                        width: double.infinity,
                        child: FilledButton(
                          onPressed: _busy ? null : _continue,
                          style: FilledButton.styleFrom(
                            backgroundColor: DanColors.brand,
                            foregroundColor: Colors.white,
                            padding: EdgeInsets.symmetric(vertical: 18),
                            shape: RoundedRectangleBorder(
                                borderRadius: BorderRadius.circular(16)),
                          ),
                          child: _busy
                              ? SizedBox(
                                  width: 22,
                                  height: 22,
                                  child: CircularProgressIndicator(
                                      strokeWidth: 2, color: Colors.white))
                              : Text(L.btnContinue,
                                  style: TextStyle(
                                      fontSize: 16,
                                      fontWeight: FontWeight.bold)),
                        ),
                      ),
                      SizedBox(height: 8),
                      TextButton(
                        onPressed: _busy ? null : () => _openMenu(),
                        style: TextButton.styleFrom(
                          foregroundColor: DanColors.muted,
                          padding: EdgeInsets.symmetric(vertical: 10),
                        ),
                        child: Text(L.btnSkip,
                            style: TextStyle(
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
