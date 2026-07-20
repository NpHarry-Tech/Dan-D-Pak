import 'dart:io' show Platform;

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../app_flavor.dart';
import '../models/app_models.dart';
import '../providers/auth_provider.dart';
import '../services/api_service.dart';
import '../services/app_updater.dart';
import '../ui/app_theme.dart';
import '../utils/translation.dart';
import '../widgets/dan_tile_grid.dart';
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
import 'self_order/self_order_table_screen.dart';
import 'warehouse/warehouse_screen.dart';
import '../services/black_box.dart';

String _moduleGroupLabel(AppModuleGroup group) {
  final labels = {
    'essentials': 'Cốt lõi',
    'sales': 'Bán hàng',
    'supply': 'Kho & cung ứng',
    'finance': 'Tài chính',
    'productivity': 'Công việc',
    'studio': 'Tùy biến',
    'settings': 'Cài đặt & nền tảng',
    'developer': 'Kỹ thuật & dữ liệu',
  };
  return t(labels[group.key] ?? group.label);
}

String _moduleLabel(AppModule module) {
  final labels = {
    'admin': 'Quản lý',
    'contacts': 'Khách hàng',
    'pos': 'POS FnB',
    'retail': 'Bán lẻ',
    'kds': 'Màn hình bếp',
    'online': 'Kênh online',
    'warehouse': 'Kho hàng',
    'inventory': 'Tồn kho',
    'purchase': 'Mua hàng',
    'expenses': 'Chi phí',
    'settings': 'Cài đặt',
    'printing': 'Máy in',
    'invoice': 'Hóa đơn',
    'accounting': 'Kế toán',
    'database': 'Cơ sở dữ liệu',
  };
  return t(labels[module.key] ?? module.label);
}

String _moduleDescription(AppModule module) {
  final descriptions = {
    'admin': 'Dashboard, báo cáo nhanh, menu, vận hành và cài đặt hằng ngày.',
    'contacts': 'Danh bạ khách hàng, nhà cung cấp, điện thoại, MST và địa chỉ.',
    'pos': 'Bàn, order, giảm giá, thanh toán, in bill và realtime với bếp.',
    'retail': 'Bán lẻ, mã vạch, lô/HSD, voucher và đổi trả.',
    'kds': 'Màn hình bếp/bar, SLA và trạng thái món realtime.',
    'online': 'Nhận đơn GrabFood/ShopeeFood/Website và điều phối hoàn tất đơn.',
    'warehouse': 'Quản lý kho BCM/showroom/bếp, SKU, lô/HSD và tồn tối thiểu.',
    'purchase': 'Đơn mua, nhập kho và công nợ nhà cung cấp.',
    'expenses': 'Sổ chi phí theo danh mục, quỹ két và đối soát.',
    'printing': 'Máy in bếp/bar/hóa đơn, in lại, cấu hình bill và tem nhãn.',
    'invoice': 'Hóa đơn điện tử, trạng thái phát hành, tra cứu và hủy.',
    'accounting': 'Sổ kế toán, thuế, thanh toán, ca và báo cáo tài chính.',
    'database': 'Sao lưu, phục hồi, reset giao dịch và tài liệu hệ thống.',
  };
  return t(descriptions[module.key] ?? module.description);
}

