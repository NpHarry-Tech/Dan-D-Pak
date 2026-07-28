import 'dart:ffi';
import 'dart:io';

import 'package:ffi/ffi.dart';

import 'app_log.dart';

// Tu khoi dong ngam "Hardware Agent" (server/agent.cjs, dong goi san thanh
// dandpak-agent.exe di kem ban cai Windows) ngay khi thu ngan dang nhap - dung
// LUON tai khoan/PIN vua dang nhap, KHONG can cau hinh file rieng, KHONG hien
// cua so den nao (CreateProcessW + CREATE_NO_WINDOW qua FFI - dart:io
// Process.start khong co cach nao an cua so tien trinh console tren Windows).
//
// Vi sao can: khi server dat tren VPS (khong chung LAN voi cua hang), server
// khong the tu thay/dieu khien may in-ket-may quet the cam vao may POS tai
// quay - agent nay chay ngay tai do, nhan lenh in tu server roi in that.
class HardwareAgentLauncher {
  HardwareAgentLauncher._();

  static bool _attempted = false;

  /// Goi sau khi dang nhap THANH CONG. Tu bo qua neu: khong phai Windows,
  /// khong tim thay dandpak-agent.exe canh file .exe chinh (ban build khong
  /// kem, hoac app khong phai ban cai dat), hoac da thu o phien nay roi.
  static void spawnIfNeeded({
    required String centralUrl,
    required String username,
    required String pin,
    required String branchId,
  }) {
    if (!Platform.isWindows || _attempted) return;
    if (username.trim().isEmpty || pin.trim().isEmpty) return;
    _attempted = true;
    try {
      final exeDir = File(Platform.resolvedExecutable).parent.path;
      final agentPath = '$exeDir\\dandpak-agent.exe';
      if (!File(agentPath).existsSync()) return; // ban build nay chua kem agent
      _createHiddenProcess(agentPath, {
        'CENTRAL_URL': centralUrl,
        'AGENT_USERNAME': username,
        'AGENT_PIN': pin,
        'BRANCH_ID': branchId,
      });
    } catch (e) {
      _attempted = false; // cho thu lai o lan dang nhap sau neu lan nay loi
      dlog('HardwareAgentLauncher: khong khoi dong duoc - $e');
    }
  }

  static void _createHiddenProcess(String exePath, Map<String, String> env) {
    final kernel32 = DynamicLibrary.open('kernel32.dll');
    final createProcessW = kernel32
        .lookupFunction<_CreateProcessWNative, _CreateProcessWDart>(
            'CreateProcessW');

    final cmdLine = '"$exePath"'.toNativeUtf16();
    final envBlock = _buildEnvBlock(env);
    final startupInfo = calloc<_StartupInfoW>();
    startupInfo.ref.cb = sizeOf<_StartupInfoW>();
    final processInfo = calloc<_ProcessInformation>();

    try {
      final ok = createProcessW(
        nullptr,
        cmdLine,
        nullptr,
        nullptr,
        0,
        _createNoWindow | _createUnicodeEnvironment,
        envBlock.cast(),
        nullptr,
        startupInfo,
        processInfo,
      );
      if (ok == 0) {
        dlog('HardwareAgentLauncher: CreateProcessW that bai.');
      } else {
        dlog('HardwareAgentLauncher: da khoi dong ngam '
            '(PID ${processInfo.ref.dwProcessId}).');
      }
    } finally {
      calloc.free(cmdLine);
      calloc.free(envBlock);
      calloc.free(startupInfo);
      calloc.free(processInfo);
    }
  }

  // Khoi bien moi truong theo dung dinh dang Windows can: chuoi "KEY=VALUE"
  // noi tiep nhau, MOI chuoi ket thuc bang 1 ky tu NUL (ma 0), va toan khoi
  // ket thuc THEM 1 NUL nua (2 NUL lien tiep bao het khoi). Dung
  // String.fromCharCode(0) thay vi go truc tiep ky tu dieu khien de tranh
  // nham lan voi khoang trang thuong khi doc/sua code sau nay.
  static Pointer<Utf16> _buildEnvBlock(Map<String, String> extra) {
    final nul = String.fromCharCode(0);
    final all = <String, String>{...Platform.environment, ...extra};
    final buffer = StringBuffer();
    for (final entry in all.entries) {
      if (entry.key.isEmpty || entry.key.contains('=')) continue;
      buffer.write(entry.key);
      buffer.write('=');
      buffer.write(entry.value);
      buffer.write(nul);
    }
    buffer.write(nul);
    return buffer.toString().toNativeUtf16();
  }
}

const int _createNoWindow = 0x08000000;
const int _createUnicodeEnvironment = 0x00000400;

final class _StartupInfoW extends Struct {
  @Uint32()
  external int cb;
  external Pointer<Utf16> lpReserved;
  external Pointer<Utf16> lpDesktop;
  external Pointer<Utf16> lpTitle;
  @Uint32()
  external int dwX;
  @Uint32()
  external int dwY;
  @Uint32()
  external int dwXSize;
  @Uint32()
  external int dwYSize;
  @Uint32()
  external int dwXCountChars;
  @Uint32()
  external int dwYCountChars;
  @Uint32()
  external int dwFillAttribute;
  @Uint32()
  external int dwFlags;
  @Uint16()
  external int wShowWindow;
  @Uint16()
  external int cbReserved2;
  external Pointer<Uint8> lpReserved2;
  external Pointer<Void> hStdInput;
  external Pointer<Void> hStdOutput;
  external Pointer<Void> hStdError;
}

final class _ProcessInformation extends Struct {
  external Pointer<Void> hProcess;
  external Pointer<Void> hThread;
  @Uint32()
  external int dwProcessId;
  @Uint32()
  external int dwThreadId;
}

typedef _CreateProcessWNative = Int32 Function(
  Pointer<Utf16> lpApplicationName,
  Pointer<Utf16> lpCommandLine,
  Pointer<Void> lpProcessAttributes,
  Pointer<Void> lpThreadAttributes,
  Int32 bInheritHandles,
  Uint32 dwCreationFlags,
  Pointer<Void> lpEnvironment,
  Pointer<Utf16> lpCurrentDirectory,
  Pointer<_StartupInfoW> lpStartupInfo,
  Pointer<_ProcessInformation> lpProcessInformation,
);
typedef _CreateProcessWDart = int Function(
  Pointer<Utf16> lpApplicationName,
  Pointer<Utf16> lpCommandLine,
  Pointer<Void> lpProcessAttributes,
  Pointer<Void> lpThreadAttributes,
  int bInheritHandles,
  int dwCreationFlags,
  Pointer<Void> lpEnvironment,
  Pointer<Utf16> lpCurrentDirectory,
  Pointer<_StartupInfoW> lpStartupInfo,
  Pointer<_ProcessInformation> lpProcessInformation,
);
