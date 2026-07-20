import 'package:dandpak_core/dandpak_core.dart';

import 'app_version.dart';

/// VỎ MỎNG bản DESKTOP (Windows/Linux/macOS).
///
/// Toàn bộ logic (models, providers, screens, services, ui, widgets, khởi động)
/// sống trong `dandpak_core`. Ở đây chỉ khai báo "vị" của máy này: định danh,
/// phiên bản, bố cục quầy và BỘ MODULE.
Future<void> main(List<String> args) => runDandpakApp(
      args: args,
      flavor: const AppFlavor(
        appId: 'dandpak_desktop',
        versionName: kAppVersionName,
        buildNumber: kAppBuildNumber,
        layout: AppLayout.station,
        // Desktop = quầy đầy đủ: hiện TẤT CẢ module theo quyền (null = không lọc).
        enabledModuleKeys: null,
      ),
    );
