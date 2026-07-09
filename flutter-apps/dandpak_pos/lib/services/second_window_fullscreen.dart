import 'dart:async';
import 'dart:ffi';
import 'dart:io';

import 'package:ffi/ffi.dart';

import 'app_log.dart';

// Win32 constants
const _hwndTopmost = -1;
const _hwndNotopmost = -2;
const _swpShowwindow = 0x0040;
// Gửi yêu cầu đổi vị trí sang LUỒNG SỞ HỮU cửa sổ thay vì làm đồng bộ từ luồng
// gọi. Bắt buộc khi gọi từ engine của cửa sổ phụ (cửa sổ do luồng chính quản):
// gọi đồng bộ chéo luồng làm treo/đơ engine và đã gây crash access-violation.
const _swpAsyncwindowpos = 0x4000;
const _gwlStyle = -16;
const _wsCaption = 0x00C00000;
const _wsThickframe = 0x00040000;
const _wsMinimizebox = 0x00020000;
const _wsMaximizebox = 0x00010000;
const _wsSysmenu = 0x00080000;
const _swpNosize = 0x0001;
const _swpNomove = 0x0002;
const _swpNozorder = 0x0004;
const _swpNoactivate = 0x0010;
const _swpFramechanged = 0x0020;
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
typedef _GetWindowRectC = Int32 Function(IntPtr, Pointer<_Rect>);
typedef _GetWindowRectD = int Function(int, Pointer<_Rect>);
typedef _GetCursorPosC = Int32 Function(Pointer<_Point>);
typedef _GetCursorPosD = int Function(Pointer<_Point>);

final class _Point extends Struct {
  @Int32()
  external int x;
  @Int32()
  external int y;
}

final DynamicLibrary _user32 = DynamicLibrary.open('user32.dll');

/// Tìm HWND của cửa sổ theo tiêu đề. Không thấy → 0.
int _findHwnd(String title) {
  final findWindow =
      _user32.lookupFunction<_FindWindowC, _FindWindowD>('FindWindowW');
  final titlePtr = title.toNativeUtf16();
  try {
    return findWindow(nullptr, titlePtr);
  } finally {
    calloc.free(titlePtr);
  }
}

/// Số màn hình vật lý đang cắm vào máy. Ngoài Windows / lỗi FFI → coi như 1.
int monitorCount() {
  if (!Platform.isWindows) return 1;
  try {
    final user32 = DynamicLibrary.open('user32.dll');
    final getMetrics = user32
        .lookupFunction<_GetSystemMetricsC, _GetSystemMetricsD>(
            'GetSystemMetrics');
    final n = getMetrics(_smCmonitors);
    return n > 0 ? n : 1;
  } catch (_) {
    return 1;
  }
}

/// Máy có màn hình thứ 2 (màn khách) hay không.
bool hasSecondMonitor() => monitorCount() > 1;

/// Bỏ THANH TIÊU ĐỀ + 3 nút (thu nhỏ/phóng to/đóng) của cửa sổ phụ → không viền.
///
/// AN TOÀN: hàm này phải được gọi TỪ CHÍNH ENGINE của cửa sổ phụ, SAU khi nó đã
/// vẽ frame đầu tiên (Flutter view đã sẵn sàng). Lúc đó WM_NCCALCSIZE do đổi
/// style kích ra sẽ được WndProc của plugin xử lý bình thường — khác với bản
/// cũ (đổi style từ tiến trình chính ngay lúc cửa sổ con đang khởi tạo → view
/// chưa sẵn sàng → crash). Chỉ đổi STYLE, giữ nguyên vị trí/kích thước/z-order
/// (NOMOVE|NOSIZE|NOZORDER) nên không đụng phần positioning đã làm trước đó.
void makeWindowBorderless({String title = 'Màn hình phụ'}) {
  if (!Platform.isWindows) return;
  try {
    final user32 = _user32;
    final getLong = user32
        .lookupFunction<_GetWindowLongPtrC, _GetWindowLongPtrD>(
            'GetWindowLongPtrW');
    final setLong = user32
        .lookupFunction<_SetWindowLongPtrC, _SetWindowLongPtrD>(
            'SetWindowLongPtrW');
    final setPos = user32
        .lookupFunction<_SetWindowPosC, _SetWindowPosD>('SetWindowPos');

    final hwnd = _findHwnd(title);
    if (hwnd == 0) {
      dlog('makeWindowBorderless: window "$title" not found');
      return;
    }
    final style = getLong(hwnd, _gwlStyle) &
        ~(_wsCaption | _wsThickframe | _wsMinimizebox | _wsMaximizebox | _wsSysmenu);
    setLong(hwnd, _gwlStyle, style);
    setPos(hwnd, 0, 0, 0, 0, 0,
        _swpNomove | _swpNosize | _swpNozorder | _swpNoactivate | _swpFramechanged);
    dlog('makeWindowBorderless applied');
  } catch (e) {
    dlog('makeWindowBorderless failed (title bar kept): $e');
  }
}

