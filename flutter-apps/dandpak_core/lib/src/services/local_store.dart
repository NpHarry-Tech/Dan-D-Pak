import 'dart:convert';
import 'dart:io';

import 'package:path_provider/path_provider.dart';

/// Tiny key-value preference store persisted as one JSON file.
///
/// The whole map is cached in memory after the first read, so repeated
/// getString calls during boot cost one disk read total (not one per key),
/// and writes go through a temp-file + rename so a crash mid-write can never
/// corrupt the saved preferences.
class LocalStore {
  LocalStore._();

  static final LocalStore instance = LocalStore._();

  Map<String, dynamic>? _cache;
  File? _fileCache;

  // BAO MAT: auth_token (kể cả biến thể theo tenant "t::<origin>::auth_token"
  // và khoá legacy không namespace) đi qua Keychain/Keystore của OS thay vì
  // nằm trần trong file JSON — CHỈ khi app đã "cắm" một backend thật vào các
  // ô dưới đây. dandpak_core KHÔNG phụ thuộc trực tiếp gói flutter_secure_storage
  // (gói đó là plugin liên nền tảng — riêng bản Windows cần component ATL của
  // Visual Studio, không có sẵn trên máy build, và desktop cũng không cần nó vì
  // đã tự xoá token khi đóng cửa sổ). Chỉ app tablet/phone (main.dart) mới
  // import gói thật và gán các hàm này lúc khởi động; desktop không gán gì cả
  // → auth_token của desktop tiếp tục nằm trong file JSON như trước.
  static Future<String?> Function(String key)? secureRead;
  static Future<void> Function(String key, String value)? secureWrite;
  static Future<void> Function(String key)? secureDelete;
  static Future<Set<String>> Function()? secureKeys;

  bool _isSensitive(String key) =>
      secureRead != null &&
      (key == 'auth_token' || key.endsWith('::auth_token'));

  /// Nơi lưu preferences. Trên Android/iOS DÙNG THƯ MỤC HỖ TRỢ ỨNG DỤNG (bền qua
  /// cập nhật app) — TUYỆT ĐỐI không dùng systemTemp vì trên Android nó là
  /// code_cache, bị hệ thống XÓA khi cập nhật app → mất server_url → tablet rớt
  /// về localhost và "thiếu cơ sở dữ liệu". Desktop giữ nguyên theo APPDATA.
  Future<File> _resolveFile() async {
    if (_fileCache != null) return _fileCache!;
    String base;
    if (Platform.isAndroid || Platform.isIOS) {
      base = (await getApplicationSupportDirectory()).path;
    } else {
      base = Platform.environment['APPDATA'] ??
          Platform.environment['LOCALAPPDATA'] ??
          Platform.environment['HOME'] ??
          Directory.systemTemp.path;
    }
    return _fileCache = File(
        '$base${Platform.pathSeparator}Dan D Pak POS ERP${Platform.pathSeparator}flutter_pos.json');
  }

  Future<Map<String, dynamic>> _read() async {
    final cached = _cache;
    if (cached != null) return cached;
    try {
      final file = await _resolveFile();
      if (!await file.exists()) return _cache = <String, dynamic>{};
      final decoded = jsonDecode(await file.readAsString());
      return _cache = decoded is Map
          ? Map<String, dynamic>.from(decoded)
          : <String, dynamic>{};
    } catch (_) {
      return _cache = <String, dynamic>{};
    }
  }

  Future<void> _write(Map<String, dynamic> data) async {
    _cache = data;
    final file = await _resolveFile();
    await file.parent.create(recursive: true);
    final tmp = File('${file.path}.tmp');
    await tmp.writeAsString(jsonEncode(data), flush: true);
    try {
      await tmp.rename(file.path);
    } on FileSystemException {
      // rename over an existing file can fail on some filesystems — fall back
      // to a direct write (still flushed).
      await file.writeAsString(jsonEncode(data), flush: true);
    }
  }

  Future<String?> getString(String key) async {
    if (_isSensitive(key)) {
      final secureValue = await secureRead!(key);
      if (secureValue != null) return secureValue;
      // Bù MỘT LẦN cho máy đã cài từ trước: token cũ còn nằm trong file JSON
      // (từ bản chưa có secure storage) — chuyển sang secure rồi xoá khỏi
      // JSON, để không đột ngột "mất đăng nhập" sau khi cập nhật app.
      final data = await _read();
      final legacyValue = data[key];
      if (legacyValue is String && legacyValue.isNotEmpty) {
        await secureWrite!(key, legacyValue);
        final next = Map<String, dynamic>.from(data)..remove(key);
        await _write(next);
        return legacyValue;
      }
      return null;
    }
    final data = await _read();
    final value = data[key];
    return value is String ? value : null;
  }

  Future<void> setString(String key, String value) async {
    if (_isSensitive(key)) {
      await secureWrite!(key, value);
      return;
    }
    final data = Map<String, dynamic>.from(await _read());
    data[key] = value;
    await _write(data);
  }

  Future<void> remove(String key) async {
    if (_isSensitive(key)) {
      await secureDelete!(key);
      return;
    }
    final data = Map<String, dynamic>.from(await _read());
    data.remove(key);
    await _write(data);
  }

  Future<void> removeWhere(bool Function(String key) predicate) async {
    final data = Map<String, dynamic>.from(await _read());
    data.removeWhere((key, _) => predicate(key));
    await _write(data);
    if (secureKeys == null) return;
    final keys = await secureKeys!();
    for (final key in keys) {
      if (predicate(key)) await secureDelete!(key);
    }
  }
}
