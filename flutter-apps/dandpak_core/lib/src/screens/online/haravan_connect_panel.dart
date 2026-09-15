import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../services/api_service.dart';
import '../../ui/app_theme.dart';
import '../../ui/open_url.dart';
import '../../utils/translation.dart';
import '../management/management_widgets.dart';
import 'online_shared.dart';

/// OAuth-only Haravan setup. App credentials and shop tokens stay on the
/// server; this screen operates on each installed shop independently.
class HaravanConnectPanel extends StatefulWidget {
  final VoidCallback? onChanged;
  const HaravanConnectPanel({super.key, this.onChanged});

  @override
  State<HaravanConnectPanel> createState() => _HaravanConnectPanelState();
}

class _HaravanConnectPanelState extends State<HaravanConnectPanel> {
  List<Map<String, dynamic>> _shops = [];
  bool _loading = true;
  String? _busyShop;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    if (mounted)
      setState(() {
        _loading = true;
        _error = null;
      });
    try {
      final data = await context.read<ApiService>().getHaravanStatus();
      if (!mounted) return;
      setState(() {
        _shops = oList(data['shops'])
            .where((s) => s['active'] == true || s['active'] == 1)
            .toList();
        _loading = false;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = error.toString().replaceFirst('Exception: ', '');
      });
    }
  }

  Future<void> _connect() async {
    try {
      final data = await context.read<ApiService>().getHaravanInstallUrl();
      final url = oStr(data['url']);
      if (url.isEmpty)
        throw Exception(t('Không lấy được liên kết uỷ quyền Haravan'));
      final opened = await openExternalUrl(url);
      if (!mounted) return;
      await showDialog<void>(
          context: context,
          builder: (dialogContext) => AlertDialog(
                title: Text(t('Kết nối Haravan')),
                content: Text(opened
                    ? t('Đăng nhập bằng tài khoản chủ shop/admin và hoàn tất cấp quyền trong trình duyệt. Sau đó quay lại đây để làm mới danh sách.')
                    : t('Không mở được trình duyệt. Hãy kiểm tra trình duyệt mặc định rồi thử lại.')),
                actions: [
                  TextButton(
                      onPressed: () => Navigator.pop(dialogContext),
                      child: Text(t('Đóng'))),
                  FilledButton(
                      onPressed: () {
                        Navigator.pop(dialogContext);
                        _load().then((_) => widget.onChanged?.call());
                      },
                      child: Text(t('Tôi đã hoàn tất'))),
                ],
              ));
    } catch (error) {
      if (mounted)
        appToast(context, error.toString().replaceFirst('Exception: ', ''),
            isError: true);
    }
  }

  Future<void> _run(String shop, Future<Map<String, dynamic>> Function() action,
      String done) async {
    setState(() => _busyShop = shop);
    try {
      await action();
      if (mounted) appToast(context, t(done));
      await _load();
      widget.onChanged?.call();
    } catch (error) {
      if (mounted)
        appToast(context, error.toString().replaceFirst('Exception: ', ''),
            isError: true);
    } finally {
      if (mounted) setState(() => _busyShop = null);
    }
  }

  Future<void> _disconnect(String shop) async {
    final confirmed = await showDialog<bool>(
        context: context,
        builder: (dialogContext) => AlertDialog(
              title: Text(t('Ngắt kết nối Haravan?')),
              content: Text(t(
                  'Gian hàng sẽ ngừng đồng bộ; lịch sử và nguồn đơn cũ vẫn được giữ nguyên.')),
              actions: [
                TextButton(
                    onPressed: () => Navigator.pop(dialogContext, false),
                    child: Text(t('Hủy'))),
                FilledButton(
                    onPressed: () => Navigator.pop(dialogContext, true),
                    child: Text(t('Ngắt kết nối'))),
              ],
            ));
    if (confirmed == true) {
      await _run(
          shop,
          () => context.read<ApiService>().disconnectHaravanShop(shop),
          'Đã ngắt kết nối Haravan');
    }
  }

  @override
  Widget build(BuildContext context) => SingleChildScrollView(
        padding: const EdgeInsets.all(18),
        child:
            Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Wrap(
              spacing: 10,
              runSpacing: 8,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                Image.asset('assets/brand/Haravan.png',
                    width: 28,
                    height: 28,
                    errorBuilder: (_, __, ___) => const Icon(
                        Icons.store_outlined,
                        size: 28,
                        color: DanColors.muted)),
                const Text('Haravan',
                    style:
                        TextStyle(fontSize: 17, fontWeight: FontWeight.w900)),
                FilledButton.icon(
                    onPressed: _busyShop == null ? _connect : null,
                    icon: const Icon(Icons.add_link, size: 17),
                    label: Text(_shops.isEmpty
                        ? t('Kết nối')
                        : t('Kết nối thêm gian hàng'))),
              ]),
          const SizedBox(height: 6),
          const Text(
              'Đồng bộ đơn hàng, khách hàng, sản phẩm và tồn kho theo từng gian hàng.',
              style: TextStyle(fontSize: 12, color: DanColors.muted)),
          const SizedBox(height: 16),
          if (_loading)
            const Center(child: CircularProgressIndicator())
          else if (_error != null)
            InlineMessage(_error!, error: true, onRetry: _load)
          else if (_shops.isEmpty)
            _addCard()
          else ...[
            for (final shop in _shops) _shopCard(shop),
            _addCard(),
          ],
        ]),
      );

  Widget _addCard() => InkWell(
        onTap: _busyShop == null ? _connect : null,
        borderRadius: BorderRadius.circular(DanRadius.md),
        child: Container(
          margin: const EdgeInsets.only(bottom: 10),
          padding: const EdgeInsets.all(18),
          decoration: BoxDecoration(
              border: Border.all(color: DanColors.border),
              borderRadius: BorderRadius.circular(DanRadius.md)),
          child: Row(mainAxisAlignment: MainAxisAlignment.center, children: [
            const Icon(Icons.add_business_outlined, color: DanColors.brand),
            const SizedBox(width: 8),
            Text(
                _shops.isEmpty
                    ? t('Kết nối gian hàng')
                    : t('Kết nối thêm gian hàng'),
                style: const TextStyle(
                    color: DanColors.brand, fontWeight: FontWeight.w800)),
          ]),
        ),
      );

  Widget _shopCard(Map<String, dynamic> data) {
    final shop = oStr(data['shop_domain']);
    final webhookOk = oStr(data['webhook_status']) == 'subscribed';
    final busy = _busyShop == shop;
    return Container(
      key: ValueKey('haravan:$shop'),
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
          color: DanColors.surface2,
          border: Border.all(
              color: webhookOk
                  ? DanColors.done.withValues(alpha: .35)
                  : DanColors.border),
          borderRadius: BorderRadius.circular(DanRadius.md)),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          Image.asset('assets/brand/Haravan.png',
              width: 34,
              height: 34,
              errorBuilder: (_, __, ___) => const Icon(Icons.store_outlined,
                  size: 30, color: DanColors.muted)),
          const SizedBox(width: 10),
          Expanded(
              child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                Text(shop.isEmpty ? t('Gian hàng Haravan') : shop,
                    style: const TextStyle(fontWeight: FontWeight.w900)),
                Text(
                    '${t('Chi nhánh')}: ${oStr(data['branch_id'])}  ·  Org ID: ${oStr(data['org_id']).isEmpty ? '—' : oStr(data['org_id'])}',
                    style:
                        const TextStyle(fontSize: 11, color: DanColors.faint)),
              ])),
          OnlinePill(webhookOk ? t('Đã kết nối') : t('Cần kiểm tra webhook'),
              webhookOk ? DanColors.done : DanColors.late),
        ]),
        const SizedBox(height: 8),
        Text(
            '${t('Đồng bộ gần nhất')}: ${oStr(data['updated_at']).isEmpty ? '—' : oStr(data['updated_at'])}',
            style: const TextStyle(fontSize: 11, color: DanColors.faint)),
        if (!webhookOk && oStr(data['webhook_error']).isNotEmpty) ...[
          const SizedBox(height: 6),
          Text(oStr(data['webhook_error']),
              style: const TextStyle(fontSize: 11, color: DanColors.late)),
        ],
        const SizedBox(height: 10),
        Wrap(spacing: 8, runSpacing: 8, children: [
          OutlinedButton.icon(
              onPressed: busy
                  ? null
                  : () => _run(
                      shop,
                      () => context.read<ApiService>().syncHaravanShop(shop),
                      'Đồng bộ Haravan hoàn tất'),
              icon: const Icon(Icons.sync, size: 16),
              label: Text(t('Đồng bộ ngay'))),
          if (!webhookOk)
            OutlinedButton.icon(
                onPressed: busy
                    ? null
                    : () => _run(
                        shop,
                        () => context
                            .read<ApiService>()
                            .subscribeHaravanShop(shop),
                        'Đã đăng ký webhook Haravan'),
                icon: const Icon(Icons.notifications_active_outlined, size: 16),
                label: Text(t('Đăng ký lại webhook'))),
          OutlinedButton.icon(
              onPressed: busy ? null : _connect,
              icon: const Icon(Icons.refresh, size: 16),
              label: Text(t('Kết nối lại'))),
          TextButton.icon(
              onPressed: busy ? null : () => _disconnect(shop),
              icon: const Icon(Icons.link_off, size: 16),
              label: Text(t('Ngắt kết nối'))),
        ]),
      ]),
    );
  }
}
