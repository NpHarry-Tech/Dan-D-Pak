import 'dart:async';

import 'api_service.dart';
import 'system_log.dart';

/// AGENT IN CHẠY NGAY TRONG APP — dành cho máy POS cầm tay có máy in gắn liền
/// (Sunmi V2, iMin, Landi...).
///
/// Vì sao cần: kiến trúc in hiện tại là server xếp job vào hàng đợi rồi
/// **Hardware Agent trên Windows** lấy về in. Máy cầm tay chạy Android, không có
/// agent đó, nên bill xếp hàng rồi nằm im. Lớp này cho chính app đóng vai trò
/// agent: báo máy in của mình lên, hỏi job, in, rồi báo kết quả.
///
/// Dùng lại TOÀN BỘ phần server đã có — phân giải tuyến, dựng nội dung, độ đậm,
/// cắt giấy, chống job mồ côi. Server đã trả sẵn `text` là chuỗi ESC/POS; máy in
/// gắn liền nhận đúng thứ đó.
///
/// Lớp này KHÔNG biết gì về Sunmi. Bản phone tiêm hàm in thật vào qua [rawPrint]
/// — nhờ vậy `dandpak_core` không kéo theo thư viện chỉ chạy trên Android, và
/// bản desktop Windows vẫn build được.
typedef RawPrint = Future<void> Function(List<int> bytes);
typedef PrinterProbe = Future<bool> Function();

class LocalPrintAgent {
  LocalPrintAgent._();
  static final LocalPrintAgent instance = LocalPrintAgent._();

  /// MÓC CHO BẢN CÓ MÁY IN GẮN LIỀN tự cắm cài đặt của mình vào.
  ///
  /// `dandpak_core` cố ý KHÔNG phụ thuộc thư viện máy in Sunmi (chỉ chạy trên
  /// Android — đưa vào core là bản desktop Windows hết build được). Nên bản
  /// phone gán hàm này trong `main()`, còn bootstrap chỉ gọi nó sau khi đăng
  /// nhập xong. App không có máy in gắn liền thì để nguyên null, không có gì
  /// thay đổi.
  static Future<bool> Function(ApiService api)? boKhoiDong;

  static bool _daThu = false;

  /// Bootstrap gọi sau khi có phiên đăng nhập. Chỉ thử MỘT LẦN mỗi lần chạy app:
  /// dò máy in là thao tác nối dịch vụ hệ thống, gọi lại mỗi lần dựng lại giao
  /// diện sẽ làm giật màn hình.
  static Future<void> khoiDongNeuCo(ApiService api) async {
    if (_daThu || boKhoiDong == null) return;
    _daThu = true;
    try {
      await boKhoiDong!(api);
    } catch (_) {
      // Không có máy in gắn liền thì thôi — app vẫn bán hàng bình thường.
    }
  }

  ApiService? _api;
  RawPrint? _rawPrint;
  PrinterProbe? _probe;
  String _tenMayIn = 'May in tich hop';

  /// Bề ngang giấy của đầu in gắn liền, tính bằng mm. Server dựng phiếu theo con
  /// số này thay vì theo cấu hình chi nhánh — máy cầm tay 58mm và máy để bàn K80
  /// nằm chung một chi nhánh, không thể dùng chung một bề ngang.
  int _beNgangMm = 58;
  Timer? _hen;
  bool _dangChay = false;

  /// Các job đang in dở — chặn in trùng khi một vòng quét chưa xong mà vòng sau
  /// đã tới (mạng cửa hàng chậm là chuyện thường).
  final Set<String> _dangIn = {};

  /// Số lần đã thử của từng job. Job hỏng thật thì bỏ sau vài lần, không quay
  /// vòng vô tận làm nóng máy và tốn pin.
  final Map<String, int> _soLanThu = {};
  static const _toiDaThu = 3;

  bool get dangHoatDong => _hen != null;

  /// Bật agent. Gọi sau khi đăng nhập xong (cần phiên để gọi API).
  ///
  /// [rawPrint] nhận nguyên byte ESC/POS. [probe] trả về máy in có sẵn sàng
  /// không — dùng để BÁO ĐÚNG SỰ THẬT lên server thay vì luôn báo "sẵn sàng".
  void batDau({
    required ApiService api,
    required RawPrint rawPrint,
    PrinterProbe? probe,
    String tenMayIn = 'May in tich hop',
    int beNgangMm = 58,
    Duration nhipQuet = const Duration(seconds: 3),
  }) {
    _api = api;
    _rawPrint = rawPrint;
    _probe = probe;
    _tenMayIn = tenMayIn;
    _beNgangMm = beNgangMm;
    _hen?.cancel();
    // Báo máy in lên ngay, đừng chờ hết một nhịp — nếu không thì tuyến in tự
    // nhận của server chưa biết máy này có máy in và bill đầu tiên sẽ trượt.
    unawaited(_baoMayIn());
    _hen = Timer.periodic(nhipQuet, (_) => unawaited(_motVong()));
  }

  void dungLai() {
    _hen?.cancel();
    _hen = null;
    _dangIn.clear();
    _soLanThu.clear();
  }

