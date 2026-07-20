import 'package:dandpak_core/dandpak_core.dart';

import 'app_version.dart';

/// VỎ MỎNG bản TABLET (Android/iOS) — máy cầm tay tại bàn.
///
/// Cùng lõi `dandpak_core` với desktop, nhưng bố cục cảm ứng và BỘ MODULE gọn
/// hơn (thiên về gọi món / bếp / kho nhanh). Sửa `enabledModuleKeys` để đổi số
/// lượng module hiển thị.
Future<void> main(List<String> args) => runDandpakApp(
      args: args,
      flavor: const AppFlavor(
        appId: 'dandpak_tablet',
        versionName: kAppVersionName,
        buildNumber: kAppBuildNumber,
        layout: AppLayout.tablet,
        enabledModuleKeys: {
          'admin', // Quản lý: dashboard, báo cáo, xem tình trạng (thêm cho tablet)
          'pos', // gọi món tại bàn
          'retail',
          'ipad', // khách tự gọi món (kiosk)
          'kds', // màn bếp/bar
          'online', // đơn Grab/Shopee
          'warehouse', // kiểm/nhập-xuất kho nhanh
          'inventory',
          'contacts',
          'printing',
          'settings',
        },
      ),
    );
