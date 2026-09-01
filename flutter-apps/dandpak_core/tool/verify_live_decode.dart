// End-to-end decode check against an explicitly selected test server.
// Run: dart run tool/verify_live_decode.dart -- http://127.0.0.1:3000
import 'package:dandpak_core/dandpak_core.dart';

Future<void> main(List<String> args) async {
  if (args.length != 1) {
    throw ArgumentError(
      'Pass exactly one explicit test server URL; production is never implied.',
    );
  }
  final client = DanDpakApiClient(baseUrl: args.single);
  final skus = await client.getJson('/api/skus?channel=retail');
  final menu = await client.getJson('/api/menu');
  print('skus: ${(skus as List).length} items decoded');
  final menuMap = menu as Map;
  print('menu: ${(menuMap['items'] as List).length} items, '
      '${(menuMap['categories'] as List).length} categories decoded');
}
