import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';

import '../providers/auth_provider.dart';

import '../ui/app_theme.dart';
import '../utils/translation.dart';

/// Prompts for a PIN to authorise a sensitive action.
/// Returns the entered PIN, or null if cancelled. Mirrors the web
/// `requestManagerOwnerPin(reason)` flow. [label] customises the field label
/// (e.g. vouchers require the CURRENT user's own PIN, not any manager's).
///
/// BỎ QUA HỘP THOẠI khi người đang đăng nhập ĐÃ là Quản lý/Admin: chính họ là
/// người có thẩm quyền duyệt, bắt gõ lại PIN của chính mình chỉ làm chậm thao
/// tác giữa ca bận và khiến PIN bị gõ ra màn hình nhiều lần trước mặt người
/// khác. Server nhận diện quyền qua PHIÊN ĐĂNG NHẬP (xem selfApprover trong
/// services/auth.js) nên chuỗi rỗng gửi lên vẫn được duyệt đúng người.
///
/// [selfPinOnly] = true cho các luồng bắt buộc người thao tác tự nhập PIN của
/// CHÍNH MÌNH (voucher) — những chỗ đó không được bỏ qua.
Future<String?> requestManagerPin(BuildContext context, String reason,
    {String label = 'PIN Manager / Admin', bool selfPinOnly = false}) {
  if (!selfPinOnly) {
    final me = context.read<AuthProvider>().currentUser;
    if (me != null && (me.role == 'owner' || me.role == 'manager')) {
      return Future<String?>.value('');
    }
  }
  final controller = TextEditingController();
  return showDialog<String>(
    context: context,
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
            Text(reason, style: TextStyle(color: DanColors.muted, height: 1.4)),
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
              onPressed: () => Navigator.of(ctx).pop(), child: Text(t('Hủy'))),
          FilledButton(onPressed: submit, child: Text(t('Xác nhận'))),
        ],
      );
    },
  );
}
