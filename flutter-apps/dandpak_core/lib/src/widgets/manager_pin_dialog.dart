import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../ui/app_theme.dart';
import '../utils/translation.dart';

/// Prompts for a PIN to authorise a sensitive action.
/// Returns the entered PIN, or null if cancelled. Mirrors the web
/// `requestManagerOwnerPin(reason)` flow. [label] customises the field label
/// (e.g. vouchers require the CURRENT user's own PIN, not any manager's).
Future<String?> requestManagerPin(BuildContext context, String reason,
    {String label = 'PIN Manager / Admin'}) {
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
