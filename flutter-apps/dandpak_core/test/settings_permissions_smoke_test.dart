import 'package:dandpak_core/src/screens/management/settings_users_panel.dart';
import 'package:dandpak_core/src/services/api_service.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

class _FakeApi extends ApiService {
  @override
  Future<List<dynamic>> getSettingsUsers() async => [];

  @override
  Future<Map<String, dynamic>> getPermissions() async => {
        'catalog': [
          {'key': 'module.pos'},
          {'key': 'sell'},
          {'key': 'pay'},
          {'key': 'settings.manage'},
        ],
        'roles': {
          'manager': ['module.pos', 'sell'],
        },
      };
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