/// Biến cửa sổ phụ (tìm theo tiêu đề) thành kiosk toàn màn hình KHÔNG VIỀN:
/// bỏ thanh tiêu đề Windows + phủ kín đúng một màn hình vật lý. Nếu máy có
/// từ 2 màn hình trở lên thì tự đưa sang màn hình KHÔNG phải màn chính (màn
/// khách). Thất bại ở bất kỳ bước nào → giữ nguyên cửa sổ thường, không crash.
Future<void> makeSecondWindowFullscreen(
    {String title = 'Màn hình phụ'}) async {
  if (!Platform.isWindows) return;
  try {
    final user32 = _user32;
    final getMetrics = user32
        .lookupFunction<_GetSystemMetricsC, _GetSystemMetricsD>(
            'GetSystemMetrics');
    final setPos = user32
        .lookupFunction<_SetWindowPosC, _SetWindowPosD>('SetWindowPos');
    final monitorFrom = user32
        .lookupFunction<_MonitorFromWindowC, _MonitorFromWindowD>(
            'MonitorFromWindow');
    final getMonitorInfo = user32
        .lookupFunction<_GetMonitorInfoC, _GetMonitorInfoD>('GetMonitorInfoW');

    // Cửa sổ con được plugin tạo bất đồng bộ — chờ tối đa ~3s cho nó xuất hiện.
    int hwnd = 0;
    for (var i = 0; i < 30; i++) {
      hwnd = _findHwnd(title);
      if (hwnd != 0) break;
      await Future.delayed(const Duration(milliseconds: 100));
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

      // QUAN TRỌNG — chống crash: KHÔNG đổi window-style (strip WS_CAPTION…)
      // lúc runtime. Cửa sổ phụ do desktop_multi_window quản lý bằng WndProc
      // riêng; SetWindowLongPtr + SWP_FRAMECHANGED kích WM_NCCALCSIZE khi
      // Flutter view của cửa sổ con chưa sẵn sàng → access violation làm SẬP
      // cả app (native crash, try/catch Dart không bắt được).
      //
      // Thay vào đó chỉ DI CHUYỂN + PHÓNG cửa sổ phủ kín màn hình khách và đưa
      // lên TOPMOST (chỉ đổi thứ tự z + vị trí/kích thước — an toàn tuyệt đối,
      // không đụng frame). Taskbar bị cửa sổ topmost phủ lên nên vẫn khuất.
      setPos(hwnd, _hwndTopmost, r.left, r.top, r.right - r.left,
          r.bottom - r.top, _swpShowwindow);
      dlog('SecondScreen covered monitor '
          '(${r.left},${r.top})-(${r.right},${r.bottom}) topmost');
    } finally {
      calloc.free(info);
    }
  } catch (e) {
    dlog('SecondScreen fullscreen failed (window kept as-is): $e');
  }
}

// ---------------------------------------------------------------------------
// Vùng kéo ẩn của cửa sổ phụ: kéo để di chuyển, nhấp đúp để bật/tắt toàn màn
// hình. Các hàm dưới đây chạy TỪ ENGINE CỦA CHÍNH CỬA SỔ PHỤ (an toàn vì chỉ
// di chuyển/đổi kích thước — không đụng window-style lúc runtime).
// ---------------------------------------------------------------------------

/// Vị trí + kích thước cửa sổ TRƯỚC khi phóng toàn màn hình, để lần nhấp đúp
/// sau trả cửa sổ về đúng chỗ cũ. (Biến sống theo engine của cửa sổ phụ.)
({int x, int y, int w, int h})? _savedWindowedRect;

