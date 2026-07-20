import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart';

/// Bọc một ô nhập PIN có KEYPAD trên màn hình để CŨNG nhận bàn phím thiết bị / bàn
/// phím rời: gõ số 0–9 (hàng trên hoặc numpad), Backspace/Delete, Enter đều được
/// chuyển thành đúng thao tác như bấm keypad. Dùng CHUNG cho mọi ô PIN keypad
/// (đăng nhập nhân viên, admin, cổng PIN…) — tránh mỗi nơi tự xử lý phím một kiểu.
///
/// [onKey] nhận: '0'..'9' | 'back' | 'enter'.
class PinKeyCapture extends StatefulWidget {
  final Widget child;
  final void Function(String key) onKey;

  /// Tự chiếm focus khi mở (đúng cho dialog CHỈ có keypad, không có ô chữ khác).
  /// Đặt false nếu trong dialog có TextField (vd nhập username) để không giành focus.
  final bool autofocus;

  const PinKeyCapture({
    super.key,
    required this.child,
    required this.onKey,
    this.autofocus = true,
  });

  @override
  State<PinKeyCapture> createState() => _PinKeyCaptureState();
}

class _PinKeyCaptureState extends State<PinKeyCapture> {
  final FocusNode _node = FocusNode(debugLabel: 'PinKeyCapture');

  @override
  void initState() {
    super.initState();
    if (widget.autofocus) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) _node.requestFocus();
      });
    }
  }

  @override
  void dispose() {
    _node.dispose();
    super.dispose();
  }

  KeyEventResult _onKeyEvent(FocusNode node, KeyEvent event) {
    if (event is! KeyDownEvent && event is! KeyRepeatEvent) {
      return KeyEventResult.ignored;
    }
    // Ký tự gõ ra (kể cả numpad khi bật NumLock) → nếu là chữ số thì nạp.
    final ch = event.character;
    if (ch != null && ch.length == 1) {
      final c = ch.codeUnitAt(0);
      if (c >= 0x30 && c <= 0x39) {
        widget.onKey(ch);
        return KeyEventResult.handled;
      }
    }
    final k = event.logicalKey;
    if (k == LogicalKeyboardKey.backspace || k == LogicalKeyboardKey.delete) {
      widget.onKey('back');
      return KeyEventResult.handled;
    }
    if (k == LogicalKeyboardKey.enter || k == LogicalKeyboardKey.numpadEnter) {
      widget.onKey('enter');
      return KeyEventResult.handled;
    }
    return KeyEventResult.ignored;
  }

  @override
  Widget build(BuildContext context) {
    return Focus(
      focusNode: _node,
      autofocus: widget.autofocus,
      onKeyEvent: _onKeyEvent,
      child: widget.child,
    );
  }
}
