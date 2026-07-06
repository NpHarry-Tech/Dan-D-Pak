import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../providers/auth_provider.dart';
import '../../services/api_service.dart';
import '../../ui/app_theme.dart';
import '../../widgets/dan_top_bar.dart';
import '../management/settings_ops_panels.dart';

class AccountingScreen extends StatelessWidget {
  const AccountingScreen({super.key});

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
        title: 'Kế toán',
        subtitle: '',
        titleIcon: Icons.receipt_long_outlined,
        userName: user?.name ?? '—',
        userRole: roleLabel(user?.role ?? ''),
        online: true,
        onBack: () => Navigator.of(context).maybePop(),
        onLogout: () => auth.logout(),
      ),
      body: OperationsPanel(api: api),
    );
  }
}
