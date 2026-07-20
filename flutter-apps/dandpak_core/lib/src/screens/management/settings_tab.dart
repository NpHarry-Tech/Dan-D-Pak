import 'dart:io' show Platform;

import 'package:flutter/material.dart';

import '../../services/api_service.dart';
import '../../ui/app_theme.dart';
import '../../widgets/dan_top_bar.dart';
import '../../widgets/manager_pin_dialog.dart';
import 'management_widgets.dart';
import 'menu_tab.dart';
import 'settings_customer_display_panel.dart';
import 'settings_loyalty_panel.dart';
import 'settings_more_panels.dart' hide PrintSettingsPanel;
import 'settings_notify_routing_panel.dart';
import 'settings_ops_panels.dart';
import 'settings_panels.dart' hide UsersPanel;
import 'settings_print_panel.dart';
import 'settings_promotions_panel.dart';
import 'settings_users_panel.dart';
import '../../utils/translation.dart';

/// Management → Cài đặt page. Left sub-nav (mirrors the web settings shell)
/// with one panel per section.
class SettingsTab extends StatefulWidget {
  final ApiService api;
  SettingsTab({super.key, required this.api});

  @override
  State<SettingsTab> createState() => _SettingsTabState();
}

class _SettingsSection {
  final String key;
  final String label;
  final String desc;
  final IconData icon;
  _SettingsSection(this.key, this.label, this.desc, this.icon);
}

class _SettingsTabState extends State<SettingsTab> {
  static final _sections = [
    _SettingsSection(
        'users',
        t('Nhân sự & Phân quyền'),
        t('Tài khoản, vai trò và quyền truy cập của nhân viên.'),
        Icons.groups_2_outlined),
    _SettingsSection(
        'branches',
        t('Chi nhánh'),
        t('Thiết lập chi nhánh, kho và phân vùng bán hàng.'),
        Icons.store_outlined),
    _SettingsSection(
        'tables',
        t('Cấu hình bàn'),
        t('Thiết lập bàn, khu vực và sơ đồ phòng bán.'),
        Icons.table_restaurant_outlined),
    _SettingsSection(
        'menu',
        t('Thực đơn (Menu)'),
        t('Danh mục, món ăn, recipe trừ kho và lịch bán.'),
        Icons.restaurant_menu_outlined),
    _SettingsSection(
        'integrations',
        t('Liên kết'),
        t('Hóa đơn điện tử, kế toán và nền tảng bán hàng.'),
        Icons.hub_outlined),
    _SettingsSection(
        'connections',
        t('Kết nối'),
        t('Trạng thái thiết bị, máy in và đồng bộ cloud.'),
        Icons.cable_outlined),
    _SettingsSection('warehouse', t('Kho & kênh bán'),
        t('Quản lý kho hàng và liên kết kênh bán.'), Icons.warehouse_outlined),
    _SettingsSection('print', t('Bill & Tem nhãn'),
        t('Thiết kế mẫu in hóa đơn và tem sản phẩm.'), Icons.print_outlined),
    _SettingsSection(
        'devices',
        t('Thiết bị khách'),
        t('Màn hình self-order và thiết bị cho khách.'),
        Icons.devices_other_outlined),
    _SettingsSection(
        'customer_display',
        t('Màn hình phụ'),
        t('Quảng cáo khi rảnh, hiển thị đơn & QR cho màn thứ 2.'),
        Icons.desktop_windows_outlined),
    _SettingsSection(
        'loyalty',
        t('Tích điểm & Khuyến mại'),
        t('Điểm theo SĐT, hạng thành viên, CTKM, voucher và lịch áp dụng.'),
        Icons.loyalty_outlined),
    _SettingsSection(
        'notifications',
        t('Cấu hình thông báo'),
        t('Âm thanh và định tuyến thông báo sự kiện.'),
        Icons.notifications_active_outlined),
  ];

  String _selected = 'users';