// ── Kéo cửa sổ theo con trỏ chuột ──────────────────────────────────────────
// KHÔNG dùng trò WM_NCLBUTTONDOWN/HTCAPTION: SendMessage từ engine của cửa sổ
// phụ chạy vòng kéo MODAL trên luồng chính và CHẶN luồng UI của engine con
// suốt lúc kéo → app đơ rồi crash (đã xảy ra thật). Thay vào đó tự kéo bằng
// dữ liệu thuần: nhớ vị trí chuột + cửa sổ lúc bấm, mỗi lần chuột nhích thì
// SetWindowPos với SWP_ASYNCWINDOWPOS (chỉ XẾP HÀNG yêu cầu cho luồng sở hữu
// cửa sổ, trả về ngay) — không chặn luồng nào, mọi toạ độ là pixel vật lý nên
// không phụ thuộc tỉ lệ DPI.
int _dragHwnd = 0;
({int x, int y})? _dragCursorStart;
({int x, int y})? _dragWindowStart;

({int x, int y})? _cursorPos() {
  final getCursorPos =
      _user32.lookupFunction<_GetCursorPosC, _GetCursorPosD>('GetCursorPos');
  final pt = calloc<_Point>();
  try {
    if (getCursorPos(pt) == 0) return null;
    return (x: pt.ref.x, y: pt.ref.y);
  } finally {
    calloc.free(pt);
  }
}

/// Gọi khi người dùng ĐÈ chuột lên vùng kéo: chốt mốc chuột + cửa sổ.
void beginSecondWindowDrag({String title = 'Màn hình phụ'}) {
  if (!Platform.isWindows) return;
  try {
    final hwnd = _findHwnd(title);
    if (hwnd == 0) return;
    final getWindowRect =
        _user32.lookupFunction<_GetWindowRectC, _GetWindowRectD>('GetWindowRect');
    final wr = calloc<_Rect>();
    try {
      if (getWindowRect(hwnd, wr) == 0) return;
      _dragHwnd = hwnd;
      _dragWindowStart = (x: wr.ref.left, y: wr.ref.top);
      _dragCursorStart = _cursorPos();
    } finally {
      calloc.free(wr);
    }
  } catch (e) {
    dlog('beginSecondWindowDrag failed: $e');
  }
}

/// Gọi trên mỗi cú nhích chuột trong lúc kéo: dời cửa sổ theo đúng quãng
/// chuột đã đi kể từ lúc bấm. An toàn gọi dày — SetWindowPos async trả về ngay.
void updateSecondWindowDrag() {
  if (!Platform.isWindows) return;
  final hwnd = _dragHwnd;
  final c0 = _dragCursorStart;
  final w0 = _dragWindowStart;
  if (hwnd == 0 || c0 == null || w0 == null) return;
  try {
    final c = _cursorPos();
    if (c == null) return;
    final setPos =
        _user32.lookupFunction<_SetWindowPosC, _SetWindowPosD>('SetWindowPos');
    setPos(hwnd, 0, w0.x + (c.x - c0.x), w0.y + (c.y - c0.y), 0, 0,
        _swpNosize | _swpNozorder | _swpNoactivate | _swpAsyncwindowpos);
  } catch (e) {
    dlog('updateSecondWindowDrag failed: $e');
  }
}

/// Gọi khi nhả chuột / hủy kéo: xả mốc.
void endSecondWindowDrag() {
  _dragHwnd = 0;
  _dragCursorStart = null;
  _dragWindowStart = null;
}

/// Cửa sổ phụ có đang PHỦ KÍN màn hình vật lý chứa nó không (trạng thái toàn
/// màn hình). So toạ độ cửa sổ với toạ độ màn hình, chấp nhận lệch vài px.
bool isSecondWindowFullscreen({String title = 'Màn hình phụ'}) {
  if (!Platform.isWindows) return false;
  try {
    final hwnd = _findHwnd(title);
    if (hwnd == 0) return false;
    final getWindowRect =
        _user32.lookupFunction<_GetWindowRectC, _GetWindowRectD>('GetWindowRect');
    final monitorFrom = _user32
        .lookupFunction<_MonitorFromWindowC, _MonitorFromWindowD>(
            'MonitorFromWindow');
    final getMonitorInfo = _user32
        .lookupFunction<_GetMonitorInfoC, _GetMonitorInfoD>('GetMonitorInfoW');

    final wr = calloc<_Rect>();
    final info = calloc<_MonitorInfo>();
    try {
      if (getWindowRect(hwnd, wr) == 0) return false;
      info.ref.cbSize = sizeOf<_MonitorInfo>();
      final mon = monitorFrom(hwnd, _monitorDefaulttonearest);
      if (getMonitorInfo(mon, info) == 0) return false;
      final m = info.ref.rcMonitor;
      final w = wr.ref;
      const tol = 4; // px
      return (w.left - m.left).abs() <= tol &&
          (w.top - m.top).abs() <= tol &&
          (w.right - m.right).abs() <= tol &&
          (w.bottom - m.bottom).abs() <= tol;
    } finally {
      calloc.free(wr);
      calloc.free(info);
    }
  } catch (_) {
    return false;
  }
}

