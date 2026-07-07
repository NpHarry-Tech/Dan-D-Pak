// Repro + verification for the "Illegal argument in isolate message" bug.
//
// OLD pattern: Isolate.run closure created INSIDE an async method → closure
// context retains the async frame (_AsyncCompleter/http.Response) → unsendable.
// NEW pattern: closure created in a top-level sync function → only captures
// the body string.
//
// Run: dart run tool/repro_isolate_fix.dart
import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:dandpak_core/dandpak_core.dart';

Future<void> main() async {
  // Build a >64KB JSON payload like /api/skus (1011 SKUs ≈ 637KB).
  final items = List.generate(
      1200,
      (i) => {
            'id': 'sku_$i',
            'code': 'KV$i',
            'name': 'Sản phẩm test số $i — Dan D Pak retail',
            'price': 125000 + i,
            'vat': 8,
            'group_path': 'Thực phẩm >> Hạt dinh dưỡng',
          });
  final body = jsonEncode(items);
  print('payload bytes: ${body.length} (threshold '
      '${DanDpakApiClient.isolateDecodeThreshold})');
  assert(body.length >= DanDpakApiClient.isolateDecodeThreshold);

  final client = DanDpakApiClient();
  final response = http.Response(body, 200,
      headers: {'content-type': 'application/json; charset=utf-8'});

  // This is exactly the call path POS/Kho/Menu use for every large response.
  final decoded = await client.decodeResponseAsync(response);
  if (decoded is List && decoded.length == 1200) {
    print('OK: large payload decoded in background isolate '
        '(${decoded.length} items).');
  } else {
    print('FAIL: unexpected decode result: ${decoded.runtimeType}');
  }

  // Also exercise the small-payload sync path.
  final small = await client.decodeResponseAsync(http.Response('{"a":1}', 200));
  print(small is Map && small['a'] == 1
      ? 'OK: small payload sync path.'
      : 'FAIL: small payload path broken');
}
