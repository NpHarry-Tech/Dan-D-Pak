// GỘP GET ĐANG BAY (single-flight) — sự cố 2026-09-04: GET /api/shifts/current
// bị bấm dồn, mỗi cú bấm bắn một request nặng → chồng chất 4.7–28.7s. coalesceGet
// gộp các lời gọi CÙNG path đang bay thành MỘT request.
import 'dart:async';
import 'package:flutter_test/flutter_test.dart';
import 'package:dandpak_core/src/services/api_service.dart';

void main() {
  test('20 GET cùng path đang bay → chạy đúng MỘT lần, mọi caller cùng kết quả',
      () async {
    final api = ApiService();
    var runs = 0;
    final gate = Completer<dynamic>();
    Future<dynamic> run() {
      runs++;
      return gate.future;
    }

    final futures =
        List.generate(20, (_) => api.coalesceGet('/api/shifts/current', run));
    expect(runs, 1, reason: 'chỉ MỘT request dù 20 lời gọi đồng thời');

    expect(api.coalescedGetRuns, 1);
    expect(api.coalescedGetHits, 19,
        reason: 'request amplification: 20 callers -> 1 request');
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

  test('lỗi cũng dọn bảng → cho phép thử lại, không kẹt future lỗi cũ',
      () async {
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
    expect(runs, 2,
        reason: 'lần 2 phải chạy lại chứ không dùng lại future lỗi');
  });

  test('token/branch/tenant rotation tách future và xóa scope cũ', () async {
    final api = ApiService();
    final oldGate = Completer<dynamic>();
    var runs = 0;
    api.coalesceGet('/same?q=1', () {
      runs++;
      return oldGate.future;
    });

    api.setToken('session-a');
    final tokenFuture = api.coalesceGet('/same?q=1', () async {
      runs++;
      return 'token';
    });
    api.setBranchId('branch-b');
    final branchFuture = api.coalesceGet('/same?q=1', () async {
      runs++;
      return 'branch';
    });
    api.setBaseUrl('https://tenant-b.example');
    final tenantFuture = api.coalesceGet('/same?q=1', () async {
      runs++;
      return 'tenant';
    });

    expect(await tokenFuture, 'token');
    expect(await branchFuture, 'branch');
    expect(await tenantFuture, 'tenant');
    expect(runs, 4);
    oldGate.complete('stale');
  });

  test('query khác nhau không coalesce', () async {
    final api = ApiService();
    var runs = 0;
    final one = api.coalesceGet('/search?q=one', () async => ++runs);
    final two = api.coalesceGet('/search?q=two', () async => ++runs);
    expect(await Future.wait([one, two]), [1, 2]);
  });

  test('equivalent query order coalesces but response locale does not',
      () async {
    final api = ApiService();
    var runs = 0;
    final gate = Completer<dynamic>();
    final one = api.coalesceGet('/search?b=2&a=1', () {
      runs++;
      return gate.future;
    }, representationVariant: 'locale=vi');
    final reordered = api.coalesceGet('/search?a=1&b=2', () {
      runs++;
      return Future.value('must-not-run');
    }, representationVariant: 'locale=vi');
    final english = api.coalesceGet('/search?a=1&b=2', () async {
      runs++;
      return 'en';
    }, representationVariant: 'locale=en');
    expect(runs, 2);
    gate.complete('vi');
    expect(await Future.wait([one, reordered, english]), ['vi', 'vi', 'en']);
  });
}
