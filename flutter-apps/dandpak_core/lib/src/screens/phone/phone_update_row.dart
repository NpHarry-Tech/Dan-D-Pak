import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../app_flavor.dart';
import '../../services/api_service.dart';
import '../../services/app_updater.dart';
import '../../ui/app_theme.dart';
import '../../utils/translation.dart';
import 'phone_kit.dart';

/// MỤC CẬP NHẬT trong màn "Nhiều hơn".
///
/// Trước đây muốn lên bản mới phải gỡ app rồi tải file cài lại bằng tay. Bản
/// desktop đã có nút "Cập nhật ngay" từ lâu (xem LauncherScreen); phần này mang
/// đúng cơ chế đó sang bản điện thoại.
///
/// Ba trạng thái, và mỗi trạng thái nói rõ đang ở đâu:
///   - đang dò            : chưa biết, hiện dòng chờ
///   - đã mới nhất        : nói thẳng, kèm số hiệu bản đang chạy
///   - có bản mới         : nút tải kèm số hiệu và ghi chú của bản đó
class PhoneUpdateRow extends StatefulWidget {
  const PhoneUpdateRow({super.key});

  @override
  State<PhoneUpdateRow> createState() => _PhoneUpdateRowState();
}

class _PhoneUpdateRowState extends State<PhoneUpdateRow> {
  UpdateInfo? _banMoi;
  bool _dangDo = true;
  bool _dangTai = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _do());
  }

  Future<void> _do() async {
    if (mounted) setState(() => _dangDo = true);
    try {
      final info = await AppUpdater.checkForUpdate(context.read<ApiService>());
      if (!mounted) return;
      setState(() {
        _banMoi = info;
        _dangDo = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() => _dangDo = false);
    }
  }

  Future<void> _capNhat() async {
    final info = _banMoi;
    if (info == null || _dangTai) return;
    setState(() => _dangTai = true);
    // KHÔNG hiện phần trăm: getBytes() tải một lần chứ không theo dòng, nên mọi
    // con số đưa ra đều là bịa. Thà một thanh chạy vô định còn hơn một thanh
    // tiến độ nói dối.
    final loi =
        await AppUpdater.downloadAndInstall(context.read<ApiService>(), info);
    if (!mounted) return;
    setState(() => _dangTai = false);
    if (loi != null) {
      appToast(context, loi, isError: true);
    } else {
      // Android: hệ thống mở hộp thoại cài đặt, app vẫn đang chạy phía sau.
      appToast(context, t('Đang mở trình cài đặt — chọn "Cài đặt" để hoàn tất'));
    }
  }

  @override
  Widget build(BuildContext context) {
    final f = AppFlavor.current;
    final coBanMoi = _banMoi != null;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        PhoneSectionTitle(t('Cập nhật')),
        Container(
          margin: const EdgeInsets.fromLTRB(16, 0, 16, 4),
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            color: DanColors.surface,
            border: Border.all(
                color: coBanMoi ? DanColors.brand : DanColors.border),
            borderRadius: BorderRadius.circular(10),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Icon(
                    coBanMoi
                        ? Icons.system_update
                        : Icons.check_circle_outline,
                    size: 20,
                    color: coBanMoi ? DanColors.brand : const Color(0xFF047857),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          _dangDo
                              ? t('Đang kiểm tra bản mới...')
                              : coBanMoi
                                  ? '${t('Có bản mới')} ${_banMoi!.version}'
                                  : t('Đang dùng bản mới nhất'),
                          style: const TextStyle(
                              fontSize: 13.5, fontWeight: FontWeight.w800),
                        ),
                        const SizedBox(height: 2),
                        Text(
                          coBanMoi
                              ? '${t('Bản đang chạy')} ${f.versionName} (build ${f.buildNumber})'
                              : '${f.versionName} (build ${f.buildNumber})',
                          style: const TextStyle(
                              fontSize: 11, color: DanColors.muted),
                        ),
                      ],
                    ),
                  ),
                  if (!_dangDo && !coBanMoi)
                    PhoneIconButton(icon: Icons.refresh, onTap: _do),
                ],
              ),

              // Ghi chú của bản mới — cho người dùng biết bản này sửa gì trước
              // khi tải hơn 100 MB.
              if (coBanMoi && _banMoi!.notes.trim().isNotEmpty) ...[
                const SizedBox(height: 10),
                Text(_banMoi!.notes.trim(),
                    style: const TextStyle(
                        fontSize: 11.5, height: 1.5, color: DanColors.muted)),
              ],

              if (coBanMoi) ...[
                const SizedBox(height: 12),
                if (_dangTai) ...[
                  ClipRRect(
                    borderRadius: BorderRadius.circular(99),
                    child: const LinearProgressIndicator(
                      minHeight: 6,
                      backgroundColor: DanColors.border,
                    ),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    t('Đang tải bản cập nhật (hơn 100 MB), giữ máy nối mạng...'),
                    style: const TextStyle(
                        fontSize: 11.5, fontWeight: FontWeight.w600),
                  ),
                ] else
                  PhoneCta(
                    label: t('Cập nhật ngay'),
                    onPressed: _capNhat,
                  ),
                if (_banMoi!.mandatory) ...[
                  const SizedBox(height: 8),
                  Text(
                      t('Bản này bắt buộc — hãy cập nhật trước khi tiếp tục bán hàng.'),
                      style: const TextStyle(
                          fontSize: 11,
                          fontWeight: FontWeight.w700,
                          color: DanColors.late)),
                ],
              ],
            ],
          ),
        ),
      ],
    );
  }
}
