import 'package:dandpak_core/src/models/app_models.dart';
import 'package:dandpak_core/src/screens/launcher_entry_panel.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

AppModule module(String key, {bool visible = true, String status = 'active'}) =>
    AppModule(
      key: key,
      label: key,
      icon: '',
      group: 'test',
      href: '/$key',
      permission: null,
      status: status,
      description: '',
      visible: visible,
    );

void main() {
  test('entry policy is role-aware and never selects a hidden module', () {
    final modules = [
      module('pos'),
      module('retail'),
      module('online'),
      module('kds')
    ];
    expect(preferredSellingModule('cashier', modules)?.key, 'pos');
    expect(preferredSellingModule('kitchen', modules)?.key, 'kds');
    expect(preferredSellingModule('online_manager', modules)?.key, 'online');
    expect(
        preferredSellingModule(
            'cashier', [module('pos', visible: false), module('retail')])?.key,
        'retail');
  });

  testWidgets('shows both entry choices and cashier sales action works',
      (tester) async {
    AppModule? opened;
    await tester.pumpWidget(MaterialApp(
        home: Scaffold(
            body: LauncherEntryPanel(
      role: 'cashier',
      modules: [module('admin'), module('pos'), module('warehouse')],
      onOpen: (value) => opened = value,
    ))));

    expect(find.text('Bán hàng'), findsOneWidget);
    expect(find.text('Quản lý'), findsOneWidget);
    expect(find.text('Ưu tiên'), findsOneWidget);
    await tester.tap(find.byKey(const Key('launcher-entry-sales')));
    expect(opened?.key, 'pos');
    expect(tester.takeException(), isNull);
  });

  testWidgets('wraps on narrow touch layout without overflow', (tester) async {
    tester.view.physicalSize = const Size(360, 640);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(MaterialApp(
        home: SingleChildScrollView(
            child: LauncherEntryPanel(
      role: 'manager',
      modules: [module('admin'), module('retail')],
      onOpen: (_) {},
    ))));
    expect(find.byType(LauncherEntryPanel), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
