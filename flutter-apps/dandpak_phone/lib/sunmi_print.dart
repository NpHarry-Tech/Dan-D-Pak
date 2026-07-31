import 'package:dandpak_core/dandpak_core.dart';
import 'package:sunmi_printer_plus/sunmi_printer_plus.dart';

/// MÁY IN GẮN LIỀN TRÊN MÁY POS CẦM TAY (Sunmi V2 và họ hàng).
///
/// Máy cầm tay in qua DỊCH VỤ RIÊNG của Sunmi, không qua spooler Windows cũng
/// không qua cổng LAN — nên Hardware Agent trên Windows không với tới được. Ở
/// đây app tự đóng vai trò agent: hỏi phiếu, in, báo kết quả.
///
/// Chỉ nhận NGUYÊN BYTE ESC/POS mà server đã dựng sẵn, không tự vẽ lại nội dung.
/// Nhờ vậy bill in ra từ máy cầm tay giống hệt bill in từ máy POS để bàn — cùng
/// một nguồn dựng, không có hai bố cục lệch nhau.
class SunmiPrint {
  /// Máy này có máy in Sunmi không. Máy điện thoại thường sẽ trả về false và
  /// agent không được bật — không có gì hỏng, chỉ là không in tại chỗ.
  static Future<bool> coMayIn() async {
    try {
      final tt = await SunmiConfig.getStatus();
      return tt != null && tt.trim().isNotEmpty;
    } catch (_) {
      return false; // không phải máy Sunmi, hoặc dịch vụ in chưa chạy
    }
  }

  /// Máy in đang dùng được không (còn giấy, nắp đóng, không kẹt).
  ///
  /// Sunmi trả về chuỗi trạng thái; coi là SẴN SÀNG khi không thấy dấu hiệu lỗi.
  /// Thà báo chưa sẵn sàng còn hơn báo bừa rồi phiếu nằm chờ mà thu ngân tưởng
  /// đã in — đúng lỗi đã gặp với máy in để bàn.
  static Future<bool> sanSang() async {
    try {
      final tt = (await SunmiConfig.getStatus() ?? '').toLowerCase();
      if (tt.isEmpty) return false;
      const dauHieuLoi = ['error', 'abnormal', 'out of paper', 'nopaper',
                          'cover', 'overheat', 'fault'];
      return !dauHieuLoi.any(tt.contains);
    } catch (_) {
      return false;
    }
  }

  /// Gửi nguyên byte ESC/POS xuống đầu in.
  ///
  /// DÙNG `printEscPos`, KHÔNG dùng `printRawData`: hàm kia đã lỗi thời và thân
  /// hàm chỉ có `return null` — gọi nó thì giấy không ra mà cũng chẳng báo lỗi,
  /// đúng kiểu hỏng im lặng khó lần nhất.
  static Future<void> inTho(List<int> bytes) async {
    await SunmiPrinter.printEscPos(bytes);
  }

  /// Bật agent in trong app nếu máy này thật sự có máy in gắn liền.
  /// Trả về true khi đã bật.
  static Future<bool> batNeuCo(ApiService api) async {
    if (!await coMayIn()) return false;
    LocalPrintAgent.instance.batDau(
      api: api,
      rawPrint: inTho,
      probe: sanSang,
      tenMayIn: 'May in tich hop',
    );
    return true;
  }
}
