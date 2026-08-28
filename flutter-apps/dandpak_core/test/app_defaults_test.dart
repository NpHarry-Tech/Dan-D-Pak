import 'package:dandpak_core/src/app_defaults.dart';
import 'package:dandpak_core/src/api_client.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('fresh install never points to a non-running localhost engine', () {
    expect(DanDpakDefaults.baseUrl, startsWith('http'));
    expect(Uri.parse(DanDpakDefaults.baseUrl).host, isNot('localhost'));
    expect(Uri.parse(DanDpakDefaults.baseUrl).host, isNot('127.0.0.1'));
  });

  test('low-level API client cannot silently fall back to localhost', () {
    final client = DanDpakApiClient();
    expect(client.baseUrl, DanDpakDefaults.prodBaseUrl);
    expect(
      DanDpakApiClient.normalizeBaseUrl(''),
      DanDpakDefaults.prodBaseUrl,
    );
  });
}
