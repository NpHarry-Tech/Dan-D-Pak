import 'dart:convert';
import 'dart:io';

import 'package:image_picker/image_picker.dart';

import '../services/system_log.dart';

// Plugin chọn ảnh/file lỗi → trả null (lỗi nghiệp vụ, app không chết) nhưng
// PHẢI để lại dấu vết trong nhật ký hệ thống để truy ra máy nào hỏng plugin gì.
void _logPickFailed(String action, Object e) {
  SystemLog.log(
    level: 'warn',
    source: 'flutter_app',
    eventType: 'plugin_error',
    title: 'Chọn file/ảnh thất bại ($action)',
    message: e.toString(),
    action: action,
    exceptionType: e.runtimeType.toString(),
  );
}

/// Chọn ảnh trên Android/iOS bằng image_picker (thư viện ảnh) và trả về data
/// URL. Desktop KHÔNG dùng nhánh này. [source] mặc định gallery; truyền camera
/// để chụp mới.
Future<String?> _pickImageMobileAsDataUrl(
    {ImageSource source = ImageSource.gallery}) async {
  try {
    final x = await ImagePicker().pickImage(source: source, imageQuality: 88);
    if (x == null) return null;
    final bytes = await x.readAsBytes();
    if (bytes.isEmpty) return null;
    return 'data:${_mimeForPath(x.name)};base64,${base64Encode(bytes)}';
  } catch (e) {
    _logPickFailed('image_picker', e);
    return null;
  }
}

/// Chọn MỘT ảnh và trả về ĐƯỜNG DẪN file — dùng cho avatar nhân viên/khách
/// hàng và ảnh món (caller tự đọc bytes + upload).
///
/// Trước đây mỗi màn tự mở PowerShell OpenFileDialog → trên Android bấm nút
/// KHÔNG có phản ứng gì (Process.run('powershell') fail lặng lẽ). Giờ:
/// Android/iOS đi qua image_picker (thư viện ảnh), desktop giữ hộp thoại hệ
/// điều hành. Trả null nếu người dùng hủy hoặc plugin lỗi (đã ghi nhật ký).
Future<String?> pickImagePathCross({String title = 'Chọn ảnh'}) async {
  try {
    if (Platform.isAndroid || Platform.isIOS) {
      final x = await ImagePicker().pickImage(
          source: ImageSource.gallery, imageQuality: 88);
      return x?.path;
    }
    if (Platform.isWindows) {
      final ps = '''
Add-Type -AssemblyName System.Windows.Forms | Out-Null
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
\$f = New-Object System.Windows.Forms.OpenFileDialog
\$f.Title = '$title'
\$f.Filter = 'Anh (*.jpg;*.jpeg;*.png;*.webp;*.gif)|*.jpg;*.jpeg;*.png;*.webp;*.gif'
\$f.Multiselect = \$false
if (\$f.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output \$f.FileName }
''';
      final result = await Process.run(
        'powershell.exe',
        ['-NoProfile', '-STA', '-Command', ps],
      );
      if (result.exitCode != 0) return null;
      final path = result.stdout.toString().trim();
      return path.isEmpty ? null : path;
    }
    final path = await _pickPathUnix();
    return (path == null || path.trim().isEmpty) ? null : path.trim();
  } catch (e) {
    _logPickFailed('pick_image_path', e);
    return null;
  }
}

/// Opens the OS file picker WITHOUT a Flutter plugin (uses a native shell
/// dialog through Process.run) and returns the chosen image/PDF as a
/// `data:<mime>;base64,...` URL — the same shape the web sends for receipts.
/// Returns null if the user cancels or anything fails.
Future<String?> pickReceiptAsDataUrl() async {
  try {
    // Tablet/điện thoại: mở thư viện ảnh (chụp hoá đơn thì chọn ảnh vừa chụp).
    if (Platform.isAndroid || Platform.isIOS) {
      return await _pickImageMobileAsDataUrl();
    }
    if (Platform.isWindows) return await _pickDataUrlWindows();

    // macOS / Linux: pick a path then read it in Dart (stdout is UTF-8 there).
    final path = await _pickPathUnix();
    if (path == null || path.trim().isEmpty) return null;
    final file = File(path.trim());
    if (!await file.exists()) return null;
    final bytes = await file.readAsBytes();
    if (bytes.isEmpty) return null;
    return 'data:${_mimeForPath(path)};base64,${base64Encode(bytes)}';
  } catch (e) {
    _logPickFailed('pick_receipt', e);
    return null;
  }
}

/// Windows: the dialog + file read + base64 all happen INSIDE PowerShell, and
/// only the finished `data:` URL (pure ASCII) crosses back to Dart. This avoids
/// a real bug: paths containing non-ASCII characters (e.g. a OneDrive folder
/// named "… hoặc …") got corrupted when the raw path was returned through
/// Process.run stdout (decoded with the system codepage), so the file could no
/// longer be found and the image was silently dropped. Reading in PowerShell
/// also forces OneDrive "online-only" files to download first.
Future<String?> _pickDataUrlWindows() async {
  const ps = r'''
Add-Type -AssemblyName System.Windows.Forms | Out-Null
$f = New-Object System.Windows.Forms.OpenFileDialog
$f.Filter = 'Anh/PDF|*.jpg;*.jpeg;*.png;*.webp;*.gif;*.pdf|Tat ca|*.*'
$f.Title = 'Chon anh hoa don'
if ($f.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
  $path = $f.FileName
  $ext = [System.IO.Path]::GetExtension($path).ToLowerInvariant()
  switch ($ext) {
    '.png'  { $mime = 'image/png' }
    '.webp' { $mime = 'image/webp' }
    '.gif'  { $mime = 'image/gif' }
    '.pdf'  { $mime = 'application/pdf' }
    default { $mime = 'image/jpeg' }
  }
  $bytes = [System.IO.File]::ReadAllBytes($path)
  $b64 = [System.Convert]::ToBase64String($bytes)
  [Console]::Out.Write("data:$mime;base64,$b64")
}
''';
  // base64 output is ASCII → decode as ascii so no codepage can mangle it,
  // and allow a big buffer for multi-MB images.
  final res = await Process.run(
    'powershell',
    ['-NoProfile', '-STA', '-Command', ps],
    stdoutEncoding: ascii,
  );
  final out = (res.stdout as String?)?.trim() ?? '';
  return out.startsWith('data:image/') || out.startsWith('data:application/pdf')
      ? out
      : null;
}

