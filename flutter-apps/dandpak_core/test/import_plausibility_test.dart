// FAIL-CLOSED số tiền vô lý khi nhập kho (Gate-6). Sự cố 2026-09-04: mã vạch
// 12–13 số lọt vào cột giá → "633.705.997.308đ" bị nhận. kvImplausibleAmountReason
// phát hiện; KvDocLine.costWarning để preview gắn cờ + chặn commit.
import 'package:flutter_test/flutter_test.dart';
import 'package:dandpak_core/src/screens/warehouse/kv_shared.dart';

void main() {
  group('kvImplausibleAmountReason', () {
    test('giá hợp lý / trống → null', () {
      expect(kvImplausibleAmountReason(50000), isNull);
      expect(kvImplausibleAmountReason(0), isNull);
      expect(kvImplausibleAmountReason(kMaxPlausibleUnitAmount), isNull); // đúng biên
      expect(kvImplausibleAmountReason(null), isNull);
    });
    test('mã vạch / số quá lớn → có lý do', () {
      expect(kvImplausibleAmountReason(633705997308), isNotNull);
      expect(kvImplausibleAmountReason(8938505970123), isNotNull);
      expect(kvImplausibleAmountReason(kMaxPlausibleUnitAmount + 1), isNotNull);
    });
    test('âm → có lý do', () {
      expect(kvImplausibleAmountReason(-1), isNotNull);
    });
  });

  test('KvDocLine.costWarning gắn cờ đơn giá vô lý, bỏ qua giá thường', () {
    final ok = KvDocLine({'name': 'Ca phe'}, 'inventory',
        initialQty: 1, initialCost: 50000);
    expect(ok.costWarning, isNull);

    final bad = KvDocLine({'name': 'Ban loi'}, 'inventory', initialQty: 1);
    bad.cost.text = '633705997308'; // mã vạch lọt vào cột giá
    expect(bad.costWarning, isNotNull);

    ok.dispose();
    bad.dispose();
  });
}
