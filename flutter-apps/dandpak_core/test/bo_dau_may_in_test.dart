// BỎ DẤU TIẾNG VIỆT CHO MÁY IN GẮN LIỀN (máy POS cầm tay).
//
// SỰ CỐ THẬT (04/08/2026): bill in ra "Trà đào" thành "Tra yao", "Độ đậm"
// thành "Yo yam" — mọi chữ `đ` biến thành `y`.
//
// Nguyên nhân: bảng bỏ dấu viết bằng HAI CHUỖI SONG SONG rồi tra theo chỉ số
// (`co[i]` -> `khong[i]`). Hai chuỗi lệch nhau đúng một ký tự (67 so với 68)
// nên mọi chữ sau chỗ lệch bị dịch ô, và `đ` nằm ô cuối nên rơi vào `y`.
// Đếm tay hai chuỗi 67 ký tự là kiểu lỗi không soi ra bằng mắt.
//
// Nay bảng dựng từ Map nhóm-theo-chữ-gốc nên KHÔNG THỂ lệch. Test này chốt lại
// kết quả để lần sau ai sửa bảng cũng bị chặn ngay.
import 'package:dandpak_core/src/services/local_print_agent.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  // Server gửi text tiếng Việt CÓ DẤU; agent bỏ dấu ở bước mã hoá khi tuyến in
  // khai bảng mã 'ascii'. Ta kiểm qua chính đường đó.
  Future<String> inRaChu(String text) async {
    final bytes = await LocalPrintAgent.instance.escposChoTest(text);
    // Lệnh ESC/POS mang tham số là chữ cái ASCII (`ESC a 0`, `ESC t 0`,
    // `GS L`, `ESC G 1`…) nên lọc "mọi byte đọc được" sẽ hốt luôn cả chúng.
    // Phần CHỮ là đoạn liên tiếp DÀI NHẤT — các lệnh luôn bị kẹp giữa byte
    // điều khiển nên chỉ tạo ra những mẩu một, hai ký tự.
    final doan = <String>[];
    final cur = StringBuffer();
    for (final b in bytes) {
      if (b >= 0x20 && b < 0x7f) {
        cur.writeCharCode(b);
      } else {
        if (cur.isNotEmpty) doan.add(cur.toString());
        cur.clear();
      }
    }
    if (cur.isNotEmpty) doan.add(cur.toString());
    doan.sort((a, b) => b.length.compareTo(a.length));
    return doan.isEmpty ? '' : doan.first;
  }

  test('chu Đ/đ KHONG bao gio bien thanh y', () async {
    final ra = await inRaChu('Trà đào - Độ đậm - đường');
    expect(ra, contains('Tra dao'));
    expect(ra, contains('Do dam'));
    expect(ra, contains('duong'));
    expect(ra, isNot(contains('yao')));
    expect(ra, isNot(contains('Yo')));
  });

  test('bo dau dung cho ca sau nhom nguyen am', () async {
    final ra = await inRaChu('ăâđêôơư ÀẢÃÁẠ ỄỆỐỘỰỹ');
    expect(ra, contains('aad'));
    expect(ra, contains('eoou'));
    expect(ra, contains('AAAAA'));
    expect(ra, contains('EEOOU'));
    expect(ra, contains('y'));
  });

  test('so tien va ky tu ASCII giu nguyen', () async {
    final ra = await inRaChu('Tong cong: 25.000d');
    expect(ra, contains('25.000d'));
  });

  test('chu HOA giu nguyen chu HOA sau khi bo dau', () async {
    final ra = await inRaChu('HÓA ĐƠN THANH TOÁN');
    expect(ra, contains('HOA DON THANH TOAN'));
  });

  test('moi chu co dau deu co anh xa — khong chu nao bi nuot', () async {
    const tatCa = 'àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩị'
        'òóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ';
    final ra = await inRaChu(tatCa);
    expect(ra.length, tatCa.length,
        reason: 'bang bo dau thieu ky tu — chu se bi nuot khi in');
    expect(RegExp(r'^[aeiouyd]+$').hasMatch(ra), isTrue,
        reason: 'moi chu phai ve dung nguyen am goc cua no, dang ra: $ra');
  });
}
