// BAO MAT: auth_token phai di qua secure storage that (Keystore/Keychain) —
// KHONG nam trong file JSON thuong — may root/jailbreak hay doc backup app
// khong duoc lay token tran. dandpak_core khong tu phu thuoc goi
// flutter_secure_storage (chi app tablet/phone moi "cam" no vao qua
// LocalStore.secureRead/secureWrite/... trong main.dart — xem local_store.dart
// de biet ly do: ban Windows cua goi do can component ATL rieng khong co san
// tren may build). Test nay gia lap dung cai "o cam" do bang mot Map thuong.
import 'package:dandpak_core/src/services/local_store.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  late Map<String, String> fakeSecure;

  setUp(() {
    fakeSecure = {};
    LocalStore.secureRead = (key) async => fakeSecure[key];
    LocalStore.secureWrite = (key, value) async => fakeSecure[key] = value;
    LocalStore.secureDelete = (key) async => fakeSecure.remove(key);
    LocalStore.secureKeys = () async => fakeSecure.keys.toSet();
  });

  tearDown(() {
    LocalStore.secureRead = null;
    LocalStore.secureWrite = null;
    LocalStore.secureDelete = null;
    LocalStore.secureKeys = null;
  });

  test('auth_token duoc ghi vao secure storage, khong vao file JSON thuong', () async {
    await LocalStore.instance.setString('t::https://x::auth_token', 'secret-abc');
    expect(fakeSecure.values, contains('secret-abc'));
    expect(await LocalStore.instance.getString('t::https://x::auth_token'), 'secret-abc');
  });

  test('key khong nhay cam (branch_id) khong dong nao cham toi secure storage', () async {
    await LocalStore.instance.setString('t::https://x::branch_id', 'sala');
    expect(fakeSecure, isEmpty);
    expect(await LocalStore.instance.getString('t::https://x::branch_id'), 'sala');
  });

  test('xoa auth_token qua remove() xoa dung khoi secure storage', () async {
    await LocalStore.instance.setString('auth_token', 'legacy-token');
    await LocalStore.instance.remove('auth_token');
    expect(await LocalStore.instance.getString('auth_token'), isNull);
    expect(fakeSecure, isEmpty);
  });

  test('removeWhere() cung don duoc key nhay cam trong secure storage', () async {
    await LocalStore.instance.setString('t::https://x::auth_token', 'tok1');
    await LocalStore.instance
        .removeWhere((key) => key.startsWith('t::https://x::'));
    expect(fakeSecure, isEmpty);
  });

  test('khong "cam" secure storage (vd desktop) thi auth_token o nguyen JSON thuong', () async {
    // dandpak_desktop khong goi LocalStore.secureWrite = ... trong main.dart —
    // mo phong dung tinh huong do bang cach KHONG gan gi (null, nhu mac dinh).
    LocalStore.secureRead = null;
    LocalStore.secureWrite = null;
    LocalStore.secureDelete = null;
    LocalStore.secureKeys = null;
    await LocalStore.instance.setString('t::desktop::auth_token', 'plain-on-desktop');
    expect(fakeSecure, isEmpty,
        reason: 'chua cam secure storage thi khong the nao ghi vao do duoc');
    expect(await LocalStore.instance.getString('t::desktop::auth_token'),
        'plain-on-desktop');
  });
}
