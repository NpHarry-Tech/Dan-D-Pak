import 'package:dandpak_core/src/api_client.dart';
import 'package:dandpak_core/src/providers/pos_provider.dart';
import 'package:dandpak_core/src/screens/shift_dialog.dart';
import 'package:dandpak_core/src/services/api_service.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';

class _FakeApi extends ApiService {
  @override
  Future<dynamic> getJson(
    String path, {
    Duration timeout = DanDpakApiClient.defaultTimeout,
    String? errorMessage,
  }) async {
    if (path == '/api/shifts/current') {
      return <String, dynamic>{
        'shift': null,
        'config': <String, dynamic>{
          'labels': [
            {'key': 'morning', 'label': 'Ca sáng'}
          ],
          'denominations': <int>[1000],
        },
        'report': <String, dynamic>{},
        'day_report': <String, dynamic>{},
      };
    }
    return <String, dynamic>{};
  }
}

void main() {
  testWidgets('50 lần mở đồng thời chỉ tạo một ShiftDialog route',
      (tester) async {
    final pos = PosProvider(apiService: _FakeApi());
    late BuildContext host;
    await tester.pumpWidget(
      ChangeNotifierProvider.value(
        value: pos,
        child: MaterialApp(
          home: Builder(builder: (context) {
            host = context;
            return const Scaffold(body: Text('host'));
          }),
        ),
      ),
    );

    final futures = List.generate(50, (_) => ShiftDialog.show(host));
    expect(ShiftDialog.routeOpen, isTrue);
    await tester.pump();
    expect(find.byType(ShiftDialog), findsOneWidget);

    Navigator.of(host, rootNavigator: true).pop();
    await tester.pumpAndSettle();
    await Future.wait(futures);
    expect(ShiftDialog.routeOpen, isFalse);
    pos.dispose();
  });
}
