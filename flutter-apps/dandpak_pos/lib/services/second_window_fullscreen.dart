import 'dart:async';
import 'dart:ffi';
import 'dart:io';

import 'package:ffi/ffi.dart';

import 'app_log.dart';

// Win32 constants
const _hwndTopmost = -1;
const _gwlStyle = -16;
const _wsCaption = 0x00C00000;
const _wsThickframe = 0x00040000;
const _wsMinimizebox = 0x00020000;
const _wsMaximizebox = 0x00010000;
const _wsSysmenu = 0x00080000;
const _swpFramechanged = 0x0020;
const _swpShowwindow = 0x0040;
const _monitorDefaulttonearest = 2;
const _smCmonitors = 80;
const _smCxscreen = 0;
const _smCyscreen = 1;
const _smXvirtualscreen = 76;
const _smYvirtualscreen = 77;
const _smCxvirtualscreen = 78;
const _smCyvirtualscreen = 79;

final class _Rect extends Struct {
  @Int32()
  external int left;
  @Int32()
  external int top;
  @Int32()
  external int right;
  @Int32()
  external int bottom;
}

final class _MonitorInfo extends Struct {
  @Uint32()
  external int cbSize;
  external _Rect rcMonitor;
  external _Rect rcWork;
  @Uint32()
  external int dwFlags;
}

typedef _FindWindowC = IntPtr Function(Pointer<Utf16>, Pointer<Utf16>);
typedef _FindWindowD = int Function(Pointer<Utf16>, Pointer<Utf16>);
typedef _GetSystemMetricsC = Int32 Function(Int32);
typedef _GetSystemMetricsD = int Function(int);
typedef _GetWindowLongPtrC = IntPtr Function(IntPtr, Int32);
typedef _GetWindowLongPtrD = int Function(int, int);
typedef _SetWindowLongPtrC = IntPtr Function(IntPtr, Int32, IntPtr);
typedef _SetWindowLongPtrD = int Function(int, int, int);
typedef _SetWindowPosC = Int32 Function(
    IntPtr, IntPtr, Int32, Int32, Int32, Int32, Uint32);
typedef _SetWindowPosD = int Function(int, int, int, int, int, int, int);
typedef _MonitorFromWindowC = IntPtr Function(IntPtr, Uint32);
typedef _MonitorFromWindowD = int Function(int, int);
typedef _GetMonitorInfoC = Int32 Function(IntPtr, Pointer<_MonitorInfo>);
typedef _GetMonitorInfoD = int Function(int, Pointer<_MonitorInfo>);

/// Biến cửa sổ phụ (tìm theo tiêu đề) thành kiosk toàn màn hình KHÔNG VIỀN:
/// bỏ thanh tiêu đề Windows + phủ kín đúng một màn hình vật lý. Nếu máy có
/// từ 2 màn hình trở lên thì tự đưa sang màn hình KHÔNG phải màn chính (màn
/// khách). Thất bại ở bất kỳ bước nào → giữ nguyên cửa sổ thường, không crash.
Future<void> makeSecondWindowFullscreen(
    {String title = 'Màn hình phụ'}) async {
  if (!Platform.isWindows) return;
  try {
    final user32 = DynamicLibrary.open('user32.dll');
    final findWindow =
        user32.lookupFunction<_FindWindowC, _FindWindowD>('FindWindowW');
    final getMetrics = user32
        .lookupFunction<_GetSystemMetricsC, _GetSystemMetricsD>(
            'GetSystemMetrics');
    final getLong = user32
        .lookupFunction<_GetWindowLongPtrC, _GetWindowLongPtrD>(
            'GetWindowLongPtrW');
    final setLong = user32
        .lookupFunction<_SetWindowLongPtrC, _SetWindowLongPtrD>(
            'SetWindowLongPtrW');
    final setPos = user32
        .lookupFunction<_SetWindowPosC, _SetWindowPosD>('SetWindowPos');
    final monitorFrom = user32
        .lookupFunction<_MonitorFromWindowC, _MonitorFromWindowD>(
            'MonitorFromWindow');
    final getMonitorInfo = user32
        .lookupFunction<_GetMonitorInfoC, _GetMonitorInfoD>('GetMonitorInfoW');

    // Cửa sổ con được plugin tạo bất đồng bộ — chờ tối đa ~3s cho nó xuất hiện.
    final titlePtr = title.toNativeUtf16();
    int hwnd = 0;
    try {
      for (var i = 0; i < 30; i++) {
        hwnd = findWindow(nullptr, titlePtr);
        if (hwnd != 0) break;
        await Future.delayed(const Duration(milliseconds: 100));
      }
    } finally {
      calloc.free(titlePtr);
    }
    if (hwnd == 0) {
      dlog('SecondScreen fullscreen: window "$title" not found');
      return;
    }

    // Có nhiều màn hình → đẩy cửa sổ vào vùng NGOÀI màn chính trước, để bước
    // MonitorFromWindow phía dưới bắt đúng màn hình khách.
    if (getMetrics(_smCmonitors) > 1) {
      final pw = getMetrics(_smCxscreen), ph = getMetrics(_smCyscreen);
      final vx = getMetrics(_smXvirtualscreen), vy = getMetrics(_smYvirtualscreen);
      final vw = getMetrics(_smCxvirtualscreen), vh = getMetrics(_smCyvirtualscreen);
      int? px, py;
      if (vx + vw > pw) {
        px = pw + 60; py = 60;            // màn phụ bên phải
      } else if (vx < 0) {
        px = vx + 60; py = 60;            // màn phụ bên trái
      } else if (vy + vh > ph) {
        px = 60; py = ph + 60;            // màn phụ phía dưới
      } else if (vy < 0) {
        px = 60; py = vy + 60;            // màn phụ phía trên
      }
      if (px != null && py != null) {
        setPos(hwnd, 0, px, py, 320, 240, _swpShowwindow);
      }
    }

    // Lấy toạ độ chính xác của màn hình đang chứa cửa sổ.
    final mon = monitorFrom(hwnd, _monitorDefaulttonearest);
    final info = calloc<_MonitorInfo>();
    try {
      info.ref.cbSize = sizeOf<_MonitorInfo>();
      if (getMonitorInfo(mon, info) == 0) return;
      final r = info.ref.rcMonitor;

      // Bỏ toàn bộ khung cửa sổ (title bar, viền, nút min/max/close).
      final style = getLong(hwnd, _gwlStyle) &
          ~(_wsCaption | _wsThickframe | _wsMinimizebox | _wsMaximizebox | _wsSysmenu);
      setLong(hwnd, _gwlStyle, style);
      // TOPMOST: nằm TRÊN cả taskbar Windows — màn khách không bao giờ bị
      // thanh taskbar/cửa sổ khác đè lên. Thoát kiosk: tắt trong Cài đặt
      // hoặc Alt+F4.
      setPos(hwnd, _hwndTopmost, r.left, r.top, r.right - r.left,
          r.bottom - r.top, _swpFramechanged | _swpShowwindow);
      dlog('SecondScreen fullscreen on monitor '
          '(${r.left},${r.top})-(${r.right},${r.bottom})');
    } finally {
      calloc.free(info);
    }
  } catch (e) {
    dlog('SecondScreen fullscreen failed (window kept as-is): $e');
  }
}
