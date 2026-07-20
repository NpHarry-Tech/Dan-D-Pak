import 'dart:async';
import 'dart:io';

import 'api_service.dart';
import 'app_log.dart';
import '../app_flavor.dart';

/// HỘP ĐEN của app — ghi lại vệt thao tác để truy nguyên crash.
///
/// Vấn đề cần giải: app từng bị crash NATIVE (access violation trong engine) —
/// loại crash này giết tiến trình ngay lập tức, mọi hook lỗi phía Dart
/// (FlutterError.onError...) đều KHÔNG kịp chạy. Cách duy nhất biết "trước khi
/// chết app đang làm gì" là ghi sẵn từng bước ra đĩa ngay lúc nó xảy ra.
///
/// Cách hoạt động:
/// 1. Mỗi sự kiện đáng giá (chạm màn hình, đổi màn hình, gọi API, sự kiện
///    realtime, lỗi Dart) được ghi 1 dòng vào file `bb_<role>_current.log`
///    trong thư mục tạm — ghi ĐỒNG BỘ + flush ngay nên sống sót qua crash.
/// 2. Thoát app đàng hoàng → dòng cuối là `## CLEAN-EXIT`.
/// 3. Lần mở app kế tiếp: nếu file cũ KHÔNG có dấu thoát sạch → lần trước chết
///    bất thường → sao lưu file thành `bb_<role>_crash_<ts>.log` và GỬI phần
///    đuôi (những thao tác cuối) về server kèm cờ `kind: 'crash'` — server ghi
///    vào nhật ký hoạt động (audit) trong database gốc để lưu hồ sơ lâu dài.
/// 4. Mọi báo lỗi Dart thường (ClientLog) cũng đính kèm ~40 dòng vệt gần nhất.
class BlackBox {
  BlackBox._();

  /// Màn hình hiện tại — các screen chính tự cập nhật khi mở.
  static String screen = 'boot';

  static RandomAccessFile? _file;
  static String _role = 'main';
  static final List<String> _recent =
      <String>[]; // ring buffer đính kèm báo lỗi
  static const int _recentMax = 40;
  static const int _maxLine = 300;
  static const int _maxFileBytes = 2 * 1024 * 1024; // ~2MB thì xoay file
  static const String _cleanMark = '## CLEAN-EXIT';

  static Directory get _dir =>
      Directory('${Directory.systemTemp.path}/dandpak_blackbox');
  static String get _currentPath => '${_dir.path}/bb_${_role}_current.log';

  /// Gọi 1 lần thật sớm. [role] = 'main' (cửa sổ chính) | 'display' (màn phụ).
  /// Nếu truyền [api], phát hiện lần chạy trước chết bất thường sẽ gửi hồ sơ
  /// về server sau vài giây (đợi app nối server xong).
  static void init({required String role, ApiService? api}) {
    _role = role;
    try {
      _dir.createSync(recursive: true);
      final cur = File(_currentPath);
      String? crashTail;
      DateTime? crashAt;
      if (cur.existsSync()) {
        final text = _safeReadTail(cur, 16000);
        if (text.trim().isNotEmpty && !text.contains(_cleanMark)) {
          // Lần chạy trước KHÔNG thoát sạch → nghi crash. Giữ hồ sơ lại.
          crashAt = cur.statSync().modified;
          final ts = DateTime.now()
              .toIso8601String()
              .replaceAll(':', '-')
              .split('.')
              .first;
          try {
            cur.copySync('${_dir.path}/bb_${role}_crash_$ts.log');
          } catch (_) {}
          _pruneOldCrashFiles();
          crashTail = text;
        }
      }
      _file = cur.openSync(mode: FileMode.write); // file mới cho lần chạy này
      _writeLine(
          '## START role=$role app=${AppFlavor.current.versionName}+${AppFlavor.current.buildNumber} '
          'os=${Platform.operatingSystemVersion}');
      if (crashTail != null && api != null) {
        _reportPreviousCrash(api, crashTail, crashAt);
      }
    } catch (e) {
      dlog('BlackBox init failed (non-fatal): $e');
    }
  }

