#include <flutter/dart_project.h>
#include <flutter/flutter_view_controller.h>
#include <windows.h>

#include <algorithm>

#include "flutter_window.h"
#include "utils.h"

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
  if (!window.Create(customer_display ? L"Màn hình phụ" : L"Dan D Pak POS",
                     origin, size)) {
    return EXIT_FAILURE;
  }
  window.SetQuitOnClose(true);

  ::MSG msg;
  while (::GetMessage(&msg, nullptr, 0, 0)) {
    ::TranslateMessage(&msg);
    ::DispatchMessage(&msg);
  }

  ::CoUninitialize();
  return EXIT_SUCCESS;
}
