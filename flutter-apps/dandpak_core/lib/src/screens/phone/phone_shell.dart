import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../app_flavor.dart';
import '../../providers/auth_provider.dart';
import '../../services/api_service.dart';
import '../../services/push_notifications.dart';
import '../../ui/app_theme.dart';
import '../../utils/translation.dart';
import '../../widgets/dan_top_bar.dart' show roleLabel;
import '../../widgets/build_diagnostics_card.dart';

import 'phone_catalog_screens.dart';
import 'phone_form_screens.dart';
import 'phone_kit.dart';
import 'phone_ops_screens.dart';
import 'phone_printers_screen.dart';
import 'phone_overview_screens.dart';
import 'phone_scaffolds.dart';
import 'phone_settings_screen.dart';
import 'phone_update_row.dart';
import 'phone_sell_screen.dart';

/// VỎ ĐIỀU HƯỚNG bản điện thoại — thanh đáy 5 mục theo bản thiết kế:
/// Tổng quan · Bán lẻ · Hàng hóa · Hóa đơn · Nhiều hơn.
///
/// Mục nào cũng phải qua kiểm tra QUYỀN THẬT (`AuthProvider.can`) và bộ module
/// đang bật của thiết bị (`AppFlavor.enabledModuleKeys`) — thu ngân không được
/// thấy mục mà họ không có quyền vào, y như trên desktop.
class PhoneShell extends StatefulWidget {
  const PhoneShell({super.key});

  @override
  State<PhoneShell> createState() => _PhoneShellState();
}

class _PhoneShellState extends State<PhoneShell> {
  int _tab = 0;

