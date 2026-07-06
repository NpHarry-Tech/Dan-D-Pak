import 'dart:convert';
import 'dart:io';

/// Opens the OS file picker WITHOUT a Flutter plugin (uses a native shell
/// dialog through Process.run) and returns the chosen image/PDF as a
/// `data:<mime>;base64,...` URL — the same shape the web sends for receipts.
/// Returns null if the user cancels or anything fails.
Future<String?> pickReceiptAsDataUrl() async {
  try {
    final path = await _pickPath();
    if (path == null || path.trim().isEmpty) return null;
    final file = File(path.trim());
    if (!await file.exists()) return null;
    final bytes = await file.readAsBytes();
    if (bytes.isEmpty) return null;
    return 'data:${_mimeForPath(path)};base64,${base64Encode(bytes)}';
  } catch (_) {
    return null;
  }
}

Future<String?> _pickPath() async {
  if (Platform.isWindows) {
    // WinForms OpenFileDialog needs a single-threaded apartment (-STA).
    const ps = r'''
Add-Type -AssemblyName System.Windows.Forms | Out-Null
$f = New-Object System.Windows.Forms.OpenFileDialog
$f.Filter = 'Anh/PDF|*.jpg;*.jpeg;*.png;*.webp;*.gif;*.pdf|Tat ca|*.*'
$f.Title = 'Chon anh hoa don'
if ($f.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($f.FileName) }
''';
    final res = await Process.run(
        'powershell', ['-NoProfile', '-STA', '-Command', ps]);
    final out = (res.stdout as String?)?.trim() ?? '';
    return out.isEmpty ? null : out;
  }
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
