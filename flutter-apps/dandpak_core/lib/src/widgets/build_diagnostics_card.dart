import 'package:flutter/material.dart';

import '../app_build_metadata.dart';
import '../app_flavor.dart';
import '../services/system_log.dart';
import '../ui/app_theme.dart';

bool canViewAdvancedDiagnostics({
  required String role,
  required bool hasDiagnosticsPermission,
}) =>
    {'owner', 'admin'}.contains(role.toLowerCase()) && hasDiagnosticsPermission;

String maskedDiagnosticId(String value) {
  final clean = value.trim();
  if (clean.isEmpty) return 'chưa định danh';
  final tail = clean.length <= 6 ? clean : clean.substring(clean.length - 6);
  return '••••••$tail';
}

String diagnosticEndpointHost(String value) {
  final uri = Uri.tryParse(value.trim());
  return uri?.host.toLowerCase() ?? '';
}

String shortGitSha(String value) {
  final clean = value.trim().toLowerCase();
  return RegExp(r'^[0-9a-f]{8,}$').hasMatch(clean)
      ? clean.substring(0, 8)
      : 'unknown';
}

class BuildDiagnosticsCard extends StatelessWidget {
  const BuildDiagnosticsCard({
    super.key,
    required this.apiBaseUrl,
    this.allowAdvanced = false,
  });

  final String apiBaseUrl;
  final bool allowAdvanced;

  @override
  Widget build(BuildContext context) {
    final flavor = AppFlavor.current;
    return Card(
      margin: EdgeInsets.zero,
      color: DanColors.surface,
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          const Text('Thông tin ứng dụng',
              style: TextStyle(fontSize: 15, fontWeight: FontWeight.w800)),
          const SizedBox(height: 10),
          _row('Ứng dụng', flavor.appId),
          _row('Phiên bản', flavor.versionName),
          _row('Build', '${flavor.buildNumber}'),
          if (allowAdvanced) ...[
            const SizedBox(height: 8),
            Align(
              alignment: Alignment.centerLeft,
              child: TextButton.icon(
                onPressed: () => _showAdvanced(context),
                icon: const Icon(Icons.admin_panel_settings_outlined, size: 18),
                label: const Text('Chẩn đoán nâng cao'),
              ),
            ),
          ],
        ]),
      ),
    );
  }

  Future<void> _showAdvanced(BuildContext context) {
    final flavor = AppFlavor.current;
    final rows = <(String, String)>[
      ('Ứng dụng', flavor.appId),
      ('Phiên bản', flavor.versionName),
      ('Build', '${flavor.buildNumber}'),
      ('Git', shortGitSha(AppBuildMetadata.gitCommit)),
      ('Build UTC', AppBuildMetadata.builtAtUtc),
      ('API host', diagnosticEndpointHost(apiBaseUrl)),
      ('Thiết bị', maskedDiagnosticId(SystemLog.deviceId)),
    ];
    return showDialog<void>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Chẩn đoán nâng cao'),
        content: SingleChildScrollView(
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            for (final row in rows) _row(row.$1, row.$2),
          ]),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext),
            child: const Text('Đóng'),
          ),
        ],
      ),
    );
  }

  static Widget _row(String label, String value) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 4),
        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          SizedBox(
            width: 108,
            child: Text(label,
                style: const TextStyle(color: DanColors.muted, fontSize: 12)),
          ),
          Expanded(
            child: SelectableText(value, style: const TextStyle(fontSize: 12)),
          ),
        ]),
      );
}
