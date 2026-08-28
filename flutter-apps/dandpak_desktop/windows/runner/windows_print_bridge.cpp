#include "windows_print_bridge.h"

#include <printmanagerinterop.h>
#include <roapi.h>
#include <winrt/Windows.Foundation.h>
#include <winrt/Windows.Foundation.Collections.h>
#include <winrt/Windows.Graphics.Printing.h>
#include <winrt/Windows.UI.h>
#include <winrt/Windows.UI.Xaml.h>
#include <winrt/Windows.UI.Xaml.Controls.h>
#include <winrt/Windows.UI.Xaml.Hosting.h>
#include <winrt/Windows.UI.Xaml.Media.h>
#include <winrt/Windows.UI.Xaml.Printing.h>

#include <algorithm>
#include <sstream>
#include <string>
#include <vector>

using namespace winrt;
using namespace winrt::Windows::Foundation;
using namespace winrt::Windows::Graphics::Printing;
using namespace winrt::Windows::UI;
using namespace winrt::Windows::UI::Xaml;
using namespace winrt::Windows::UI::Xaml::Controls;
using namespace winrt::Windows::UI::Xaml::Hosting;
using namespace winrt::Windows::UI::Xaml::Media;
using namespace winrt::Windows::UI::Xaml::Printing;

namespace {
std::wstring Utf8ToWide(const std::string& value) {
  if (value.empty()) return {};
  const int size = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS,
                                       value.data(), static_cast<int>(value.size()),
                                       nullptr, 0);
  if (size <= 0) return {};
  std::wstring result(size, L'\0');
  MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, value.data(),
                      static_cast<int>(value.size()), result.data(), size);
  return result;
}

std::vector<std::wstring> Lines(const std::wstring& text) {
  std::vector<std::wstring> lines;
  std::wstringstream input(text);
  std::wstring line;
  while (std::getline(input, line)) {
    if (!line.empty() && line.back() == L'\r') line.pop_back();
    lines.push_back(line);
  }
  if (lines.empty()) lines.push_back(L"");
  return lines;
}
}  // namespace

class WindowsPrintBridge::Impl {
 public:
  explicit Impl(HWND hwnd) : hwnd_(hwnd) {}

  ~Impl() { Unregister(); }

  bool Show(const std::wstring& title, const std::wstring& text) {
    // Do not initialize XAML during runner startup. Flutter owns the process
    // COM setup, and eager initialization caused the desktop app to terminate
    // before the first frame. Printing initializes its native document host
    // only when the operator explicitly requests it.
    if (!xaml_manager_) {
      xaml_manager_ = WindowsXamlManager::InitializeForCurrentThread();
    }
    Unregister();
    title_ = title.empty() ? L"Dan D Pak - In tài liệu" : title;
    lines_ = Lines(text);

    auto interop = get_activation_factory<PrintManager, IPrintManagerInterop>();
    check_hresult(interop->GetForWindow(
        hwnd_, guid_of<PrintManager>(), put_abi(print_manager_)));

    print_document_ = PrintDocument();
    document_source_ = print_document_.DocumentSource();
    paginate_token_ = print_document_.Paginate(
        {this, &Impl::OnPaginate});
    preview_token_ = print_document_.GetPreviewPage(
        {this, &Impl::OnGetPreviewPage});
    add_pages_token_ = print_document_.AddPages(
        {this, &Impl::OnAddPages});
    task_token_ = print_manager_.PrintTaskRequested(
        {this, &Impl::OnPrintTaskRequested});

    com_ptr<IAsyncOperation<bool>> operation;
    check_hresult(interop->ShowPrintUIForWindowAsync(
        hwnd_, guid_of<IAsyncOperation<bool>>(), operation.put_void()));
    return true;
  }

 private:
  void Unregister() noexcept {
    try {
      if (print_manager_ && task_token_.value) {
        print_manager_.PrintTaskRequested(task_token_);
      }
      if (print_document_) {
        if (paginate_token_.value) print_document_.Paginate(paginate_token_);
        if (preview_token_.value) print_document_.GetPreviewPage(preview_token_);
        if (add_pages_token_.value) print_document_.AddPages(add_pages_token_);
      }
    } catch (...) {}
    task_token_ = {};
    paginate_token_ = {};
    preview_token_ = {};
    add_pages_token_ = {};
    pages_.clear();
    document_source_ = nullptr;
    print_document_ = nullptr;
    print_manager_ = nullptr;
  }

  void OnPrintTaskRequested(PrintManager const&,
                            PrintTaskRequestedEventArgs const& args) {
    auto deferral = args.Request().GetDeferral();
    auto task = args.Request().CreatePrintTask(
        title_, [this](PrintTaskSourceRequestedArgs const& source_args) {
          source_args.SetSource(document_source_);
        });
    task.Completed([this](PrintTask const&,
                          PrintTaskCompletedEventArgs const&) {
      // Keep objects alive until Windows has finished/cancelled the job.
    });
    deferral.Complete();
  }

