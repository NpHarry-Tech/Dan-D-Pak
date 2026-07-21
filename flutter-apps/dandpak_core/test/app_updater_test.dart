import 'package:flutter_test/flutter_test.dart';
import 'package:dandpak_core/src/services/api_service.dart';
import 'package:dandpak_core/src/services/app_updater.dart';

// Test TÍCH HỢP: cần server local đang chạy ở cổng 3000 và đã publish bản
// release build 2 (xem deploy/publish-release.ps1). Mặc định BỎ QUA để
// `flutter test` luôn xanh trên máy dev; chạy thật bằng:
//   flutter test --dart-define=E2E=true test/app_updater_test.dart
void main() {
  test('update notification follows the device language', () {
    const info = UpdateInfo(
      buildNumber: 30,
      version: '2026.07.21.3',
      notes: '',
      url: '/update.apk',
      mandatory: false,
    );
    expect(AppUpdater.notificationBody(info, localeName: 'vi_VN'),
        contains('cập nhật mới số "2026.07.21.3"'));
    expect(AppUpdater.notificationBody(info, localeName: 'en_US'),
        contains('update "2026.07.21.3"'));
  });

  const runE2e = bool.fromEnvironment('E2E');
  test('AppUpdater.checkForUpdate and getBytes e2e integration test', () async {
    final api = ApiService();
    // Use the local server for integration testing
    api.baseUrl = 'http://127.0.0.1:3000';

    // 1. Check for update
    final updateInfo = await AppUpdater.checkForUpdate(api);
    expect(updateInfo, isNotNull,
        reason: 'Server has build 2 which is > client build 1');
    expect(updateInfo!.buildNumber, equals(2));
    expect(updateInfo.version, equals('2026.07.07'));
    expect(updateInfo.url, equals('/api/app/download/windows'));

    // 2. Fetch update bytes
    final bytes = await api.getBytes(updateInfo.url);
    expect(bytes, isNotEmpty);
    final text = String.fromCharCodes(bytes);
    expect(text.trim(), equals('Dummy Installer Bytes for E2E Test'));
  },
      skip: runE2e
          ? false
          : 'Cần server local :3000 + release build 2 — chạy với --dart-define=E2E=true');
}
