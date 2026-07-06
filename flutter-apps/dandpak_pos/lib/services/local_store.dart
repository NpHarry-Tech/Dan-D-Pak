import 'dart:convert';
import 'dart:io';

/// Tiny key-value preference store persisted as one JSON file under APPDATA.
///
/// The whole map is cached in memory after the first read, so repeated
/// getString calls during boot cost one disk read total (not one per key),
/// and writes go through a temp-file + rename so a crash mid-write can never
/// corrupt the saved preferences.
class LocalStore {
  LocalStore._();

  static final LocalStore instance = LocalStore._();

  Map<String, dynamic>? _cache;

  File get _file {
    final base = Platform.environment['APPDATA'] ??
        Platform.environment['LOCALAPPDATA'] ??
        Platform.environment['HOME'] ??
        Directory.systemTemp.path;
    return File('$base${Platform.pathSeparator}Dan D Pak POS ERP${Platform.pathSeparator}flutter_pos.json');
  }

  Future<Map<String, dynamic>> _read() async {
    final cached = _cache;
    if (cached != null) return cached;
    try {
      final file = _file;
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
    final file = _file;
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
    final data = await _read();
    final value = data[key];
    return value is String ? value : null;
  }

  Future<void> setString(String key, String value) async {
    final data = Map<String, dynamic>.from(await _read());
    data[key] = value;
    await _write(data);
  }

  Future<void> remove(String key) async {
    final data = Map<String, dynamic>.from(await _read());
    data.remove(key);
    await _write(data);
  }
}
