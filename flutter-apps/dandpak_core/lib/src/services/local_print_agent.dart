import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart' show visibleForTesting;

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
        unawaited(
            _inMotJob(api, inRa, id, j).whenComplete(() => _dangIn.remove(id)));
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
      await inRa(await _escpos(text,
          drawer: job['drawer'] == true,
          density: job['density'],
          charset: '${job['charset'] ?? 'utf8'}',
          fontScale: job['fontScale'],
          buzzer: job['buzzer'] == true));
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
  ///   ESC t n    chọn bảng mã (chỉ khi server yêu cầu cp1258)
  ///   GS  ! n    cỡ chữ toàn phiếu do server quyết (fontScale)
  ///   ESC 7      chỉnh NHIỆT đầu in — đây mới là lệnh làm bill đen hơn thật
  ///   ESC G 1    in đè thêm lượt (double-strike)
  Future<List<int>> _escpos(
    String text, {
    bool drawer = false,
    dynamic density = '',
    String charset = 'utf8',
    dynamic fontScale,
    bool buzzer = false,
  }) async {
    final d = '$density'.toLowerCase().trim();
    final isMax = d == 'max' || d.contains('rat') || d.contains('very');
    final isDark =
        isMax || d == 'dark' || d.contains('dam') || d.contains('bold');

    final bytes = <int>[];
    // ESC @ (Init) & FS . (Cancel Kanji Mode - prevent Chinese characters)
    bytes.addAll([0x1b, 0x40, 0x1c, 0x2e]);
    // ESC ! 0, GS ! 0, ESC a 0, ESC 2 (Reset)
    bytes.addAll(
        [0x1b, 0x21, 0x00, 0x1d, 0x21, 0x00, 0x1b, 0x61, 0x00, 0x1b, 0x32]);
    // ESC t 0 (bảng mã gốc) + GS L 0 0 (lề trái 0) + GS W (vùng in tối đa) —
    // GIỮ ĐỒNG BỘ với ESC_RESET ở server. Xem chú thích đầy đủ tại đó.
    bytes.addAll(
        [0x1b, 0x74, 0x00, 0x1d, 0x4c, 0x00, 0x00, 0x1d, 0x57, 0xff, 0xff]);
    if (charset == 'cp1258') bytes.addAll([0x1b, 0x74, _cp1258Page]);
    final scale = _fontScaleByte(fontScale);
    if (scale != 0) bytes.addAll([0x1d, 0x21, scale]);
    // ESC 7 (nhiệt) rồi mới tới double-strike/emphasized — giống hệt server.
    if (isMax) {
      bytes
          .addAll([0x1b, 0x37, 15, 220, 2, 0x1b, 0x47, 0x01, 0x1b, 0x45, 0x01]);
    } else if (isDark) {
      bytes.addAll([0x1b, 0x37, 11, 160, 2, 0x1b, 0x47, 0x01]);
    }

    bytes.addAll(_encodeMarked(text, charset));
    bytes.addAll(utf8.encode('\n\n'));

    // Buzzer: ESC B 3 tieng khi nha bill — GIU DONG BO voi printing.js/agent.cjs.
    if (buzzer) {
      bytes.addAll([0x1b, 0x42, 0x03, 0x02]);
    }
    if (drawer) {
      bytes.addAll([0x1b, 0x70, 0x00, 0x19, 0xfa]);
    }
    bytes.addAll([0x1d, 0x56, 0x42, 0x00]);

    return bytes;
  }

  /// Lối vào cho kiểm thử: dựng byte ESC/POS đúng như lúc in thật, với bảng mã
  /// 'ascii' (mặc định của tuyến chưa khai). Không dùng trong luồng chạy.
  @visibleForTesting
  Future<List<int>> escposChoTest(String text) =>
      _escpos(text, charset: 'ascii');

  static const _cp1258Page = 30;
  // [[BC:..]] = mã vạch 1D thật, [[QR:..]] = QR thật. GIỮ ĐỒNG BỘ với server.
  static const _markRe = r'\[\[(B[01]|S[0-3]|BC:[^\]]*|QR:[^\]]*)\]\]';
  // GIỮ ĐỒNG BỘ với FONT_SCALE ở server/agent.cjs. S3=2x cả 2 chiều (phiếu bếp).
  static const _fontScale = {0: 0x00, 1: 0x01, 2: 0x02, 3: 0x11};

  static int _fontScaleByte(dynamic raw) {
    final n = raw is int ? raw : int.tryParse('$raw') ?? 0;
    return _fontScale[n.clamp(0, 3)] ?? 0x00;
  }

  /// Đánh dấu kiểu chữ [[B1]]/[[S2]] → lệnh ESC/POS; phần chữ mã hoá theo
  /// bảng mã máy in. GIỮ ĐỒNG BỘ với encodeMarked() ở server/services/printing.js.
  static List<int> _encodeMarked(String text, String charset) {
    final out = <int>[];
    var last = 0;
    for (final m in RegExp(_markRe).allMatches(text)) {
      if (m.start > last) {
        out.addAll(_encodeText(text.substring(last, m.start), charset));
      }
      out.addAll(_markToBytes(m.group(1)!));
      last = m.end;
    }
    if (last < text.length) {
      out.addAll(_encodeText(text.substring(last), charset));
    }
    return out;
  }

  static List<int> _markToBytes(String tag) {
    // In dam = ESC E (emphasized) + ESC G (double-strike) — double-strike moi ro
    // dam tren may in nhiet re. GIU DONG BO voi printing.js/agent.cjs.
    if (tag == 'B1') return [0x1b, 0x45, 0x01, 0x1b, 0x47, 0x01];
    if (tag == 'B0') return [0x1b, 0x45, 0x00, 0x1b, 0x47, 0x00];
    if (tag.startsWith('BC:')) return _code128Bytes(tag.substring(3));
    if (tag.startsWith('QR:')) return _qrBytes(tag.substring(3));
    return [0x1d, 0x21, _fontScaleByte(int.tryParse(tag[1]) ?? 0)];
  }

  // Mã vạch 1D Code128 thật — GIỮ ĐỒNG BỘ với code128Bytes() ở server.
  static List<int> _code128Bytes(String data) {
    final d = data.length > 40 ? data.substring(0, 40) : data;
    final chars = d.codeUnits.map((c) => c & 0x7f).toList();
    return [
      0x1b,
      0x61,
      0x01,
      0x1d,
      0x48,
      0x02,
      0x1d,
      0x66,
      0x00,
      0x1d,
      0x68,
      80,
      0x1d,
      0x77,
      0x02,
      0x1d,
      0x6b,
      0x49,
      chars.length + 2,
      0x7b,
      0x42,
      ...chars,
      0x0a,
      0x1b,
      0x61,
      0x00,
    ];
  }

  // Mã QR thật (GS ( k, model 2) — GIỮ ĐỒNG BỘ với qrBytes() ở server.
  static List<int> _qrBytes(String data) {
    final d = data.length > 512 ? data.substring(0, 512) : data;
    final bytes = d.codeUnits.map((c) => c & 0xff).toList();
    final store = 3 + bytes.length;
    return [
      0x1b,
      0x61,
      0x01,
      0x1d,
      0x28,
      0x6b,
      0x04,
      0x00,
      0x31,
      0x41,
      0x32,
      0x00,
      0x1d,
      0x28,
      0x6b,
      0x03,
      0x00,
      0x31,
      0x43,
      0x06,
      0x1d,
      0x28,
      0x6b,
      0x03,
      0x00,
      0x31,
      0x45,
      0x31,
      0x1d,
      0x28,
      0x6b,
      store & 0xff,
      (store >> 8) & 0xff,
      0x31,
      0x50,
      0x30,
      ...bytes,
      0x1d,
      0x28,
      0x6b,
      0x03,
      0x00,
      0x31,
      0x51,
      0x30,
      0x0a,
      0x1b,
      0x61,
      0x00,
    ];
  }

  /// Máy in gắn liền của máy cầm tay hiểu UTF-8 — đây là đường đang chạy tốt và
  /// là mặc định. 'ascii' là lối thoát cho máy in đời cũ; 'cp1258' để server
  /// quyết khi tuyến in khai bảng mã đó (bảng mã dựng ở server, ở đây chỉ cần
  /// gửi đúng byte UTF-8 vì Sunmi không dùng cp1258).
  static List<int> _encodeText(String s, String charset) {
    if (charset == 'ascii') {
      return latin1.encode(_boDau(s));
    }
    return utf8.encode(s);
  }

  /// Nhóm ký tự tiếng Việt theo chữ cái gốc.
  ///
  /// CỐ Ý DÙNG MAP THAY VÌ HAI CHUỖI SONG SONG. Bản trước viết
  /// `const co = 'àáả…đ'` và `const khong = 'aaa…d'` rồi tra theo chỉ số —
  /// hai chuỗi lệch nhau ĐÚNG MỘT ký tự (67 so với 68) nên mọi chữ sau chỗ lệch
  /// bị dịch ô, và `đ` (ô cuối) rơi vào `y`: bill in ra "Trà đào" thành
  /// "Tra yao", "Độ đậm" thành "Yo yam". Đếm tay hai chuỗi 67 ký tự là kiểu lỗi
  /// không ai soi ra bằng mắt — nên bỏ hẳn cách đó.
  static const Map<String, String> _nhomDau = {
    'a': 'àáảãạăằắẳẵặâầấẩẫậ',
    'e': 'èéẻẽẹêềếểễệ',
    'i': 'ìíỉĩị',
    'o': 'òóỏõọôồốổỗộơờớởỡợ',
    'u': 'ùúủũụưừứửữự',
    'y': 'ỳýỷỹỵ',
    'd': 'đ',
  };

  static final Map<String, String> _bangBoDau = {
    for (final e in _nhomDau.entries)
      for (final ch in e.value.split('')) ...{
        ch: e.key,
        ch.toUpperCase(): e.key.toUpperCase(),
      }
  };

  static String _boDau(String s) {
    final b = StringBuffer();
    for (final ch in s.split('')) {
      final thay = _bangBoDau[ch];
      if (thay != null) {
        b.write(thay);
      } else if (ch.codeUnitAt(0) < 128) {
        b.write(ch); // ASCII giữ nguyên
      }
      // Ký tự ngoài bảng và ngoài ASCII thì bỏ — máy in không có phông cho nó.
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
