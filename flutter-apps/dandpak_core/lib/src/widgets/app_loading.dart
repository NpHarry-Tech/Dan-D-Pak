import 'dart:async';

import 'package:flutter/material.dart';

import '../ui/app_theme.dart';

/// Spinner NHỎ — dùng cho vùng nhỏ (nút, side tab, ô đang tải…). Vòng tròn xoay
/// màu thương hiệu. Không chiếm chỗ, không có chữ.
class AppSpinner extends StatelessWidget {
  final double size;
  final Color? color;
  final double stroke;
  const AppSpinner({super.key, this.size = 22, this.color, this.stroke = 2.6});

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: size,
      height: size,
      child: CircularProgressIndicator(
        strokeWidth: stroke,
        valueColor: AlwaysStoppedAnimation(color ?? DanColors.brand),
      ),
    );
  }
}

/// Màn LOADING LỚN — cho cả màn hình / vùng lớn (lưới hàng kho/retail đang tải,
/// mạng lag). Logo Dan D Pak có hiệu ứng SÓNG mờ chạy trái→phải + vòng xoay bên
/// dưới. Sau 10s chưa xong thì hiện dòng "mạng chậm, vui lòng đợi…" để người dùng
/// biết là ĐANG tải chứ không phải treo/trống.
class AppLoadingView extends StatefulWidget {
  final String? message;
  const AppLoadingView({super.key, this.message});

  @override
  State<AppLoadingView> createState() => _AppLoadingViewState();
}

class _AppLoadingViewState extends State<AppLoadingView>
    with SingleTickerProviderStateMixin {
  late final AnimationController _wave;
  Timer? _slowTimer;
  bool _slow = false;

  @override
  void initState() {
    super.initState();
    _wave = AnimationController(
        vsync: this, duration: const Duration(milliseconds: 1300))
      ..repeat();
    // > 10s = mạng chậm → báo cho người dùng đợi 30s–1 phút (yêu cầu vận hành).
    _slowTimer = Timer(const Duration(seconds: 10), () {
      if (mounted) setState(() => _slow = true);
    });
  }

  @override
  void dispose() {
    _wave.dispose();
    _slowTimer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          SizedBox(
            height: 68,
            child: AnimatedBuilder(
              animation: _wave,
              builder: (context, child) {
                // Dải sáng chạy trái→phải trên logo (sóng biển).
                final t = _wave.value;
                return ShaderMask(
                  blendMode: BlendMode.srcATop,
                  shaderCallback: (rect) => LinearGradient(
                    begin: Alignment.centerLeft,
                    end: Alignment.centerRight,
                    colors: const [
                      Color(0x66FFFFFF),
                      Color(0xFFFFFFFF),
                      Color(0x66FFFFFF),
                    ],
                    stops: [
                      (t - 0.3).clamp(0.0, 1.0),
                      t.clamp(0.0, 1.0),
                      (t + 0.3).clamp(0.0, 1.0),
                    ],
                  ).createShader(rect),
                  child: child,
                );
              },
              child: Image.asset(
                'assets/brand/DanOnLogo.png',
                height: 68,
                fit: BoxFit.contain,
                errorBuilder: (_, __, ___) => Text('Dan D Pak',
                    style: TextStyle(
                        fontSize: 22,
                        fontWeight: FontWeight.w900,
                        color: DanColors.brand)),
              ),
            ),
          ),
          const SizedBox(height: 18),
          const AppSpinner(size: 26),
          const SizedBox(height: 14),
          Text(
            _slow
                ? (widget.message ??
                    'Mạng chậm — vui lòng đợi 30 giây đến 1 phút…')
                : (widget.message ?? 'Đang tải…'),
            textAlign: TextAlign.center,
            style: TextStyle(
                fontSize: 13,
                color: _slow ? DanColors.late : DanColors.muted,
                fontWeight: FontWeight.w600),
          ),
        ],
      ),
    );
  }
}
