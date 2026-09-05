// SINGLE-FLIGHT cho thao tác GHI (Gate-3). Sự cố 2026-09-04: bấm "Kết ca" nhiều
// lần lúc lag → nhiều request + nhiều modal chồng nhau. singleFlight khoá theo
// hành động: lần bấm sau khi lần trước CHƯA xong bị chặn thay vì gọi lại.
import 'dart:async';
import 'package:flutter_test/flutter_test.dart';
import 'package:dandpak_core/src/api_client.dart';
import 'package:dandpak_core/src/providers/pos_provider.dart';
import 'package:dandpak_core/src/services/api_service.dart';

class _ShiftApi extends ApiService {
  final closeGate = Completer<dynamic>();
  int closeCalls = 0;
  int reads = 0;

  @override
  Future<dynamic> postJson(
    String path, {
    Object? body,
    Duration timeout = DanDpakApiClient.defaultTimeout,
    String? errorMessage,
  }) async {
    if (path == '/api/shifts/close') {
      closeCalls++;
      return closeGate.future;
    }
    return <String, dynamic>{};
  }

  @override
  Future<dynamic> getJson(
    String path, {
    Duration timeout = DanDpakApiClient.defaultTimeout,
    String? errorMessage,
  }) async {
    reads++;
    return <String, dynamic>{'shift': null};
  }
}

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
    expect(p.isActionInFlight('shift:close'), false,
        reason: 'khoá được thả sau khi xong');
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

  test('50 close đồng thời chỉ gửi một mutation; đổi session bỏ response cũ',
      () async {
    final api = _ShiftApi();
    final p = PosProvider(apiService: api);
    final attempts = List.generate(
      50,
      (_) => p
          .closeShiftCounts(
            shiftKey: 'morning',
            counts: const {},
            closingCash: 0,
          )
          .then<Object?>((_) => null, onError: (Object e) => e),
    );
    expect(api.closeCalls, 1);
    api.setBranchId('new-branch');
    api.closeGate.complete(<String, dynamic>{'ok': true});
    await Future.wait(attempts);
    expect(api.closeCalls, 1);
    expect(api.reads, 0,
        reason: 'response thuộc branch/session cũ không reload state mới');
  });

  test('dispose khi close đang bay không áp state muộn và cleanup an toàn',
      () async {
    final api = _ShiftApi();
    final p = PosProvider(apiService: api);
    final close = p.closeShiftCounts(
      shiftKey: 'morning',
      counts: const {},
      closingCash: 0,
    );
    p.dispose();
    api.closeGate.complete(<String, dynamic>{'ok': true});
    await close;
    expect(api.reads, 0);
    await expectLater(
      p.singleFlight<void>('after-dispose', () async {}),
      throwsStateError,
    );
  });
}
