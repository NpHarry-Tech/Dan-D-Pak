import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../providers/auth_provider.dart';
import '../../services/api_service.dart';
import '../../ui/app_theme.dart';
import '../../utils/translation.dart';
import '../management/settings_branches_panel.dart';
import '../management/settings_notify_routing_panel.dart';
import '../management/settings_tables_panel.dart';
import '../management/settings_warehouse_panel.dart';
import 'phone_kit.dart';
import 'phone_scaffolds.dart';
import 'phone_printers_screen.dart';
import 'phone_sell_settings_screen.dart';

/// MÀN CÀI ĐẶT bản điện thoại / POS cầm tay.
///
/// Thay cho `SettingsTab` của desktop — màn đó có ngưỡng 820px, dưới ngưỡng thì
/// dồn hết mục vào một dải cuộn ngang cao 64px, người dùng không thấy được có
/// bao nhiêu mục và phải quẹt mò.
///
/// Ở đây là DANH SÁCH DỌC, xếp theo TẦN SUẤT DÙNG THẬT ngoài cửa hàng chứ không
/// theo thứ tự trong code: thứ mở hằng ngày nằm trên cùng, thứ chỉ đụng lúc lắp
/// đặt nằm dưới đáy.
///
/// Mỗi dòng có một câu mô tả TRẠNG THÁI HIỆN TẠI ("2/3 kho đang bật · 3 bảng
/// giá") thay vì mô tả tính năng. Người dùng mở Cài đặt là để kiểm tra hoặc đổi
/// một thứ cụ thể — biết ngay tình trạng thì đỡ phải vào từng mục để dò.
class PhoneSettingsScreen extends StatefulWidget {
  const PhoneSettingsScreen({super.key});

  @override
  State<PhoneSettingsScreen> createState() => _PhoneSettingsScreenState();
}

class _PhoneSettingsScreenState extends State<PhoneSettingsScreen> {
  final _timKiem = TextEditingController();

  /// Câu mô tả trạng thái của từng mục, khoá theo id mục. Nạp dần — mục nào
  /// chưa có số liệu thì để trống chứ không hiện số bịa.
  final Map<String, String> _trangThai = {};
  bool _dangNap = true;

  @override
  void initState() {
    super.initState();
    _napTrangThai();
  }

  @override
  void dispose() {
    _timKiem.dispose();
    super.dispose();
  }

  /// Nạp SONG SONG và chịu lỗi từng phần: một API hỏng không được làm trống cả
  /// màn. Mục nào không lấy được số liệu thì đơn giản là không có dòng mô tả.
  Future<void> _napTrangThai() async {
    if (mounted) setState(() => _dangNap = true);
    final api = context.read<ApiService>();

    Future<void> lay(String id, Future<String> Function() f) async {
      try {
        final s = await f();
        if (mounted && s.isNotEmpty) setState(() => _trangThai[id] = s);
      } catch (_) {/* mục này không có mô tả, không sao */}
    }

    await Future.wait([
      lay('sell', () async {
        final cfg = await api.getAppSettings();
        final rc = (cfg['retail_config'] as Map?) ?? const {};
        final st = (rc['standalone'] as Map?) ?? const {};
        final ten = '${st['price_list_name'] ?? st['priceListName'] ?? ''}';
        return ten.isEmpty
            ? t('Bảng giá · quét mã · thanh toán')
            : '${t('Bảng giá')} $ten · ${t('quét mã')} · ${t('thanh toán')}';
      }),
      lay('warehouse', () async {
        final ds = await api.getWarehouses();
        final tong = ds.length;
        final bat = ds
            .whereType<Map>()
            .where((e) => e['active'] != false && e['enabled'] != false)
            .length;
        return '$bat/$tong ${t('kho đang bật')}';
      }),
      lay('tables', () async {
        final ds = await api.getTables();
        final rows = ds.whereType<Map>().toList();
        final khu = rows
            .map((e) => '${e['zone'] ?? e['area'] ?? ''}')
            .where((e) => e.isNotEmpty)
            .toSet()
            .length;
        return '${rows.length} ${t('bàn')} · $khu ${t('khu vực')}';
      }),
      lay('branches', () async {
        final ds = await api.getBranches();
        final rows = ds.whereType<Map>().toList();
        final mo = rows.where((e) => e['active'] != false).length;
        return '$mo/${rows.length} ${t('đang mở')}';
      }),
      lay('printing', () async {
        final ds = await api.getPrinters(live: false);
        return ds.isEmpty
            ? t('Chưa kết nối máy in nào')
            : '${ds.length} ${t('máy in')}';
      }),
      lay('integrations', () async {
        final cfg = await api.getIntegrations();
        final ds = cfg.entries.where((e) => e.value is Map).toList();
        final noi = ds
            .where((e) => (e.value as Map)['enabled'] == true)
            .length;
        return ds.isEmpty
            ? ''
            : '$noi/${ds.length} ${t('đối tác đã nối')}';
      }),
    ]);
    if (mounted) setState(() => _dangNap = false);
  }

