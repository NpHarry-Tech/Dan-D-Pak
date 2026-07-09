import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'self_order_menu_screen.dart';

// ─── Model ngôn ngữ ──────────────────────────────────────────────────────────

class SelfOrderLang {
  final String code;
  final String flag;
  final String nativeName;

  // Chuỗi giao diện
  final String greetTitle;
  final String greetSub;
  final String phoneLabel;
  final String phoneHint;
  final String btnSkip;
  final String btnStart;
  // Menu screen strings
  final String menuTitle;
  final String allCategory;
  final String cartEmpty;
  final String cartTitle;
  final String totalLabel;
  final String sendKitchenBtn;
  final String clearCartBtn;
  final String callStaffBtn;
  final String selectTablePrompt;
  final String thankYou;

  const SelfOrderLang({
    required this.code,
    required this.flag,
    required this.nativeName,
    required this.greetTitle,
    required this.greetSub,
    required this.phoneLabel,
    required this.phoneHint,
    required this.btnSkip,
    required this.btnStart,
    required this.menuTitle,
    required this.allCategory,
    required this.cartEmpty,
    required this.cartTitle,
    required this.totalLabel,
    required this.sendKitchenBtn,
    required this.clearCartBtn,
    required this.callStaffBtn,
    required this.selectTablePrompt,
    required this.thankYou,
  });
}

const List<SelfOrderLang> kSelfOrderLangs = [
  SelfOrderLang(
    code: 'vi',
    flag: '🇻🇳',
    nativeName: 'Tiếng Việt',
    greetTitle: 'Chào mừng quý khách!',
    greetSub: 'Chọn ngôn ngữ bên dưới để bắt đầu',
    phoneLabel: 'Nhập số điện thoại tích điểm thành viên (không bắt buộc)',
    phoneHint: 'Ví dụ: 0901234567',
    btnSkip: 'Bỏ qua & Gọi món',
    btnStart: 'Bắt đầu gọi món →',
    menuTitle: 'Thực đơn',
    allCategory: 'Tất cả',
    cartEmpty: 'Chưa chọn món ăn nào',
    cartTitle: 'Giỏ hàng',
    totalLabel: 'Tổng',
    sendKitchenBtn: 'GỬI BẾP',
    clearCartBtn: 'Xóa hết',
    callStaffBtn: 'Gọi nhân viên',
    selectTablePrompt: 'Vui lòng chọn bàn trước khi gọi món',
    thankYou: 'Cảm ơn bạn!\nĐơn của bạn đã được gửi.',
  ),
  SelfOrderLang(
    code: 'en',
    flag: '🇬🇧',
    nativeName: 'English',
    greetTitle: 'Welcome!',
    greetSub: 'Choose your language below to start',
    phoneLabel: 'Enter phone number for rewards points (optional)',
    phoneHint: 'e.g. 0901234567',
    btnSkip: 'Skip & Order',
    btnStart: 'Start ordering →',
    menuTitle: 'Menu',
    allCategory: 'All',
    cartEmpty: 'Your cart is empty',
    cartTitle: 'Cart',
    totalLabel: 'Total',
    sendKitchenBtn: 'SEND TO KITCHEN',
    clearCartBtn: 'Clear',
    callStaffBtn: 'Call Staff',
    selectTablePrompt: 'Please select a table before ordering',
    thankYou: 'Thank you!\nYour order has been sent.',
  ),
  SelfOrderLang(
    code: 'zh',
    flag: '🇨🇳',
    nativeName: '中文',
    greetTitle: '欢迎光临！',
    greetSub: '请选择下面的语言开始',
    phoneLabel: '输入手机号码以累积积分（可选）',
    phoneHint: '例如：0901234567',
    btnSkip: '跳过并点餐',
    btnStart: '开始点餐 →',
    menuTitle: '菜单',
    allCategory: '全部',
    cartEmpty: '购物车是空的',
    cartTitle: '购物车',
    totalLabel: '合计',
    sendKitchenBtn: '发送到厨房',
    clearCartBtn: '清空',
    callStaffBtn: '呼叫服务员',
    selectTablePrompt: '请先选择桌位',
    thankYou: '感谢您！\n您的订单已发送。',
  ),
  SelfOrderLang(
    code: 'ja',
    flag: '🇯🇵',
    nativeName: '日本語',
    greetTitle: 'いらっしゃいませ！',
    greetSub: '開始するには、以下の言語を選択してください',
    phoneLabel: 'ポイントを獲得するには電話番号を入力してください（任意）',
    phoneHint: '例：0901234567',
    btnSkip: 'スキップして注文',
    btnStart: '注文を始める →',
    menuTitle: 'メニュー',
    allCategory: 'すべて',
    cartEmpty: 'カートは空です',
    cartTitle: 'カート',
    totalLabel: '合計',
    sendKitchenBtn: 'キッチンへ送る',
    clearCartBtn: 'クリア',
    callStaffBtn: 'スタッフを呼ぶ',
    selectTablePrompt: '注文前にテーブルを選択してください',
    thankYou: 'ありがとうございます！\nご注文が送信されました。',
  ),
  SelfOrderLang(
    code: 'ko',
    flag: '🇰🇷',
    nativeName: '한국어',
    greetTitle: '어서오세요!',
    greetSub: '시작하려면 아래에서 언어를 선택하세요',
    phoneLabel: '포인트 적립을 위해 전화번호를 입력하세요 (선택)',
    phoneHint: '예: 0901234567',
    btnSkip: '건너뛰고 주문',
    btnStart: '주문 시작 →',
    menuTitle: '메뉴',
    allCategory: '전체',
    cartEmpty: '장바구니가 비어 있습니다',
    cartTitle: '장바구니',
    totalLabel: '합계',
    sendKitchenBtn: '주방으로 보내기',
    clearCartBtn: '비우기',
    callStaffBtn: '직원 호출',
    selectTablePrompt: '주문 전에 테이블을 선택하세요',
    thankYou: '감사합니다!\n주문이 전송되었습니다.',
  ),
];