class LauncherScreen extends StatefulWidget {
  LauncherScreen({super.key});

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
    final err =
        await AppUpdater.downloadAndInstall(context.read<ApiService>(), info);
    // Nếu thành công (Windows) app đã tự thoát; tới đây nghĩa là có lỗi.
    if (!mounted) return;
    setState(() => _updating = false);
    if (err != null) {
      ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(err), backgroundColor: DanColors.late));
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
          .push(MaterialPageRoute(builder: (_) => PosScreen()));
      return;
    }
    if (module.key == 'admin') {
      Navigator.of(context)
          .push(MaterialPageRoute(builder: (_) => ManagementScreen()));
      return;
    }
    if (module.key == 'settings') {
      Navigator.of(context)
          .push(MaterialPageRoute(builder: (_) => SettingsScreen()));
      return;
    }
    if (module.key == 'kds') {
      Navigator.of(context)
          .push(MaterialPageRoute(builder: (_) => KdsScreen()));
      return;
    }
    if (module.key == 'retail') {
      Navigator.of(context)
          .push(MaterialPageRoute(builder: (_) => RetailScreen()));
      return;
    }
    if (module.key == 'ipad') {
      // Man NHAN VIEN chon ban cho khach tu goi mon (native Flutter kiosk).
      final auth = context.read<AuthProvider>();
      Navigator.of(context).push(MaterialPageRoute(
          settings: RouteSettings(name: '/so-table'),
          fullscreenDialog: true,
          builder: (_) => SelfOrderTableScreen(
                serverUrl: auth.serverUrl,
                branchId: auth.selectedBranchId,
                staffToken: auth.token,
              )));
      return;
    }
    if (module.key == 'warehouse') {
      Navigator.of(context)
          .push(MaterialPageRoute(builder: (_) => WarehouseScreen()));
      return;
    }
    if (module.key == 'contacts') {
      Navigator.of(context)
          .push(MaterialPageRoute(builder: (_) => ContactsScreen()));
      return;
    }
    if (module.key == 'purchase') {
      Navigator.of(context)
          .push(MaterialPageRoute(builder: (_) => PurchaseScreen()));
      return;
    }
    if (module.key == 'expenses') {
      Navigator.of(context)
          .push(MaterialPageRoute(builder: (_) => ExpensesScreen()));
      return;
    }
    if (module.key == 'online') {
      Navigator.of(context)
          .push(MaterialPageRoute(builder: (_) => OnlineScreen()));
      return;
    }
    if (module.key == 'invoice') {
      Navigator.of(context)
          .push(MaterialPageRoute(builder: (_) => InvoicesScreen()));
      return;
    }
    if (module.key == 'database') {
      Navigator.of(context)
          .push(MaterialPageRoute(builder: (_) => DatabaseScreen()));
      return;
    }
    if (module.key == 'printing') {
      Navigator.of(context)
          .push(MaterialPageRoute(builder: (_) => PrintersScreen()));
      return;
    }
    if (module.key == 'accounting') {
      Navigator.of(context)
          .push(MaterialPageRoute(builder: (_) => AccountingScreen()));
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
                        constraints: BoxConstraints(maxWidth: 1160),
                        child: Padding(
                          // Desktop chừa 62px trên cho thanh kéo/nút cửa sổ; tablet
                          // không có nên thu lại để dùng hết không gian.
                          padding: EdgeInsets.fromLTRB(
                              24, AppFlavor.current.isTablet ? 28 : 62, 24, 28),
                          child: Column(
                            children: [
                              Image.asset(
                                'assets/brand/logo.png',
                                width: 390,
                                fit: BoxFit.contain,
                              ),
                              SizedBox(height: 26),
                              _LauncherBranchRow(
                                branchName: branch.name.isNotEmpty
                                    ? branch.name
                                    : branch.id,
                                onLogout: auth.logout,
                              ),
                            ],
                          ),
                        ),
                      ),
                    ),
                  ),
                  SliverPadding(
                    padding: EdgeInsets.fromLTRB(24, 0, 24, 36),
                    sliver: SliverToBoxAdapter(
                      child: Center(
                        child: ConstrainedBox(
                          constraints: BoxConstraints(maxWidth: 1160),
                          child: _body(),
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ),
            Positioned(
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
      // Windows: chừa chỗ cho 3 nút cửa sổ ghim góc phải trên (WindowChrome,
      // rộng ~146px) — không thì nút t("Cập nhật ngay") bị đè, khó bấm.
      padding:
          EdgeInsets.fromLTRB(20, 12, WindowControls.supported ? 158 : 20, 12),
      child: Row(
        children: [
          Icon(Icons.system_update_alt, color: Colors.white, size: 20),
          SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('${t('Có bản cập nhật mới')} ${info.version}',
                    style: TextStyle(
                        color: Colors.white,
                        fontWeight: FontWeight.w800,
                        fontSize: 14)),
                if (info.notes.isNotEmpty)
                  Text(info.notes,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(color: Colors.white70, fontSize: 12)),
              ],
            ),
          ),
          SizedBox(width: 12),
          if (!info.mandatory)
            TextButton(
              onPressed:
                  _updating ? null : () => setState(() => _update = null),
              child: Text(t('Để sau'), style: TextStyle(color: Colors.white70)),
            ),
          SizedBox(width: 6),
          FilledButton.icon(
            onPressed: _updating ? null : _runUpdate,
            style: FilledButton.styleFrom(
                backgroundColor: Colors.white,
                foregroundColor: DanColors.brand),
            icon: _updating
                ? SizedBox(
                    width: 16,
                    height: 16,
                    child: CircularProgressIndicator(strokeWidth: 2))
                : Icon(Icons.download, size: 18),
            label: Text(_updating ? t('Đang tải…') : t('Cập nhật ngay')),
          ),
        ],
      ),
    );
  }

  Widget _body() {
    if (_loading && _catalog == null) return _LauncherSkeleton();
    if (_error != null) return _LauncherError(message: _error!, onRetry: _load);
    final catalog = _catalog;
    if (catalog == null) return SizedBox.shrink();

    // Màn tự gọi món chạy native trên tablet/phone → chỉ hiện tile 'ipad'
    // trên tablet; desktop Windows ẩn đi như trước (webview không hỗ trợ).
    // Ngoài ra lọc theo BỘ MODULE của vị máy (desktop = tất cả, tablet/phone =
    // bộ riêng) — đây là chỗ t("khác số lượng module") thành hiện thực.
    final visible = catalog.modules
        .where((m) => m.visible)
        .where((m) => m.isActive)
        .where((m) => m.key != 'ipad' || Platform.isAndroid || Platform.isIOS)
        .where((m) => AppFlavor.current.showsModule(m.key))
        .toList();

    final blocks = <Widget>[];
    for (final group in catalog.groups) {
      final modules =
          visible.where((m) => m.group == group.key && m.isActive).toList();
      if (modules.isEmpty) continue;
      blocks.add(_GroupTitle(_moduleGroupLabel(group)));
      blocks.add(_ModuleGrid(modules: modules, onTap: _openModule));
      blocks.add(SizedBox(height: 26));
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

  _LauncherBranchRow({
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
        Text(
          t('CHI NHÁNH'),
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
              padding: EdgeInsets.symmetric(horizontal: 13),
              textStyle: TextStyle(fontSize: 12, fontWeight: FontWeight.w900),
            ),
            child: Text(t('Đăng xuất')),
          ),
        ),
      ],
    );
  }
}

