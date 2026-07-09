import 'package:flutter/material.dart';

import '../../services/api_service.dart';
import 'self_order_models.dart';
import 'self_order_phone_screen.dart';
import 'self_order_staff_exit.dart';
import 'self_order_strings.dart';

export 'self_order_strings.dart';

/// Màn CHỌN NGÔN NGỮ của khách (bàn đã được nhân viên chọn ở màn trước).
/// Việt / Anh / Trung / Nhật / Hàn → sang màn nhập số điện thoại.
class SelfOrderWelcomeScreen extends StatefulWidget {
  final String serverUrl;
  final String? branchId;
  final String? staffToken;
  final SoTableModel table;

  const SelfOrderWelcomeScreen({
    super.key,
    required this.serverUrl,
    this.branchId,
    this.staffToken,
    required this.table,
  });

  @override
  State<SelfOrderWelcomeScreen> createState() => _SelfOrderWelcomeScreenState();
}

class _SelfOrderWelcomeScreenState extends State<SelfOrderWelcomeScreen>
    with SingleTickerProviderStateMixin {
  SelfOrderLang _lang = kSelfOrderLangs.first;
  late final ApiService _api;
  late AnimationController _animCtrl;
  late Animation<double> _fadeAnim;

  @override
  void initState() {
    super.initState();
    _api = ApiService(
      baseUrl: widget.serverUrl,
      token: widget.staffToken,
      branchId: widget.branchId,
    );
    _animCtrl = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 300),
    );
    _fadeAnim = CurvedAnimation(parent: _animCtrl, curve: Curves.easeOut);
    _animCtrl.forward();
  }

  @override
  void dispose() {
    _animCtrl.dispose();
    super.dispose();
  }

  void _selectLang(SelfOrderLang lang) {
    if (_lang == lang) return;
    _animCtrl.reverse().then((_) {
      if (!mounted) return;
      setState(() => _lang = lang);
      _animCtrl.forward();
    });
  }

  void _proceed() {
    Navigator.of(context).push(PageRouteBuilder(
      settings: const RouteSettings(name: '/so-phone'),
      pageBuilder: (_, __, ___) => SelfOrderPhoneScreen(
        serverUrl: widget.serverUrl,
        branchId: widget.branchId,
        staffToken: widget.staffToken,
        table: widget.table,
        lang: _lang,
      ),
      transitionsBuilder: (_, anim, __, child) =>
          FadeTransition(opacity: anim, child: child),
      transitionDuration: const Duration(milliseconds: 350),
    ));
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
                  stops: [0, 0.55, 1],
                ),
              ),
            ),
          ),
          const Positioned(
            top: -120,
            right: -80,
            child:
                _GlowCircle(color: Color(0xFF0891B2), size: 380, opacity: 0.13),
          ),
          const Positioned(
            bottom: -100,
            left: -60,
            child:
                _GlowCircle(color: Color(0xFF8B5CF6), size: 320, opacity: 0.10),
          ),
          SafeArea(
            child: Center(
              child: SingleChildScrollView(
                padding:
                    const EdgeInsets.symmetric(horizontal: 24, vertical: 36),
                child: ConstrainedBox(
                  constraints: const BoxConstraints(maxWidth: 720),
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      // Chip bàn đang phục vụ
                      Container(
                        padding: const EdgeInsets.symmetric(
                            horizontal: 14, vertical: 6),
                        decoration: BoxDecoration(
                          color: Colors.white.withValues(alpha: 0.08),
                          borderRadius: BorderRadius.circular(20),
                          border: Border.all(
                              color: Colors.white.withValues(alpha: 0.15)),
                        ),
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            const Icon(Icons.table_bar_rounded,
                                size: 16, color: Color(0xFF0891B2)),
                            const SizedBox(width: 6),
                            Text(widget.table.name,
                                style: const TextStyle(
                                    color: Colors.white,
                                    fontWeight: FontWeight.bold)),
                          ],
                        ),
                      ),
                      const SizedBox(height: 20),
                      FadeTransition(
                        opacity: _fadeAnim,
                        child: Column(
                          children: [
                            Text(
                              _lang.greetTitle,
                              textAlign: TextAlign.center,
                              style: const TextStyle(
                                color: Colors.white,
                                fontSize: 34,
                                fontWeight: FontWeight.w900,
                              ),
                            ),
                            const SizedBox(height: 6),
                            Text(
                              _lang.greetSub,
                              textAlign: TextAlign.center,
                              style: TextStyle(
                                color: Colors.white.withValues(alpha: 0.55),
                                fontSize: 15,
                              ),
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(height: 40),
                      Wrap(
                        alignment: WrapAlignment.center,
                        spacing: 16,
                        runSpacing: 16,
                        children: kSelfOrderLangs
                            .map((l) => _LangTile(
                                  lang: l,
                                  isSelected: _lang == l,
                                  onTap: () => _selectLang(l),
                                ))
                            .toList(),
                      ),
                      const SizedBox(height: 40),
                      FadeTransition(
                        opacity: _fadeAnim,
                        child: SizedBox(
                          width: 320,
                          child: ElevatedButton(
                            onPressed: _proceed,
                            style: ElevatedButton.styleFrom(
                              backgroundColor: const Color(0xFF0891B2),
                              foregroundColor: Colors.white,
                              padding: const EdgeInsets.symmetric(vertical: 18),
                              shape: RoundedRectangleBorder(
                                borderRadius: BorderRadius.circular(16),
                              ),
                              elevation: 0,
                            ),
                            child: Text(
                              _lang.btnStart,
                              style: const TextStyle(
                                  fontSize: 17, fontWeight: FontWeight.bold),
                            ),
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
          // Logo nhân viên (3 chạm + mật khẩu → về màn chọn bàn)
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

class _LangTile extends StatelessWidget {
  final SelfOrderLang lang;
  final bool isSelected;
  final VoidCallback onTap;

  const _LangTile({
    required this.lang,
    required this.isSelected,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 200),
        curve: Curves.easeOut,
        width: 118,
        padding: const EdgeInsets.symmetric(vertical: 16, horizontal: 8),
        decoration: BoxDecoration(
          color: isSelected
              ? const Color(0xFF0891B2).withValues(alpha: 0.18)
              : Colors.white.withValues(alpha: 0.04),
          borderRadius: BorderRadius.circular(20),
          border: Border.all(
            color: isSelected
                ? const Color(0xFF0891B2)
                : Colors.white.withValues(alpha: 0.08),
            width: isSelected ? 2 : 1,
          ),
          boxShadow: isSelected
              ? [
                  BoxShadow(
                    color: const Color(0xFF0891B2).withValues(alpha: 0.20),
                    blurRadius: 12,
                    spreadRadius: 1,
                  )
                ]
              : [],
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(lang.flag, style: const TextStyle(fontSize: 40)),
            const SizedBox(height: 8),
            Text(
              lang.nativeName,
              textAlign: TextAlign.center,
              style: TextStyle(
                color: isSelected
                    ? Colors.white
                    : Colors.white.withValues(alpha: 0.55),
                fontSize: 13,
                fontWeight: isSelected ? FontWeight.bold : FontWeight.w500,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _GlowCircle extends StatelessWidget {
  final Color color;
  final double size;
  final double opacity;

  const _GlowCircle({
    required this.color,
    required this.size,
    required this.opacity,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        gradient: RadialGradient(
          colors: [
            color.withValues(alpha: opacity),
            color.withValues(alpha: 0)
          ],
        ),
      ),
    );
  }
}
