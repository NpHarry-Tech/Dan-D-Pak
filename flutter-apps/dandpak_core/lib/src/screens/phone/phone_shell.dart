import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../app_flavor.dart';
import '../../providers/auth_provider.dart';
import '../../ui/app_theme.dart';
import '../../utils/translation.dart';

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
        gate('warehouse', 'warehouse.manage', () => const PhoneTransferScreen())
      ),
      (
        'Kiểm kho',
        Icons.fact_check_outlined,
        gate(
            'warehouse', 'inventory.adjust', () => const PhoneStocktakeScreen())
      ),
      (
        'Báo cáo',
        Icons.bar_chart_outlined,
        gate('reports', 'reports', () => const PhoneReportsScreen())
      ),
      (
        'Máy in',
        Icons.print_outlined,
        gate('printing', 'module.printing', () => const PhonePrintersScreen())
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
            PhoneHeader(
              title: t('Nhiều hơn'),
              subtitle: auth.currentUser?.name ?? '',
            ),
            Expanded(
              child: ListView(
                padding: const EdgeInsets.only(bottom: 20),
                children: [
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