  Future<void> _baoMayIn() async {
    final api = _api;
    if (api == null) return;
    try {
      await api.reportAgentPrinters([
        {'Name': _tenMayIn, 'name': _tenMayIn, 'widthMm': _beNgangMm},
      ]);
    } catch (_) {
      // Mất mạng thì thôi, vòng sau báo lại. Không làm ồn nhật ký.
    }
  }

  Future<void> _motVong() async {
    if (_dangChay) return; // vòng trước chưa xong
    _dangChay = true;
    try {
      final api = _api;
      final inRa = _rawPrint;
      if (api == null || inRa == null) return;

      // Báo lại máy in mỗi vòng: server coi máy im lặng là đã tắt app, và sẽ
      // ngừng phát job cho nó.
      await _baoMayIn();

      final jobs = await api.getAgentPendingJobs(limit: 20);
      for (final j in jobs) {
        final id = '${j['id'] ?? ''}';
        if (id.isEmpty || _dangIn.contains(id)) continue;
        if ((_soLanThu[id] ?? 0) >= _toiDaThu) continue;
        _dangIn.add(id);
        unawaited(_inMotJob(api, inRa, id, j).whenComplete(() => _dangIn.remove(id)));
      }
    } catch (_) {
      // Hỏng mạng giữa ca bán hàng là chuyện thường — vòng sau thử lại.
    } finally {
      _dangChay = false;
    }
  }

  Future<void> _inMotJob(
    ApiService api,
    RawPrint inRa,
    String id,
    Map<String, dynamic> job,
  ) async {
    _soLanThu[id] = (_soLanThu[id] ?? 0) + 1;
    try {
      final text = '${job['text'] ?? ''}';
      if (text.isEmpty) throw Exception('Job không có nội dung để in');
      await inRa(_escpos(text, drawer: job['drawer'] == true));
      await api.reportAgentJobResult(id, ok: true);
      _soLanThu.remove(id);
    } catch (e) {
      final loi = e.toString().replaceFirst('Exception: ', '');
      try {
        await api.reportAgentJobResult(id, ok: false, error: loi);
      } catch (_) {/* báo lỗi thất bại thì vòng sau thử lại */}
      // Chỉ ghi nhật ký khi đã hết lượt thử — tránh spam nhật ký vì một lần
      // giấy kẹt tạm thời.
      if ((_soLanThu[id] ?? 0) >= _toiDaThu) {
        SystemLog.log(
          level: 'error',
          source: 'printer',
          eventType: 'local_print_failed',
          title: 'Máy in tích hợp không in được phiếu',
          message: loi,
          action: 'print',
        );
      }
    }
  }

  /// Dựng chuỗi byte ESC/POS. GIỮ ĐỒNG BỘ với `escposBuffer` ở
  /// server/services/printing.js và server/agent.cjs — cùng lệnh, cùng thứ tự.
  ///
  ///   ESC @      khởi tạo
  ///   ESC ! 0    font A, không nhân đôi cao/rộng
  ///   GS  ! 0    cỡ ký tự 1x1  <- lệnh gỡ chữ bị phóng to
  ///   ESC a 0    canh trái (server tự căn giữa bằng dấu cách)
  ///   ESC 2      giãn dòng mặc định
  ///   ESC G 1    in đậm (double-strike) cho nét rõ trên giấy nhiệt
  List<int> _escpos(String text, {bool drawer = false}) {
    return [
      0x1b, 0x40,
      0x1b, 0x21, 0x00,
      0x1d, 0x21, 0x00,
      0x1b, 0x61, 0x00,
      0x1b, 0x32,
      0x1b, 0x47, 0x01,
      ..._ascii(text).codeUnits,
      0x0a, 0x0a, 0x0a,
      if (drawer) ...[0x1b, 0x70, 0x00, 0x19, 0xfa],
      0x1d, 0x56, 0x42, 0x00, // cắt giấy
    ];
  }

  /// Máy in nhiệt chỉ in được ASCII. Bỏ dấu GIỐNG HỆT server (`ascii()` trong
  /// printing.js) — lệch một chút là cùng một bill in ở hai đường ra chữ khác
  /// nhau.
  String _ascii(String s) {
    const co = 'àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡ'
        'ùúụủũưừứựửữỳýỵỷỹ';
    const khong = 'aaaaaaaaaaaaaaaaaeeeeeeeeeeeiiiiiooooooooooooooooo'
        'uuuuuuuuuuuyyyyy';
    final b = StringBuffer();
    for (final ch in s.split('')) {
      final thuong = ch.toLowerCase();
      final i = co.indexOf(thuong);
      if (i >= 0) {
        final thay = khong[i];
        b.write(ch == thuong ? thay : thay.toUpperCase());
      } else if (thuong == 'đ') {
        b.write(ch == 'đ' ? 'd' : 'D');
      } else if (ch.codeUnitAt(0) >= 0x20 && ch.codeUnitAt(0) <= 0x7e ||
          ch == '\n' || ch == '\r' || ch == '\t') {
        b.write(ch);
      }
      // Ký tự lạ khác thì bỏ — máy in sẽ ra ô vuông vô nghĩa.
    }
    return b.toString();
  }

  /// Máy in có thật sự sẵn sàng không (hết giấy, nắp mở...). Dùng cho màn Máy in.
  Future<bool> sanSang() async {
    final p = _probe;
    if (p == null) return _rawPrint != null;
    try {
      return await p();
    } catch (_) {
      return false;
    }
  }
}
