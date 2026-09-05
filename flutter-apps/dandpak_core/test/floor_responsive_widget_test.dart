import 'package:dandpak_core/src/screens/floor_layout.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

class _FloorProbe extends StatelessWidget {
  const _FloorProbe();

  @override
  Widget build(BuildContext context) => LayoutBuilder(
        builder: (context, constraints) {
          final geometry = FloorViewportGeometry.fromViewport(
            maxWidth: constraints.maxWidth,
            maxHeight: constraints.maxHeight,
            rows: 8,
          );
          Widget table(String id, double x, double y) {
            return Positioned.fromRect(
              rect: geometry.tableRect(x, y),
              child: ColoredBox(key: ValueKey(id), color: Colors.blue),
            );
          }

          final canvas = SizedBox(
            key: const ValueKey('canvas'),
            width: geometry.canvasWidth,
            height: geometry.canvasHeight,
            child: Stack(children: [
              table('table-a', 0, 0),
              table('table-b', 3.25, 2.5),
              table('table-c', 13.5, 7),
            ]),
          );
          return SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: SingleChildScrollView(child: canvas),
          );
        },
      );
}

void main() {
  for (final viewport in <(String, Size)>[
    ('desktop-1366x768', const Size(1366, 768)),
    ('full-hd-1920x1080', const Size(1920, 1080)),
    ('ultrawide-2560x1080', const Size(2560, 1080)),
    ('tablet-portrait', const Size(768, 1024)),
    ('tablet-landscape', const Size(1024, 768)),
  ]) {
    testWidgets('${viewport.$1} preserves every table and grid ratio',
        (tester) async {
      tester.view.physicalSize = viewport.$2;
      tester.view.devicePixelRatio = viewport.$1 == 'tablet-portrait' ? 2 : 1;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(const MaterialApp(home: _FloorProbe()));

      expect(find.byKey(const ValueKey('table-a')), findsOneWidget);
      expect(find.byKey(const ValueKey('table-b')), findsOneWidget);
      expect(find.byKey(const ValueKey('table-c')), findsOneWidget);
      expect(tester.takeException(), isNull);

      final canvas = tester.getTopLeft(find.byKey(const ValueKey('canvas')));
      final a =
          tester.getTopLeft(find.byKey(const ValueKey('table-a'))) - canvas;
      final b =
          tester.getTopLeft(find.byKey(const ValueKey('table-b'))) - canvas;
      final c =
          tester.getTopLeft(find.byKey(const ValueKey('table-c'))) - canvas;
      final cell = (b.dx - a.dx) / 3.25;
      expect(b.dy - a.dy, closeTo(2.5 * cell, .01));
      expect(c.dx - a.dx, closeTo(13.5 * cell, .01));
      expect(c.dy - a.dy, closeTo(7 * cell, .01));
      expect(tester.getSize(find.byKey(const ValueKey('table-a'))).height,
          closeTo(cell - 8, .01));
    });
  }
}
