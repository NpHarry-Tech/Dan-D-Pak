import 'package:dandpak_core/dandpak_core.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import 'app_version.dart';

/// VỎ MỎNG bản TABLET (Android/iOS) — máy cầm tay tại bàn.
///
/// Cùng lõi `dandpak_core` với desktop, nhưng bố cục cảm ứng và BỘ MODULE gọn
/// hơn (thiên về gọi món / bếp / kho nhanh). Sửa `enabledModuleKeys` để đổi số
/// lượng module hiển thị.
Future<void> main(List<String> args) {
  // Cắm secure storage thật cho auth_token (Keystore Android/Keychain iOS) —
  // dandpak_core không tự phụ thuộc gói này (xem local_store.dart) nên phải
  // gán ở đây trước khi app khởi động.
  const secure = FlutterSecureStorage();
  LocalStore.secureRead = (key) => secure.read(key: key);
  LocalStore.secureWrite = (key, value) => secure.write(key: key, value: value);
  LocalStore.secureDelete = (key) => secure.delete(key: key);
  LocalStore.secureKeys = () async => (await secure.readAll()).keys.toSet();
  return runDandpakApp(
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
          'catalogue', // màn khách bán lẻ ngoài quầy — CHỈ tablet mới có
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
}
