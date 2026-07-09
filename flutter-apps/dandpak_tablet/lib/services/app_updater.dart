import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:url_launcher/url_launcher.dart';

import '../app_version.dart';

/// Kiểm tra bản cập nhật cho app tablet (Android).
///
/// Cách hoạt động: hỏi server `/api/app/version?platform=android`; nếu server
/// có build MỚI HƠN bản đang chạy thì hiện hộp thoại mời tải. Bấm "Tải bản
/// cập nhật" sẽ mở trình duyệt tải file APK từ chính server
/// (`/api/app/download/android`) — Android tải xong chỉ cần chạm vào file để
/// cài đè (giữ nguyên dữ liệu). Mọi lỗi mạng đều im lặng bỏ qua, không chặn
/// việc dùng app.
class TabletUpdater {
  TabletUpdater._();

  /// Chỉ nhắc 1 lần cho mỗi lần mở app — tránh làm phiền nhân viên.
  static bool _promptedThisSession = false;

  static Future<void> checkAndPrompt(BuildContext context, String serverUrl) async {
    if (_promptedThisSession) return;
    final base = serverUrl.trim().replaceAll(RegExp(r'/+$'), '');
    if (base.isEmpty) return;

    Map<String, dynamic>? info;
    try {
      final res = await http
          .get(Uri.parse('$base/api/app/version?platform=android'))
          .timeout(const Duration(seconds: 4));
      if (res.statusCode != 200) return;
      final body = jsonDecode(res.body);
      if (body is Map<String, dynamic>) info = body;
    } catch (_) {
      return; // không có mạng / server cũ chưa có API — bỏ qua
    }
    if (info == null || info['available'] != true) return;
    final serverBuild = (info['buildNumber'] is num) ? (info['buildNumber'] as num).toInt() : 0;
    if (serverBuild <= kAppBuildNumber) return;

    _promptedThisSession = true;
    if (!context.mounted) return;
    final version = (info['version'] ?? '').toString();
    final notes = (info['notes'] ?? '').toString();
    await showDialog<void>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Có bản cập nhật mới'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Phiên bản $version (bản hiện tại: $kAppVersionName).'),
            if (notes.isNotEmpty) ...[
              const SizedBox(height: 8),
              Text(notes, style: const TextStyle(fontSize: 13)),
            ],
            const SizedBox(height: 8),
            const Text(
              'Bấm "Tải bản cập nhật", chờ tải xong rồi chạm vào file vừa tải để cài đè. Dữ liệu và cài đặt được giữ nguyên.',
              style: TextStyle(fontSize: 12.5, color: Colors.black54),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(),
            child: const Text('Để sau'),
          ),
          FilledButton(
            onPressed: () {
              Navigator.of(ctx).pop();
              launchUrl(
                Uri.parse('$base/api/app/download/android'),
                mode: LaunchMode.externalApplication,
              ).catchError((_) => false);
            },
            child: const Text('Tải bản cập nhật'),
          ),
        ],
      ),
    );
  }
}
