import 'dart:io' show Platform;

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../models/app_models.dart';
import '../providers/auth_provider.dart';
import '../services/api_service.dart';
import '../services/app_updater.dart';
import '../ui/app_theme.dart';
import '../widgets/window_controls.dart';
import 'accounting/accounting_screen.dart';
import 'contacts/contacts_screen.dart';
import 'database/database_screen.dart';
import 'expenses/expenses_screen.dart';
import 'invoices/invoices_screen.dart';
import 'kds/kds_screen.dart';
import 'management/management_screen.dart';
import 'management/settings_screen.dart';
import 'online/online_screen.dart';
import 'pos_screen.dart';
import 'printers/printers_screen.dart';
import 'purchase/purchase_screen.dart';
import 'retail/retail_screen.dart';
import 'self_order/self_order_screen.dart';
import 'warehouse/warehouse_screen.dart';
import '../services/black_box.dart';

class LauncherScreen extends StatefulWidget {
  const LauncherScreen({super.key});

  @override
  State<LauncherScreen> createState() => _LauncherScreenState();
}

class _LauncherScreenState extends State<LauncherScreen> {
  ModuleCatalog? _catalog;
  String? _error;
  bool _loading = true;
  UpdateInfo? _update;
  bool _updating = false;

  @override
  void initState() {
    super.initState();
    BlackBox.screen = 'launcher';
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _load();
      _checkUpdate();
    });
  }

  Future<void> _checkUpdate() async {
    final info = await AppUpdater.checkForUpdate(context.read<ApiService>());
    if (mounted && info != null) setState(() => _update = info);
  }

  Future<void> _runUpdate() async {
    final info = _update;
    if (info == null || _updating) return;
    setState(() => _updating = true);
    final err = await AppUpdater.downloadAndInstall(context.read<ApiService>(), info);
    // Nếu thành công (Windows) app đã tự thoát; tới đây nghĩa là có lỗi.
    if (!mounted) return;
    setState(() => _updating = false);
    if (err != null) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text(err), backgroundColor: DanColors.late));
    }
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final catalog = await context.read<ApiService>().getModules();
      if (mounted) setState(() => _catalog = catalog);
    } catch (e) {
      if (mounted) setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  void _openModule(AppModule module) {
    if (!module.isActive) return;
    if (module.key == 'pos') {
      Navigator.of(context)
          .push(MaterialPageRoute(builder: (_) => const PosScreen()));
      return;
    }
    if (module.key == 'admin') {
      Navigator.of(context)
          .push(MaterialPageRoute(builder: (_) => const ManagementScreen()));
      return;
    }
    if (module.key == 'settings') {
      Navigator.of(context)
          .push(MaterialPageRoute(builder: (_) => const SettingsScreen()));
      return;
    }
    if (module.key == 'kds') {
      Navigator.of(context)
          .push(MaterialPageRoute(builder: (_) => const KdsScreen()));
      return;
    }
    if (module.key == 'retail') {
      Navigator.of(context)
          .push(MaterialPageRoute(builder: (_) => const RetailScreen()));
      return;
    }
    if (module.key == 'ipad') {
      // Màn KHÁCH tự gọi món (WebView /ipad) — thường mở trên tablet đặt tại
      // bàn rồi đưa cho khách; nhân viên thoát bằng 5 chạm góc trên-trái.
      final serverUrl = context.read<AuthProvider>().serverUrl;
      Navigator.of(context).push(MaterialPageRoute(
          fullscreenDialog: true,
          builder: (_) => SelfOrderScreen(serverUrl: serverUrl)));
      return;
    }
    if (module.key == 'warehouse') {
      Navigator.of(context)
          .push(MaterialPageRoute(builder: (_) => const WarehouseScreen()));
      return;
    }
    if (module.key == 'contacts') {
      Navigator.of(context)
          .push(MaterialPageRoute(builder: (_) => const ContactsScreen()));
      return;
    }
    if (module.key == 'purchase') {
      Navigator.of(context)
          .push(MaterialPageRoute(builder: (_) => const PurchaseScreen()));
      return;
    }
    if (module.key == 'expenses') {
      Navigator.of(context)
          .push(MaterialPageRoute(builder: (_) => const ExpensesScreen()));
      return;
    }
    if (module.key == 'online') {
      Navigator.of(context)
          .push(MaterialPageRoute(builder: (_) => const OnlineScreen()));
      return;
    }
    if (module.key == 'invoice') {
      Navigator.of(context)
          .push(MaterialPageRoute(builder: (_) => const InvoicesScreen()));
      return;
    }
    if (module.key == 'database') {
      Navigator.of(context)
          .push(MaterialPageRoute(builder: (_) => const DatabaseScreen()));
      return;
    }
    if (module.key == 'printing') {
      Navigator.of(context)
          .push(MaterialPageRoute(builder: (_) => const PrintersScreen()));
      return;
    }
    if (module.key == 'accounting') {
      Navigator.of(context)
          .push(MaterialPageRoute(builder: (_) => const AccountingScreen()));
      return;
    }
    Navigator.of(context).push(
      MaterialPageRoute(
          builder: (_) => NativeModulePlaceholder(module: module)),
    );
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final branch = auth.selectedBranch;

    return Scaffold(
      backgroundColor: DanColors.bg,
      body: SafeArea(
        child: Stack(
          children: [
            Positioned.fill(
              child: CustomScrollView(
                slivers: [
                  if (_update != null)
                    SliverToBoxAdapter(child: _updateBanner()),
                  SliverToBoxAdapter(
                    child: Center(
                      child: ConstrainedBox(
                        constraints: const BoxConstraints(maxWidth: 1160),
                        child: Padding(
                          padding: const EdgeInsets.fromLTRB(24, 62, 24, 28),
                          child: Column(
                            children: [
                              Image.asset(
                                'assets/web/assets/logo.png',
                                width: 390,
                                fit: BoxFit.contain,
                              ),
                              const SizedBox(height: 26),
                              _LauncherBranchRow(
                                branchName:
                                    branch.name.isNotEmpty ? branch.name : branch.id,
                                onLogout: auth.logout,
                              ),
                            ],
                          ),
                        ),
                      ),
                    ),
                  ),
                  SliverPadding(
                    padding: const EdgeInsets.fromLTRB(24, 0, 24, 36),
                    sliver: SliverToBoxAdapter(
                      child: Center(
                        child: ConstrainedBox(
                          constraints: const BoxConstraints(maxWidth: 1160),
                          child: _body(),
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ),
            const Positioned(
              top: 0,
              left: 0,
              right: 146,
              height: 62,
              child: DragToMoveArea(
                child: SizedBox.expand(),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _updateBanner() {
    final info = _update!;
    return Container(
      width: double.infinity,
      color: DanColors.brand,
      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
      child: Row(
        children: [
          const Icon(Icons.system_update_alt, color: Colors.white, size: 20),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Có bản cập nhật mới ${info.version}',
                    style: const TextStyle(
                        color: Colors.white,
                        fontWeight: FontWeight.w800,
                        fontSize: 14)),
                if (info.notes.isNotEmpty)
                  Text(info.notes,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(color: Colors.white70, fontSize: 12)),
              ],
            ),
          ),
          const SizedBox(width: 12),
          if (!info.mandatory)
            TextButton(
              onPressed: _updating ? null : () => setState(() => _update = null),
              child: const Text('Để sau',
                  style: TextStyle(color: Colors.white70)),
            ),
          const SizedBox(width: 6),
          FilledButton.icon(
            onPressed: _updating ? null : _runUpdate,
            style: FilledButton.styleFrom(
                backgroundColor: Colors.white, foregroundColor: DanColors.brand),
            icon: _updating
                ? const SizedBox(
                    width: 16,
                    height: 16,
                    child: CircularProgressIndicator(strokeWidth: 2))
                : const Icon(Icons.download, size: 18),
            label: Text(_updating ? 'Đang tải…' : 'Cập nhật ngay'),
          ),
        ],
      ),
    );
  }

  Widget _body() {
    if (_loading && _catalog == null) return const _LauncherSkeleton();
    if (_error != null) return _LauncherError(message: _error!, onRetry: _load);
    final catalog = _catalog;
    if (catalog == null) return const SizedBox.shrink();

    // Màn tự gọi món chạy trên WebView (chỉ Android/iOS) → chỉ hiện tile 'ipad'
    // trên tablet; desktop Windows ẩn đi như trước (webview không hỗ trợ).
    final visible = catalog.modules
        .where((m) => m.visible)
        .where((m) => m.key != 'ipad' || Platform.isAndroid || Platform.isIOS)
        .toList();

    final blocks = <Widget>[];
    for (final group in catalog.groups) {
      final modules =
          visible.where((m) => m.group == group.key && m.isActive).toList();
      if (modules.isEmpty) continue;
      blocks.add(_GroupTitle(group.label));
      blocks.add(_ModuleGrid(modules: modules, onTap: _openModule));
      blocks.add(const SizedBox(height: 26));
    }

    final planned = visible.where((m) => !m.isActive).toList();
    if (planned.isNotEmpty) {
      blocks.add(const _GroupTitle('Roadmap theo kiến trúc ERP'));
      blocks.add(_ModuleGrid(modules: planned, onTap: _openModule));
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: blocks,
    );
  }
}

class _LauncherBranchRow extends StatelessWidget {
  final String branchName;
  final VoidCallback onLogout;

  const _LauncherBranchRow({
    required this.branchName,
    required this.onLogout,
  });

  @override
  Widget build(BuildContext context) {
    return Wrap(
      alignment: WrapAlignment.center,
      crossAxisAlignment: WrapCrossAlignment.center,
      spacing: 8,
      runSpacing: 8,
      children: [
        const Text(
          'CHI NHÁNH',
          style: TextStyle(
            color: DanColors.faint,
            fontSize: 12,
            fontWeight: FontWeight.w900,
            letterSpacing: .35,
          ),
        ),
        _BranchChip(label: branchName),
        SizedBox(
          height: 38,
          child: OutlinedButton(
            onPressed: onLogout,
            style: OutlinedButton.styleFrom(
              padding: const EdgeInsets.symmetric(horizontal: 13),
              textStyle:
                  const TextStyle(fontSize: 12, fontWeight: FontWeight.w900),
            ),
            child: const Text('Đăng xuất'),
          ),
        ),
      ],
    );
  }
}

class _BranchChip extends StatelessWidget {
  final String label;

  const _BranchChip({required this.label});

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: BoxDecoration(
        color: DanColors.surface2,
        border: Border.all(color: DanColors.border2),
        borderRadius: BorderRadius.circular(9),
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
        child: Text(
          label,
          style: const TextStyle(
            color: DanColors.text,
            fontWeight: FontWeight.w900,
            fontSize: 13,
          ),
        ),
      ),
    );
  }
}

class _GroupTitle extends StatelessWidget {
  final String label;

  const _GroupTitle(this.label);

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Text(
        label.toUpperCase(),
        style: const TextStyle(
          color: DanColors.muted,
          fontSize: 12,
          fontWeight: FontWeight.w900,
          letterSpacing: .35,
        ),
      ),
    );
  }
}

class _ModuleGrid extends StatelessWidget {
  final List<AppModule> modules;
  final ValueChanged<AppModule> onTap;

  const _ModuleGrid({
    required this.modules,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final width = constraints.maxWidth;
        final columns = width >= 980
            ? 4
            : width >= 720
                ? 3
                : width >= 470
                    ? 2
                    : 1;
        return GridView.builder(
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          itemCount: modules.length,
          gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
            crossAxisCount: columns,
            crossAxisSpacing: 16,
            mainAxisSpacing: 16,
            mainAxisExtent: 240,
          ),
          itemBuilder: (context, index) {
            final module = modules[index];
            return _ModuleCard(module: module, onTap: () => onTap(module));
          },
        );
      },
    );
  }
}

class _ModuleCard extends StatelessWidget {
  final AppModule module;
  final VoidCallback onTap;

  const _ModuleCard({
    required this.module,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final enabled = module.isActive;
    final icon = _moduleIcon(module);
    return InkWell(
      borderRadius: BorderRadius.circular(DanRadius.lg),
      onTap: enabled ? onTap : null,
      child: AnimatedOpacity(
        duration: const Duration(milliseconds: 150),
        opacity: enabled ? 1 : .58,
        child: Container(
          padding: const EdgeInsets.all(22),
          decoration: BoxDecoration(
            color: DanColors.surface,
            border: Border.all(color: DanColors.border),
            borderRadius: BorderRadius.circular(DanRadius.lg),
            boxShadow: const [
              BoxShadow(
                color: Color(0x0A102840),
                blurRadius: 2,
                offset: Offset(0, 1),
              ),
            ],
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(icon, style: const TextStyle(fontSize: 38)),
              const SizedBox(height: 18),
              Text(
                module.label,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                    fontSize: 18, fontWeight: FontWeight.w900, height: 1.15),
              ),
              const SizedBox(height: 8),
              Expanded(
                child: Text(
                  module.description,
                  maxLines: 4,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: DanColors.muted,
                    fontSize: 13,
                    height: 1.45,
                    fontWeight: FontWeight.w500,
                  ),
                ),
              ),
              if (!enabled)
                const Text(
                  'Đang nằm trong roadmap',
                  style: TextStyle(
                      color: DanColors.brand,
                      fontSize: 12.5,
                      fontWeight: FontWeight.w800),
                ),
            ],
          ),
        ),
      ),
    );
  }

  String _moduleIcon(AppModule module) {
    const byKey = {
      'admin': '📊',
      'contacts': '👥',
      'pos': '💳',
      'retail': '🛒',
      'kds': '👨‍🍳',
      'online': '🌐',
      'warehouse': '📦',
      'inventory': '🏷️',
      'purchase': '📥',
      'expenses': '💸',
      'settings': '⚙️',
      'printing': '🖨️',
      'invoice': '🧾',
      'database': '🛢️',
    };
    return byKey[module.key] ?? (module.icon.isEmpty ? '•' : module.icon);
  }
}

class NativeModulePlaceholder extends StatelessWidget {
  final AppModule module;

  const NativeModulePlaceholder({super.key, required this.module});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: DanColors.bg,
      appBar: AppBar(
        backgroundColor: DanColors.surface,
        foregroundColor: DanColors.text,
        elevation: 0,
        title: Text(module.label),
      ),
      body: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 520),
          child: Card(
            child: Padding(
              padding: const EdgeInsets.all(24),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(_placeholderIcon(module),
                      style: const TextStyle(fontSize: 44)),
                  const SizedBox(height: 12),
                  Text(
                    module.label,
                    style: const TextStyle(
                        fontSize: 22, fontWeight: FontWeight.w900),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    module.description,
                    textAlign: TextAlign.center,
                    style: const TextStyle(color: DanColors.muted, height: 1.5),
                  ),
                  const SizedBox(height: 18),
                  const Text(
                    'Module này sẽ được port native từ bản web hiện tại bằng cùng API backend.',
                    textAlign: TextAlign.center,
                    style: TextStyle(
                        color: DanColors.faint, fontWeight: FontWeight.w700),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  String _placeholderIcon(AppModule module) {
    if (module.key == 'admin') return '📊';
    if (module.key == 'contacts') return '👥';
    if (module.key == 'retail') return '🛒';
    if (module.key == 'kds') return '👨‍🍳';
    return module.icon.isEmpty ? '•' : module.icon;
  }
}

class _LauncherSkeleton extends StatelessWidget {
  const _LauncherSkeleton();

  @override
  Widget build(BuildContext context) {
    return GridView.count(
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      crossAxisCount: 4,
      crossAxisSpacing: 16,
      mainAxisSpacing: 16,
      children: List.generate(
        8,
        (_) => Container(
          height: 240,
          decoration: BoxDecoration(
            color: DanColors.surface,
            border: Border.all(color: DanColors.border),
            borderRadius: BorderRadius.circular(DanRadius.lg),
          ),
        ),
      ),
    );
  }
}

class _LauncherError extends StatelessWidget {
  final String message;
  final VoidCallback onRetry;

  const _LauncherError({
    required this.message,
    required this.onRetry,
  });

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(22),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(message,
                textAlign: TextAlign.center,
                style: const TextStyle(color: DanColors.late)),
            const SizedBox(height: 12),
            FilledButton(onPressed: onRetry, child: const Text('Tải lại')),
          ],
        ),
      ),
    );
  }
}
