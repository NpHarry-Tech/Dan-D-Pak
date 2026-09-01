#pragma once

#include <flutter/binary_messenger.h>
#include <flutter/method_channel.h>
#include <flutter/standard_method_codec.h>
#include <windows.h>

#include <memory>

class WindowsPrintBridge {
 public:
  WindowsPrintBridge(HWND hwnd, flutter::BinaryMessenger* messenger);
  ~WindowsPrintBridge();

  WindowsPrintBridge(const WindowsPrintBridge&) = delete;
  WindowsPrintBridge& operator=(const WindowsPrintBridge&) = delete;

 private:
  class Impl;
  std::unique_ptr<Impl> impl_;
  std::unique_ptr<flutter::MethodChannel<flutter::EncodableValue>> channel_;
};