class _BranchChip extends StatelessWidget {
  final String label;

  _BranchChip({required this.label});

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: BoxDecoration(
        color: DanColors.surface2,
        border: Border.all(color: DanColors.border2),
        borderRadius: BorderRadius.circular(9),
      ),
      child: Padding(
        padding: EdgeInsets.symmetric(horizontal: 14, vertical: 8),
        child: Text(
          label,
          style: TextStyle(
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

  _GroupTitle(this.label);

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(bottom: 12),
      child: Text(
        label.toUpperCase(),
        style: TextStyle(
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

  _ModuleGrid({
    required this.modules,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    // QUY TẮC LƯỚI CHUNG: thẻ module có kích thước CỐ ĐỊNH (tablet cảm ứng to hơn
    // cho ngón tay). Bật/tắt module thì các thẻ sau tự DỊCH TRÁI – LÙI LÊN, KHÔNG
    // giãn thẻ ra cho vừa hàng (xem DanTileGrid).
    final tablet = AppFlavor.current.isTablet;
    return DanTileGrid(
      tileWidth: tablet ? 340 : 260,
      tileHeight: tablet ? 288 : 240,
      spacing: tablet ? 20 : 16,
      runSpacing: tablet ? 20 : 16,
      children: [
        for (final module in modules)
          _ModuleCard(module: module, onTap: () => onTap(module)),
      ],
    );
  }
}

class _ModuleCard extends StatelessWidget {
  final AppModule module;
  final VoidCallback onTap;

  _ModuleCard({
    required this.module,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final enabled = module.isActive;
    final icon = _moduleIcon(module);
    // Tablet: thẻ to hơn, icon/chữ lớn hơn cho thao tác cảm ứng.
    final tablet = AppFlavor.current.isTablet;
    return InkWell(
      borderRadius: BorderRadius.circular(DanRadius.lg),
      onTap: enabled ? onTap : null,
      child: AnimatedOpacity(
        duration: Duration(milliseconds: 150),
        opacity: enabled ? 1 : .58,
        child: Container(
          padding: EdgeInsets.all(tablet ? 26 : 22),
          decoration: BoxDecoration(
            color: DanColors.surface,
            border: Border.all(color: DanColors.border),
            borderRadius: BorderRadius.circular(DanRadius.lg),
            boxShadow: [
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
              Text(icon, style: TextStyle(fontSize: tablet ? 46 : 38)),
              SizedBox(height: tablet ? 20 : 18),
              Text(
                _moduleLabel(module),
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                    fontSize: tablet ? 20 : 18,
                    fontWeight: FontWeight.w900,
                    height: 1.15),
              ),
              SizedBox(height: tablet ? 10 : 8),
              Expanded(
                child: Text(
                  _moduleDescription(module),
                  maxLines: tablet ? 5 : 4,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    color: DanColors.muted,
                    fontSize: 13,
                    height: 1.45,
                    fontWeight: FontWeight.w500,
                  ),
                ),
              ),
              if (!enabled)
                Text(
                  t('Đang nằm trong roadmap'),
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
    final byKey = {
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

  NativeModulePlaceholder({super.key, required this.module});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: DanColors.bg,
      appBar: AppBar(
        backgroundColor: DanColors.surface,
        foregroundColor: DanColors.text,
        elevation: 0,
        title: Text(_moduleLabel(module)),
      ),
      body: Center(
        child: ConstrainedBox(
          constraints: BoxConstraints(maxWidth: 520),
          child: Card(
            child: Padding(
              padding: EdgeInsets.all(24),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(_placeholderIcon(module),
                      style: TextStyle(fontSize: 44)),
                  SizedBox(height: 12),
                  Text(
                    _moduleLabel(module),
                    style: TextStyle(fontSize: 22, fontWeight: FontWeight.w900),
                  ),
                  SizedBox(height: 8),
                  Text(
                    _moduleDescription(module),
                    textAlign: TextAlign.center,
                    style: TextStyle(color: DanColors.muted, height: 1.5),
                  ),
                  SizedBox(height: 18),
                  Text(
                    t('Module này sẽ được port native từ bản web hiện tại bằng cùng API backend.'),
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
  _LauncherSkeleton();

  @override
  Widget build(BuildContext context) {
    // Skeleton dùng ĐÚNG kích thước thẻ như lưới module thật → không "nhảy" layout.
    final tablet = AppFlavor.current.isTablet;
    return DanTileGrid(
      tileWidth: tablet ? 340 : 260,
      tileHeight: tablet ? 288 : 240,
      spacing: tablet ? 20 : 16,
      runSpacing: tablet ? 20 : 16,
      children: List.generate(
        8,
        (_) => DecoratedBox(
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

  _LauncherError({
    required this.message,
    required this.onRetry,
  });

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: EdgeInsets.all(22),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(message,
                textAlign: TextAlign.center,
                style: TextStyle(color: DanColors.late)),
            SizedBox(height: 12),
            FilledButton(onPressed: onRetry, child: Text(t('Tải lại'))),
          ],
        ),
      ),
    );
  }
}
