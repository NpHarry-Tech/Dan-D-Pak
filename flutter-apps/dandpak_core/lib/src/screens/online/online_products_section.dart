import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../providers/auth_provider.dart';
import '../../services/api_service.dart';
import '../../ui/app_theme.dart';
import '../../ui/debouncer.dart';
import '../../ui/format.dart';
import '../../utils/translation.dart';
import '../management/management_widgets.dart';
import 'online_shared.dart';

/// Hàng hóa bán online. Tab "Hàng trong kho" = SKU thật (đơn online trừ chính
/// kho này). Tab "Liên kết sàn" = ánh xạ listing sàn ↔ SKU kho theo bố cục
/// KiotViet: gian hàng (logo sàn) · hàng trên sàn (ảnh/tên/ID/SKU) · hàng trên
/// POS (ảnh/tên/SKU/ID/giá/tồn) · trạng thái · thao tác (Sao chép/Hủy liên kết).
class OnlineProductsSection extends StatefulWidget {
  const OnlineProductsSection({super.key});

  @override
  State<OnlineProductsSection> createState() => _OnlineProductsSectionState();
}

class _OnlineProductsSectionState extends State<OnlineProductsSection> {
  int _tab = 0; // 0 = Hàng trong kho, 1 = Liên kết sàn
  final _search = TextEditingController();
  final Debouncer _searchDebounce = Debouncer();
  String _query = '';

  // Kho
  List<Map<String, dynamic>> _kho = [];
  int _khoTotal = 0;
  // Sàn
  int _sanSub = 0; // 0 tất cả, 1 đã liên kết, 2 chưa liên kết
  String _provider = ''; // lọc theo sàn ('' = tất cả)
  List<Map<String, dynamic>> _san = [];
  Map<String, int> _counts = {'all': 0, 'linked': 0, 'unlinked': 0};

  bool _loading = true;
  bool _busy = false; // đang đồng bộ / thao tác
  String? _error;

