import 'package:dandpak_core/src/screens/phone/phone_scaffolds.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets(
      'phone history loads subsequent server pages without replacing page one',
      (tester) async {
    final requestedPages = <int>[];
    await tester.pumpWidget(MaterialApp(
      home: PhoneListScaffold<int>(
        title: 'Hóa đơn',
        fetch: (_) async => List<int>.generate(100, (index) => index + 1),
        fetchMore: (_, page) async {
          requestedPages.add(page);
          return page == 2 ? [101, 102] : <int>[];
        },
        pageSize: 100,
        rowBuilder: (_, value, __) => Text('Bill $value'),
      ),
    ));
    await tester.pumpAndSettle();

    expect(find.text('Bill 1'), findsOneWidget);
    await tester.scrollUntilVisible(
      find.text('Xem thêm lịch sử'),
      600,
      scrollable: find.byType(Scrollable).last,
    );
    await tester.ensureVisible(find.text('Xem thêm lịch sử'));
    await tester.pumpAndSettle();
    expect(find.text('Xem thêm lịch sử'), findsOneWidget);
    await tester.tap(find.text('Xem thêm lịch sử'));
    await tester.pumpAndSettle();

    expect(requestedPages, [2]);
    await tester.scrollUntilVisible(
      find.text('Bill 102'),
      300,
      scrollable: find.byType(Scrollable).last,
    );
    expect(find.text('Bill 102'), findsOneWidget);
    await tester.scrollUntilVisible(
      find.text('Bill 1'),
      -600,
      scrollable: find.byType(Scrollable).last,
    );
    expect(find.text('Bill 1'), findsOneWidget);
    expect(find.text('Xem thêm lịch sử'), findsNothing);
  });
}
