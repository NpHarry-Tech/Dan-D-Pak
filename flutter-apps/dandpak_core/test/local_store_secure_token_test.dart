// BAO MAT: auth_token phai di qua secure storage (Keychain/Keystore), KHONG
// nam trong file JSON thuong — may root/jailbreak hay doc backup app khong
// duoc lay token tran. Fake platform o day thay the kenh native that de test
// khong can chay tren thiet bi.
import 'package:dandpak_core/src/services/local_store.dart';
import 'package:flutter_secure_storage_platform_interface/flutter_secure_storage_platform_interface.dart';
import 'package:flutter_test/flutter_test.dart';

class _FakeSecureStoragePlatform extends FlutterSecureStoragePlatform {
  final Map<String, String> store = {};

  @override
  Future<void> write({
    required String key,
    required String value,
    required Map<String, String> options,
  }) async {
    store[key] = value;
  }

  @override
  Future<String?> read({
    required String key,
    required Map<String, String> options,
  }) async =>
      store[key];

  @override
  Future<bool> containsKey({
    required String key,
    required Map<String, String> options,
  }) async =>
      store.containsKey(key);

  @override
  Future<void> delete({
    required String key,
    required Map<String, String> options,
  }) async {
    store.remove(key);
  }

  @override
  Future<Map<String, String>> readAll({
    required Map<String, String> options,
  }) async =>
      Map<String, String>.from(store);

  @override
  Future<void> deleteAll({required Map<String, String> options}) async {
    store.clear();
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  late _FakeSecureStoragePlatform fakeSecure;

  setUp(() {
    fakeSecure = _FakeSecureStoragePlatform();
    FlutterSecureStoragePlatform.instance = fakeSecure;
  });

  test('auth_token duoc ghi vao secure storage, khong vao file JSON thuong', () async {
    await LocalStore.instance.setString('t::https://x::auth_token', 'secret-abc');
    expect(fakeSecure.store.values, contains('secret-abc'));
    expect(await LocalStore.instance.getString('t::https://x::auth_token'), 'secret-abc');
  });

  test('key khong nhay cam (branch_id) khong dong nao cham toi secure storage', () async {
    await LocalStore.instance.setString('t::https://x::branch_id', 'sala');
    expect(fakeSecure.store, isEmpty);
    expect(await LocalStore.instance.getString('t::https://x::branch_id'), 'sala');
  });

  test('xoa auth_token qua remove() xoa dung khoi secure storage', () async {
    await LocalStore.instance.setString('auth_token', 'legacy-token');
    await LocalStore.instance.remove('auth_token');
    expect(await LocalStore.instance.getString('auth_token'), isNull);
    expect(fakeSecure.store, isEmpty);
  });

  test('removeWhere() cung don duoc key nhay cam trong secure storage', () async {
    await LocalStore.instance.setString('t::https://x::auth_token', 'tok1');
    await LocalStore.instance
        .removeWhere((key) => key.startsWith('t::https://x::'));
    expect(fakeSecure.store, isEmpty);
  });
}