  static const _syncableProviders = ['shopee', 'lazada', 'tiktokshop'];

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _search.dispose();
    _searchDebounce.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    try {
      final api = context.read<ApiService>();
      if (_tab == 0) {
        final res = await api.getSkusPaginated(page: 1, limit: 200, q: _query);
        _kho = oList(res['items'] ?? res['rows'] ?? res['skus']);
        _khoTotal = oNum(res['total']).toInt();
      } else {
        final status = _sanSub == 1
            ? 'linked'
            : _sanSub == 2
                ? 'unlinked'
                : '';
        final res = await api.getOnlineProductMappings(
            status: status, provider: _provider, q: _query, limit: 200);
        _san = oList(res['rows']);
        final c = oMap(res['counts']);
        _counts = {
          'all': oNum(c['all']).toInt(),
          'linked': oNum(c['linked']).toInt(),
          'unlinked': oNum(c['unlinked']).toInt(),
        };
      }
      if (!mounted) return;
      setState(() {
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

  // ── Đồng bộ listing sản phẩm từ sàn ────────────────────────────────────────
  Future<void> _syncProducts(String provider) async {
    setState(() => _busy = true);
    try {
      final res = await context.read<ApiService>().syncOnlineProducts(provider);
      final n = oNum(res['synced']).toInt();
      if (mounted) {
        appToast(context,
            '${t('Đã đồng bộ')} $n ${t('sản phẩm từ')} ${providerMeta(provider).name}');
      }
      await _load();
    } catch (e) {
      if (mounted) {
        appToast(context, e.toString().replaceFirst('Exception: ', ''),
            isError: true);
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  // ── "Sao chép": tự đối chiếu SKU/ID; khớp thì liên kết, không thì chọn tay ──
  Future<void> _copyLink(Map<String, dynamic> row) async {
    setState(() => _busy = true);
    try {
      final res = await context.read<ApiService>().autoLinkOnlineProduct(
            provider: oStr(row['provider']),
            shopDomain: oStr(row['shop_domain']),
            externalProductId: oStr(row['external_product_id']),
            externalVariantId: oStr(row['external_variant_id']),
          );
      if (res['matched'] == true) {
        if (mounted) appToast(context, t('Đã tự động liên kết theo SKU/ID'));
        await _load();
      } else {
        // Không khớp → cho chọn tay.
        if (mounted) {
          appToast(
              context,
              oStr(res['reason']).isEmpty
                  ? t('Không tìm thấy SKU khớp')
                  : oStr(res['reason']),
              isError: true);
        }
        await _manualLink(row);
      }
    } catch (e) {
      if (mounted) {
        appToast(context, e.toString().replaceFirst('Exception: ', ''),
            isError: true);
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _manualLink(Map<String, dynamic> row) async {
    final sku = await showSkuPickerDialog(context);
    if (sku == null) return;
    try {
      await context.read<ApiService>().linkOnlineProduct(
            provider: oStr(row['provider']),
            shopDomain: oStr(row['shop_domain']),
            externalProductId: oStr(row['external_product_id']),
            externalVariantId: oStr(row['external_variant_id']),
            skuId: oStr(sku['id']),
          );
      if (mounted) appToast(context, t('Đã liên kết hàng hóa'));
      await _load();
    } catch (e) {
      if (mounted) {
        appToast(context, e.toString().replaceFirst('Exception: ', ''),
            isError: true);
      }
    }
  }

  Future<void> _unlink(Map<String, dynamic> row) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        title: Text(t('Hủy liên kết')),
        content: Text(t(
            'Bỏ liên kết listing này với SKU kho? Đơn của listing sẽ cần liên kết lại để trừ kho.')),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: Text(t('Không'))),
          FilledButton(
              onPressed: () => Navigator.pop(context, true),
              child: Text(t('Hủy liên kết'))),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await context.read<ApiService>().unlinkOnlineProduct(
            provider: oStr(row['provider']),
            shopDomain: oStr(row['shop_domain']),
            externalProductId: oStr(row['external_product_id']),
            externalVariantId: oStr(row['external_variant_id']),
          );
      if (mounted) appToast(context, t('Đã hủy liên kết'));
      await _load();
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
              _tabChip(0, t('Hàng trong kho')),
              const SizedBox(width: 8),
              _tabChip(1, t('Liên kết sàn')),
              const Spacer(),
              if (_tab == 1) _syncMenu(),
              const SizedBox(width: 8),
              SizedBox(
                width: 240,
                child: TextField(
                  controller: _search,
                  decoration: InputDecoration(
                    isDense: true,
                    hintText: _tab == 0
                        ? t('Tìm tên/SKU/mã vạch')
                        : t('Tìm tên/SKU/ID sàn'),
                    prefixIcon: const Icon(Icons.search, size: 18),
                  ),
                  // Lọc real-time từng chữ (debounce nhẹ để không gọi server dồn dập).
                  onChanged: (v) {
                    final q = v.trim();
                    _searchDebounce(() {
                      if (!mounted || q == _query) return;
                      setState(() => _query = q);
                      _load();
                    });
                  },
                ),
              ),
            ],
          ),
        ),
        if (_tab == 1) _sanFilterBar(),
        const Divider(height: 1, color: DanColors.border),
        if (_busy) const LinearProgressIndicator(minHeight: 2),
        Expanded(child: _body()),
      ],
    );
  }

  Widget _syncMenu() {
    return PopupMenuButton<String>(
      enabled: !_busy,
      onSelected: _syncProducts,
      itemBuilder: (_) => [
        for (final p in _syncableProviders)
          PopupMenuItem(
            value: p,
            child: Row(children: [
              Icon(providerMeta(p).icon,
                  size: 16, color: providerMeta(p).color),
              const SizedBox(width: 8),
              Text('${t('Đồng bộ')} ${providerMeta(p).name}'),
            ]),
          ),
      ],
      child: OutlinedButton.icon(
        onPressed: null,
        icon: const Icon(Icons.sync, size: 16),
        label: Text(t('Đồng bộ sản phẩm')),
        style: OutlinedButton.styleFrom(
            minimumSize: const Size(0, 36),
            foregroundColor: DanColors.brand,
            disabledForegroundColor: DanColors.brand),
      ),
    );
  }

  Widget _sanFilterBar() {
    Widget chip(int i, String label, int count) {
      final sel = _sanSub == i;
      return Padding(
        padding: const EdgeInsets.only(right: 8),
        child: ChoiceChip(
          label: Text('${t(label)} ($count)'),
          selected: sel,
          onSelected: (_) {
            setState(() => _sanSub = i);
            _load();
          },
        ),
      );
    }

    return Padding(
      padding: const EdgeInsets.fromLTRB(14, 4, 14, 8),
      child: Row(
        children: [
          chip(0, 'Tất cả', _counts['all'] ?? 0),
          chip(1, 'Đã liên kết', _counts['linked'] ?? 0),
          chip(2, 'Chưa liên kết', _counts['unlinked'] ?? 0),
          const Spacer(),
          SizedBox(
            width: 160,
            child: DropdownButtonFormField<String>(
              initialValue: _provider,
              isExpanded: true,
              decoration:
                  const InputDecoration(isDense: true, labelText: 'Sàn'),
              items: [
                const DropdownMenuItem(value: '', child: Text('Tất cả sàn')),
                for (final key in const [
                  'haravan',
                  'shopee',
                  'lazada',
                  'tiktokshop',
                  'tiki'
                ])
                  DropdownMenuItem(
                      value: key, child: Text(providerMeta(key).name)),
              ],
              onChanged: (v) {
                setState(() => _provider = v ?? '');
                _load();
              },
            ),
          ),
        ],
      ),
    );
  }

  Widget _tabChip(int i, String label) {
    final sel = _tab == i;
    return InkWell(
      onTap: () {
        if (_tab != i) {
          setState(() => _tab = i);
          _load();
        }
      },
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 9),
        decoration: BoxDecoration(
          color: sel ? DanColors.brandDim : DanColors.surface2,
          borderRadius: BorderRadius.circular(DanRadius.sm),
          border: Border.all(color: sel ? DanColors.brand : DanColors.border),
        ),
        child: Text(label,
            style: TextStyle(
                fontSize: 13,
                fontWeight: FontWeight.w700,
                color: sel ? DanColors.brand : DanColors.muted)),
      ),
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
    return _tab == 0 ? _khoBody() : _sanBody();
  }

  Widget _khoBody() {
    if (_kho.isEmpty) {
      return OnlineEmpty(t('Kho chưa có mặt hàng nào'),
          icon: Icons.inventory_2_outlined);
    }
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView.separated(
        padding: const EdgeInsets.all(14),
        itemCount: _kho.length + 1,
        separatorBuilder: (_, __) => const SizedBox(height: 8),
        itemBuilder: (_, i) {
          if (i == 0) {
            return Padding(
              padding: const EdgeInsets.only(bottom: 4),
              child: Text(
                  '${t('Hàng trong kho bán online')}: $_khoTotal — ${t('đơn online trừ trực tiếp tồn kho này')}',
                  style: const TextStyle(fontSize: 12, color: DanColors.muted)),
            );
          }
          return _khoRow(_kho[i - 1]);
        },
      ),
    );
  }

