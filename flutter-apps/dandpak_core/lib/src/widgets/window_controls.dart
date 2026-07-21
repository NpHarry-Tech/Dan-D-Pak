import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../services/black_box.dart';
import '../utils/translation.dart';

/// Bridge to the native runner's custom window-chrome channel (the app has a
/// frameless window; the Flutter top bar is the title bar).
class WindowControls {
  static final _ch = MethodChannel('dandpak/window');
  static bool get supported => Platform.isWindows;

  static Future<void> minimize() => _safe('minimize');
  static Future<void> maximizeOrRestore() => _safe('maximizeOrRestore');
  static Future<void> close() {
    // Người dùng chủ động đóng app → đánh dấu thoát sạch để hộp đen không
    // báo nhầm là crash ở lần mở sau.
    BlackBox.markCleanExit();
    return _safe('close');
  }

  static Future<void> startDrag() => _safe('startDrag');
  static Future<void> startResize(String edge) => _safe('startResize', edge);

  static Future<bool> isMaximized() async {
    if (!supported) return true;
    try {
      return (await _ch.invokeMethod<bool>('isMaximized')) ?? false;
    } catch (_) {
      return false;
    }
  }

  static Future<void> _safe(String method, [dynamic args]) async {
    if (!supported) return;
    try {
      await _ch.invokeMethod(method, args);
    } catch (_) {}
  }
}

/// Minimize / maximize-restore / close buttons for the custom title bar.
class WindowButtons extends StatefulWidget {
  WindowButtons({super.key});

  @override
  State<WindowButtons> createState() => _WindowButtonsState();
}

class _WindowButtonsState extends State<WindowButtons> {
  @override
  Widget build(BuildContext context) {
    if (!WindowControls.supported) return SizedBox.shrink();
    return Material(
      color: Colors.transparent,
      child: Padding(
        padding: EdgeInsets.only(right: 14),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            _WinBtn(
              icon: Icons.remove,
              tooltip: t('Thu nhỏ'),
              onTap: WindowControls.minimize,
              iconSize: 18,
            ),
            _WinBtn(
              icon: Icons.crop_square,
              iconSize: 15,
              tooltip: t('Phóng to / khôi phục'),
              onTap: () async {
                await WindowControls.maximizeOrRestore();
              },
            ),
            _WinBtn(
              icon: Icons.close,
              tooltip: t('Đóng'),
              onTap: WindowControls.close,
              iconSize: 18,
            ),
          ],
        ),
      ),
    );
  }
}

class _WinBtn extends StatefulWidget {
  final IconData icon;
  final double iconSize;
  final String tooltip;
  final VoidCallback onTap;

  _WinBtn({
    required this.icon,
    required this.tooltip,
    required this.onTap,
    required this.iconSize,
  });

  @override
  State<_WinBtn> createState() => _WinBtnState();
}

class _WinBtnState extends State<_WinBtn> {
  bool _hover = false;

  @override
  Widget build(BuildContext context) {
    final isMac = Platform.isMacOS;
    Color dotColor;
    IconData displayIcon = widget.icon;

    if (widget.tooltip == t('Đóng')) {
      dotColor = Color(0xFFFF5F56); // macOS Close Red
      displayIcon = Icons.close;
    } else if (widget.tooltip == t('Thu nhỏ')) {
      dotColor = Color(0xFFFFBD2E); // macOS Minimize Yellow
      displayIcon = Icons.remove;
    } else {
      dotColor = Color(0xFF27C93F); // macOS Maximize Green
      displayIcon = Icons.crop_square;
    }

    if (isMac) {
      // Circular traffic lights design for macOS
      return MouseRegion(
        onEnter: (_) => setState(() => _hover = true),
        onExit: (_) => setState(() => _hover = false),
        child: GestureDetector(
          onTap: widget.onTap,
          child: Container(
            width: 44,
            height: 62,
            color: Colors.transparent,
            alignment: Alignment.center,
            child: AnimatedContainer(
              duration: Duration(milliseconds: 150),
              width: 16,
              height: 16,
              decoration: BoxDecoration(
                color: dotColor,
                shape: BoxShape.circle,
                boxShadow: [
                  BoxShadow(
                    color: Colors.black.withValues(alpha: 0.12),
                    blurRadius: 1.5,
                    offset: Offset(0, 1),
                  ),
                ],
              ),
              child: Center(
                child: AnimatedOpacity(
                  duration: Duration(milliseconds: 100),
                  opacity: _hover ? 1.0 : 0.0,
                  child: Icon(
                    displayIcon,
                    size: 10,
                    color: Colors.black.withValues(alpha: 0.7),
                  ),
                ),
              ),
            ),
          ),
        ),
      );
    } else {
      // Windows design: square buttons with colored icons
      Color fg;
      Color bg;

      if (widget.tooltip == t('Đóng')) {
        bg = _hover
            ? Color(0xFFE81123)
            : Colors.transparent; // Windows Close Red
        fg = _hover ? Colors.white : Color(0xFFE81123);
      } else if (widget.tooltip == t('Thu nhỏ')) {
        bg = _hover
            ? Color(0xFFFFBD2E).withValues(alpha: 0.1)
            : Colors.transparent;
        fg = Color(0xFFD97706); // Amber/orange
      } else {
        bg = _hover
            ? Color(0xFF27C93F).withValues(alpha: 0.1)
            : Colors.transparent;
        fg = Color(0xFF16A34A); // Green
      }

      return MouseRegion(
        onEnter: (_) => setState(() => _hover = true),
        onExit: (_) => setState(() => _hover = false),
        child: GestureDetector(
          onTap: widget.onTap,
          child: SizedBox(
            width: 44,
            height: 62,
            child: Center(
              child: AnimatedContainer(
                duration: Duration(milliseconds: 100),
                width: 36,
                height: 36,
                decoration: BoxDecoration(
                  color: bg,
                  borderRadius: BorderRadius.circular(7),
                ),
                alignment: Alignment.center,
                child: Icon(
                  displayIcon,
                  size: widget.iconSize,
                  color: fg,
                ),
              ),
            ),
          ),
        ),
      );
    }
  }
}

