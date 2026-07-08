import 'package:flutter_test/flutter_test.dart';
import 'package:dandpak_pos/services/api_service.dart';
import 'package:dandpak_pos/services/app_updater.dart';
import 'package:dandpak_pos/app_version.dart';

void main() {
  test('AppUpdater.checkForUpdate and getBytes e2e integration test', () async {
    final api = ApiService();
    // Use the local server for integration testing
    api.baseUrl = 'http://127.0.0.1:3000';

    // 1. Check for update
    final updateInfo = await AppUpdater.checkForUpdate(api);
    expect(updateInfo, isNotNull, reason: 'Server has build 2 which is > client build 1');
    expect(updateInfo!.buildNumber, equals(2));
    expect(updateInfo.version, equals('2026.07.07'));
    expect(updateInfo.url, equals('/api/app/download/windows'));

    // 2. Fetch update bytes
    final bytes = await api.getBytes(updateInfo.url);
    expect(bytes, isNotEmpty);
    final text = String.fromCharCodes(bytes);
    expect(text.trim(), equals('Dummy Installer Bytes for E2E Test'));
  });
}
