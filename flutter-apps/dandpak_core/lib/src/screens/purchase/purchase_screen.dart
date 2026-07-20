import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../providers/auth_provider.dart';
import '../../services/api_service.dart';
import '../../ui/app_theme.dart';
import '../../widgets/dan_top_bar.dart';
import '../contacts/contacts_screen.dart';
import '../management/management_widgets.dart';
import '../warehouse/kv_shared.dart';
import '../../services/black_box.dart';
import '../../utils/translation.dart';
import 'purchase_doc_form_page.dart';
import 'purchase_doc_list_page.dart';

/// Module Mua hàng (KiotViet): 2 tab dùng chung trang với module Kho —
/// Nhập hàng (PN…) và Trả hàng nhập (THN…) + lối tắt mở danh bạ Nhà cung cấp.
class PurchaseScreen extends StatefulWidget {
  PurchaseScreen({super.key});

  @override
  State<PurchaseScreen> createState() => _PurchaseScreenState();
}

class _PurchaseScreenState extends State<PurchaseScreen> {
  String _tab = 'in'; // in | return
  List<Map<String, dynamic>> _warehouses = [];
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    BlackBox.screen = 'purchase';
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final whs = await context.read<ApiService>().getWarehouses();
      if (!mounted) return;
      setState(() {
        _warehouses = kvMapList(whs);
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.toString().replaceFirst('Exception: ', '');
        _loading = false;
      });
    }
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
        title: t('Mua hàng'),
        subtitle: '',
        titleIcon: Icons.local_shipping_outlined,
        userName: user?.name ?? '—',
        userRole: roleLabel(user?.role ?? ''),
        online: true,
        onBack: () => Navigator.of(context).maybePop(),
        onLogout: () => auth.logout(),
        actions: [
          DanTopBarButton(
            onPressed: () => Navigator.of(context).push(MaterialPageRoute(
                builder: (_) => ContactsScreen(initialType: 'supplier'))),
            icon: Icons.people_outline,
            label: t('Nhà cung cấp'),
          ),
        ],
      ),
      body: Column(
        children: [
          _tabBar(),
          Divider(height: 1, color: DanColors.border),
          Expanded(child: _body()),
        ],
      ),
    );
  }

  Widget _tabBar() {
    final tabs = [
      ['in', t('Nhập hàng')],
      ['return', t('Trả hàng nhập')],
    ];
    return Container(
      width: double.infinity,
      color: DanColors.surface,
      padding: EdgeInsets.symmetric(horizontal: 12),
      child: Row(
        children: [
          for (final tb in tabs)
            InkWell(
              onTap: () => setState(() => _tab = tb[0]),
              child: Container(
                padding: EdgeInsets.symmetric(horizontal: 14, vertical: 11),
                decoration: BoxDecoration(
                  border: Border(
                    bottom: BorderSide(
                      color:
                          _tab == tb[0] ? DanColors.brand : Colors.transparent,
                      width: 2.5,
                    ),
                  ),
                ),
                child: Text(tb[1],
                    style: TextStyle(
                        fontSize: 13.5,
                        fontWeight: FontWeight.w800,
                        color: _tab == tb[0]
                            ? DanColors.brand
                            : DanColors.muted)),
              ),
            ),
        ],
      ),
    );
  }

  Widget _body() {
    if (_loading && _warehouses.isEmpty) {
      return Center(child: CircularProgressIndicator());
    }
    if (_error != null && _warehouses.isEmpty) {
      return Padding(
        padding: EdgeInsets.all(40),
        child: InlineMessage(t('Không tải được danh sách kho ($_error)'),
            error: true, onRetry: _load),
      );
    }
    return _tab == 'return'
        ? PurchaseDocListPage(
            key: ValueKey('return'),
            mode: PurchaseDocMode.purchaseReturn,
            warehouses: _warehouses)
        : PurchaseDocListPage(
            key: ValueKey('in'),
            mode: PurchaseDocMode.purchaseIn,
            warehouses: _warehouses);
  }
}