/// Wraps the whole app: adds resize handles on every edge/corner and a
/// persistent window-buttons overlay so every screen (including login and the
/// launcher, which have no module top bar) can move/resize/close the window.
class WindowChrome extends StatelessWidget {
  final Widget child;
  WindowChrome({super.key, required this.child});

  @override
  Widget build(BuildContext context) {
    if (!WindowControls.supported) return child;
    final thickness = 6.0; // resize band thickness
    return Stack(
      children: [
        Positioned.fill(child: child),
        // Edges
        _edge(
            left: 0,
            top: thickness,
            bottom: thickness,
            width: thickness,
            cursor: SystemMouseCursors.resizeLeftRight,
            dir: 'left'),
        _edge(
            right: 0,
            top: thickness,
            bottom: thickness,
            width: thickness,
            cursor: SystemMouseCursors.resizeLeftRight,
            dir: 'right'),
        _edge(
            top: 0,
            left: thickness,
            right: thickness,
            height: thickness,
            cursor: SystemMouseCursors.resizeUpDown,
            dir: 'top'),
        _edge(
            bottom: 0,
            left: thickness,
            right: thickness,
            height: thickness,
            cursor: SystemMouseCursors.resizeUpDown,
            dir: 'bottom'),
        // Corners
        _edge(
            left: 0,
            top: 0,
            width: thickness,
            height: thickness,
            cursor: SystemMouseCursors.resizeUpLeftDownRight,
            dir: 'topLeft'),
        _edge(
            right: 0,
            top: 0,
            width: thickness,
            height: thickness,
            cursor: SystemMouseCursors.resizeUpRightDownLeft,
            dir: 'topRight'),
        _edge(
            left: 0,
            bottom: 0,
            width: thickness,
            height: thickness,
            cursor: SystemMouseCursors.resizeUpRightDownLeft,
            dir: 'bottomLeft'),
        _edge(
            right: 0,
            bottom: 0,
            width: thickness,
            height: thickness,
            cursor: SystemMouseCursors.resizeUpLeftDownRight,
            dir: 'bottomRight'),
        // Window buttons pinned top-right, always on top.
        Positioned(top: 0, right: 0, child: WindowButtons()),
      ],
    );
  }

  Widget _edge({
    double? left,
    double? top,
    double? right,
    double? bottom,
    double? width,
    double? height,
    required SystemMouseCursor cursor,
    required String dir,
  }) {
    return Positioned(
      left: left,
      top: top,
      right: right,
      bottom: bottom,
      width: width,
      height: height,
      child: MouseRegion(
        cursor: cursor,
        child: Listener(
          behavior: HitTestBehavior.translucent,
          onPointerDown: (_) => WindowControls.startResize(dir),
        ),
      ),
    );
  }
}

/// Wrap any custom title bar to make its empty areas drag the window and
/// double-click toggle maximize.
class DragToMoveArea extends StatelessWidget {
  final Widget child;
  DragToMoveArea({super.key, required this.child});

  @override
  Widget build(BuildContext context) {
    if (!WindowControls.supported) return child;
    return GestureDetector(
      behavior: HitTestBehavior.translucent,
      onPanStart: (_) => WindowControls.startDrag(),
      onDoubleTap: WindowControls.maximizeOrRestore,
      child: child,
    );
  }
}
