// SINGLE-FLIGHT cho thao tác GHI (Gate-3). Sự cố 2026-09-04: bấm "Kết ca" nhiều
// lần lúc lag → nhiều request + nhiều modal chồng nhau. singleFlight khoá theo
// hành động: lần bấm sau khi lần trước CHƯA xong bị chặn thay vì gọi lại.
import 'dart:async';
import 'package:flutter_test/flutter_test.dart';
import 'package:dandpak_core/src/providers/pos_provider.dart';
import 'package:dandpak_core/src/services/api_service.dart';

void main() {
  test('bấm dồn cùng hành động → chỉ chạy MỘT lần, lần sau bị chặn', () async {
    final p = PosProvider(apiService: ApiService());
    var runs = 0;
    final gate = Completer<void>();
    Future<void> action() async {
      runs++;
      await gate.future;
    }

    final f1 = p.singleFlight('shift:close', action);
    expect(p.isActionInFlight('shift:close'), true);

    // Cú bấm thứ hai lúc lần đầu chưa xong → bị chặn.
    await expectLater(
        p.singleFlight('shift:close', action), throwsA(isA<Exception>()));
    expect(runs, 1, reason: 'action chỉ được chạy một lần');

    gate.complete();
    await f1;
    expect(p.isActionInFlight('shift:close'), false, reason: 'khoá được thả sau khi xong');
  });

  test('xong rồi thì lần bấm mới chạy lại; lỗi cũng thả khoá', () async {
    final p = PosProvider(apiService: ApiService());
    var runs = 0;

    // Lần 1 lỗi → khoá vẫn phải được thả (finally).
    await expectLater(
      p.singleFlight('shift:close', () async {
        runs++;
        throw Exception('net');
      }),
      throwsA(isA<Exception>()),
    );
    expect(p.isActionInFlight('shift:close'), false);

    // Lần 2 chạy lại bình thường.
    await p.singleFlight('shift:close', () async {
      runs++;
    });
    expect(runs, 2);
  });

  test('hành động KHÁC key không chặn nhau', () async {
    final p = PosProvider(apiService: ApiService());
    final gate = Completer<void>();
    final open = p.singleFlight('shift:open', () => gate.future);
    // Khác key → không bị chặn.
    var closeRan = false;
    await p.singleFlight('shift:close', () async {
      closeRan = true;
    });
    expect(closeRan, true);
    gate.complete();
    await open;
  });
}