  // Tablet/điện thoại (Android/iOS) chỉ có 1 màn hình → KHÔNG có t("Màn hình phụ")
  // (màn khách trên màn thứ 2 là tính năng riêng của desktop). Ẩn mục này đi.
  bool get _isMobile => Platform.isAndroid || Platform.isIOS;
  List<_SettingsSection> get _visibleSections => _sections
      .where((s) => !(_isMobile && s.key == 'customer_display'))
      .toList();

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(builder: (context, constraints) {
      final wide = constraints.maxWidth >= 820;
      final nav = _nav(wide);
      if (wide) {
        return Row(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            SizedBox(width: 270, child: nav),
            VerticalDivider(width: 1, color: DanColors.border),
            Expanded(child: _content()),
          ],
        );
      }
      return Column(
        children: [
          SizedBox(height: 64, child: nav),
          Divider(height: 1, color: DanColors.border),
          Expanded(child: _content()),
        ],
      );
    });
  }

  Widget _nav(bool wide) {
    if (!wide) {
      return ListView(
        scrollDirection: Axis.horizontal,
        padding: EdgeInsets.symmetric(horizontal: 10, vertical: 10),
        children: [
          for (final s in _visibleSections)
            Padding(
              padding: EdgeInsets.only(right: 8),
              child: ChoiceChip(
                label: Text(s.label),
                selected: _selected == s.key,
                onSelected: (_) => setState(() => _selected = s.key),
              ),
            ),
        ],
      );
    }
    return Container(
      color: DanColors.surface,
      child: ListView(
        padding: EdgeInsets.symmetric(vertical: 10, horizontal: 8),
        children: [
          for (final s in _visibleSections)
            InkWell(
              onTap: () => setState(() => _selected = s.key),
              borderRadius: BorderRadius.circular(DanRadius.sm),
              child: Container(
                margin: EdgeInsets.symmetric(vertical: 2),
                padding: EdgeInsets.symmetric(horizontal: 12, vertical: 11),
                decoration: BoxDecoration(
                  color: _selected == s.key
                      ? DanColors.brandDim
                      : Colors.transparent,
                  borderRadius: BorderRadius.circular(DanRadius.sm),
                ),
                child: Row(
                  children: [
                    Icon(s.icon,
                        size: 20,
                        color: _selected == s.key
                            ? DanColors.brand
                            : DanColors.muted),
                    SizedBox(width: 11),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(s.label,
                              style: TextStyle(
                                  fontSize: 13.5,
                                  fontWeight: FontWeight.w800,
                                  color: _selected == s.key
                                      ? DanColors.brand
                                      : DanColors.text)),
                          SizedBox(height: 2),
                          Text(s.desc,
                              maxLines: 2,
                              overflow: TextOverflow.ellipsis,
                              style: TextStyle(
                                  fontSize: 10.5,
                                  color: DanColors.faint,
                                  height: 1.3)),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ),
        ],
      ),
    );
  }

  Widget _content() {
    switch (_selected) {
      case 'users':
        return UsersPanel(api: widget.api);
      case 'branches':
        return BranchesPanel(api: widget.api);
      case 'tables':
        return TablesPanel(api: widget.api);
      case 'menu':
        return MenuTab(api: widget.api);
      case 'connections':
        return ConnectionsPanel(api: widget.api);
      case 'integrations':
        return IntegrationsPanel(api: widget.api);
      case 'warehouse':
        return WarehouseSettingsPanel(api: widget.api);
      case 'print':
        return PrintSettingsPanel(api: widget.api);
      case 'devices':
        return DevicesPanel(api: widget.api);
      case 'customer_display':
        return CustomerDisplaySettingsPanel(api: widget.api);
      case 'loyalty':
        return LoyaltyPromotionsPanel(api: widget.api);
      case 'notifications':
        return NotificationSettingsPanel(api: widget.api);
      default:
        final s = _sections.firstWhere((e) => e.key == _selected);
        return _SubInProgress(label: s.label, desc: s.desc);
    }
  }
}

class LoyaltyPromotionsPanel extends StatelessWidget {
  final ApiService api;
  LoyaltyPromotionsPanel({super.key, required this.api});

  @override
  Widget build(BuildContext context) {
    return DefaultTabController(
      length: 2,
      child: Column(
        children: [
          Container(
            alignment: Alignment.centerLeft,
            color: DanColors.surface,
            padding: EdgeInsets.fromLTRB(16, 10, 16, 0),
            child: TabBar(
              isScrollable: true,
              tabs: [
                Tab(text: t('Tích điểm')),
                Tab(text: 'CTKM / Voucher'),
              ],
            ),
          ),
          Expanded(
            child: TabBarView(
              children: [
                LoyaltySettingsPanel(api: api),
                PromotionSettingsPanel(api: api),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _SubInProgress extends StatelessWidget {
  final String label;
  final String desc;
  _SubInProgress({required this.label, required this.desc});

  @override
  Widget build(BuildContext context) {
    return Center(
      child: ConstrainedBox(
        constraints: BoxConstraints(maxWidth: 420),
        child: Padding(
          padding: EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(Icons.tune, size: 38, color: DanColors.faint),
              SizedBox(height: 12),
              Text(label,
                  style: TextStyle(fontSize: 17, fontWeight: FontWeight.w900)),
              SizedBox(height: 6),
              Text(desc,
                  textAlign: TextAlign.center,
                  style: TextStyle(color: DanColors.muted, height: 1.5)),
              SizedBox(height: 12),
              Text(t('Đang được port trong module này.'),
                  style: TextStyle(
                      color: DanColors.brand,
                      fontWeight: FontWeight.w700,
                      fontSize: 12.5)),
            ],
          ),
        ),
      ),
    );
  }
}

/// Shared scaffold for a settings panel: title row + add button + body.
class SettingsPanelScaffold extends StatelessWidget {
  final String title;
  final String? addLabel;
  final VoidCallback? onAdd;
  final Widget child;
  final VoidCallback? onRefresh;

  SettingsPanelScaffold({
    super.key,
    required this.title,
    required this.child,
    this.addLabel,
    this.onAdd,
    this.onRefresh,
  });

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Padding(
          padding: EdgeInsets.fromLTRB(18, 16, 18, 12),
          child: Row(
            children: [
              Expanded(
                child: Text(title,
                    style:
                        TextStyle(fontSize: 18, fontWeight: FontWeight.w900)),
              ),
              if (onRefresh != null)
                IconButton(
                    onPressed: onRefresh,
                    icon: Icon(Icons.refresh, color: DanColors.muted)),
              if (onAdd != null && addLabel != null)
                FilledButton.icon(
                  onPressed: onAdd,
                  icon: Icon(Icons.add, size: 18),
                  label: Text(addLabel!),
                  style: FilledButton.styleFrom(minimumSize: Size(0, 40)),
                ),
            ],
          ),
        ),
        Divider(height: 1, color: DanColors.border),
        Expanded(child: child),
      ],
    );
  }
}

/// Helper exposed for panels to prompt for a manager PIN.
Future<String?> settingsPin(BuildContext context, String reason) =>
    requestManagerPin(context, reason);

String settingsRoleLabel(String role) => roleLabel(role);

/// Inline error/loading helper reused across settings panels.
Widget settingsState(
    {required bool loading,
    String? error,
    VoidCallback? onRetry,
    required Widget child}) {
  if (loading) return Center(child: CircularProgressIndicator());
  if (error != null) {
    return Padding(
      padding: EdgeInsets.all(40),
      child: InlineMessage(error, error: true, onRetry: onRetry),
    );
  }
  return child;
}
