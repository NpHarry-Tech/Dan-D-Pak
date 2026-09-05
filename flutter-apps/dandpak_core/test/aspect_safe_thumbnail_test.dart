import 'package:dandpak_core/src/ui/aspect_safe_thumbnail.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('logo/photo contracts stay centered and constrained',
      (tester) async {
    const image = AssetImage('assets/brand/logo.png');
    await tester.pumpWidget(const MaterialApp(
      home: Row(children: [
        AspectSafeThumbnail(
          key: ValueKey('portrait'),
          width: 40,
          height: 80,
          image: image,
          fallback: Icon(Icons.broken_image),
        ),
        AspectSafeThumbnail(
          key: ValueKey('landscape'),
          width: 100,
          height: 40,
          image: image,
          fallback: Icon(Icons.broken_image),
        ),
        AspectSafeThumbnail(
          key: ValueKey('square-photo'),
          width: 60,
          height: 60,
          image: image,
          kind: ThumbnailKind.photo,
          fallback: Icon(Icons.broken_image),
        ),
      ]),
    ));
    expect(tester.getSize(find.byKey(const ValueKey('portrait'))),
        const Size(40, 80));
    expect(tester.getSize(find.byKey(const ValueKey('landscape'))),
        const Size(100, 40));
    final images = tester.widgetList<Image>(find.byType(Image)).toList();
    expect(images[0].fit, BoxFit.contain);
    expect(images[1].fit, BoxFit.contain);
    expect(images[2].fit, BoxFit.cover);
    expect(images.every((item) => item.alignment == Alignment.center), isTrue);
  });

  testWidgets('missing image renders the explicit fallback', (tester) async {
    await tester.pumpWidget(const MaterialApp(
      home: AspectSafeThumbnail(
        width: 50,
        height: 50,
        fallback: Text('missing'),
      ),
    ));
    expect(find.text('missing'), findsOneWidget);
    expect(find.byType(Image), findsNothing);
  });
}