  /// Ghi 1 sự kiện. Không bao giờ ném lỗi, không bao giờ chặn app.
  static void add(String category, String message) {
    try {
      var line =
          '${DateTime.now().toIso8601String()} [$screen] $category: $message';
      if (line.length > _maxLine) line = line.substring(0, _maxLine);
      _recent.add(line);
      if (_recent.length > _recentMax) _recent.removeAt(0);
      _writeLine(line);
    } catch (_) {}
  }

  /// ~40 dòng gần nhất — ClientLog đính kèm vào mọi báo lỗi Dart.
  static String recentTrace() => _recent.join('\n');

  /// Gọi khi app thoát chủ động (nút Đóng / lifecycle detached) — đánh dấu
  /// "thoát sạch" để lần mở sau không báo crash oan.
  static void markCleanExit() {
    try {
      _writeLine(_cleanMark);
      _file?.closeSync();
      _file = null;
    } catch (_) {}
  }

  static void _writeLine(String line) {
    final f = _file;
    if (f == null) return;
    try {
      if (f.positionSync() > _maxFileBytes) {
        // File quá to (phiên chạy rất dài) — cắt về đầu, giữ máy nhẹ.
        f.truncateSync(0);
        f.setPositionSync(0);
      }
      f.writeStringSync('$line\n');
      f.flushSync(); // flush từng dòng — sống sót qua crash native
    } catch (_) {}
  }

  static String _safeReadTail(File f, int maxChars) {
    try {
      final s = f.readAsStringSync();
      return s.length <= maxChars ? s : s.substring(s.length - maxChars);
    } catch (_) {
      return '';
    }
  }

  static void _pruneOldCrashFiles() {
    try {
      final crashes = _dir
          .listSync()
          .whereType<File>()
          .where((f) => f.path.contains('bb_${_role}_crash_'))
          .toList()
        ..sort((a, b) => b.path.compareTo(a.path)); // tên chứa timestamp
      for (final f in crashes.skip(5)) {
        try {
          f.deleteSync();
        } catch (_) {}
      }
    } catch (_) {}
  }

  /// Gửi hồ sơ crash của LẦN CHẠY TRƯỚC về server (ghi vào audit DB gốc).
  /// Lúc mới mở app có thể CHƯA đăng nhập (server từ chối 401) → thử lại mỗi
  /// 30s, tối đa 8 lần. Vẫn thất bại thì thôi — hồ sơ còn nguyên trên đĩa
  /// (`%TEMP%/dandpak_blackbox/bb_*_crash_*.log`) để xem tay.
  static void _reportPreviousCrash(
      ApiService api, String tail, DateTime? crashAt) {
    var attempts = 0;
    Future<void> trySend() async {
      attempts++;
      // Kèm tên các file minidump mới (nếu WER LocalDumps đang bật).
      String dumps = '';
      try {
        final dd = Directory('C:/CrashDumps');
        if (dd.existsSync()) {
          final exeName = Platform.resolvedExecutable
              .split(RegExp(r'[\\/]'))
              .last
              .toLowerCase();
          final names = dd.listSync().whereType<File>().where((f) {
            final path = f.path.toLowerCase();
            if (!path.endsWith('.dmp') || !path.contains(exeName)) {
              return false;
            }
            if (crashAt == null) return true;
            final delta =
                f.statSync().modified.difference(crashAt).inMinutes.abs();
            return delta <= 30;
          }).toList()
            ..sort((a, b) =>
                b.statSync().modified.compareTo(a.statSync().modified));
          dumps = names.take(2).map((f) => f.path).join(', ');
        }
      } catch (_) {}
      try {
        await api.postClientLog({
          'app': AppFlavor.current.appId,
          'version':
              '${AppFlavor.current.versionName}+${AppFlavor.current.buildNumber}',
          'kind': 'crash',
          'screen': 'blackbox:$_role',
          'message': 'App thoát bất thường lần chạy trước (nghi crash native).'
              '${dumps.isEmpty ? '' : ' Minidump: $dumps'}',
          'stack': tail,
        });
        dlog('BlackBox: đã gửi hồ sơ crash lần chạy trước lên server');
      } catch (_) {
        if (attempts < 8) Timer(const Duration(seconds: 30), trySend);
      }
    }

    Timer(const Duration(seconds: 6), trySend);
  }
}
