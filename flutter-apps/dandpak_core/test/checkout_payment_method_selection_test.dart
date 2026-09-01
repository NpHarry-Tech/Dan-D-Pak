import 'package:dandpak_core/src/models/retail_models.dart';
import 'package:dandpak_core/src/screens/retail/checkout_dialog.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('đổi phương thức thay dòng đủ tiền cũ và xóa metadata ngân hàng', () {
    final result = paymentLinesAfterMethodSelection(
      lines: const [
        PaymentLine(
          method: 'bank',
          amount: 500000,
          reference: 'BCMVF01',
          bankTxId: 'tx-old',
          manualReason: 'xác nhận cũ',
        ),
      ],
      previousMethod: 'bank',
      nextMethod: 'cash',
      payable: 500000,
    );

    expect(result, hasLength(1));
    expect(result.single.method, 'cash');
    expect(result.single.amount, 500000);
    expect(result.single.reference, isEmpty);
    expect(result.single.bankTxId, isNull);
    expect(result.single.manualReason, isNull);
  });

  test('quy tắc dùng được cho phương thức mới, không viết cứng bank cash', () {
    final result = paymentLinesAfterMethodSelection(
      lines: const [PaymentLine(method: 'crypto_future', amount: 90000)],
      previousMethod: 'crypto_future',
      nextMethod: 'loyalty_future',
      payable: 90000,
    );
    expect(result.single.method, 'loyalty_future');
  });

  test('giữ nguyên nhiều dòng hoặc dòng trả một phần để hỗ trợ split tender',
      () {
    final partial = paymentLinesAfterMethodSelection(
      lines: const [PaymentLine(method: 'bank', amount: 40000)],
      previousMethod: 'bank',
      nextMethod: 'cash',
      payable: 100000,
    );
    expect(partial.single.method, 'bank');

    final split = paymentLinesAfterMethodSelection(
      lines: const [
        PaymentLine(method: 'voucher', amount: 30000),
        PaymentLine(method: 'bank', amount: 70000),
      ],
      previousMethod: 'bank',
      nextMethod: 'cash',
      payable: 100000,
    );
    expect(split.map((line) => line.method), ['voucher', 'bank']);
  });
}
