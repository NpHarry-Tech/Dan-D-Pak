import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../services/api_service.dart';
import '../../ui/app_theme.dart';
import '../../ui/format.dart';
import '../../utils/translation.dart';
import '../management/management_widgets.dart';
import 'online_shared.dart';

/// Hàng hóa — liên kết sản phẩm trên sàn với SKU trong kho (Haravan hiện có
/// dữ liệu; sàn khác hiện lên khi connector được cấp quyền).
class OnlineProductsSection extends StatefulWidget {
  const OnlineProductsSection({super.key});

  @override
  State<OnlineProductsSection> createState() => _OnlineProductsSectionState();
}

class _OnlineProductsSectionState extends State<OnlineProductsSection> {
  static const _tabs = [
    ['all', 'Tất cả'],
    ['catalog_linked', 'Đã liên kết'],
    ['shadow_import', 'Chưa liên kết'],
  ];
  int _tab = 0;
  final _search = TextEditingController();
  String _query = '';
  List<Map<String, dynamic>> _rows = [];
  int _total = 0;
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    try {
      final res = await context.read<ApiService>().getOnlineProductMappings(
            status: _tabs[_tab][0] == 'all' ? '' : _tabs[_tab][0],
            q: _query,
            limit: 100,
          );
      if (!mounted) return;
      setState(() {
        _rows = oList(res['rows']);
        _total = oNum(res['total']).toInt();
        _loading = false;
        _error = null;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.toString().replaceFirst('Exception: ', '');
        _loading = false;
      });
    }
  }

  Future<void> _linkDialog(Map<String, dynamic> row) async {
    final sku = await showSkuPickerDialog(context);
    if (sku == null) return;
    try {
      await context.read<ApiService>().linkOnlineProduct(
            shopDomain: oStr(row['shop_domain']),
            externalProductId: oStr(row['external_product_id']),
            externalVariantId: oStr(row['external_variant_id']),
            skuId: oStr(sku['id']),
          );
      if (mounted) appToast(context, t('Đã liên kết hàng hóa'));
      _load();
    } catch (e) {
      if (mounted) {
        appToast(context, e.toString().replaceFirst('Exception: ', ''),
            isError: true);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(14, 12, 14, 8),
          child: Row(
            children: [
              for (var i = 0; i < _tabs.length; i++) ...[
                ChoiceChip(
                  label: Text(t(_tabs[i][1])),
                  selected: _tab == i,
                  onSelected: (_) {
                    setState(() => _tab = i);
                    _load();
                  },
                ),
                const SizedBox(width: 8),
              ],
              const Spacer(),
              SizedBox(
                width: 260,
                child: TextField(
                  controller: _search,
                  decoration: InputDecoration(
                    isDense: true,
                    hintText: t('Tìm tên/SKU/mã sàn'),
                    prefixIcon: const Icon(Icons.search, size: 18),
                  ),
                  onSubmitted: (v) {
                    setState(() => _query = v.trim());
                    _load();
                  },
                ),
              ),
            ],
          ),
        ),
        const Divider(height: 1, color: DanColors.border),
        Expanded(child: _body()),
      ],
    );
  }

  Widget _body() {
    if (_loading) return const Center(child: CircularProgressIndicator());
    if (_error != null) {
      return Padding(
        padding: const EdgeInsets.all(40),
        child: InlineMessage(_error!, error: true, onRetry: _load),
      );
    }
    if (_rows.isEmpty) {
      return OnlineEmpty(
          t('Chưa có hàng hóa sàn nào — đồng bộ Haravan hoặc chờ cấp quyền sàn khác'),
          icon: Icons.inventory_2_outlined);
    }
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView.separated(
        padding: const EdgeInsets.all(14),
        itemCount: _rows.length + 1,
        separatorBuilder: (_, __) => const SizedBox(height: 8),
        itemBuilder: (_, i) {
          if (i == 0) {
            return Text('${t('Tổng')}: $_total',
                style: const TextStyle(
                    fontSize: 12.5, color: DanColors.muted));
          }
          return _row(_rows[i - 1]);
        },
      ),
    );
  }

  Widget _row(Map<String, dynamic> r) {
    final linked = oStr(r['mapping_status']) == 'catalog_linked';
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: DanColors.surface,
        border: Border.all(color: DanColors.border),
        borderRadius: BorderRadius.circular(DanRadius.md),
      ),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(oStr(r['name']),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                        fontSize: 13, fontWeight: FontWeight.w700)),
                const SizedBox(height: 2),
                Text(
                  'SKU: ${oStr(r['sku']).isEmpty ? '—' : oStr(r['sku'])} · '
                  '${t('Tồn')}: ${oNum(r['stock']).toInt()} · ${Fmt.money(oNum(r['price']))}',
                  style:
                      const TextStyle(fontSize: 11.5, color: DanColors.muted),
                ),
              ],
            ),
          ),
          const SizedBox(width: 10),
          OnlinePill(linked ? t('Đã liên kết') : t('Chưa liên kết'),
              linked ? DanColors.done : DanColors.doing),
          const SizedBox(width: 10),
          OutlinedButton(
            onPressed: () => _linkDialog(r),
            style: OutlinedButton.styleFrom(minimumSize: const Size(0, 34)),
            child: Text(linked ? t('Đổi liên kết') : t('Liên kết'),
                style: const TextStyle(fontSize: 12)),
          ),
        ],
      ),
    );
  }
}

