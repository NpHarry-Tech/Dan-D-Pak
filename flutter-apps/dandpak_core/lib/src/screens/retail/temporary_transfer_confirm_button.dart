import 'package:flutter/material.dart';

/// Nút nghiệp vụ tạm thời trong giai đoạn chưa nối ngân hàng gốc.
/// Xóa file này và hai chỗ dùng khi luồng đối soát chính thức sẵn sàng.
class TemporaryTransferConfirmButton extends StatelessWidget {
  final VoidCallback? onPressed;

  const TemporaryTransferConfirmButton({super.key, this.onPressed});

  @override
  Widget build(BuildContext context) => OutlinedButton.icon(
        onPressed: onPressed,
        icon: const Icon(Icons.check_circle_outline, size: 18),
        label: const Text('Xác nhận đã chuyển khoản'),
      );
}