  Widget _khoRow(Map<String, dynamic> s) {
    final stock = oNum(s['stock']).toInt();
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
                Text(oStr(s['name']),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                        fontSize: 13, fontWeight: FontWeight.w700)),
                const SizedBox(height: 2),
                Text(
                  'SKU ${oStr(s['id'])}'
                  '${oStr(s['barcode']).isNotEmpty ? ' · ${oStr(s['barcode'])}' : ''}',
                  style:
                      const TextStyle(fontSize: 11.5, color: DanColors.muted),
                ),
              ],
            ),
          ),
          const SizedBox(width: 10),
          Column(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Text(Fmt.money(oNum(s['price'])),
                  style: const TextStyle(
                      fontSize: 13, fontWeight: FontWeight.w800)),
              const SizedBox(height: 2),
              OnlinePill('${t('Tồn')} $stock',
                  stock > 0 ? DanColors.done : DanColors.late),
            ],
          ),
        ],
      ),
    );
  }

  Widget _sanBody() {
    if (_san.isEmpty) {
      return OnlineEmpty(
          t('Chưa có listing sàn nào. Bấm "Đồng bộ sản phẩm" để kéo hàng từ Shopee/Lazada/TikTok về, hoặc kết nối kênh trong Thiết lập.'),
          icon: Icons.link_outlined);
    }
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView.separated(
        padding: const EdgeInsets.all(14),
        itemCount: _san.length,
        separatorBuilder: (_, __) => const SizedBox(height: 8),
        itemBuilder: (_, i) => _sanRow(_san[i]),
      ),
    );
  }

  Widget _sanRow(Map<String, dynamic> r) {
    final linked = oStr(r['mapping_status']) == 'catalog_linked';
    final pos = oMap(r['pos']);
    final provider = oStr(r['provider']);
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: DanColors.surface,
        border: Border.all(color: DanColors.border),
        borderRadius: BorderRadius.circular(DanRadius.md),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Gian hàng (logo sàn + tên shop)
          Row(
            children: [
              ProviderBadge(provider, shop: oStr(r['shop_domain'])),
              const Spacer(),
              if (linked)
                const Icon(Icons.check_circle, size: 18, color: DanColors.done)
              else
                OnlinePill(t('Chưa liên kết'), DanColors.doing),
            ],
          ),
          const SizedBox(height: 8),
          LayoutBuilder(builder: (context, c) {
            final narrow = c.maxWidth < 620;
            final left = _sanListing(r);
            final right = linked ? _posLinked(pos) : _posUnlinked(r);
            if (narrow) {
              return Column(children: [
                left,
                const SizedBox(height: 8),
                right,
              ]);
            }
            return Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(child: left),
                Container(
                    width: 1,
                    height: 52,
                    margin: const EdgeInsets.symmetric(horizontal: 12),
                    color: DanColors.border),
                Expanded(child: right),
              ],
            );
          }),
          const SizedBox(height: 8),
          Row(
            mainAxisAlignment: MainAxisAlignment.end,
            children: [
              if (linked)
                OutlinedButton.icon(
                  onPressed: _busy ? null : () => _unlink(r),
                  icon: const Icon(Icons.link_off, size: 15),
                  label: Text(t('Hủy liên kết'),
                      style: const TextStyle(fontSize: 12)),
                  style: OutlinedButton.styleFrom(
                      minimumSize: const Size(0, 34),
                      foregroundColor: DanColors.late),
                )
              else ...[
                OutlinedButton(
                  onPressed: _busy ? null : () => _manualLink(r),
                  style:
                      OutlinedButton.styleFrom(minimumSize: const Size(0, 34)),
                  child:
                      Text(t('Chọn tay'), style: const TextStyle(fontSize: 12)),
                ),
                const SizedBox(width: 8),
                FilledButton.icon(
                  onPressed: _busy ? null : () => _copyLink(r),
                  icon: const Icon(Icons.content_copy, size: 15),
                  label:
                      Text(t('Sao chép'), style: const TextStyle(fontSize: 12)),
                  style: FilledButton.styleFrom(minimumSize: const Size(0, 34)),
                ),
              ],
            ],
          ),
        ],
      ),
    );
  }

  // Cột "Hàng trên sàn": ảnh + tên + ID/SKU sàn.
  Widget _sanListing(Map<String, dynamic> r) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _thumb(oStr(r['external_image'])),
        const SizedBox(width: 10),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                oStr(r['external_name']).isEmpty
                    ? t('(Không có tên listing)')
                    : oStr(r['external_name']),
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                    fontSize: 12.5, fontWeight: FontWeight.w700),
              ),
              const SizedBox(height: 3),
              Text(
                'ID: ${oStr(r['external_product_id'])}'
                '${oStr(r['external_sku']).isNotEmpty ? '  ·  SKU: ${oStr(r['external_sku'])}' : ''}',
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                    fontSize: 11,
                    color: DanColors.muted,
                    fontFamily: 'JetBrains Mono'),
              ),
            ],
          ),
        ),
      ],
    );
  }

  // Cột "Hàng trên POS" khi đã liên kết: ảnh + tên + SKU/ID + giá + tồn.
  Widget _posLinked(Map<String, dynamic> pos) {
    final stock = oNum(pos['stock']).toInt();
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _thumb(oStr(pos['image'])),
        const SizedBox(width: 10),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(oStr(pos['name']),
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                      fontSize: 12.5, fontWeight: FontWeight.w700)),
              const SizedBox(height: 3),
              Text(
                'SKU ${oStr(pos['sku_id'])}'
                '${oStr(pos['code']).isNotEmpty ? ' · ${oStr(pos['code'])}' : ''}',
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(fontSize: 11, color: DanColors.muted),
              ),
              const SizedBox(height: 4),
              Row(children: [
                Text(Fmt.money(oNum(pos['price'])),
                    style: const TextStyle(
                        fontSize: 12.5, fontWeight: FontWeight.w800)),
                const SizedBox(width: 8),
                OnlinePill('${t('Tồn')} $stock',
                    stock > 0 ? DanColors.done : DanColors.late),
              ]),
            ],
          ),
        ),
      ],
    );
  }

  Widget _posUnlinked(Map<String, dynamic> r) {
    return Row(
      children: [
        const Icon(Icons.help_outline, size: 18, color: DanColors.faint),
        const SizedBox(width: 8),
        Expanded(
          child: Text(
            t('Chưa gắn mặt hàng POS — bấm "Sao chép" để tự đối chiếu SKU/ID.'),
            style: const TextStyle(fontSize: 11.5, color: DanColors.muted),
          ),
        ),
      ],
    );
  }

  // Dựng URL ảnh: ảnh sàn là URL đầy đủ (http); ảnh SKU kho là path tương đối →
  // ghép serverUrl.
  String _imgUrl(String url) {
    if (url.isEmpty) return '';
    if (url.startsWith('http')) return url;
    final base = context.read<AuthProvider>().serverUrl;
    return '$base${url.startsWith('/') ? '' : '/'}$url';
  }

  Widget _thumb(String url) {
    const size = 46.0;
    Widget placeholder() => Container(
          width: size,
          height: size,
          decoration: BoxDecoration(
            color: DanColors.surface2,
            borderRadius: BorderRadius.circular(8),
            border: Border.all(color: DanColors.border),
          ),
          child: const Icon(Icons.image_outlined,
              size: 20, color: DanColors.faint),
        );
    final resolved = _imgUrl(url);
    if (!resolved.startsWith('http')) return placeholder();
    return ClipRRect(
      borderRadius: BorderRadius.circular(8),
      child: Image.network(resolved,
          width: size,
          height: size,
          fit: BoxFit.cover,
          errorBuilder: (_, __, ___) => placeholder(),
          loadingBuilder: (ctx, child, progress) =>
              progress == null ? child : placeholder()),
    );
  }
}

