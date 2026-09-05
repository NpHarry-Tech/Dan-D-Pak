#include <flutter/dart_project.h>
#include <flutter/flutter_view_controller.h>
#include <windows.h>

#include <algorithm>

#include "flutter_window.h"
#include "utils.h"

namespace {
void ActivateExistingWindow(HWND existing) {
  if (existing == nullptr) return;
  // Async restore does not wait on a hung UI thread. If foreground activation
  // is refused, flash the taskbar so the second launch gives visible feedback.
  if (::IsIconic(existing)) ::ShowWindowAsync(existing, SW_RESTORE);
  bool activated = false;
  if (!::IsHungAppWindow(existing)) {
    ::SetWindowPos(existing, HWND_TOP, 0, 0, 0, 0,
                   SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW);
    activated = ::SetForegroundWindow(existing) != FALSE;
  }
  if (!activated) {
    FLASHWINFO flash = {sizeof(FLASHWINFO), existing,
                        FLASHW_TRAY | FLASHW_TIMERNOFG, 3, 0};
    ::FlashWindowEx(&flash);
  }
}
}  // namespace

int APIENTRY wWinMain(_In_ HINSTANCE instance, _In_opt_ HINSTANCE prev,
                      _In_ wchar_t *command_line, _In_ int show_command) {
  // Attach to console when present (e.g., 'flutter run') or create a
  // new console when running with a debugger.
  if (!::AttachConsole(ATTACH_PARENT_PROCESS) && ::IsDebuggerPresent()) {
    CreateAndAttachConsole();
  }

  // Initialize COM, so that it is available for use in the library and/or
  // plugins.
  ::CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);

  flutter::DartProject project(L"data");

  std::vector<std::string> command_line_arguments =
      GetCommandLineArguments();
  const bool customer_display =
      std::find(command_line_arguments.begin(), command_line_arguments.end(),
                "--customer-display") != command_line_arguments.end();

  // SINGLE-INSTANCE cho cửa sổ POS CHÍNH. Một named mutex cho lần mở thứ hai
  // phát hiện tiến trình đang chạy rồi ĐƯA CỬA SỔ CŨ LÊN thay vì mở cửa sổ mới
  // (cùng cơ chế named-mutex Windows dùng để đồng bộ xuyên tiến trình). Màn hình
  // phụ (--customer-display) CỐ Ý là tiến trình riêng nên được miễn trừ.
  HANDLE single_instance_mutex = nullptr;
  if (!customer_display) {
    single_instance_mutex =
        ::CreateMutexW(nullptr, TRUE, L"Local\\DanDPakPOS_SingleInstance");
    if (single_instance_mutex == nullptr ||
        ::GetLastError() == ERROR_ALREADY_EXISTS) {
      HWND existing = ::FindWindowW(nullptr, L"Dan-D Pak POS");
      ActivateExistingWindow(existing);
      if (single_instance_mutex != nullptr) {
        ::CloseHandle(single_instance_mutex);
      }
      ::CoUninitialize();
      return EXIT_SUCCESS;
    }
  }

  project.set_dart_entrypoint_arguments(std::move(command_line_arguments));

  FlutterWindow window(project);
  // POS terminals are often 1024x768: clamp the initial window to the
  // monitor's work area so the frameless window never spawns off-screen.
  RECT work_area = {0, 0, 1440, 900};
  ::SystemParametersInfo(SPI_GETWORKAREA, 0, &work_area, 0);
  const LONG work_w = work_area.right - work_area.left;
  const LONG work_h = work_area.bottom - work_area.top;
  const unsigned int width =
      static_cast<unsigned int>(work_w < 1460 ? work_w - 20 : 1440);
  const unsigned int height =
      static_cast<unsigned int>(work_h < 920 ? work_h - 20 : 900);
  Win32Window::Point origin(10, 10);
  Win32Window::Size size(width, height);
  if (!window.Create(customer_display ? L"Màn hình phụ" : L"Dan-D Pak POS",
                     origin, size)) {
    if (single_instance_mutex != nullptr) {
      ::CloseHandle(single_instance_mutex);
    }
    ::CoUninitialize();
    return EXIT_FAILURE;
  }
  window.SetQuitOnClose(true);

  ::MSG msg;
  while (::GetMessage(&msg, nullptr, 0, 0)) {
    ::TranslateMessage(&msg);
    ::DispatchMessage(&msg);
  }

  if (single_instance_mutex != nullptr) {
    ::CloseHandle(single_instance_mutex);
  }
  ::CoUninitialize();
  return EXIT_SUCCESS;
}
