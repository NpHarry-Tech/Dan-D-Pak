import 'package:dandpak_core/src/app_flavor.dart';
import 'package:dandpak_core/src/widgets/build_diagnostics_card.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('normal production diagnostics exposes only app/version/build',
      (tester) async {
    final previous = AppFlavor.current;
    AppFlavor.current = const AppFlavor(
      appId: 'dandpak_test',
      versionName: '9.8.7',
      buildNumber: 654,
    );
    try {
      await tester.pumpWidget(const MaterialApp(
        home: Scaffold(
          body: BuildDiagnosticsCard(
            apiBaseUrl: 'https://api.example.test?token=must-not-render',
          ),
        ),
      ));
      expect(find.text('Thông tin ứng dụng'), findsOneWidget);
      expect(find.text('dandpak_test'), findsOneWidget);
      expect(find.text('9.8.7'), findsOneWidget);
      expect(find.text('654'), findsOneWidget);
      for (final forbidden in [
        'Git',
        'Git commit',
        'Source SHA-256',
        'Build UTC',
        'API host',
        'API endpoint',
        'Device ID',
        'Schema target',
        'Chẩn đoán nâng cao',
      ]) {
        expect(find.text(forbidden), findsNothing);
      }
      expect(find.textContaining('must-not-render'), findsNothing);
    } finally {
      AppFlavor.current = previous;
    }
  });

  testWidgets('authorized admin must explicitly open redacted diagnostics',
      (tester) async {
    await tester.pumpWidget(const MaterialApp(
      home: Scaffold(
        body: BuildDiagnosticsCard(
          apiBaseUrl: 'https://API.EXAMPLE.TEST/path?token=hidden',
          allowAdvanced: true,
        ),
      ),
    ));
    expect(find.text('API host'), findsNothing);
    await tester.tap(find.text('Chẩn đoán nâng cao'));
    await tester.pumpAndSettle();
    expect(find.text('API host'), findsOneWidget);
    expect(find.text('api.example.test'), findsOneWidget);
    expect(find.textContaining('token='), findsNothing);
    expect(find.text('Source SHA-256'), findsNothing);
    expect(find.text('Schema target'), findsNothing);
  });

  test('diagnostic policy requires role and permission', () {
    expect(
        canViewAdvancedDiagnostics(
            role: 'owner', hasDiagnosticsPermission: true),
        isTrue);
    expect(
        canViewAdvancedDiagnostics(
            role: 'admin', hasDiagnosticsPermission: true),
        isTrue);
    expect(
        canViewAdvancedDiagnostics(
            role: 'cashier', hasDiagnosticsPermission: true),
        isFalse);
    expect(
        canViewAdvancedDiagnostics(
            role: 'admin', hasDiagnosticsPermission: false),
        isFalse);
  });

  test('advanced identifiers are shortened/masked', () {
    expect(shortGitSha('5208475af156ea63962ebe36fe4131f49fcca05e'), '5208475a');
    expect(maskedDiagnosticId('dev_msd2gzoj7kbs0'), '••••••j7kbs0');
    expect(
        diagnosticEndpointHost('https://api.test/x?token=secret'), 'api.test');
  });
}
