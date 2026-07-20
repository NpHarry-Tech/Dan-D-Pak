import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../primitives.dart';

import '../../providers/auth_provider.dart';
import '../../services/api_service.dart';
import '../../ui/app_theme.dart';
import '../../widgets/dan_top_bar.dart';
import 'dashboard_tab.dart';
import 'reports_screen.dart';
import '../../services/black_box.dart';
import '../../utils/translation.dart';

/// Native port of the web t("Quản lý") (admin.html) page.
/// Matches the web exactly: a single Dashboard view with a t("Báo cáo") button
/// in the top bar that opens the report center. (Menu, operations and the
/// settings sub-tabs live in the separate t("Cài đặt") module, like the web.)
class ManagementScreen extends StatefulWidget {
  ManagementScreen({super.key});

  @override
  State<ManagementScreen> createState() => _ManagementScreenState();
}

class _ManagementScreenState extends State<ManagementScreen> {
  static final _events = [
    'stats:dirty',
    'payment:done',
    'shift:updated',
    'order:new',
    'order:item',
    'inventory:updated',
    'inventory:alert',
    'menu:updated',
  ];

  final DanDpakRealtimeClient _realtime = DanDpakRealtimeClient();
  final ValueNotifier<int> _refreshTick = ValueNotifier<int>(0);
  bool _online = false;
  bool _disposed = false;

  @override
  void initState() {
    super.initState();
    BlackBox.screen = 'management';
    WidgetsBinding.instance.addPostFrameCallback((_) => _connectRealtime());
  }

  void _connectRealtime() {
    if (_disposed || !mounted) return;
    final auth = context.read<AuthProvider>();
    _realtime.connect(
      url: auth.serverUrl,
      token: auth.token ?? '',
      branchId: auth.selectedBranchId,
      device: 'admin',
      events: _events,
      onConnectionChanged: (connected) {
        if (_disposed || !mounted) return;
        setState(() => _online = connected);
      },
      onEvent: (event, _) {
        if (_disposed || !mounted || event == 'connect_error') return;
        _refreshTick.value++;
      },
    );
  }

  @override
  void dispose() {
    _disposed = true;
    _realtime.dispose();
    _refreshTick.dispose();
    super.dispose();
  }

  void _openReports() {
    Navigator.of(context).push(
      MaterialPageRoute(builder: (_) => ReportsScreen()),
    );
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
        title: t('Quản lý'),
        subtitle: '',
        titleIcon: Icons.bar_chart_outlined,
        userName: user?.name ?? '—',
        userRole: roleLabel(user?.role ?? ''),
        online: _online,
        onBack: () => Navigator.of(context).maybePop(),
        onLogout: () => auth.logout(),
        actions: [
          DanTopBarButton(
            onPressed: _openReports,
            icon: Icons.description_outlined,
            label: t('Báo cáo'),
          ),
        ],
      ),
      body: DashboardTab(api: api, refresh: _refreshTick),
    );
  }
}
