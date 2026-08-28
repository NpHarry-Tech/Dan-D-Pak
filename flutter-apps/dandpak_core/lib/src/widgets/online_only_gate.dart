import 'package:flutter/material.dart';

import '../services/connectivity_status.dart';
import '../ui/app_theme.dart';
import '../utils/translation.dart';

/// ONLINE-ONLY (owner 2026-08-26): server là nguồn dữ liệu duy nhất. Khi mất
/// cổng ghi (không chạm được server / server ốm / hết phiên) thì mọi thao tác
/// TIỀN/HÀNG bị chặn và màn chuyển CHỈ ĐỌC. KHÔNG chốt bill/queue local.

/// Banner CHỈ ĐỌC — đặt ở đầu thân các màn có thao tác tiền/hàng
/// (Bán lẻ/POS/Thanh toán/Trả hàng/Kho). Tự ẩn khi đang online.
class ServerConnectionBanner extends StatelessWidget {
  const ServerConnectionBanner({super.key});

  @override
  Widget build(BuildContext context) {
    final cs = ConnectivityStatus.instance;
    return AnimatedBuilder(
      animation: cs.writeGate,
      builder: (context, _) {
        final reason = cs.writeBlockReason;
        if (reason == null) return const SizedBox.shrink();
        return Material(
          color: DanColors.late,
          child: SafeArea(
            top: false,
            bottom: false,
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 9),
              child: Row(
                children: [
                  const Icon(Icons.cloud_off, size: 18, color: Colors.white),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Text(
                      '$reason — ${t('chế độ CHỈ ĐỌC. Không thể bán/thanh toán/trả hàng/sửa kho cho tới khi kết nối lại máy chủ.')}',
                      style: const TextStyle(
                          color: Colors.white,
                          fontSize: 12.5,
                          fontWeight: FontWeight.w700,
                          height: 1.3),
                    ),
                  ),
                ],
              ),
            ),
          ),
        );
      },
    );
  }
}

/// Guard cho HÀNH ĐỘNG ghi tiền/hàng. Gọi ngay đầu handler mutation:
///   if (!ensureOnlineForMutation(context)) return;
/// Trả true nếu được phép; nếu mất kết nối thì báo rõ + trả false (KHÔNG thực
/// hiện, KHÔNG queue local, KHÔNG giả định request đã/chưa chạy).
bool ensureOnlineForMutation(BuildContext context, {String? action}) {
  final cs = ConnectivityStatus.instance;
  if (cs.canMutate) return true;
  final reason = cs.writeBlockReason ?? t('Mất kết nối máy chủ');
  final what = action != null ? '$action: ' : '';
  appToast(
    context,
    '$what$reason — ${t('không thể thao tác tiền/hàng khi mất kết nối. Vui lòng thử lại sau khi có mạng.')}',
    isError: true,
  );
  return false;
}
