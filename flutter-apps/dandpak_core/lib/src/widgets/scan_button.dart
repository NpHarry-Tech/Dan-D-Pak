import 'dart:io';

import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter/material.dart';

import '../screens/scanner/barcode_scanner_screen.dart';
import '../utils/translation.dart';

/// Quét bằng camera CHỈ khả dụng trên tablet/điện thoại. Desktop dùng máy quét
/// mã vạch USB (gõ thẳng vào ô tìm) nên ẩn nút quét camera đi.
bool get kCameraScanSupported =>
    !kIsWeb && (Platform.isAndroid || Platform.isIOS);

/// Nút biểu tượng mở trình quét mã vạch bằng camera. Trên desktop trả về
/// một icon TRANG TRÍ không bấm được (không phải nút) — đúng yêu cầu "ẩn nút
/// quét trên desktop". [onCode] nhận chuỗi mã sau khi quét xong.
class ScanIconButton extends StatelessWidget {
  final void Function(String code) onCode;
  final String? title;
  final double size;
  final Color? color;
  ScanIconButton({
    super.key,
    required this.onCode,
    this.title,
    this.size = 22,
    this.color,
  });

  @override
  Widget build(BuildContext context) {
    if (!kCameraScanSupported) {
      // Desktop: giữ icon gợi ý ô nhập mã (máy quét USB gõ vào đây), KHÔNG bấm.
      return Icon(Icons.qr_code_scanner, size: size, color: color);
    }
    return IconButton(
      tooltip: t('Quét mã vạch bằng camera'),
      icon: Icon(Icons.qr_code_scanner, size: size, color: color),
      onPressed: () async {
        final code = await scanBarcode(context, title: title);
        if (code != null && code.isNotEmpty) onCode(code);
      },
    );
  }
}
