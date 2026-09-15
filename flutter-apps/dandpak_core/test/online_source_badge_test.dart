import 'package:dandpak_core/src/screens/online/online_shared.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('order source shows platform and shop without TikTok music-note UI',
      (tester) async {
    await tester.pumpWidget(const MaterialApp(
      home: Scaffold(
        body: SizedBox(
          width: 150,
          child: ProviderBadge('tiktokshop',
              shop: 'Dan D Pak Official Store With A Long Name'),
        ),
      ),
    ));
    await tester.pumpAndSettle();

    expect(find.textContaining('TikTok Shop · Dan D Pak Official'), findsOneWidget);
    expect(find.byIcon(Icons.music_note), findsNothing);
    expect(
        find.byWidgetPredicate(
            (widget) => widget is Text && (widget.data ?? '').contains('♪')),
        findsNothing);
    expect(tester.takeException(), isNull,
        reason: 'the source badge must not overflow a phone-width card');
  });

  testWidgets('missing partner logo uses a neutral provider fallback',
      (tester) async {
    await tester.pumpWidget(const MaterialApp(
      home: ProviderLogo('partner-without-asset'),
    ));
    expect(find.byIcon(Icons.public), findsOneWidget);
  });
}