// ─── Welcome Screen ───────────────────────────────────────────────────────────

class SelfOrderWelcomeScreen extends StatefulWidget {
  final String serverUrl;
  final String? branchId;
  final String? staffToken;

  const SelfOrderWelcomeScreen({
    super.key,
    required this.serverUrl,
    this.branchId,
    this.staffToken,
  });

  @override
  State<SelfOrderWelcomeScreen> createState() => _SelfOrderWelcomeScreenState();
}

class _SelfOrderWelcomeScreenState extends State<SelfOrderWelcomeScreen>
    with SingleTickerProviderStateMixin {
  SelfOrderLang _lang = kSelfOrderLangs.first;
  final _phoneCtrl = TextEditingController();
  late AnimationController _animCtrl;
  late Animation<double> _fadeAnim;
  Timer? _idleTimer;
  static const _idleDuration = Duration(seconds: 120);

  @override
  void initState() {
    super.initState();
    _animCtrl = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 300),
    );
    _fadeAnim = CurvedAnimation(parent: _animCtrl, curve: Curves.easeOut);
    _animCtrl.forward();
    _resetIdle();
  }

  @override
  void dispose() {
    _idleTimer?.cancel();
    _animCtrl.dispose();
    _phoneCtrl.dispose();
    super.dispose();
  }

  void _resetIdle() {
    _idleTimer?.cancel();
    _idleTimer = Timer(_idleDuration, () {
      if (!mounted) return;
      setState(() {
        _lang = kSelfOrderLangs.first;
        _phoneCtrl.clear();
      });
      _animCtrl.forward(from: 0);
    });
  }

  void _selectLang(SelfOrderLang lang) {
    _resetIdle();
    if (_lang == lang) return;
    _animCtrl.reverse().then((_) {
      if (!mounted) return;
      setState(() => _lang = lang);
      _animCtrl.forward();
    });
  }

  void _proceed({bool skip = false}) {
    _idleTimer?.cancel();
    final phone = skip ? '' : _phoneCtrl.text.trim();
    Navigator.of(context).pushReplacement(
      PageRouteBuilder(
        pageBuilder: (_, __, ___) => SelfOrderMenuScreen(
          serverUrl: widget.serverUrl,
          branchId: widget.branchId,
          staffToken: widget.staffToken,
          lang: _lang,
          customerPhone: phone,
        ),
        transitionsBuilder: (_, anim, __, child) =>
            FadeTransition(opacity: anim, child: child),
        transitionDuration: const Duration(milliseconds: 400),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: _resetIdle,
      onPanDown: (_) => _resetIdle(),
      child: Scaffold(
        backgroundColor: const Color(0xFF0B1220),
        body: Stack(
          children: [
            // ── Background Gradients ──
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
            // Decorative Glowing Circles
            const Positioned(
              top: -120,
              right: -80,
              child: _GlowCircle(
                  color: Color(0xFF0891B2), size: 380, opacity: 0.13),
            ),
            const Positioned(
              bottom: -100,
              left: -60,
              child: _GlowCircle(
                  color: Color(0xFF8B5CF6), size: 320, opacity: 0.10),
            ),

            // ── Main Content Layout ──
            SafeArea(
              child: Center(
                child: SingleChildScrollView(
                  padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 36),
                  child: ConstrainedBox(
                    constraints: const BoxConstraints(maxWidth: 720),
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        // Brand Logo
                        const _BrandLogo(),
                        const SizedBox(height: 24),

                        // Greeting Section
                        FadeTransition(
                          opacity: _fadeAnim,
                          child: Column(
                            children: [
                              Text(
                                _lang.greetTitle,
                                textAlign: TextAlign.center,
                                style: const TextStyle(
                                  color: Colors.white,
                                  fontSize: 32,
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
                        const SizedBox(height: 36),

                        // Language Selection Grid (Large & Centered)
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
                        const SizedBox(height: 36),

                        // Phone Input Section (Positioned underneath, dynamic language changes)
                        FadeTransition(
                          opacity: _fadeAnim,
                          child: Container(
                            padding: const EdgeInsets.all(24),
                            decoration: BoxDecoration(
                              color: Colors.white.withValues(alpha: 0.06),
                              borderRadius: BorderRadius.circular(24),
                              border: Border.all(color: Colors.white.withValues(alpha: 0.12)),
                            ),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Row(
                                  children: [
                                    Container(
                                      padding: const EdgeInsets.all(8),
                                      decoration: BoxDecoration(
                                        color: const Color(0xFF0891B2).withValues(alpha: 0.2),
                                        borderRadius: BorderRadius.circular(10),
                                      ),
                                      child: const Icon(
                                        Icons.card_giftcard_rounded,
                                        color: Color(0xFF0891B2),
                                        size: 20,
                                      ),
                                    ),
                                    const SizedBox(width: 12),
                                    Expanded(
                                      child: Text(
                                        _lang.phoneLabel,
                                        style: TextStyle(
                                          color: Colors.white.withValues(alpha: 0.80),
                                          fontSize: 14,
                                          fontWeight: FontWeight.w500,
                                        ),
                                      ),
                                    ),
                                  ],
                                ),
                                const SizedBox(height: 16),
                                TextField(
                                  controller: _phoneCtrl,
                                  keyboardType: TextInputType.phone,
                                  inputFormatters: [
                                    FilteringTextInputFormatter.digitsOnly,
                                    LengthLimitingTextInputFormatter(12),
                                  ],
                                  style: const TextStyle(
                                    color: Colors.white,
                                    fontSize: 22,
                                    fontWeight: FontWeight.bold,
                                    letterSpacing: 2.5,
                                  ),
                                  cursorColor: const Color(0xFF0891B2),
                                  decoration: InputDecoration(
                                    hintText: _lang.phoneHint,
                                    hintStyle: TextStyle(
                                      color: Colors.white.withValues(alpha: 0.25),
                                      fontSize: 16,
                                      fontWeight: FontWeight.w400,
                                      letterSpacing: 0,
                                    ),
                                    prefixIcon: Padding(
                                      padding: const EdgeInsets.only(right: 8, bottom: 4),
                                      child: Icon(
                                        Icons.phone_outlined,
                                        color: Colors.white.withValues(alpha: 0.4),
                                        size: 20,
                                      ),
                                    ),
                                    prefixIconConstraints: const BoxConstraints(minWidth: 32),
                                    enabledBorder: UnderlineInputBorder(
                                      borderSide: BorderSide(
                                        color: Colors.white.withValues(alpha: 0.15),
                                        width: 1.5,
                                      ),
                                    ),
                                    focusedBorder: const UnderlineInputBorder(
                                      borderSide: BorderSide(
                                        color: Color(0xFF0891B2),
                                        width: 2,
                                      ),
                                    ),
                                  ),
                                  onChanged: (_) => _resetIdle(),
                                ),
                              ],
                            ),
                          ),
                        ),
                        const SizedBox(height: 28),

                        // Action Buttons (Start Ordering & Skip)
                        FadeTransition(
                          opacity: _fadeAnim,
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.stretch,
                            children: [
                              ElevatedButton(
                                onPressed: () => _proceed(skip: false),
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
                                    fontSize: 16,
                                    fontWeight: FontWeight.bold,
                                  ),
                                ),
                              ),
                              const SizedBox(height: 8),
                              TextButton(
                                onPressed: () => _proceed(skip: true),
                                style: TextButton.styleFrom(
                                  foregroundColor: Colors.white.withValues(alpha: 0.45),
                                  padding: const EdgeInsets.symmetric(vertical: 10),
                                ),
                                child: Text(
                                  _lang.btnSkip,
                                  style: const TextStyle(
                                    fontSize: 14,
                                    fontWeight: FontWeight.w500,
                                  ),
                                ),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ),

            // ── Hidden Admin Exit Area (Tap 5 times / 3s on top-left) ──
            Positioned(
              top: 0,
              left: 0,
              width: 80,
              height: 80,
              child: _HiddenExit(onExit: () => Navigator.of(context).pop()),
            ),
          ],
        ),
      ),
    );
  }
}

// ─── Sub-widgets ──────────────────────────────────────────────────────────────

class _BrandLogo extends StatelessWidget {
  const _BrandLogo();

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Container(
          width: 64,
          height: 64,
          decoration: BoxDecoration(
            gradient: const LinearGradient(
              colors: [Color(0xFF0891B2), Color(0xFF0E6EAA)],
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
            ),
            borderRadius: BorderRadius.circular(18),
            boxShadow: [
              BoxShadow(
                color: const Color(0xFF0891B2).withValues(alpha: 0.35),
                blurRadius: 18,
                offset: const Offset(0, 6),
              )
            ],
          ),
          child: const Center(
            child: Text(
              'D',
              style: TextStyle(
                color: Colors.white,
                fontSize: 36,
                fontWeight: FontWeight.w900,
              ),
            ),
          ),
        ),
        const SizedBox(height: 8),
        const Text(
          'DAN D PAK',
          style: TextStyle(
            color: Colors.white,
            fontSize: 11,
            fontWeight: FontWeight.w800,
            letterSpacing: 3.0,
          ),
        ),
      ],
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
        width: 110,
        padding: const EdgeInsets.symmetric(vertical: 14, horizontal: 8),
        decoration: BoxDecoration(
          color: isSelected
              ? const Color(0xFF0891B2).withValues(alpha: 0.18)
              : Colors.white.withValues(alpha: 0.04),
          borderRadius: BorderRadius.circular(20),
          border: Border.all(
            color: isSelected ? const Color(0xFF0891B2) : Colors.white.withValues(alpha: 0.08),
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
            Text(lang.flag, style: const TextStyle(fontSize: 38)),
            const SizedBox(height: 8),
            Text(
              lang.nativeName,
              textAlign: TextAlign.center,
              style: TextStyle(
                color: isSelected ? Colors.white : Colors.white.withValues(alpha: 0.55),
                fontSize: 13,
                fontWeight: isSelected ? FontWeight.bold : FontWeight.w500,
              ),
            ),
            if (isSelected) ...[
              const SizedBox(height: 4),
              Container(
                width: 16,
                height: 2.5,
                decoration: BoxDecoration(
                  color: const Color(0xFF0891B2),
                  borderRadius: BorderRadius.circular(1.5),
                ),
              ),
            ],
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
          colors: [color.withValues(alpha: opacity), color.withValues(alpha: 0)],
        ),
      ),
    );
  }
}

class _HiddenExit extends StatefulWidget {
  final VoidCallback onExit;

  const _HiddenExit({required this.onExit});

  @override
  State<_HiddenExit> createState() => _HiddenExitState();
}

class _HiddenExitState extends State<_HiddenExit> {
  int _taps = 0;
  Timer? _w;

  void _tap() {
    _taps++;
    _w ??= Timer(const Duration(seconds: 3), () {
      _taps = 0;
      _w = null;
    });
    if (_taps >= 5) {
      _w?.cancel();
      _w = null;
      _taps = 0;
      widget.onExit();
    }
  }

  @override
  void dispose() {
    _w?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      behavior: HitTestBehavior.translucent,
      onTap: _tap,
      child: const SizedBox.expand(),
    );
  }
}
