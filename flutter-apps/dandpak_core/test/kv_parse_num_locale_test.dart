// kvParseNum phải hiểu ĐÚNG số tiền vi-VN (nhóm nghìn "."). Sự cố 2026-09-04:
// nhập kho từ Excel ra "số tiền vô lý" — một phần vì parser cũ đổi "," -> "."
// rồi num.tryParse, khiến "1.000.000" -> 1.0 và "1.234,56" -> null.
import 'package:flutter_test/flutter_test.dart';
import 'package:dandpak_core/src/screens/warehouse/kv_shared.dart';

void main() {
  test('nhóm nghìn vi-VN đọc đúng (KHÔNG sai 1000 lần)', () {
    expect(kvParseNum('1.000'), 1000);
    expect(kvParseNum('1.000.000'), 1000000);
    expect(kvParseNum('705.997'), 705997);
    expect(kvParseNum('633.705.997.308'), 633705997308);
  });

  test('nhóm nghìn en-US đọc đúng', () {
    expect(kvParseNum('1,000'), 1000);
    expect(kvParseNum('1,000,000'), 1000000);
  });

  test('thập phân cả hai locale', () {
    expect(kvParseNum('4,5'), 4.5); // vi-VN
    expect(kvParseNum('4.5'), 4.5); // en-US
    expect(kvParseNum('0,25'), 0.25);
  });

  test('hỗn hợp: dấu sau cùng là thập phân', () {
    expect(kvParseNum('1.234.567,89'), 1234567.89); // vi
    expect(kvParseNum('1,234,567.89'), 1234567.89); // us
  });

  test('số nguyên thuần từ Excel (toString) giữ nguyên', () {
    expect(kvParseNum('705997'), 705997);
    expect(kvParseNum('633705997308'), 633705997308); // barcode lọt cột: PARSE ok,
    // (việc CHẶN giá trị vô lý là ở tầng kiểm tra preview — xem remediation S8).
  });

  test('ký hiệu tiền tệ / phần trăm được bỏ', () {
    expect(kvParseNum('12.500đ'), 12500);
    expect(kvParseNum('12,5%'), 12.5);
  });

  test('âm giữ dấu', () {
    expect(kvParseNum('-1.000'), -1000);
  });

  test('rỗng / rác trả null (không đoán)', () {
    expect(kvParseNum(''), isNull);
    expect(kvParseNum('   '), isNull);
    expect(kvParseNum('abc'), isNull);
  });
}
