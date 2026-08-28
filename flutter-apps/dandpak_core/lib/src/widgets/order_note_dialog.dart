import 'package:flutter/material.dart';

import '../utils/translation.dart';

Future<String?> editOrderNote(BuildContext context, String current) async {
  var note = current;
  return showDialog<String>(
    context: context,
    builder: (dialogContext) => AlertDialog(
      title: Text(t('Ghi chú')),
      content: TextFormField(
        initialValue: current,
        autofocus: true,
        maxLength: 500,
        minLines: 3,
        maxLines: 6,
        onChanged: (value) => note = value,
        decoration: InputDecoration(hintText: t('Nhập ghi chú cho đơn hàng')),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(dialogContext).pop(),
          child: Text(t('Huỷ')),
        ),
        FilledButton(
          onPressed: () => Navigator.of(dialogContext).pop(note.trim()),
          child: Text(t('Lưu')),
        ),
      ],
    ),
  );
}
