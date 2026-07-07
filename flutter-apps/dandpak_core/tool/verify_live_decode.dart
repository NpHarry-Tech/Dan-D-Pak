// End-to-end check: fixed client vs the real local engine's large payloads.
// Run: dart run tool/verify_live_decode.dart (server must be on :3000)
import 'package:dandpak_core/dandpak_core.dart';

Future<void> main() async {
  final client = DanDpakApiClient();
  final skus = await client.getJson('/api/skus?channel=retail');
  final menu = await client.getJson('/api/menu');
  print('skus: ${(skus as List).length} items decoded');
  final menuMap = menu as Map;
  print('menu: ${(menuMap['items'] as List).length} items, '
      '${(menuMap['categories'] as List).length} categories decoded');
}
