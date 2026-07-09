import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../providers/auth_provider.dart';
import '../../providers/customer_display_controller.dart';
import '../../services/api_service.dart';
import '../../ui/app_theme.dart';
import '../../widgets/dan_top_bar.dart';
import 'settings_tab.dart';
import '../../services/black_box.dart';

/// Standalone "Cài đặt" module screen (web /settings). Hosts the settings
/// sub-nav: users, branches, tables, menu, operations, connections, etc.
class SettingsScreen extends StatefulWidget {
  const SettingsScreen({super.key});

  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  @override
  void initState() {
    super.initState();
    BlackBox.screen = 'settings';
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) {
        context
            .read<CustomerDisplayController>()
            .showIdle(pauseSalesMirrors: true);
      }
    });
  }

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
        title: 'Cài đặt',
        subtitle: '',
        titleIcon: Icons.settings_outlined,
        userName: user?.name ?? '—',
        userRole: roleLabel(user?.role ?? ''),
        online: true,
        onBack: () => Navigator.of(context).maybePop(),
        onLogout: () => auth.logout(),
      ),
      body: SettingsTab(api: api),
    );
  }
}
