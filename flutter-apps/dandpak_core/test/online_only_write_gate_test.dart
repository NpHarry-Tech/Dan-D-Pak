// ONLINE-ONLY (owner 2026-08-26): cổng ghi tiền/hàng. Server là nguồn dữ liệu
// duy nhất; mất kết nối ⇒ CHẶN thao tác, KHÔNG chốt/queue local.
import 'package:dandpak_core/src/services/connectivity_status.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('mặc định online: cho phép ghi', () {
    final cs = ConnectivityStatus.createForTesting();
    expect(cs.canMutate, true);
    expect(cs.writeBlockReason, isNull);
  });

  test('mất đường truyền ⇒ chặn ghi + lý do rõ', () {
    final cs = ConnectivityStatus.createForTesting();
    cs.internetReachable.value = false;
    expect(cs.canMutate, false);
    expect(cs.writeBlockReason, 'Mất kết nối máy chủ');
  });

  test('server ốm (5xx liên tục) ⇒ chặn ghi', () {
    final cs = ConnectivityStatus.createForTesting();
    cs.apiHealthOk.value = false;
    expect(cs.canMutate, false);
    expect(cs.writeBlockReason, 'Máy chủ đang gặp sự cố');
  });

  test('hết phiên (401) ⇒ chặn ghi', () {
    final cs = ConnectivityStatus.createForTesting();
    cs.authValid.value = false;
    expect(cs.canMutate, false);
    expect(cs.writeBlockReason, 'Phiên đăng nhập đã hết hạn');
  });

  test('BLIP socket realtime KHÔNG được chặn bán hàng (HTTP vẫn sống)', () {
    final cs = ConnectivityStatus.createForTesting();
    cs.socketConnected.value = false;
    expect(cs.canMutate, true,
        reason: 'socket không thuộc cổng ghi — mutation đi qua HTTP');
    expect(cs.writeBlockReason, isNull);
  });
}
