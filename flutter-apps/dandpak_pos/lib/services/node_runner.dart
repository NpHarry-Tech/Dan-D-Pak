import 'dart:async';
import 'dart:io';

import 'app_log.dart';

/// Boots the bundled Node "local engine" AND keeps it alive.
///
/// Startup is non-blocking: the Flutter window paints immediately while the
/// server comes up in the background, and the first API calls await [ready].
///
/// Self-healing ("fix mãi mãi" — user gặp Connection refused nhiều lần):
/// - Nếu process Node do app spawn bị chết → tự spawn lại (backoff 1s).
/// - Watchdog 10s: kể cả khi server do NGƯỜI DÙNG tự chạy ngoài terminal rồi
///   tắt mất, app phát hiện port 3000 đóng và tự spawn engine bundled.
/// - [recover] được ApiClient gọi ngay khi gặp connection-refused: spawn +
///   chờ port mở (tối đa ~8s) rồi request được retry trong suốt với UI.
class NodeRunner {
  static Process? _process;
  static Future<void>? _ready;
  static IOSink? _outSink;
  static IOSink? _errSink;
  static Timer? _watchdog;
  static bool _stopped = false;
  static bool _starting = false;
  static String? _rootDir;

  /// Completes when the Node engine is accepting connections on :3000.
  /// Idempotent — the same future is shared by every awaiter.
  static Future<void> get ready => _ready ??= _start();

  /// Kick off startup (fire-and-forget from main so first paint isn't blocked).
  static Future<void> startServer() {
    _stopped = false;
    _watchdog ??= Timer.periodic(const Duration(seconds: 10), (_) {
      if (!_stopped) _ensureAlive();
    });
    return _ready ??= _start();
  }

  static Future<bool> isPortOpen(int port) async {
    try {
      final socket = await Socket.connect('127.0.0.1', port,
          timeout: const Duration(milliseconds: 400));
      socket.destroy();
      return true;
    } catch (_) {
      return false;
    }
  }

  /// Gọi khi một request bị connection-refused: đảm bảo engine sống rồi chờ
  /// port mở để caller retry. An toàn gọi song song (chống spawn trùng).
  static Future<bool> recover() async {
    if (_stopped) return false;
    if (await isPortOpen(3000)) return true;
    await _ensureAlive();
    for (int i = 0; i < 20; i++) {
      if (await isPortOpen(3000)) return true;
      await Future.delayed(const Duration(milliseconds: 400));
    }
    return false;
  }

  static Future<void> _ensureAlive() async {
    if (_stopped || _starting) return;
    if (await isPortOpen(3000)) return;
    dlog('NodeRunner watchdog: port 3000 down → respawning engine...');
    await _spawn();
  }

  static Future<void> _start() async {
    if (await isPortOpen(3000)) {
      dlog('Node server already running on port 3000.');
      return;
    }
    await _spawn();
    // Poll for readiness (in the background — main() does not await this).
    for (int i = 0; i < 24; i++) {
      if (await isPortOpen(3000)) {
        dlog('Node server listening on port 3000.');
        return;
      }
      await Future.delayed(const Duration(milliseconds: 200));
    }
    dlog('Node server did not open port 3000 within timeout.');
  }

  static Future<String?> _findRoot() async {
    if (_rootDir != null) return _rootDir;
    // Resolve project root by scanning upwards for server/index.js.
    Directory rootDir = Directory.current;
    for (int i = 0; i < 5; i++) {
      if (await File('${rootDir.path}/server/index.js').exists() &&
          await File('${rootDir.path}/package.json').exists()) {
        return _rootDir = rootDir.path;
      }
      rootDir = rootDir.parent;
    }
    final fallback = Directory('${Directory.current.path}/../..');
    if (await File('${fallback.path}/server/index.js').exists()) {
      return _rootDir = fallback.path;
    }
    dlog('Could not locate server/index.js from ${Directory.current.path}');
    return null;
  }

  static Future<void> _spawn() async {
    if (_starting) return;
    _starting = true;
    try {
      final root = await _findRoot();
      if (root == null) return;
      dlog('Starting Node server from $root ...');
      _process = await Process.start(
        'node',
        ['server/index.js'],
        workingDirectory: root,
        runInShell: true,
      );

      // Buffered async log sinks (one open handle) instead of a synchronous
      // file write per stdout chunk, which would jank the UI isolate at boot.
      _outSink?.close();
      _errSink?.close();
      _outSink = File('$root/tmp_server_run.log').openWrite(mode: FileMode.write);
      _errSink = File('$root/tmp_server_err.log').openWrite(mode: FileMode.write);
      _process!.stdout.listen(_outSink!.add, onError: (_) {});
      _process!.stderr.listen(_errSink!.add, onError: (_) {});

      // Tự hồi sinh: engine chết bất ngờ (crash/kill) → spawn lại sau 1s.
      final p = _process!;
      p.exitCode.then((code) async {
        if (_stopped || !identical(p, _process)) return;
        dlog('Node server exited (code $code) → restarting in 1s...');
        await Future.delayed(const Duration(seconds: 1));
        if (!_stopped) await _ensureAlive();
      });
    } catch (e) {
      dlog('Failed to start Node server process: $e');
    } finally {
      _starting = false;
    }
  }

  static void stopServer() {
    _stopped = true;
    _watchdog?.cancel();
    _watchdog = null;
    _outSink?.close();
    _errSink?.close();
    _outSink = null;
    _errSink = null;
    if (_process != null) {
      dlog('Terminating background Node server...');
      _process!.kill();
      _process = null;
    }
  }
}
