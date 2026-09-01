import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../providers/auth_provider.dart';
import '../../services/black_box.dart';
import '../../ui/app_theme.dart';
import '../../utils/translation.dart';
import '../../widgets/dan_top_bar.dart';
import 'online_channels_section.dart';
import 'online_chat_section.dart';
import 'online_orders_section.dart';
import 'online_overview_section.dart';
import 'online_products_section.dart';
import 'online_reconciliation_section.dart';

class _NavItem {
  final String key;
  final String label;
  final IconData icon;
  final String? group;
  const _NavItem(this.key, this.label, this.icon, {this.group});
}

const List<_NavItem> _nav = [
  _NavItem('overview', 'Tổng quan', Icons.dashboard_outlined,
      group: 'Thương mại điện tử'),
  _NavItem('orders', 'Đơn hàng', Icons.receipt_long_outlined),
  _NavItem('products', 'Hàng hóa', Icons.inventory_2_outlined),
  _NavItem('reconciliation', 'Đối soát', Icons.account_balance_outlined),
  _NavItem('channels', 'Thiết lập kênh', Icons.settings_outlined),
  _NavItem('chat', 'Chat đa kênh', Icons.forum_outlined, group: 'Mạng xã hội'),
];

/// Mục "Bán hàng online" (Dan D Pak Omni) — vỏ có thanh điều hướng bên trái
/// theo bố cục KiotViet: Tổng quan / Đơn hàng / Hàng hóa / Đối soát / Thiết lập
/// kênh / Chat đa kênh.
class OnlineShell extends StatefulWidget {
  final String initialSection;
  const OnlineShell({super.key, this.initialSection = 'overview'});

  @override
  State<OnlineShell> createState() => _OnlineShellState();
}

class _OnlineShellState extends State<OnlineShell> {
  late String _section;

  @override
  void initState() {
    super.initState();
    BlackBox.screen = 'online';
    _section = widget.initialSection;
  }

  Widget _sectionBody() {
    switch (_section) {
      case 'orders':
        return const OnlineOrdersSection();
      case 'products':
        return const OnlineProductsSection();
      case 'reconciliation':
        return const OnlineReconciliationSection();
      case 'channels':
        return const OnlineChannelsSection();
      case 'chat':
        return const OnlineChatSection();
      case 'overview':
      default:
        return OnlineOverviewSection(onOpenSection: _go);
    }
  }

  void _go(String key) {
    if (_section != key) setState(() => _section = key);
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final user = auth.currentUser;
    final branch = auth.selectedBranch;
    final narrow = MediaQuery.sizeOf(context).width < 900;

    return Scaffold(
      backgroundColor: DanColors.bg,
      appBar: DanModuleTopBar(
        brandName: branch.name.isNotEmpty ? branch.name : branch.id,
        title: t('Bán hàng online'),
        subtitle: 'Dan D Pak Omni',
        titleIcon: Icons.public,
        userName: user?.name ?? '—',
        userRole: roleLabel(user?.role ?? ''),
        online: true,
        onBack: () => Navigator.of(context).maybePop(),
        onLogout: () => auth.logout(),
      ),
      drawer: narrow ? Drawer(child: SafeArea(child: _sidebar(true))) : null,
      body: Row(
        children: [
          if (!narrow)
            SizedBox(
              width: 210,
              child: DecoratedBox(
                decoration: const BoxDecoration(
                  color: DanColors.surface,
                  border: Border(right: BorderSide(color: DanColors.border)),
                ),
                child: _sidebar(false),
              ),
            ),
          Expanded(child: _sectionBody()),
        ],
      ),
    );
  }

  Widget _sidebar(bool inDrawer) {
    final tiles = <Widget>[];
    String? lastGroup;
    for (final item in _nav) {
      final group = item.group;
      if (group != null && group != lastGroup) {
        lastGroup = group;
        tiles.add(Padding(
          padding: const EdgeInsets.fromLTRB(16, 16, 12, 6),
          child: Text(group.toUpperCase(),
              style: const TextStyle(
                  fontSize: 10.5,
                  fontWeight: FontWeight.w800,
                  letterSpacing: .5,
                  color: DanColors.faint)),
        ));
      }
      final selected = _section == item.key;
      tiles.add(InkWell(
        onTap: () {
          _go(item.key);
          if (inDrawer) Navigator.of(context).maybePop();
        },
        child: Container(
          margin: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 11),
          decoration: BoxDecoration(
            color: selected ? DanColors.brandDim : Colors.transparent,
            borderRadius: BorderRadius.circular(DanRadius.sm),
          ),
          child: Row(
            children: [
              Icon(item.icon,
                  size: 19,
                  color: selected ? DanColors.brand : DanColors.muted),
              const SizedBox(width: 11),
              Expanded(
                child: Text(t(item.label),
                    style: TextStyle(
                        fontSize: 13.5,
                        fontWeight:
                            selected ? FontWeight.w800 : FontWeight.w600,
                        color: selected ? DanColors.brand : DanColors.text)),
              ),
            ],
          ),
        ),
      ));
    }
    return ListView(padding: const EdgeInsets.only(bottom: 20), children: [
      const Padding(
        padding: EdgeInsets.fromLTRB(16, 14, 12, 4),
        child: Text('BÁN ONLINE',
            style: TextStyle(
                fontSize: 13,
                fontWeight: FontWeight.w900,
                color: DanColors.text)),
      ),
      ...tiles,
    ]);
  }
}