  /// Các mục, đã xếp theo tần suất dùng thật.
  List<_Nhom> _nhom(BuildContext context) {
    void mo(Widget w) =>
        Navigator.of(context).push(MaterialPageRoute(builder: (_) => w));

    return [
      // Không có tiêu đề nhóm: đây là mục mở nhiều nhất, để nó nằm ngay dưới ô
      // tìm kiếm, không phải lướt qua một tiêu đề mới tới.
      _Nhom('', [
        _Muc('sell', 'Thiết lập bán hàng', Icons.shopping_cart_outlined,
            () => mo(const PhoneSellSettingsScreen())),
      ]),
      _Nhom('HẰNG TUẦN', [
        _Muc('warehouse', 'Kho & kênh bán', Icons.warehouse_outlined,
            () => mo(_KhungPanel('Kho & kênh bán',
                (api) => WarehouseSettingsPanel(api: api)))),
      ]),
      _Nhom('THỈNH THOẢNG', [
        _Muc('tables', 'Cấu hình bàn', Icons.table_restaurant_outlined,
            () => mo(_KhungPanel('Cấu hình bàn',
                (api) => TablesPanel(api: api)))),
        _Muc('notify', 'Cấu hình thông báo', Icons.notifications_outlined,
            () => mo(_KhungPanel('Cấu hình thông báo',
                (api) => NotificationSettingsPanel(api: api)))),
      ]),
      _Nhom('LÚC LẮP ĐẶT', [
        _Muc('printing', 'Máy in', Icons.print_outlined,
            () => mo(const PhonePrintersScreen())),
        _Muc('branches', 'Chi nhánh', Icons.store_outlined,
            () => mo(_KhungPanel('Chi nhánh',
                (api) => BranchesPanel(api: api)))),
      ]),
    ];
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final q = _timKiem.text.trim().toLowerCase();

    final nhom = _nhom(context)
        .map((n) => _Nhom(
            n.tieuDe,
            n.mucs
                .where((m) => q.isEmpty || t(m.ten).toLowerCase().contains(q))
                .toList()))
        .where((n) => n.mucs.isNotEmpty)
        .toList();

    return Scaffold(
      backgroundColor: DanColors.bg,
      body: SafeArea(
        bottom: false,
        child: Column(
          children: [
            PhoneHeader(
              title: t('Cài đặt'),
              subtitle: auth.currentUser?.name ?? '',
              onBack: () => Navigator.of(context).maybePop(),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 4, 16, 12),
              child: PhoneSearchBar(
                controller: _timKiem,
                hint: t('Tìm mục cài đặt...'),
                onChanged: (_) => setState(() {}),
              ),
            ),
            Expanded(
              child: RefreshIndicator(
                onRefresh: _napTrangThai,
                child: ListView(
                  padding: const EdgeInsets.only(bottom: 24),
                  children: [
                    for (final n in nhom) ...[
                      if (n.tieuDe.isNotEmpty) PhoneSectionTitle(t(n.tieuDe)),
                      for (final m in n.mucs)
                        PhoneListRow(
                          title: t(m.ten),
                          subtitle: _trangThai[m.id] ??
                              (_dangNap ? t('Đang tải...') : ''),
                          onTap: m.moMan,
                        ),
                    ],
                    if (q.isEmpty) const _GhiChuChiCoTrenMayBan(),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _Nhom {
  final String tieuDe;
  final List<_Muc> mucs;
  _Nhom(this.tieuDe, this.mucs);
}

class _Muc {
  final String id;
  final String ten;
  final IconData icon;
  final VoidCallback moMan;
  _Muc(this.id, this.ten, this.icon, this.moMan);
}

/// Nói THẲNG những gì không có trên điện thoại, thay vì để người dùng đi tìm rồi
/// tưởng app thiếu tính năng.
class _GhiChuChiCoTrenMayBan extends StatelessWidget {
  const _GhiChuChiCoTrenMayBan();

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 20, 16, 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(t('CHỈ CÓ TRÊN MÁY ĐỂ BÀN'),
              style: const TextStyle(
                  fontSize: 10.5,
                  fontWeight: FontWeight.w800,
                  letterSpacing: .5,
                  color: DanColors.faint)),
          const SizedBox(height: 6),
          Text(
              t('Thiết kế bill & tem nhãn · Nhân sự & phân quyền · Màn hình phụ. '
                  'Ba mục này cần canvas kéo thả hoặc ma trận quyền nên đã gỡ khỏi '
                  'bản điện thoại — desktop và tablet vẫn giữ đủ 12 mục.'),
              style: const TextStyle(
                  fontSize: 11.5, height: 1.5, color: DanColors.faint)),
        ],
      ),
    );
  }
}

/// Bọc panel của desktop trong khung điện thoại.
///
/// Các panel này chưa được thiết kế lại cho màn nhỏ — bọc lại để chúng có thanh
/// tiêu đề và nút quay lại đúng kiểu điện thoại, còn ruột giữ nguyên. Thà vào
/// được và hơi chật còn hơn không vào được.
class _KhungPanel extends StatelessWidget {
  final String tieuDe;
  final Widget Function(ApiService api) dung;
  const _KhungPanel(this.tieuDe, this.dung);

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: DanColors.bg,
      body: SafeArea(
        bottom: false,
        child: Column(
          children: [
            PhoneHeader(
              title: t(tieuDe),
              onBack: () => Navigator.of(context).maybePop(),
            ),
            Expanded(child: dung(context.read<ApiService>())),
          ],
        ),
      ),
    );
  }
}
