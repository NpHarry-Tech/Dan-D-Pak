import 'dart:io';

class NodeRunner {
  static Process? _process;

  static Future<bool> isPortOpen(int port) async {
    try {
      final socket = await Socket.connect('127.0.0.1', port, timeout: const Duration(milliseconds: 500));
      socket.destroy();
      return true;
    } catch (_) {
      return false;
    }
  }

  static Future<void> startServer() async {
    if (await isPortOpen(3000)) {
      print("Node server is already running on port 3000.");
      return;
    }

    // Resolve project root path by scanning upwards
    Directory rootDir = Directory.current;
    bool found = false;
    for (int i = 0; i < 5; i++) {
      if (await File('${rootDir.path}/server/index.js').exists() &&
          await File('${rootDir.path}/package.json').exists()) {
        found = true;
        break;
      }
      rootDir = rootDir.parent;
    }

    if (!found) {
      // Direct fallback check
      rootDir = Directory(Directory.current.path + "/../..");
      if (await File('${rootDir.path}/server/index.js').exists()) {
        found = true;
      }
    }

    if (!found) {
      print("Could not locate server/index.js from ${Directory.current.path}");
      return;
    }

    print("Found project root at ${rootDir.path}. Starting Node server...");

    try {
      _process = await Process.start(
        'node',
        ['server/index.js'],
        workingDirectory: rootDir.path,
        runInShell: true,
      );

      final logFile = File('${rootDir.path}/tmp_server_run.log');
      final errFile = File('${rootDir.path}/tmp_server_err.log');
      if (await logFile.exists()) await logFile.delete();
      if (await errFile.exists()) await errFile.delete();

      _process!.stdout.listen((data) {
        logFile.writeAsBytesSync(data, mode: FileMode.append);
      });
      _process!.stderr.listen((data) {
        errFile.writeAsBytesSync(data, mode: FileMode.append);
      });

      print("Node server started asynchronously.");
      
      // Wait for port to open
      for (int i = 0; i < 20; i++) {
        await Future.delayed(const Duration(milliseconds: 250));
        if (await isPortOpen(3000)) {
          print("Node server is listening on port 3000.");
          break;
        }
      }
    } catch (e) {
      print("Failed to start Node server process: $e");
    }
  }

  static void stopServer() {
    if (_process != null) {
      print("Terminating background Node server...");
      _process!.kill();
      _process = null;
    }
  }
}