/// Chọn một SKU trong kho để liên kết với hàng trên sàn.
Future<Map<String, dynamic>?> showSkuPickerDialog(BuildContext context) async {
  return showDialog<Map<String, dynamic>>(
    context: context,
    builder: (_) => const _SkuPickerDialog(),
  );
}

class _SkuPickerDialog extends StatefulWidget {
  const _SkuPickerDialog();

  @override
  State<_SkuPickerDialog> createState() => _SkuPickerDialogState();
}

class _SkuPickerDialogState extends State<_SkuPickerDialog> {
  final _search = TextEditingController();
  List<Map<String, dynamic>> _skus = [];
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load('');
  }

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  Future<void> _load(String q) async {
    setState(() => _loading = true);
    try {
      final res = await context
          .read<ApiService>()
          .getSkusPaginated(page: 1, limit: 40, q: q);
      if (!mounted) return;
      setState(() {
        _skus = oList(res['rows'] ?? res['items'] ?? res['skus']);
        _loading = false;
      });
    } catch (_) {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Dialog(
      child: ConstrainedBox(
        constraints: BoxConstraints(
          maxWidth: dialogWidth(context, 480),
          maxHeight: MediaQuery.sizeOf(context).height * .8,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Padding(
              padding: const EdgeInsets.all(14),
              child: TextField(
                controller: _search,
                autofocus: true,
                decoration: InputDecoration(
                  hintText: t('Tìm sản phẩm trong kho'),
                  prefixIcon: const Icon(Icons.search, size: 18),
                ),
                onSubmitted: _load,
              ),
            ),
            const Divider(height: 1, color: DanColors.border),
            Flexible(
              child: _loading
                  ? const Padding(
                      padding: EdgeInsets.all(30),
                      child: Center(child: CircularProgressIndicator()))
                  : ListView.builder(
                      shrinkWrap: true,
                      itemCount: _skus.length,
                      itemBuilder: (_, i) {
                        final s = _skus[i];
                        return ListTile(
                          dense: true,
                          title: Text(oStr(s['name']),
                              style: const TextStyle(fontSize: 13)),
                          subtitle: Text(
                              'SKU ${oStr(s['id'])} · ${t('Tồn')} ${oNum(s['stock']).toInt()}',
                              style: const TextStyle(fontSize: 11)),
                          trailing: Text(Fmt.money(oNum(s['price'])),
                              style: const TextStyle(
                                  fontSize: 12, fontWeight: FontWeight.w700)),
                          onTap: () => Navigator.of(context).pop(s),
                        );
                      },
                    ),
            ),
          ],
        ),
      ),
    );
  }
}
