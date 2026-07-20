import 'dart:async';

import 'package:flutter/material.dart';

import '../../services/api_service.dart';
import '../../utils/translation.dart';

/// Logo góc trên-trái trên các màn KHÁCH của iPad Self-Order.
///
/// Nhân viên chạm 3 lần liên tiếp (trong 3 giây) → hộp nhập MẬT KHẨU thiết bị
/// khách (Cài đặt → ipad_staff_pin) → đúng thì thoát về màn CHỌN BÀN.
/// Khách chạm 1–2 lần không thấy gì xảy ra nên không phá được kiosk.
class SelfOrderStaffLogo extends StatefulWidget {
  final ApiService api;
  SelfOrderStaffLogo({super.key, required this.api});

  @override
  State<SelfOrderStaffLogo> createState() => _SelfOrderStaffLogoState();
}

class _SelfOrderStaffLogoState extends State<SelfOrderStaffLogo> {
  int _taps = 0;
  Timer? _window;

  void _tap() {
    _taps++;
    _window ??= Timer(Duration(seconds: 3), () {
      _taps = 0;
      _window = null;
    });
    if (_taps >= 3) {
      _window?.cancel();
      _window = null;
      _taps = 0;
      _askPin();
    }
  }

  Future<void> _askPin() async {
    final ctrl = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(t('Nhân viên thoát kiosk')),
        content: TextField(
          controller: ctrl,
          autofocus: true,
          obscureText: true,
          keyboardType: TextInputType.number,
          maxLength: 8,
          decoration: InputDecoration(
            labelText: t('Mật khẩu thiết bị khách'),
            counterText: '',
          ),
          onSubmitted: (_) => Navigator.of(ctx).pop(true),
        ),
        actions: [
          TextButton(
              onPressed: () => Navigator.of(ctx).pop(false),
              child: Text(t('Hủy'))),
          FilledButton(
              onPressed: () => Navigator.of(ctx).pop(true),
              child: Text(t('Xác nhận'))),
        ],
      ),
    );
    if (ok != true || !mounted) return;
    final r = await widget.api.ipadUnlock(ctrl.text.trim());
    final valid = r['ok'] == true;
    if (!mounted) return;
    if (valid) {
      // Về màn chọn bàn của module (route '/so-table').
      Navigator.of(context)
          .popUntil((r) => r.settings.name == '/so-table' || r.isFirst);
    } else {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        content: Text(t('Mật khẩu không đúng')),
        backgroundColor: Color(0xFFFF7A7A),
      ));
    }
  }

  @override
  void dispose() {
    _window?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTap: _tap,
      child: SizedBox(
        width: 44,
        height: 44,
        child: Image.asset(
          'assets/brand/logo.png',
          fit: BoxFit.contain,
          // Nếu thiếu asset thì vẫn hiện ô chữ D (không để trống/hỏng UI).
          errorBuilder: (_, __, ___) => Container(
            decoration: BoxDecoration(
              color: Color(0xFF0891B2),
              borderRadius: BorderRadius.circular(10),
            ),
            alignment: Alignment.center,
            child: Text('D',
                style: TextStyle(
                    color: Colors.white,
                    fontSize: 20,
                    fontWeight: FontWeight.w900)),
          ),
        ),
      ),
    );
  }
}
