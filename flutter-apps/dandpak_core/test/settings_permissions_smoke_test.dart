import 'package:dandpak_core/src/screens/management/settings_users_panel.dart';
import 'package:dandpak_core/src/services/api_service.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

/// Giả lập server ở tầng HTTP, KHÔNG override từng hàm nghiệp vụ.
///
/// Trước đây fake này `@override getSettingsUsers()` / `getPermissions()`. Cách
/// đó ngừng hoạt động khi ApiService được tách thành các `extension` (xem
/// services/api/*.dart): phương thức extension trong Dart được nối TĨNH theo
/// kiểu khai báo, KHÔNG phải virtual — nên bản override không bao giờ được gọi,
/// panel vẫn đi gọi HTTP thật (trong widget test luôn trả 400), màn hình rỗng và
/// `find.text('Sửa')` không thấy gì → test chết bằng "Bad state: No element".
///
/// `getJson` là method thường của DanDpakApiClient nên override được. Chặn ở đó
/// vừa đúng chỗ, vừa không phụ thuộc việc hàm nghiệp vụ nằm trong class hay
/// extension — refactor sau này không làm test âm thầm mất tác dụng nữa.
class _FakeApi extends ApiService {
  @override
  Future<dynamic> getJson(
    String path, {
    Duration timeout = const Duration(seconds: 30),
    String? errorMessage,
  }) async {
    if (path.startsWith('/api/settings/users')) return <dynamic>[];
    if (path.startsWith('/api/settings/permissions')) {
      return {
        'catalog': [
          {'key': 'module.pos'},
          {'key': 'sell'},
          {'key': 'pay'},
          {'key': 'settings.manage'},
        ],
        // Contract hiện tại trả role objects (không còn map role -> perms).
        'roles': [
          {
            'key': 'manager',
            'label': 'Quản lý',
            'perms': ['module.pos', 'sell'],
            'custom': false,
          },
        ],
      };
    }
    return <dynamic>[];
  }
}

void main() {
  testWidgets('permission editor fits narrow sheets without ListTile errors',
      (tester) async {
    await tester.binding.setSurfaceSize(const Size(560, 800));
    addTearDown(() => tester.binding.setSurfaceSize(null));

    await tester.pumpWidget(MaterialApp(home: UsersPanel(api: _FakeApi())));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Sửa').first);
    await tester.pumpAndSettle();

    expect(find.byType(CheckboxListTile), findsWidgets);
    expect(tester.takeException(), isNull);
  });
}