Future<String?> _pickPathUnix() async {
  if (Platform.isMacOS) {
    const script =
        'POSIX path of (choose file with prompt "Chọn ảnh hóa đơn" of type {"public.image","com.adobe.pdf"})';
    final res = await Process.run('osascript', ['-e', script]);
    final out = (res.stdout as String?)?.trim() ?? '';
    return out.isEmpty ? null : out;
  }
  // Linux (best-effort).
  final res = await Process.run(
      'zenity', ['--file-selection', '--title=Chọn ảnh hóa đơn']);
  final out = (res.stdout as String?)?.trim() ?? '';
  return out.isEmpty ? null : out;
}

String _mimeForPath(String path) {
  final p = path.toLowerCase();
  if (p.endsWith('.png')) return 'image/png';
  if (p.endsWith('.webp')) return 'image/webp';
  if (p.endsWith('.gif')) return 'image/gif';
  if (p.endsWith('.pdf')) return 'application/pdf';
  return 'image/jpeg';
}

/// Pick an ad media file (image or video) and convert it to a data URL.
Future<String?> pickAdFileAsDataUrl() async {
  try {
    // Tablet/điện thoại: chọn ảnh quảng cáo từ thư viện (video quảng cáo hiếm
    // dùng trên tablet — nếu cần sẽ bổ sung pickVideo sau).
    if (Platform.isAndroid || Platform.isIOS) {
      return await _pickImageMobileAsDataUrl();
    }
    if (Platform.isWindows) return await _pickAdDataUrlWindows();

    final path = await _pickAdPathUnix();
    if (path == null || path.trim().isEmpty) return null;
    final file = File(path.trim());
    if (!await file.exists()) return null;
    final bytes = await file.readAsBytes();
    if (bytes.isEmpty) return null;
    return 'data:${_mimeForAdPath(path)};base64,${base64Encode(bytes)}';
  } catch (e) {
    _logPickFailed('pick_ad_media', e);
    return null;
  }
}

Future<String?> _pickAdDataUrlWindows() async {
  const ps = r'''
Add-Type -AssemblyName System.Windows.Forms | Out-Null
$f = New-Object System.Windows.Forms.OpenFileDialog
$f.Filter = 'Media Files|*.jpg;*.jpeg;*.png;*.webp;*.gif;*.mp4;*.mov;*.avi;*.mkv|All files|*.*'
$f.Title = 'Chon hinh anh hoac video quang cao'
if ($f.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
  $path = $f.FileName
  $ext = [System.IO.Path]::GetExtension($path).ToLowerInvariant()
  switch ($ext) {
    '.png'  { $mime = 'image/png' }
    '.webp' { $mime = 'image/webp' }
    '.gif'  { $mime = 'image/gif' }
    '.mp4'  { $mime = 'video/mp4' }
    '.mov'  { $mime = 'video/quicktime' }
    '.avi'  { $mime = 'video/x-msvideo' }
    '.mkv'  { $mime = 'video/x-matroska' }
    default { $mime = 'image/jpeg' }
  }
  $bytes = [System.IO.File]::ReadAllBytes($path)
  $b64 = [System.Convert]::ToBase64String($bytes)
  [Console]::Out.Write("data:$mime;base64,$b64")
}
''';
  final res = await Process.run(
    'powershell',
    ['-NoProfile', '-STA', '-Command', ps],
    stdoutEncoding: ascii,
  );
  final out = (res.stdout as String?)?.trim() ?? '';
  return out.startsWith('data:image/') || out.startsWith('data:video/')
      ? out
      : null;
}

Future<String?> _pickAdPathUnix() async {
  if (Platform.isMacOS) {
    const script =
        'POSIX path of (choose file with prompt "Chọn hình ảnh hoặc video quảng cáo" of type {"public.image","public.movie"})';
    final res = await Process.run('osascript', ['-e', script]);
    final out = (res.stdout as String?)?.trim() ?? '';
    return out.isEmpty ? null : out;
  }
  final res = await Process.run(
      'zenity', ['--file-selection', '--title=Chọn hình ảnh hoặc video quảng cáo']);
  final out = (res.stdout as String?)?.trim() ?? '';
  return out.isEmpty ? null : out;
}

String _mimeForAdPath(String path) {
  final p = path.toLowerCase();
  if (p.endsWith('.png')) return 'image/png';
  if (p.endsWith('.webp')) return 'image/webp';
  if (p.endsWith('.gif')) return 'image/gif';
  if (p.endsWith('.mp4')) return 'video/mp4';
  if (p.endsWith('.mov')) return 'video/quicktime';
  if (p.endsWith('.avi')) return 'video/x-msvideo';
  if (p.endsWith('.mkv')) return 'video/x-matroska';
  return 'image/jpeg';
}