/// Chọn một SKU trong kho để liên kết với listing trên sàn.
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
  // Nạp catalog MỘT lần rồi lọc real-time client-side bằng module search chuẩn
  // (utils/search.dart) — gõ tới đâu lọc tới đó, không phải bấm Enter.
  List<Map<String, dynamic>> _all = [];
  String _q = '';
  bool _loading = true;

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
      final res = await context
          .read<ApiService>()
          .getSkusPaginated(page: 1, limit: 5000, q: '');
      if (!mounted) return;
      setState(() {
        // Loại SKU "bóng" do connector tạo (hvn_/shp_/lzd_/ttk_) — chỉ cho chọn
        // mặt hàng kho thật để liên kết.
        _all = oList(res['items'] ?? res['rows'] ?? res['skus']).where((s) {
          final id = oStr(s['id']);
          return !(id.startsWith('hvn_') ||
              id.startsWith('shp_') ||
              id.startsWith('lzd_') ||
              id.startsWith('ttk_'));
        }).toList();
        _loading = false;
      });
    } catch (_) {
      if (mounted) setState(() => _loading = false);
    }
  }

  List<Map<String, dynamic>> get _results {
    if (_q.trim().isEmpty) return _all.take(60).toList();
    return _all
        .where((s) =>
            searchMatchesAny([s['name'], s['id'], s['code'], s['barcode']], _q))
        .take(60)
        .toList();
  }

  // Ảnh SKU kho để đối chiếu bằng hình (path tương đối → ghép serverUrl).
  Widget _pickerThumb(String url) {
    const size = 40.0;
    Widget ph() => Container(
          width: size,
          height: size,
          decoration: BoxDecoration(
            color: DanColors.surface2,
            borderRadius: BorderRadius.circular(6),
            border: Border.all(color: DanColors.border),
          ),
          child: const Icon(Icons.image_outlined,
              size: 18, color: DanColors.faint),
        );
    if (url.isEmpty) return ph();
    final resolved = url.startsWith('http')
        ? url
        : '${context.read<AuthProvider>().serverUrl}${url.startsWith('/') ? '' : '/'}$url';
    return ClipRRect(
      borderRadius: BorderRadius.circular(6),
      child: Image.network(resolved,
          width: size,
          height: size,
          fit: BoxFit.cover,
          errorBuilder: (_, __, ___) => ph(),
          loadingBuilder: (c, child, p) => p == null ? child : ph()),
    );
  }

  @override
  Widget build(BuildContext context) {
    final results = _results;
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
                onChanged: (v) => setState(() => _q = v),
              ),
            ),
            const Divider(height: 1, color: DanColors.border),
            Flexible(
              child: _loading
                  ? const Padding(
                      padding: EdgeInsets.all(30),
                      child: Center(child: CircularProgressIndicator()))
                  : results.isEmpty
                      ? Padding(
                          padding: const EdgeInsets.all(24),
                          child: Text(t('Không tìm thấy mặt hàng'),
                              style: const TextStyle(color: DanColors.muted)))
                      : ListView.builder(
                          shrinkWrap: true,
                          itemCount: results.length,
                          itemBuilder: (_, i) {
                            final s = results[i];
                            return ListTile(
                              dense: true,
                              leading: _pickerThumb(oStr(s['image'])),
                              title: Text(oStr(s['name']),
                                  style: const TextStyle(fontSize: 13)),
                              subtitle: Text(
                                  'SKU ${oStr(s['id'])} · ${t('Tồn')} ${oNum(s['stock']).toInt()}',
                                  style: const TextStyle(fontSize: 11)),
                              trailing: Text(Fmt.money(oNum(s['price'])),
                                  style: const TextStyle(
                                      fontSize: 12,
                                      fontWeight: FontWeight.w700)),
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
