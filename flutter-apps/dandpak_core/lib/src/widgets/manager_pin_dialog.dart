import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../ui/app_theme.dart'; // re-export: appNavigatorKey, AppNotifier, DanColors
import '../utils/translation.dart';

// Single-flight: chặn hai modal xác nhận quyền chồng nhau (double-tap / hai thao
// tác đồng thời) — nguyên nhân modal "đè nhau" hoặc kẹt (§17).
bool _managerPinOpen = false;

/// Prompts for a PIN to authorise a sensitive action.
/// Returns the entered PIN, or null if cancelled. Mirrors the web
/// `requestManagerOwnerPin(reason)` flow. [label] customises the field label
/// (e.g. vouchers require the CURRENT user's own PIN, not any manager's).
/// Luôn hiển thị hộp nhập trên cả desktop/tablet/phone. Một số endpoint (kho,
/// voucher...) bắt buộc PIN thật và không cho phiên quản lý tự duyệt; bỏ qua
/// ở client khiến backend từ chối nhưng người dùng không có chỗ để nhập.
Future<String?> requestManagerPin(BuildContext context, String reason,
    {String label = 'PIN Manager / Admin', bool selfPinOnly = false}) async {
  // Dùng Navigator ROOT toàn cục (ổn định) thay cho context nơi gọi — context đó
  // có thể đã bị dispose/nằm sau await khiến showDialog im lặng không hiện (§16).
  final dialogContext = appNavigatorKey.currentContext ?? context;
  // FAIL-CLOSED: không có navigator hợp lệ → KHÔNG cho action chạy tiếp, báo rõ.
  final navOk = appNavigatorKey.currentState != null || context.mounted;
  if (!navOk) {
    AppNotifier.show(
        title: t('Không thể mở xác nhận quản lý. Vui lòng thử lại.'),
        isError: true);
    return null;
  }
  if (_managerPinOpen)
    return null; // đang có modal xác nhận khác — bỏ qua double-tap
  _managerPinOpen = true;
  final controller = TextEditingController();
  try {
    return await showDialog<String>(
      context: dialogContext,
      useRootNavigator: true,
      builder: (ctx) {
        void submit() {
          final v = controller.text.trim();
          if (v.isNotEmpty) Navigator.of(ctx).pop(v);
        }

        return AlertDialog(
          backgroundColor: DanColors.surface,
          title: Text(t('Xác nhận quyền'),
              style: TextStyle(fontWeight: FontWeight.w900, fontSize: 18)),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(reason,
                  style: TextStyle(color: DanColors.muted, height: 1.4)),
              SizedBox(height: 14),
              TextField(
                controller: controller,
                autofocus: true,
                obscureText: true,
                keyboardType: TextInputType.number,
                inputFormatters: [
                  FilteringTextInputFormatter.digitsOnly,
                  LengthLimitingTextInputFormatter(8),
                ],
                decoration: InputDecoration(
                  labelText: label,
                  prefixIcon: Icon(Icons.lock_outline),
                ),
                onSubmitted: (_) => submit(),
              ),
            ],
          ),
          actions: [
            TextButton(
                onPressed: () => Navigator.of(ctx).pop(),
                child: Text(t('Hủy'))),
            FilledButton(onPressed: submit, child: Text(t('Xác nhận'))),
          ],
        );
      },
    );
  } finally {
    _managerPinOpen = false;
  }
}
