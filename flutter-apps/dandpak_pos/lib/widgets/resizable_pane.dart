import 'package:flutter/material.dart';

import '../services/local_store.dart';
import '../ui/app_theme.dart';

/// Thanh giỏ hàng bên phải mà thu ngân KÉO RỘNG/HẸP được theo chiều ngang.
///
/// - Rê chuột vào mép trái giỏ → hiện tay nắm (con trỏ đổi thành mũi tên ↔),
///   kéo trái để rộng ra, kéo phải để hẹp lại.
/// - Nút phóng to/thu nhỏ ở đầu tay nắm: bấm để nhảy giữa mức mặc định và mức
///   rộng nhất (một chạm, khỏi kéo).
/// - Bề rộng được NHỚ theo [storageKey] (khác nhau cho Retail và F&B) nên lần
///   mở sau vẫn giữ đúng cỡ thu ngân đã chọn.
///
/// Đặt trong một Row với phần nội dung bên trái là Expanded — widget này tự
/// chiếm đúng bề rộng đang chọn (đã kẹp trong [minWidth]..[maxWidth] và không
/// vượt quá [maxAvailable] để không nuốt hết chỗ của lưới sản phẩm).
class ResizablePane extends StatefulWidget {
  final Widget child;
  final String storageKey;
  final double minWidth;
  final double maxWidth;
  final double defaultWidth;
  final double maxAvailable;

  const ResizablePane({
    super.key,
    required this.child,
    required this.storageKey,
    required this.maxAvailable,
    this.minWidth = 320,
    this.maxWidth = 720,
    this.defaultWidth = 460,
  });

  @override
  State<ResizablePane> createState() => _ResizablePaneState();
}

class _ResizablePaneState extends State<ResizablePane> {
  double? _width;
  bool _hovering = false;
  bool _dragging = false;

  String get _key => 'cart_width_${widget.storageKey}';

  @override
  void initState() {
    super.initState();
    _restore();
  }

  Future<void> _restore() async {
    try {
      final saved = await LocalStore.instance.getString(_key);
      final v = saved == null ? null : double.tryParse(saved);
      if (v != null && mounted) setState(() => _width = v);
    } catch (_) {}
  }

  void _persist(double v) {
    LocalStore.instance.setString(_key, v.toStringAsFixed(0));
  }

  // Mức trần thực tế: không vượt maxWidth và luôn chừa tối thiểu 360px cho
  // lưới sản phẩm/sơ đồ bàn bên trái.
  double get _ceiling {
    final room = widget.maxAvailable - 360;
    final hardMax = room < widget.minWidth ? widget.minWidth : room;
    return widget.maxWidth < hardMax ? widget.maxWidth : hardMax;
  }

  double get _effective {
    final w = _width ?? widget.defaultWidth;
    return w.clamp(widget.minWidth, _ceiling);
  }

  void _setWidth(double w, {bool persist = false}) {
    final clamped = w.clamp(widget.minWidth, _ceiling);
    setState(() => _width = clamped);
    if (persist) _persist(clamped);
  }

  void _toggle() {
    // Gần mức rộng nhất → thu về mặc định; ngược lại → mở rộng hết cỡ.
    final atWide = _effective >= _ceiling - 4;
    _setWidth(atWide ? widget.defaultWidth : _ceiling, persist: true);
  }

  @override
  Widget build(BuildContext context) {
    final active = _hovering || _dragging;
    return Row(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      mainAxisSize: MainAxisSize.min,
      children: [
        _handle(active),
        SizedBox(width: _effective, child: widget.child),
      ],
    );
  }

  Widget _handle(bool active) {
    final atWide = _effective >= _ceiling - 4;
    return MouseRegion(
      cursor: SystemMouseCursors.resizeLeftRight,
      onEnter: (_) => setState(() => _hovering = true),
      onExit: (_) => setState(() => _hovering = false),
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onDoubleTap: _toggle,
        onHorizontalDragStart: (_) => setState(() => _dragging = true),
        // Kéo sang TRÁI (delta âm) → giỏ rộng ra; sang PHẢI → hẹp lại.
        onHorizontalDragUpdate: (d) => _setWidth(_effective - d.delta.dx),
        onHorizontalDragEnd: (_) {
          setState(() => _dragging = false);
          _persist(_effective);
        },
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 120),
          width: active ? 16 : 10,
          decoration: BoxDecoration(
            color: active ? DanColors.brand.withValues(alpha: .12) : Colors.transparent,
            border: Border(
              left: BorderSide(
                color: active ? DanColors.brand : DanColors.border,
                width: active ? 2 : 1,
              ),
            ),
          ),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              // Nút phóng to / thu nhỏ (hiện rõ khi rê vào).
              Tooltip(
                message: atWide ? 'Thu nhỏ giỏ hàng' : 'Mở rộng giỏ hàng',
                child: InkWell(
                  onTap: _toggle,
                  customBorder: const CircleBorder(),
                  child: AnimatedOpacity(
                    opacity: active ? 1 : 0.35,
                    duration: const Duration(milliseconds: 120),
                    child: Container(
                      margin: const EdgeInsets.only(bottom: 8),
                      padding: const EdgeInsets.all(3),
                      decoration: BoxDecoration(
                        color: active ? DanColors.brand : DanColors.surface2,
                        shape: BoxShape.circle,
                      ),
                      child: Icon(
                        atWide
                            ? Icons.unfold_less_rounded
                            : Icons.unfold_more_rounded,
                        size: 14,
                        color: active ? Colors.white : DanColors.muted,
                      ),
                    ),
                  ),
                ),
              ),
              // Tay nắm dạng ba chấm dọc.
              Icon(Icons.drag_indicator,
                  size: active ? 16 : 13,
                  color: active ? DanColors.brand : DanColors.faint),
            ],
          ),
        ),
      ),
    );
  }
}
