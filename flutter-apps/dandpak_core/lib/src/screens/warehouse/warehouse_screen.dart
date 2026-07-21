import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../providers/auth_provider.dart';
import '../../services/api_service.dart';
import '../../ui/app_theme.dart';
import '../../ui/format.dart';
import '../../widgets/dan_top_bar.dart';
import '../../widgets/scan_button.dart';
import '../contacts/contacts_screen.dart';
import '../management/management_widgets.dart';
import '../purchase/purchase_doc_form_page.dart';
import '../purchase/purchase_doc_list_page.dart';
import '../../services/black_box.dart';
import '../../utils/translation.dart';
import 'price_book_page.dart';
import 'stocktake_page.dart';
import 'warehouse_doc_pages.dart';

part 'warehouse_screen_methods.dart';

part 'warehouse_filters.dart';
part 'warehouse_stock_table.dart';
part 'stock_move_dialog.dart';

/// Kho hàng — điều hướng 2 tầng, chọn từ trên xuống:
///   Tầng 1: CHỌN KHO (pill) — áp cho mọi tính năng bên dưới.
///   Tầng 2: CHỌN TÍNH NĂNG — một dải tab gộp chia 4 nhóm:
///     Tồn kho (Tồn kho · Lô & HSD · Lịch sử · Phiếu kho) |
///     Nghiệp vụ kho (Kiểm kho · Chuyển hàng · Xuất nội bộ) |
///     Mua hàng (Nhập hàng · Trả hàng nhập · Nhà cung cấp) | Giá bán.
class WarehouseScreen extends StatefulWidget {
  WarehouseScreen({super.key});

  @override
  State<WarehouseScreen> createState() => _WarehouseScreenState();
}

class _WarehouseScreenState extends State<WarehouseScreen> {
  List<Map<String, dynamic>> _warehouses = [];
  List<Map<String, dynamic>> _stock = [];
  List<Map<String, dynamic>> _lots = [];
  List<Map<String, dynamic>> _movements = [];
  List<Map<String, dynamic>> _documents = [];
  String _activeWh = '';
  // Tính năng đang mở (1 dải tab gộp, chọn kho ở hàng trên):
  // stock | lots | hist | docs | stocktake | transfer | internal |
  // purchase_in | purchase_return | pricebook
  String _feature = 'stock';
  // SKU đang mở rộng panel chi tiết trong bảng Tồn kho retail ('' = đóng hết).
  String _expandedSku = '';
  bool _loading = true;
  String? _error;
  String _search = '';
  final _searchCtrl = TextEditingController();

  // KiotViet-style retail product-list filters (left sidebar).
  bool _showFilters = true;
  String _catFilter = ''; // Nhóm hàng (leaf category); '' = tất cả
  String _brandFilter = ''; // Thương hiệu
  String _vatFilter = ''; // VAT hàng bán label ("8%", "KCT", …)
  String _stockFilter = 'all'; // all | instock | out | low
  // Column picker (gear): the three price/vat columns show by default.
  bool _colPreTax = true;
  bool _colVat = true;
  bool _colAfterTax = true;
  bool _colBrand = false;
  bool _colCreated = false;

  // Cầu nối setState cho các method đã tách sang extension (warehouse_screen_methods).
  // setState là @protected nên chỉ gọi hợp lệ từ instance member của State — extension
  // gọi qua wrapper này để giữ nguyên hành vi mà không vướng lint protected-member.
  void _rebuild([VoidCallback? fn]) => setState(fn ?? () {});

  void _resetRetailFilters() {
    _catFilter = '';
    _brandFilter = '';
    _vatFilter = '';
    _stockFilter = 'all';
  }

  @override
  void initState() {
    super.initState();
    BlackBox.screen = 'warehouse';
    _loadAll();
  }

  @override
  void dispose() {
    _searchCtrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final user = auth.currentUser;
    final branch = auth.selectedBranch;

    return Scaffold(
      backgroundColor: DanColors.bg,
      appBar: DanModuleTopBar(
        brandName: branch.name.isNotEmpty ? branch.name : branch.id,
        title: t('Kho hàng'),
        subtitle: '',
        titleIcon: Icons.warehouse_outlined,
        userName: user?.name ?? '—',
        userRole: roleLabel(user?.role ?? ''),
        online: true,
        onBack: () => Navigator.of(context).maybePop(),
        onLogout: () => auth.logout(),
      ),
      body: Column(
        children: [
          _khoBar(),
          Divider(height: 1, color: DanColors.border),
          _featureBar(),
          Divider(height: 1, color: DanColors.border),
          Expanded(child: _featureBody()),
        ],
      ),
    );
  }

  // ── Điều hướng 2 tầng: (1) chọn KHO → (2) chọn TÍNH NĂNG ────────────────
  // Gộp menu Hàng hóa/Mua hàng cũ + 4 tab Kho/Lô/Lịch sử/Phiếu vào MỘT dải
  // tab nhóm (giống thanh module KiotViet nhưng phẳng, không dropdown).

}