/// Bật/tắt TOÀN MÀN HÌNH cho cửa sổ phụ (gọi khi nhấp đúp vùng kéo ẩn).
///
/// - Đang cửa sổ thường → lưu lại vị trí/kích thước hiện tại rồi phủ kín màn
///   hình vật lý ĐANG CHỨA cửa sổ (kéo sang màn nào thì phóng ở màn đó) và đưa
///   lên TOPMOST như chế độ kiosk lúc mở.
/// - Đang toàn màn hình → trả về vị trí đã lưu (chưa từng lưu thì về cửa sổ
///   1024x768 lệch góc trên-trái của màn đó) và BỎ topmost để không đè các
///   cửa sổ khác.
///
/// Trả về trạng thái MỚI (true = toàn màn hình). Lỗi ở bất kỳ bước nào → giữ
/// nguyên cửa sổ, trả về trạng thái hiện tại.
bool toggleSecondWindowFullscreen({String title = 'Màn hình phụ'}) {
  if (!Platform.isWindows) return false;
  try {
    final hwnd = _findHwnd(title);
    if (hwnd == 0) return false;
    final getWindowRect =
        _user32.lookupFunction<_GetWindowRectC, _GetWindowRectD>('GetWindowRect');
    final setPos =
        _user32.lookupFunction<_SetWindowPosC, _SetWindowPosD>('SetWindowPos');
    final monitorFrom = _user32
        .lookupFunction<_MonitorFromWindowC, _MonitorFromWindowD>(
            'MonitorFromWindow');
    final getMonitorInfo = _user32
        .lookupFunction<_GetMonitorInfoC, _GetMonitorInfoD>('GetMonitorInfoW');

    final info = calloc<_MonitorInfo>();
    final wr = calloc<_Rect>();
    try {
      info.ref.cbSize = sizeOf<_MonitorInfo>();
      final mon = monitorFrom(hwnd, _monitorDefaulttonearest);
      if (getMonitorInfo(mon, info) == 0) return isSecondWindowFullscreen(title: title);
      final m = info.ref.rcMonitor;

      if (isSecondWindowFullscreen(title: title)) {
        // Thoát toàn màn hình → về vị trí đã lưu / cửa sổ mặc định.
        final r = _savedWindowedRect ??
            (x: m.left + 120, y: m.top + 120, w: 1024, h: 768);
        setPos(hwnd, _hwndNotopmost, r.x, r.y, r.w, r.h,
            _swpShowwindow | _swpAsyncwindowpos);
        dlog('SecondScreen windowed (${r.x},${r.y}) ${r.w}x${r.h}');
        return false;
      }

      // Vào toàn màn hình → nhớ chỗ cũ rồi phủ kín màn hình đang chứa cửa sổ.
      if (getWindowRect(hwnd, wr) != 0) {
        final w = wr.ref;
        _savedWindowedRect =
            (x: w.left, y: w.top, w: w.right - w.left, h: w.bottom - w.top);
      }
      setPos(hwnd, _hwndTopmost, m.left, m.top, m.right - m.left,
          m.bottom - m.top, _swpShowwindow | _swpAsyncwindowpos);
      dlog('SecondScreen fullscreen on monitor '
          '(${m.left},${m.top})-(${m.right},${m.bottom})');
      return true;
    } finally {
      calloc.free(info);
      calloc.free(wr);
    }
  } catch (e) {
    dlog('toggleSecondWindowFullscreen failed: $e');
    return isSecondWindowFullscreen(title: title);
  }
}
