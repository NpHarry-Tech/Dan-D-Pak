import 'package:dandpak_core/src/models/app_models.dart';
import 'package:dandpak_core/src/screens/launcher_screen.dart';
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

  test('sellFirstModules đưa module bán hàng lên trước, module quản trị sau',
      () {
    final ordered = sellFirstModules('cashier', [
      module('warehouse'),
      module('pos'),
      module('contacts'),
      module('retail'),
    ]);
    expect(ordered.map((m) => m.key).toList(), ['pos', 'retail', 'warehouse', 'contacts']);
  });
}
