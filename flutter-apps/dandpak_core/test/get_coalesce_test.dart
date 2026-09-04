// GỘP GET ĐANG BAY (single-flight) — sự cố 2026-09-04: GET /api/shifts/current
// bị bấm dồn, mỗi cú bấm bắn một request nặng → chồng chất 4.7–28.7s. coalesceGet
// gộp các lời gọi CÙNG path đang bay thành MỘT request.
import 'dart:async';
import 'package:flutter_test/flutter_test.dart';
import 'package:dandpak_core/src/services/api_service.dart';

void main() {
  test('20 GET cùng path đang bay → chạy đúng MỘT lần, mọi caller cùng kết quả', () async {
    final api = ApiService();
    var runs = 0;
    final gate = Completer<dynamic>();
    Future<dynamic> run() {
      runs++;
      return gate.future;
    }

    final futures = List.generate(20, (_) => api.coalesceGet('/api/shifts/current', run));
    expect(runs, 1, reason: 'chỉ MỘT request dù 20 lời gọi đồng thời');

    gate.complete({'ok': true});
    final results = await Future.wait(futures);
    for (final r in results) {
      expect(r, {'ok': true});
    }

    // Xong rồi → lời gọi mới phải bắn request MỚI.
    final gate2 = Completer<dynamic>();
    final f2 = api.coalesceGet('/api/shifts/current', () {
      runs++;
      return gate2.future;
    });
    expect(runs, 2);
    gate2.complete({'ok': 2});
    expect(await f2, {'ok': 2});
  });

  test('path KHÁC nhau KHÔNG gộp', () async {
    final api = ApiService();
    var a = 0, b = 0;
    final ga = Completer<dynamic>(), gb = Completer<dynamic>();
    api.coalesceGet('/a', () {
      a++;
      return ga.future;
    });
    api.coalesceGet('/b', () {
      b++;
      return gb.future;
    });
    expect(a, 1);
    expect(b, 1);
    ga.complete(1);
    gb.complete(2);
  });

  test('lỗi cũng dọn bảng → cho phép thử lại, không kẹt future lỗi cũ', () async {
    final api = ApiService();
    var runs = 0;
    await expectLater(
      api.coalesceGet('/x', () {
        runs++;
        return Future<dynamic>.error(Exception('net'));
      }),
      throwsA(isA<Exception>()),
    );
    final ok = await api.coalesceGet('/x', () {
      runs++;
      return Future.value('ok');
    });
    expect(ok, 'ok');
    expect(runs, 2, reason: 'lần 2 phải chạy lại chứ không dùng lại future lỗi');
  });
}
