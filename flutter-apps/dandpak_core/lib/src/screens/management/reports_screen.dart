import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../providers/auth_provider.dart';
import '../../services/api_service.dart';
import '../../ui/app_theme.dart';
import '../../widgets/dan_top_bar.dart';
import 'reports_tab.dart';
import '../../utils/translation.dart';

/// Standalone t("Trung tâm báo cáo") screen, opened from the Quản lý t("Báo cáo")
/// button — mirrors the web report-center view.
class ReportsScreen extends StatelessWidget {
  ReportsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final api = context.read<ApiService>();
    final user = auth.currentUser;
    final branch = auth.selectedBranch;

    return Scaffold(
      backgroundColor: DanColors.bg,
      appBar: DanModuleTopBar(
        brandName: branch.name.isNotEmpty ? branch.name : branch.id,
        title: t('Trung tâm báo cáo'),
        subtitle: '',
        titleIcon: Icons.query_stats_outlined,
        userName: user?.name ?? '—',
        userRole: roleLabel(user?.role ?? ''),
        online: true,
        onBack: () => Navigator.of(context).maybePop(),
        onLogout: () => auth.logout(),
      ),
      body: ReportsTab(api: api),
    );
  }
}
