import 'package:flutter/material.dart';

class DanColors {
  const DanColors._();

  static const bg = Color(0xFFF7F8FA);
  static const surface = Color(0xFFFFFFFF);
  static const surface2 = Color(0xFFF3F5F7);
  static const surface3 = Color(0xFFE8EBEF);
  static const border = Color(0xFFE7EAEE);
  static const border2 = Color(0xFFD3D8DF);
  static const text = Color(0xFF1A2230);
  static const muted = Color(0xFF677084);
  static const faint = Color(0xFF9AA3B2);
  static const brand = Color(0xFF0891B2);
  static const brandHover = Color(0xFF077E9B);
  static const brandDim = Color(0x1A0891B2);
  static const newState = Color(0xFF5EA3FF);
  static const doing = Color(0xFFFFC24D);
  static const done = Color(0xFF3FE08F);
  static const late = Color(0xFFFF6B6B);
  static const paying = Color(0xFFB58CFF);
}

class DanRadius {
  const DanRadius._();

  static const sm = 8.0;
  static const md = 10.0;
  static const lg = 14.0;
}

/// Chuyển trang TỨC THÌ — dùng ở chế độ máy yếu: mỗi hiệu ứng trượt/mờ là
/// hàng chục frame raster mà POS Celeron không kham nổi (khựng → nghi crash).
class _InstantPageTransitionsBuilder extends PageTransitionsBuilder {
  const _InstantPageTransitionsBuilder();

  @override
  Widget buildTransitions<T>(
    PageRoute<T> route,
    BuildContext context,
    Animation<double> animation,
    Animation<double> secondaryAnimation,
    Widget child,
  ) =>
      child;
}

class DanTheme {
  const DanTheme._();

  /// [lowEnd] = chế độ máy yếu (PerfMode tự đo và bật): bỏ hiệu ứng chuyển
  /// trang + hiệu ứng loang khi chạm — giảm hẳn tải raster trên GPU onboard.
  static ThemeData light({bool lowEnd = false}) {
    final base = ThemeData(
      useMaterial3: true,
      brightness: Brightness.light,
      scaffoldBackgroundColor: DanColors.bg,
      fontFamily: 'Be Vietnam Pro',
      colorScheme: ColorScheme.fromSeed(
        seedColor: DanColors.brand,
        brightness: Brightness.light,
        primary: DanColors.brand,
        surface: DanColors.surface,
      ),
    );
    return base.copyWith(
      pageTransitionsTheme: lowEnd
          ? const PageTransitionsTheme(builders: {
              TargetPlatform.android: _InstantPageTransitionsBuilder(),
              TargetPlatform.iOS: _InstantPageTransitionsBuilder(),
              TargetPlatform.windows: _InstantPageTransitionsBuilder(),
              TargetPlatform.macOS: _InstantPageTransitionsBuilder(),
              TargetPlatform.linux: _InstantPageTransitionsBuilder(),
            })
          : null,
      splashFactory: lowEnd ? NoSplash.splashFactory : null,
      textTheme: base.textTheme.apply(
        bodyColor: DanColors.text,
        displayColor: DanColors.text,
        fontFamily: 'Be Vietnam Pro',
      ),
      cardTheme: CardThemeData(
        color: DanColors.surface,
        elevation: 0,
        margin: EdgeInsets.zero,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(DanRadius.lg),
          side: const BorderSide(color: DanColors.border),
        ),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          backgroundColor: DanColors.brand,
          foregroundColor: Colors.white,
          minimumSize: const Size(0, 42),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(DanRadius.sm)),
          textStyle: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          foregroundColor: DanColors.text,
          side: const BorderSide(color: DanColors.border2),
          minimumSize: const Size(0, 42),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(DanRadius.sm)),
          textStyle: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700),
        ),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: DanColors.surface,
        contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 11),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(DanRadius.sm),
          borderSide: const BorderSide(color: DanColors.border),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(DanRadius.sm),
          borderSide: const BorderSide(color: DanColors.border),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(DanRadius.sm),
          borderSide: const BorderSide(color: DanColors.brand),
        ),
      ),
    );
  }
}
