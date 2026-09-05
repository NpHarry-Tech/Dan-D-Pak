import 'package:flutter/material.dart';

import '../models/app_models.dart';
import '../ui/app_theme.dart';
import '../utils/translation.dart';

const _sellingKeys = <String>{'pos', 'retail', 'online', 'kds'};
const _backOfficeKeys = <String>{
  'admin',
  'settings',
  'contacts',
  'warehouse',
  'purchase',
  'expenses',
  'invoice',
  'accounting',
  'database',
  'printing',
};

AppModule? preferredSellingModule(String role, Iterable<AppModule> modules) {
  final visible = modules.where((m) => m.visible && m.isActive).toList();
  final order = switch (role) {
    'kitchen' => const ['kds', 'pos', 'retail', 'online'],
    'online_manager' || 'marketplace_operator' => const [
        'online',
        'retail',
        'pos',
        'kds'
      ],
    _ => const ['pos', 'retail', 'online', 'kds'],
  };
  for (final key in order) {
    for (final module in visible) {
      if (module.key == key) return module;
    }
  }
  return null;
}

AppModule? preferredBackOfficeModule(Iterable<AppModule> modules) {
  final visible = modules.where((m) => m.visible && m.isActive).toList();
  for (final key in _backOfficeKeys) {
    for (final module in visible) {
      if (module.key == key) return module;
    }
  }
  return null;
}

List<AppModule> sellFirstModules(String role, Iterable<AppModule> modules) {
  final list = modules.toList();
  int lane(AppModule module) {
    if (_sellingKeys.contains(module.key)) return 0;
    if (_backOfficeKeys.contains(module.key)) return 1;
    return 2;
  }

  list.sort((a, b) {
    final byLane = lane(a).compareTo(lane(b));
    if (byLane != 0) return byLane;
    final preferred = preferredSellingModule(role, list)?.key;
    if (a.key == preferred) return -1;
    if (b.key == preferred) return 1;
    return 0;
  });
  return list;
}

class LauncherEntryPanel extends StatelessWidget {
  const LauncherEntryPanel({
    super.key,
    required this.role,
    required this.modules,
    required this.onOpen,
  });

  final String role;
  final List<AppModule> modules;
  final ValueChanged<AppModule> onOpen;

  @override
  Widget build(BuildContext context) {
    final selling = preferredSellingModule(role, modules);
    final backOffice = preferredBackOfficeModule(modules);
    if (selling == null && backOffice == null) return const SizedBox.shrink();
    final salesPreferred = role == 'cashier' || role == 'kitchen';

    return Semantics(
      container: true,
      label: t('Chọn khu vực làm việc'),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(t('Bắt đầu công việc'),
              style:
                  const TextStyle(fontSize: 22, fontWeight: FontWeight.w900)),
          const SizedBox(height: 12),
          Wrap(
            spacing: 12,
            runSpacing: 12,
            children: [
              if (selling != null)
                _EntryButton(
                  key: const Key('launcher-entry-sales'),
                  icon: Icons.point_of_sale,
                  title: t('Bán hàng'),
                  subtitle: t('Vào nhanh màn bán phù hợp với vai trò'),
                  preferred: salesPreferred,
                  onTap: () => onOpen(selling),
                ),
              if (backOffice != null)
                _EntryButton(
                  key: const Key('launcher-entry-management'),
                  icon: Icons.space_dashboard_outlined,
                  title: t('Quản lý'),
                  subtitle: t('Báo cáo, khách hàng, kho và cài đặt'),
                  preferred:
                      !salesPreferred && {'owner', 'manager'}.contains(role),
                  onTap: () => onOpen(backOffice),
                ),
            ],
          ),
          const SizedBox(height: 28),
          Text(t('Tất cả tính năng'),
              style: TextStyle(
                  color: DanColors.muted, fontWeight: FontWeight.w900)),
          const SizedBox(height: 12),
        ],
      ),
    );
  }
}

class _EntryButton extends StatelessWidget {
  const _EntryButton({
    super.key,
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.preferred,
    required this.onTap,
  });

  final IconData icon;
  final String title;
  final String subtitle;
  final bool preferred;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => SizedBox(
        width: 340,
        height: 108,
        child: Card(
          margin: EdgeInsets.zero,
          color: preferred
              ? DanColors.brand.withValues(alpha: .08)
              : DanColors.surface,
          child: InkWell(
            borderRadius: BorderRadius.circular(DanRadius.lg),
            onTap: onTap,
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Row(children: [
                Icon(icon, size: 34, color: DanColors.brand),
                const SizedBox(width: 14),
                Expanded(
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(children: [
                        Flexible(
                            child: Text(title,
                                style: const TextStyle(
                                    fontSize: 18,
                                    fontWeight: FontWeight.w900))),
                        if (preferred) ...[
                          const SizedBox(width: 8),
                          Text(t('Ưu tiên'),
                              style: TextStyle(
                                  color: DanColors.brand,
                                  fontSize: 11,
                                  fontWeight: FontWeight.w900)),
                        ],
                      ]),
                      const SizedBox(height: 5),
                      Text(subtitle,
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                              color: DanColors.muted, fontSize: 12.5)),
                    ],
                  ),
                ),
                const Icon(Icons.arrow_forward_rounded),
              ]),
            ),
          ),
        ),
      );
}
