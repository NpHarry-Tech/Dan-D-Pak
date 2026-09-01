import 'package:dandpak_core/src/api_client.dart';
import 'package:dandpak_core/src/services/connectivity_status.dart';
import 'package:flutter_test/flutter_test.dart';

ApiTrace trace(int status, {String? error}) => ApiTrace(
      method: 'GET',
      path: '/health',
      statusCode: status,
      durationMs: 10,
      error: error,
      exceptionType: status == 0 ? 'SocketException' : null,
    );

void main() {
  test('two consecutive transport failures mark endpoint unreachable', () {
    final status = ConnectivityStatus.createForTesting();
    status.onApiTrace(trace(0, error: 'wan down'));
    expect(status.internetReachable.value, isTrue,
        reason: 'one transient failure must not flicker the whole app');
    status.onApiTrace(trace(0, error: 'wan still down'));
    expect(status.internetReachable.value, isFalse);
  });

  test('any HTTP response restores reachability without hiding HTTP health', () {
    final status = ConnectivityStatus.createForTesting();
    status.onApiTrace(trace(0));
    status.onApiTrace(trace(0));
    status.onApiTrace(trace(503));
    expect(status.internetReachable.value, isTrue);
    expect(status.apiHealthOk.value, isTrue,
        reason: 'one 5xx response is not yet a sustained server incident');
  });

  test('three consecutive 5xx responses mark API unhealthy and success recovers', () {
    final status = ConnectivityStatus.createForTesting();
    status.onApiTrace(trace(500));
    status.onApiTrace(trace(502));
    status.onApiTrace(trace(503));
    expect(status.internetReachable.value, isTrue);
    expect(status.apiHealthOk.value, isFalse);
    status.onApiTrace(trace(200));
    expect(status.apiHealthOk.value, isTrue);
  });

  test('401 invalidates auth while later authorized HTTP restores it', () {
    final status = ConnectivityStatus.createForTesting();
    status.onApiTrace(trace(401));
    expect(status.authValid.value, isFalse);
    status.onApiTrace(trace(200));
    expect(status.authValid.value, isTrue);
  });
}
