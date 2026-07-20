import 'package:dandpak_core/dandpak_core.dart';

import 'app_version.dart';

/// VỎ MỎNG bản PHONE (Android/iOS) — chủ/quản lý theo dõi & duyệt từ xa.
///
/// Cùng lõi `dandpak_core`, bố cục một cột và BỘ MODULE thiên về quản trị:
/// dashboard, liên hệ, chi phí, hoá đơn, kế toán, kho, cơ sở dữ liệu. Sửa
/// `enabledModuleKeys` để đổi số lượng module hiển thị.
Future<void> main(List<String> args) => runDandpakApp(
      args: args,
      flavor: const AppFlavor(
        appId: 'dandpak_phone',
        versionName: kAppVersionName,
        buildNumber: kAppBuildNumber,
        layout: AppLayout.handset,
        enabledModuleKeys: {
          'admin', // dashboard/quản lý
          'retail',
          'contacts',
          'expenses',
          'invoice',
          'accounting',
          'warehouse',
          'database',
          'settings',
        },
      ),
    );
