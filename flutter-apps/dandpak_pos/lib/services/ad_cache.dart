import 'dart:convert';
import 'dart:io';

/// Chuyển danh sách nguồn quảng cáo về dạng PHÁT ĐƯỢC trên màn hình khách:
/// - data-URL (ảnh/video base64, có thể vài MB) → ghi ra file tạm dùng chung
///   `%TEMP%/dandpak_ads/`, đặt tên theo hash nội dung để lần sau tái dùng,
///   trả về đường dẫn file. (Không bao giờ đẩy nguyên base64 qua method
///   channel giữa 2 cửa sổ — payload lớn làm sập app.)
/// - URL http(s) → giữ nguyên.
/// - Nguồn hỏng/không đọc được → bỏ qua, không để làm sập.
Future<List<String>> materializeAdSources(List<String> images) async {
  final dir = Directory('${Directory.systemTemp.path}/dandpak_ads');
  try {
    await dir.create(recursive: true);
  } catch (_) {}
  final out = <String>[];
  for (final img in images) {
    if (img.startsWith('data:image/') || img.startsWith('data:video/')) {
      try {
        final comma = img.indexOf(',');
        final bytes = base64Decode(comma >= 0 ? img.substring(comma + 1) : img);
        final f = File('${dir.path}/ad_${img.hashCode & 0x7fffffff}${_extFor(img)}');
        if (!f.existsSync() || f.lengthSync() != bytes.length) {
          await f.writeAsBytes(bytes);
        }
        out.add(f.path);
      } catch (_) {
        // nguồn hỏng → bỏ qua
      }
    } else if (img.isNotEmpty) {
      out.add(img);
    }
  }
  return out;
}

String _extFor(String dataUrl) {
  if (dataUrl.startsWith('data:image/')) return '.img';
  if (dataUrl.contains('video/quicktime')) return '.mov';
  if (dataUrl.contains('video/x-msvideo')) return '.avi';
  if (dataUrl.contains('video/x-matroska')) return '.mkv';
  return '.mp4';
}
