// Khoá bất biến cho CHUÔNG món tự-gọi (self-order) — sự cố 2026-09-04:
// "đã confirm món nhưng chuông vẫn kêu lặp lại".
//
// Nguyên nhân gốc (đã truy ra file:line):
//   • server phát LẠI 'order:pending' kèm 'confirmed'/'rejected' khi nhân viên
//     xác nhận/từ chối (server/services/orders.js:430, :477);
//   • client cũ reo trên MỌI 'order:pending' và chỉ dừng khi bấm tay
//     (ring_controller.dart cũ: đếm mù, acknowledge() mới xoá).
//
// Test này khoá hành vi MỚI của RingController: đếm theo KHÓA (dedup) + gỡ theo
// khóa + reconcile về sự thật server. KHÔNG cấu hình baseUrl → _startLoop là
// no-op (không đụng media_kit/nền tảng), chỉ kiểm trạng thái `pending`.
import 'package:flutter_test/flutter_test.dart';
import 'package:dandpak_core/src/services/ring_controller.dart';

void main() {
  final ring = RingController.instance;

  setUp(() {
    // Singleton dùng chung giữa các test → dọn sạch trước mỗi ca.
    ring.acknowledge();
    expect(ring.pending.value, 0);
  });

  test('cùng một đơn tới hai lần (redelivery/reconnect) KHÔNG cộng dồn', () {
    ring.ring('o1');
    ring.ring('o1');
    ring.ring('o1');
    expect(ring.pending.value, 1);
  });

  test('hai đơn khác nhau → đếm 2; gỡ từng đơn → giảm đúng', () {
    ring.ring('o1');
    ring.ring('o2');
    expect(ring.pending.value, 2);
    ring.clear('o1');
    expect(ring.pending.value, 1);
    ring.clear('o2');
    expect(ring.pending.value, 0);
  });

  test('XÁC NHẬN món → clear đúng đơn thì chuông tắt (bug chính)', () {
    ring.ring('o1'); // khách tự gọi → reo
    expect(ring.pending.value, 1);
    // Server phát lại order:pending(confirmed) → client gọi clear('o1').
    ring.clear('o1');
    expect(ring.pending.value, 0, reason: 'confirm phải làm chuông im, không cần bấm tay');
  });

  test('clear đơn không tồn tại thì không sao, không âm', () {
    ring.ring('o1');
    ring.clear('khong-co');
    expect(ring.pending.value, 1);
    ring.clear('o1');
    expect(ring.pending.value, 0);
  });

  test('reconcile kéo về đúng tập việc server đang chờ (reconnect)', () {
    ring.ring('o1');
    ring.ring('o2');
    ring.ring('o3');
    expect(ring.pending.value, 3);
    // Trong lúc rớt mạng, o1 & o3 đã được xử lý ở máy khác. Server còn mỗi o2.
    ring.reconcile(['o2']);
    expect(ring.pending.value, 1);
    ring.reconcile(const <String>[]);
    expect(ring.pending.value, 0);
  });

  test('acknowledge xoá tất cả (bấm chuông xem hết)', () {
    ring.ring('o1');
    ring.ring('o2');
    ring.acknowledge();
    expect(ring.pending.value, 0);
  });

  test('nguồn không có mã (ring rỗng) VẪN reo, không dedup, reconcile giữ lại', () {
    ring.ring(); // ẩn danh #1
    ring.ring(); // ẩn danh #2 — không có mã nên không gộp
    expect(ring.pending.value, 2);
    // reconcile từ server (chỉ biết đơn có mã) KHÔNG được nuốt việc ẩn danh.
    ring.reconcile(['x1']);
    expect(ring.pending.value, 3, reason: '2 ẩn danh + x1');
  });
}