  @override
  void initState() {
    super.initState();
    // Đăng ký nhận thông báo đẩy (FCM) — nhận CẢ KHI TẮT app. Trước đây chỉ
    // LauncherScreen (desktop/tablet) gọi, nên PHONE không bao giờ đăng ký token.
    // Android-only + idempotent nên gọi thoải mái.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      PushNotifications.register(context.read<ApiService>());
    });
  }

  @override
  Widget build(BuildContext context) {
    final tabs = _tabs(context);
    final safeIndex = _tab.clamp(0, tabs.length - 1);
    return Scaffold(
      backgroundColor: DanColors.bg,
      body: IndexedStack(
        index: safeIndex,
        children: [for (final tb in tabs) tb.$3],
      ),
      bottomNavigationBar: Container(
        decoration: const BoxDecoration(
          color: DanColors.surface,
          border: Border(top: BorderSide(color: DanColors.border)),
        ),
        child: SafeArea(
          top: false,
          child: SizedBox(
            height: 58,
            child: Row(
              children: [
                for (var i = 0; i < tabs.length; i++)
                  Expanded(
                    child: InkWell(
                      onTap: () => setState(() => _tab = i),
                      child: Column(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          Icon(tabs[i].$2,
                              size: 21,
                              color: i == safeIndex
                                  ? DanColors.brand
                                  : DanColors.faint),
                          const SizedBox(height: 3),
                          Text(t(tabs[i].$1),
                              style: TextStyle(
                                  fontSize: 10,
                                  fontWeight: FontWeight.w800,
                                  color: i == safeIndex
                                      ? DanColors.brand
                                      : DanColors.faint)),
                        ],
                      ),
                    ),
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  /// Chỉ dựng tab mà người dùng THỰC SỰ vào được.
  List<(String, IconData, Widget)> _tabs(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    bool on(String moduleKey, String perm) =>
        AppFlavor.current.showsModule(moduleKey) &&
        auth.moduleEnabled(moduleKey) &&
        auth.hasPermission(perm);

    // QUYỀN PHẢI KHỚP GUARD THẬT CỦA ROUTE, nếu không người dùng thấy mục rồi
    // bấm vào lại ăn 403. Đối chiếu server/modules/*/routes.js:
    //   GET /api/dashboard      -> guard()                  (chỉ cần đăng nhập)
    //   GET /api/skus           -> guard()                  (chỉ cần đăng nhập)
    //   GET /api/orders/history -> guard('pay')
    final out = <(String, IconData, Widget)>[];
    // Module 'admin' khai báo perm: null trong server/services/modules.js —
    // desktop cũng cho mọi người đã đăng nhập thấy, nên phone giữ y vậy.
    if (AppFlavor.current.showsModule('admin')) {
      out.add(('Tổng quan', Icons.home_outlined, const PhoneHomeScreen()));
    }
    if (on('retail', 'module.retail') && auth.hasPermission('sell')) {
      out.add(
          ('Bán lẻ', Icons.shopping_cart_outlined, const PhoneSellScreen()));
    }
    if (on('warehouse', 'module.warehouse') ||
        on('inventory', 'module.inventory')) {
      out.add((
        'Hàng hóa',
        Icons.inventory_2_outlined,
        const PhoneProductsScreen()
      ));
    }
    // Danh sách hóa đơn đọc /api/orders/history -> guard('pay'), nên ngoài
    // module.invoice còn phải có 'pay' mới vào được mà không ăn 403.
    if (on('invoice', 'module.invoice') && auth.hasPermission('pay')) {
      out.add((
        'Hóa đơn',
        Icons.receipt_long_outlined,
        const PhoneInvoicesScreen()
      ));
    }
    out.add(('Nhiều hơn', Icons.grid_view_outlined, const PhoneMoreScreen()));
    return out;
  }
}

/// THẺ TÀI KHOẢN ở đầu màn "Nhiều hơn".
///
/// Ba thứ phải thấy được ngay, vì máy POS cầm tay hay bị chuyền tay giữa các
/// ca: ĐANG LÀ AI, quyền gì, và ở CƠ SỞ nào. Nút "Đổi" nhả máy cho người sau
/// mà không phải đi tìm nút Đăng xuất tận cuối màn.
class _PhoneAccountCard extends StatelessWidget {
  const _PhoneAccountCard();

  String _viet(String name) {
    final parts =
        name.trim().split(RegExp(r'\s+')).where((e) => e.isNotEmpty).toList();
    if (parts.isEmpty) return '?';
    // Lấy theo RUNE chứ không cắt chuỗi: chữ có dấu tiếng Việt không phải lúc
    // nào cũng gọn trong một đơn vị UTF-16.
    String dau(String s) => String.fromCharCode(s.runes.first).toUpperCase();
    if (parts.length == 1) return dau(parts.first);
    // Tên Việt: chữ cái họ + chữ cái tên gọi (Nguyễn Minh Thư → NT).
    return '${dau(parts.first)}${dau(parts.last)}';
  }

  Future<void> _doi(BuildContext context, AuthProvider auth) async {
    final chon = await showPhoneSheet<String>(
      context: context,
      title: t('Đổi người dùng / cơ sở'),
      builder: (c) => Padding(
        padding: const EdgeInsets.fromLTRB(16, 4, 16, 16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            PhoneCta(
                label: t('Đổi người dùng'),
                onPressed: () => Navigator.of(c).pop('user')),
            const SizedBox(height: 8),
            PhoneSecondaryButton(
                label: t('Đổi cơ sở'),
                icon: Icons.store_outlined,
                onPressed: () => Navigator.of(c).pop('branch')),
            const SizedBox(height: 10),
            Text(t('Cả hai đều đăng xuất khỏi máy này. Ca đang mở KHÔNG bị ảnh hưởng — ca thuộc về cơ sở, không thuộc về máy.'),
                style: const TextStyle(
                    fontSize: 11.5, height: 1.5, color: DanColors.faint)),
          ],
        ),
      ),
    );
    if (chon == null) return;
    // Đổi người dùng: giữ cơ sở để người sau bấm PIN là vào ngay.
    await auth.logout(keepBranch: chon == 'user');
    if (chon == 'branch') auth.changeBranch();
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final user = auth.currentUser;
    final ten = user?.name ?? user?.username ?? '—';
    final coSo = auth.selectedBranch.name.isNotEmpty
        ? auth.selectedBranch.name
        : auth.selectedBranchId;

    return Container(
      color: DanColors.surface,
      padding: const EdgeInsets.fromLTRB(16, 14, 12, 14),
      child: Row(
        children: [
          Container(
            width: 46,
            height: 46,
            decoration: const BoxDecoration(
                color: DanColors.brandDim, shape: BoxShape.circle),
            alignment: Alignment.center,
            child: Text(_viet(ten),
                style: const TextStyle(
                    fontSize: 15,
                    fontWeight: FontWeight.w900,
                    color: DanColors.brand)),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(ten,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                        fontSize: 16, fontWeight: FontWeight.w800)),
                const SizedBox(height: 3),
                Text(
                    [roleLabel(user?.role ?? ''), coSo]
                        .where((e) => e.isNotEmpty)
                        .join(' · '),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.w600,
                        color: DanColors.muted)),
              ],
            ),
          ),
          const SizedBox(width: 8),
          Material(
            color: DanColors.surface,
            borderRadius: BorderRadius.circular(9),
            child: InkWell(
              onTap: () => _doi(context, auth),
              borderRadius: BorderRadius.circular(9),
              child: Container(
                height: 40,
                padding: const EdgeInsets.symmetric(horizontal: 16),
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  border: Border.all(color: DanColors.border2),
                  borderRadius: BorderRadius.circular(9),
                ),
                child: Text(t('Đổi'),
                    style: const TextStyle(
                        fontSize: 13, fontWeight: FontWeight.w800)),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// MÀN "NHIỀU HƠN" — lưới module còn lại, ẩn theo quyền.
class PhoneMoreScreen extends StatelessWidget {
  const PhoneMoreScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    void go(Widget w) =>
        Navigator.of(context).push(MaterialPageRoute(builder: (_) => w));

    VoidCallback? gate(String moduleKey, String perm, Widget Function() build) {
      if (!AppFlavor.current.showsModule(moduleKey)) return null;
      if (!auth.hasPermission(perm)) return null;
      return () => go(build());
    }

    VoidCallback? gateAny(
        String moduleKey, List<String> perms, Widget Function() build) {
      if (!AppFlavor.current.showsModule(moduleKey)) return null;
      if (!perms.any(auth.hasPermission)) return null;
      return () => go(build());
    }

    // Mỗi mục gate bằng ĐÚNG quyền mà route tương ứng đòi:
    //   /api/shifts/current, /api/cash-drawer/current -> guard('pay')
    //   /api/partners            -> guardAny('module.contacts', 'contacts.*')
    //   /api/expenses            -> guard('module.expenses')
    //   /api/purchase            -> guard('module.purchase')
    //   /api/warehouse/documents -> guardAny('inventory.adjust','warehouse.manage')
    //   /api/warehouse/stocktakes-> guardAny('inventory.adjust', …)
    final items = <(String, IconData, VoidCallback?)>[
      (
        'Ca & két tiền',
        Icons.account_balance_wallet_outlined,
        auth.hasPermission('pay') ? () => go(const PhoneShiftScreen()) : null
      ),
      (
        'Khách hàng',
        Icons.people_outline,
        gate('contacts', 'module.contacts',
            () => const PhonePartnersScreen(type: 'customer'))
      ),
      (
        'Nhà cung cấp',
        Icons.local_shipping_outlined,
        gate('contacts', 'module.contacts',
            () => const PhonePartnersScreen(type: 'supplier'))
      ),
      (
        'Chi phí',
        Icons.payments_outlined,
        gate('expenses', 'module.expenses', () => const PhoneExpensesScreen())
      ),
      (
        'Nhập hàng',
        Icons.inbox_outlined,
        gate('purchase', 'module.purchase', () => const PhonePurchaseScreen())
      ),
      (
        'Chuyển hàng',
        Icons.swap_horiz,
        gateAny('warehouse', ['warehouse.manage', 'inventory.adjust'],
            () => const PhoneTransferScreen())
      ),
      (
        'Kiểm kho',
        Icons.fact_check_outlined,
        gateAny('warehouse', ['warehouse.stocktake', 'inventory.adjust'],
            () => const PhoneStocktakeScreen())
      ),
      (
        'Báo cáo',
        Icons.bar_chart_outlined,
        // Backend không có module key `reports`; Trung tâm báo cáo thuộc module
        // `admin` và endpoint tự kiểm tra quyền `reports`/reports.<type>.
        AppFlavor.current.showsModule('admin') &&
                (auth.hasPermission('reports') ||
                    (auth.currentUser?.permissions
                            .any((p) => p.startsWith('reports.')) ??
                        false))
            ? () => go(const PhoneReportsScreen())
            : null
      ),
      (
        'Máy in',
        Icons.print_outlined,
        gateAny(
            'printing',
            ['module.printing', 'settings.printers', 'settings.print', 'pay'],
            () => const PhonePrintersScreen())
      ),
      (
        'Thiết lập',
        Icons.settings_outlined,
        gate('settings', 'settings.manage', () => const PhoneSettingsScreen())
      ),
    ];

    return Scaffold(
      backgroundColor: DanColors.bg,
      body: SafeArea(
        bottom: false,
        child: Column(
          children: [
            PhoneHeader(title: t('Nhiều hơn')),
            Expanded(
              child: ListView(
                padding: const EdgeInsets.only(bottom: 20),
                children: [
                  // ĐẦU MÀN là THẺ NGƯỜI DÙNG, không phải một dòng phụ đề mờ:
                  // đây là chỗ duy nhất trên bản điện thoại nói rõ đang đăng
                  // nhập bằng ai, quyền gì, ở cơ sở nào — và đổi được ngay.
                  const _PhoneAccountCard(),
                  PhoneModuleGrid(items),
                  // Cập nhật đặt NGAY TRÊN phần Tài khoản: người dùng cuộn tới
                  // cuối màn là thấy, không phải đi tìm trong Thiết lập.
                  const PhoneUpdateRow(),
                  PhoneSectionTitle(t('Tài khoản')),
                  PhoneRow(
                    icon: Icons.logout,
                    label: t('Đăng xuất'),
                    value: '',
                    valueColor: DanColors.late,
                    onTap: () => auth.logout(),
                  ),
                  Padding(
                    padding: const EdgeInsets.fromLTRB(16, 16, 16, 0),
                    child: BuildDiagnosticsCard(
                      apiBaseUrl: context.read<ApiService>().baseUrl,
                      allowAdvanced: canViewAdvancedDiagnostics(
                        role: auth.currentUser?.role ?? '',
                        hasDiagnosticsPermission:
                            auth.hasPermission('settings.manage'),
                      ),
                    ),
                  ),
                  Padding(
                    padding: const EdgeInsets.all(16),
                    child: Text(
                        '${AppFlavor.current.appId} · ${AppFlavor.current.versionName} (build ${AppFlavor.current.buildNumber})',
                        style: const TextStyle(
                            fontSize: 11, color: DanColors.faint)),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
