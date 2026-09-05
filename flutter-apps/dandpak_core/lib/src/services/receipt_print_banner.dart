import 'dart:async';

import '../utils/translation.dart';
import 'api_service.dart';
import 'app_notifier.dart';
import 'receipt_print_tracker.dart';

/// Một integration duy nhất cho F&B, Retail desktop/tablet và POS điện thoại.
/// Payment đã commit luôn là sự thật; lỗi/timeout ở đây chỉ nói về việc IN.
void trackReceiptPrintBanner({
  required ApiService api,
  required Map<String, dynamic> receipt,
  required String orderId,
}) {
  final paymentId = '${receipt['payment_id'] ?? ''}'.trim();
  final initial = '${receipt['print_status'] ?? ''}'.trim().toLowerCase();
  final initialError = '${receipt['print_error'] ?? ''}'.trim();
  if (paymentId.isEmpty) return;
  if (initial == 'printed') {
    AppNotifier.show(
      title: t('Hóa đơn đã in'),
      body: t('Hóa đơn $orderId đã được máy in xác nhận.'),
      osNotify: false,
    );
    return;
  }
  if (initial == 'failed' || initialError.isNotEmpty) {
    AppNotifier.show(
      title: t('Đã thanh toán · in hóa đơn thất bại'),
      body: initialError,
      isError: true,
      osNotify: false,
    );
    return;
  }
  if (!{'pending', 'queued', 'claimed', 'printing'}.contains(initial)) {
    return;
  }
  final rawJobs = receipt['print_job_ids'];
  final jobIds =
      rawJobs is Iterable ? rawJobs.map((value) => '$value') : const <String>[];
  final scope = '${api.baseUrl}|${api.branchId ?? ''}|g${api.authGeneration}';

  AppNotifier.show(
    title: t('Đã thanh toán · đang chờ máy in xác nhận'),
    body: t('Hóa đơn $orderId chưa được xác nhận là đã in.'),
    osNotify: false,
    duration: const Duration(minutes: 10),
  );

  unawaited(ReceiptPrintTracker.instance.start(
    paymentId: paymentId,
    orderId: orderId,
    scope: scope,
    jobIds: jobIds,
    read: () => api.receiptPrintStatus(paymentId),
    onState: (state) {
      switch (state.phase) {
        case ReceiptPrintPhase.queued:
        case ReceiptPrintPhase.claimed:
          return;
        case ReceiptPrintPhase.printed:
          AppNotifier.show(
            title: t('Hóa đơn đã in'),
            body: t('Hóa đơn $orderId đã được máy in xác nhận.'),
            osNotify: false,
          );
          return;
        case ReceiptPrintPhase.failed:
          AppNotifier.show(
            title: t('Đã thanh toán · in hóa đơn thất bại'),
            body: state.error,
            isError: true,
            osNotify: false,
          );
          return;
        case ReceiptPrintPhase.timeout:
          AppNotifier.show(
            title: t('Đã thanh toán · chưa có xác nhận in'),
            body: state.error,
            isError: true,
            osNotify: false,
          );
          return;
      }
    },
  ));
}