  UIElement BuildPage(const std::vector<std::wstring>& page_lines,
                      PrintPageDescription const& description) {
    auto panel = StackPanel();
    panel.Width(description.PageSize.Width);
    panel.Height(description.PageSize.Height);
    panel.Padding(Thickness{description.ImageableRect.X + 12,
                            description.ImageableRect.Y + 12,
                            12, 12});
    auto background = SolidColorBrush(Colors::White());
    panel.Background(background);

    auto text = TextBlock();
    std::wstring content;
    for (size_t i = 0; i < page_lines.size(); ++i) {
      if (i) content += L"\n";
      content += page_lines[i];
    }
    text.Text(content);
    text.FontFamily(FontFamily(L"Consolas"));
    text.FontSize(12);
    text.Foreground(SolidColorBrush(Colors::Black()));
    text.TextWrapping(TextWrapping::Wrap);
    panel.Children().Append(text);
    // PrintDocument does not run these detached pages through Flutter's visual
    // tree. Give XAML an explicit layout pass so preview and spool output both
    // receive the text/vector primitives instead of an empty page.
    panel.Measure(Size{description.PageSize.Width,
                       description.PageSize.Height});
    panel.Arrange(Rect{0, 0, description.PageSize.Width,
                       description.PageSize.Height});
    panel.UpdateLayout();
    return panel;
  }

  void OnPaginate(winrt::Windows::Foundation::IInspectable const&,
                  PaginateEventArgs const& args) {
    pages_.clear();
    const auto options = args.PrintTaskOptions();
    const auto description = options.GetPageDescription(0);
    const double usable =
        std::max(100.0, static_cast<double>(description.ImageableRect.Height) - 28.0);
    const size_t lines_per_page =
        static_cast<size_t>(std::max(8.0, usable / 17.0));
    for (size_t start = 0; start < lines_.size(); start += lines_per_page) {
      const auto end = std::min(lines_.size(), start + lines_per_page);
      pages_.push_back(BuildPage(
          std::vector<std::wstring>(lines_.begin() + start,
                                    lines_.begin() + end),
          description));
    }
    print_document_.SetPreviewPageCount(
        static_cast<int32_t>(pages_.size()),
        PreviewPageCountType::Final);
  }

  void OnGetPreviewPage(winrt::Windows::Foundation::IInspectable const&,
                        GetPreviewPageEventArgs const& args) {
    const int index = args.PageNumber() - 1;
    if (index >= 0 && static_cast<size_t>(index) < pages_.size()) {
      print_document_.SetPreviewPage(args.PageNumber(), pages_[index]);
    }
  }

  void OnAddPages(winrt::Windows::Foundation::IInspectable const&,
                  AddPagesEventArgs const&) {
    for (const auto& page : pages_) print_document_.AddPage(page);
    print_document_.AddPagesComplete();
  }

  HWND hwnd_;
  WindowsXamlManager xaml_manager_{nullptr};
  PrintManager print_manager_{nullptr};
  PrintDocument print_document_{nullptr};
  winrt::Windows::Graphics::Printing::IPrintDocumentSource document_source_{nullptr};
  event_token task_token_{};
  event_token paginate_token_{};
  event_token preview_token_{};
  event_token add_pages_token_{};
  std::wstring title_;
  std::vector<std::wstring> lines_;
  std::vector<UIElement> pages_;
};

WindowsPrintBridge::WindowsPrintBridge(
    HWND hwnd, flutter::BinaryMessenger* messenger)
    : impl_(std::make_unique<Impl>(hwnd)),
      channel_(std::make_unique<flutter::MethodChannel<flutter::EncodableValue>>(
          messenger, "dandpak/windows_print",
          &flutter::StandardMethodCodec::GetInstance())) {
  channel_->SetMethodCallHandler(
      [this](const flutter::MethodCall<flutter::EncodableValue>& call,
             std::unique_ptr<flutter::MethodResult<flutter::EncodableValue>> result) {
        if (call.method_name() != "showPrintUI") {
          result->NotImplemented();
          return;
        }
        try {
          std::string title;
          std::string text;
          if (const auto* args = std::get_if<flutter::EncodableMap>(call.arguments())) {
            const auto title_it = args->find(flutter::EncodableValue("title"));
            const auto text_it = args->find(flutter::EncodableValue("text"));
            if (title_it != args->end()) {
              if (const auto* value = std::get_if<std::string>(&title_it->second)) title = *value;
            }
            if (text_it != args->end()) {
              if (const auto* value = std::get_if<std::string>(&text_it->second)) text = *value;
            }
          }
          if (text.empty()) {
            result->Error("EMPTY_DOCUMENT", "Khong co noi dung de in.");
            return;
          }
          result->Success(flutter::EncodableValue(
              impl_->Show(Utf8ToWide(title), Utf8ToWide(text))));
        } catch (const winrt::hresult_error& error) {
          result->Error("WINDOWS_PRINT_ERROR",
                        winrt::to_string(error.message()));
        } catch (...) {
          result->Error("WINDOWS_PRINT_ERROR", "Khong the mo giao dien in Windows.");
        }
      });
}

WindowsPrintBridge::~WindowsPrintBridge() = default;
