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

  // BAO MAT (MITM): go domain/IP CONG KHAI khong kem scheme phai mac dinh
  // https — mac dinh http se gui PIN/don hang qua mang khong ma hoa neu nhan
  // vien go nham IP tran cua server that thay vi domain.
  test('bare domain without scheme defaults to https', () {
    expect(DanDpakApiClient.normalizeBaseUrl('api.dandpakpos.io.vn'),
        'https://api.dandpakpos.io.vn');
  });

  test('bare PUBLIC IP without scheme defaults to https, not http', () {
    expect(DanDpakApiClient.normalizeBaseUrl('42.96.18.70'),
        'https://42.96.18.70');
  });

  test('private LAN IP without scheme still defaults to http (no TLS on LAN)', () {
    expect(DanDpakApiClient.normalizeBaseUrl('192.168.1.50'),
        'http://192.168.1.50:3000');
    expect(DanDpakApiClient.normalizeBaseUrl('10.0.0.5'),
        'http://10.0.0.5:3000');
  });

  test('localhost without scheme still defaults to http', () {
    expect(DanDpakApiClient.normalizeBaseUrl('localhost'),
        'http://localhost:3000');
  });

  test('explicit http:// on a public IP is respected as-is (no LAN port guess)', () {
    expect(DanDpakApiClient.normalizeBaseUrl('http://42.96.18.70'),
        'http://42.96.18.70');
  });

  test('private IP is always forced to http (LAN has no valid TLS cert), port kept', () {
    expect(DanDpakApiClient.normalizeBaseUrl('https://192.168.1.50:9000'),
        'http://192.168.1.50:9000');
  });
}
