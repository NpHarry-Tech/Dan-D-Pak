import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';

import '../providers/auth_provider.dart';
import '../ui/app_theme.dart';
import '../utils/translation.dart';

/// Màn ÉP đổi PIN mặc định. Hiện thay cho Launcher khi server báo tài khoản vừa
/// đăng nhập còn dùng PIN mặc định (owner/1234). Không thể bỏ qua: chỉ thoát khi
/// đổi PIN thành công (provider xóa cờ → gốc routing trả về Launcher) hoặc đăng xuất.
class ForceChangePinScreen extends StatefulWidget {
  const ForceChangePinScreen({super.key});

  @override
  State<ForceChangePinScreen> createState() => _ForceChangePinScreenState();
}

class _ForceChangePinScreenState extends State<ForceChangePinScreen> {
  final _current = TextEditingController();
  final _new = TextEditingController();
  final _confirm = TextEditingController();
  bool _busy = false;
  String? _error;

  // Cảnh báo tức thì phía client — server mới là nơi chốt chặn (danh sách đầy đủ).
  static const _weak = {
    '0000', '1111', '2222', '3333', '4444', '5555', '6666', '7777', '8888',
    '9999', '1234', '4321', '2345', '3456', '4567', '5678', '6789', '0123',
    '1212', '2580', '000000', '111111', '123456', '654321', '121212',
  };

  @override
  void dispose() {
    _current.dispose();
    _new.dispose();
    _confirm.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final cur = _current.text.trim();
    final next = _new.text.trim();
    final confirm = _confirm.text.trim();
    if (cur.isEmpty) {
      setState(() => _error = t('Nhập mã PIN hiện tại.'));
      return;
    }
    if (!RegExp(r'^\d{4,6}$').hasMatch(next)) {
      setState(() => _error = t('PIN mới phải gồm 4–6 chữ số.'));
      return;
    }
    if (_weak.contains(next)) {
      setState(() => _error = t('PIN mới quá dễ đoán. Hãy chọn dãy số khác.'));
      return;
    }
    if (next != confirm) {
      setState(() => _error = t('Hai lần nhập PIN mới không khớp.'));
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await context.read<AuthProvider>().changeOwnPin(cur, next);
      // Thành công → provider xóa mustChangePin + notifyListeners → gốc routing
      // tự chuyển sang Launcher. Không cần điều hướng thủ công ở đây.
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = '$e'.replaceFirst('Exception: ', '');
      });
    }
  }

  Future<void> _logout() async {
    await context.read<AuthProvider>().logout();
  }

  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: false,
      child: Scaffold(
        backgroundColor: DanColors.bg,
        body: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: Container(
                padding: const EdgeInsets.all(28),
                decoration: BoxDecoration(
                  color: DanColors.surface,
                  borderRadius: BorderRadius.circular(16),
                  border: Border.all(color: DanColors.border),
                ),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    const Icon(Icons.shield_outlined,
                        size: 44, color: DanColors.brand),
                    const SizedBox(height: 14),
                    Text(
                      t('Đổi mã PIN mặc định'),
                      textAlign: TextAlign.center,
                      style: const TextStyle(
                          fontSize: 20,
                          fontWeight: FontWeight.w700,
                          color: DanColors.text),
                    ),
                    const SizedBox(height: 8),
                    Text(
                      t('Tài khoản Admin đang dùng mã PIN mặc định. Vì an toàn của cửa hàng, hãy đặt mã PIN mới trước khi tiếp tục.'),
                      textAlign: TextAlign.center,
                      style: const TextStyle(
                          fontSize: 13.5, color: DanColors.muted, height: 1.4),
                    ),
                    const SizedBox(height: 22),
                    _pinField(_current, t('Mã PIN hiện tại')),
                    const SizedBox(height: 12),
                    _pinField(_new, t('Mã PIN mới (4–6 số)')),
                    const SizedBox(height: 12),
                    _pinField(_confirm, t('Nhập lại mã PIN mới')),
                    if (_error != null) ...[
                      const SizedBox(height: 14),
                      Text(
                        _error!,
                        textAlign: TextAlign.center,
                        style: const TextStyle(
                            color: DanColors.late,
                            fontSize: 13,
                            fontWeight: FontWeight.w600),
                      ),
                    ],
                    const SizedBox(height: 22),
                    SizedBox(
                      height: 46,
                      child: ElevatedButton(
                        onPressed: _busy ? null : _submit,
                        style: ElevatedButton.styleFrom(
                          backgroundColor: DanColors.brand,
                          foregroundColor: Colors.white,
                          shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(10)),
                        ),
                        child: _busy
                            ? const SizedBox(
                                width: 20,
                                height: 20,
                                child: CircularProgressIndicator(
                                    strokeWidth: 2, color: Colors.white))
                            : Text(t('Đổi PIN & tiếp tục'),
                                style: const TextStyle(
                                    fontSize: 15, fontWeight: FontWeight.w700)),
                      ),
                    ),
                    const SizedBox(height: 8),
                    TextButton(
                      onPressed: _busy ? null : _logout,
                      child: Text(t('Đăng xuất'),
                          style: const TextStyle(color: DanColors.muted)),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _pinField(TextEditingController c, String label) {
    return TextField(
      controller: c,
      obscureText: true,
      keyboardType: TextInputType.number,
      maxLength: 6,
      inputFormatters: [FilteringTextInputFormatter.digitsOnly],
      onSubmitted: (_) => _busy ? null : _submit(),
      decoration: InputDecoration(
        labelText: label,
        counterText: '',
        filled: true,
        fillColor: DanColors.surface2,
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(10),
          borderSide: BorderSide(color: DanColors.border),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(10),
          borderSide: BorderSide(color: DanColors.border),
        ),
      ),
    );
  }
}
