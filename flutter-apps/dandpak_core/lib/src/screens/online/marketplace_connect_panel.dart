import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';

import '../../services/api_service.dart';
import '../../ui/app_theme.dart';
import '../../ui/open_url.dart';
import '../../utils/translation.dart';
import '../management/management_widgets.dart';
import 'online_shared.dart';

/// Các sàn dùng kết nối "1 chạm" (Connection Platform) thay cho form Partner
/// ID/Key. Màn "Liên kết" (IntegrationsPanel) render nút Kết nối 1-chạm cho các
/// key này thay vì form credential.
const Set<String> kMarketplaceOneClickProviders = {'shopee', 'lazada'};

/// Kết nối sàn "1 chạm" DÙNG CHUNG (Connection Platform). Người dùng KHÔNG nhập
/// Partner ID/Key/Token — chỉ bấm Kết nối → đăng nhập sàn → đồng ý → xong. Token
/// đổi & lưu ở backend (mã hoá). Provider hoá qua [provider] (shopee/lazada/…).
///
/// [embedded] = true khi nhúng vào khung detail của màn Liên kết: bỏ card/margin
/// ngoài để không lồng "card trong card".
class MarketplaceConnectPanel extends StatefulWidget {
  final String provider;
  final bool embedded;

  /// Gọi sau khi kết nối/ngắt thành công — để màn cha (danh sách Liên kết) làm
  /// mới trạng thái "Đã/Chưa kết nối" của sàn.
  final VoidCallback? onChanged;
  const MarketplaceConnectPanel(
      {super.key,
      required this.provider,
      this.embedded = false,
      this.onChanged});

  @override
  State<MarketplaceConnectPanel> createState() =>
      _MarketplaceConnectPanelState();
}

class _MarketplaceConnectPanelState extends State<MarketplaceConnectPanel> {
  List<Map<String, dynamic>> _connections = [];
  bool _loading = true;
  bool _busy = false;
  String? _error;

  String get _provider => widget.provider;
  ProviderMeta get _meta => providerMeta(_provider);

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    try {
      final res =
          await context.read<ApiService>().getMarketplaceConnections(_provider);
      if (!mounted) return;
      setState(() {
        _connections = oList(res['connections'])
            .where((c) => oStr(c['status']) != 'disconnected')
            .toList();
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

  Future<void> _connect() async {
    setState(() => _busy = true);
    try {
      final started =
          await context.read<ApiService>().startMarketplaceConnect(_provider);
      final url = oStr(started['url']);
      final attemptId = oStr(started['attempt_id']);
      if (url.isEmpty || attemptId.isEmpty) {
        throw Exception(t('Không lấy được liên kết uỷ quyền'));
      }
      final opened = await openExternalUrl(url);
      if (!mounted) return;
      final ok = await showDialog<bool>(
        context: context,
        barrierDismissible: false,
        builder: (_) => _WaitConnectDialog(
            provider: _provider,
            providerName: _meta.name,
            attemptId: attemptId,
            authUrl: url,
            browserOpened: opened),
      );
      if (ok == true) {
        if (mounted) appToast(context, '${t('Đã kết nối')} ${_meta.name}');
        await _load();
        widget.onChanged?.call();
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

  Future<void> _disconnect(Map<String, dynamic> c) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        backgroundColor: DanColors.surface,
        title: Text('${t('Ngắt kết nối')} ${_meta.name}?'),
        content: Text(t(
            'Gian hàng sẽ ngừng đồng bộ. Lịch sử đơn được giữ lại. Có thể kết nối lại sau.')),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: Text(t('Hủy'))),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: DanColors.late),
            onPressed: () => Navigator.pop(context, true),
            child: Text(t('Ngắt kết nối')),
          ),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await context
          .read<ApiService>()
          .disconnectMarketplace(_provider, oStr(c['id']));
      if (mounted) appToast(context, t('Đã ngắt kết nối'));
      await _load();
      widget.onChanged?.call();
    } catch (e) {
      if (mounted) {
        appToast(context, e.toString().replaceFirst('Exception: ', ''),
            isError: true);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final e = widget.embedded;
    return Container(
      margin: e
          ? const EdgeInsets.all(18)
          : const EdgeInsets.fromLTRB(14, 14, 14, 6),
      padding: e ? EdgeInsets.zero : const EdgeInsets.all(16),
      decoration: e
          ? null
          : BoxDecoration(
              color: DanColors.surface,
              border: Border.all(color: DanColors.border),
              borderRadius: BorderRadius.circular(DanRadius.lg),
            ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(children: [
            Icon(_meta.icon, size: 22, color: _meta.color),
            const SizedBox(width: 8),
            Text(_meta.name,
                style:
                    const TextStyle(fontSize: 16, fontWeight: FontWeight.w900)),
            const Spacer(),
            if (!_loading)
              FilledButton.icon(
                onPressed: _busy ? null : _connect,
                icon: _busy
                    ? const SizedBox(
                        width: 15,
                        height: 15,
                        child: CircularProgressIndicator(
                            strokeWidth: 2, color: Colors.white))
                    : const Icon(Icons.add_link, size: 16),
                label: Text(
                    _connections.isEmpty ? t('Kết nối') : t('Thêm gian hàng')),
              ),
          ]),
          const SizedBox(height: 6),
          Text(
            '${t('Kết nối gian hàng')} ${_meta.name} ${t('để đồng bộ đơn hàng, hàng hóa, tồn kho và giá bán. Bạn chỉ cần đăng nhập và đồng ý — không phải nhập Partner ID/Key hay token.')}',
            style: const TextStyle(fontSize: 12, color: DanColors.muted),
          ),
          const SizedBox(height: 12),
          if (_loading)
            const Padding(
                padding: EdgeInsets.all(16),
                child: Center(child: CircularProgressIndicator()))
          else if (_error != null)
            InlineMessage(_error!, error: true, onRetry: _load)
          else if (_connections.isEmpty)
            Container(
              padding: const EdgeInsets.symmetric(vertical: 14, horizontal: 12),
              decoration: BoxDecoration(
                color: DanColors.surface2,
                borderRadius: BorderRadius.circular(DanRadius.md),
              ),
              child: Row(children: [
                const Icon(Icons.link_off, size: 18, color: DanColors.faint),
                const SizedBox(width: 8),
                Text(t('Chưa kết nối gian hàng nào'),
                    style: const TextStyle(color: DanColors.muted)),
              ]),
            )
          else
            for (final c in _connections) _connectionCard(c),
        ],
      ),
    );
  }

  Widget _connectionCard(Map<String, dynamic> c) {
    final status = oStr(c['status']);
    final active = status == 'active' || status == 'connected';
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: DanColors.surface2,
        border: Border.all(color: DanColors.border),
        borderRadius: BorderRadius.circular(DanRadius.md),
      ),
      child: Row(
        children: [
          Icon(active ? Icons.check_circle : Icons.error_outline,
              size: 20, color: active ? DanColors.done : DanColors.late),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                    oStr(c['shop_name']).isEmpty
                        ? '${t('Gian hàng')} ${oStr(c['shop_id'])}'
                        : oStr(c['shop_name']),
                    style: const TextStyle(
                        fontSize: 13.5, fontWeight: FontWeight.w800)),
                const SizedBox(height: 2),
                Text(
                    'Shop ID: ${oStr(c['shop_id'])} · ${t('Chi nhánh')}: ${oStr(c['branch_id'])}',
                    style:
                        const TextStyle(fontSize: 11, color: DanColors.faint)),
              ],
            ),
          ),
          OnlinePill(active ? t('Hoạt động') : _statusLabel(status),
              active ? DanColors.done : DanColors.late),
          if (!active) ...[
            const SizedBox(width: 8),
            OutlinedButton.icon(
              onPressed: _busy ? null : _connect,
              icon: const Icon(Icons.refresh, size: 15),
              label: Text(t('Kết nối lại')),
              style: OutlinedButton.styleFrom(
                foregroundColor: DanColors.late,
                side: const BorderSide(color: DanColors.late),
                visualDensity: VisualDensity.compact,
              ),
            ),
          ],
          const SizedBox(width: 8),
          IconButton(
            tooltip: t('Ngắt kết nối'),
            onPressed: () => _disconnect(c),
            icon: const Icon(Icons.link_off, size: 18, color: DanColors.faint),
          ),
        ],
      ),
    );
  }

  String _statusLabel(String s) => switch (s) {
        'auth_expired' || 'reauth_required' => t('Cần kết nối lại'),
        'error' => t('Lỗi'),
        'connecting' => t('Đang kết nối'),
        _ => s,
      };
}

// Dialog chờ xác nhận trên sàn + poll trạng thái attempt.
class _WaitConnectDialog extends StatefulWidget {
  final String provider;
  final String providerName;
  final String attemptId;
  final String authUrl;
  final bool browserOpened;
  const _WaitConnectDialog(
      {required this.provider,
      required this.providerName,
      required this.attemptId,
      required this.authUrl,
      required this.browserOpened});

  @override
  State<_WaitConnectDialog> createState() => _WaitConnectDialogState();
}

class _WaitConnectDialogState extends State<_WaitConnectDialog> {
  Timer? _timer;
  String _status = 'pending';

  @override
  void initState() {
    super.initState();
    _timer = Timer.periodic(const Duration(seconds: 2), (_) => _poll());
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  Future<void> _poll() async {
    try {
      final res = await context
          .read<ApiService>()
          .getMarketplaceAttempt(widget.provider, widget.attemptId);
      final s = oStr(res['status']);
      if (!mounted) return;
      if (s == 'done') {
        _timer?.cancel();
        Navigator.of(context).pop(true);
      } else if (s == 'expired' || s == 'error' || s == 'not_found') {
        _timer?.cancel();
        setState(() => _status = s);
      }
    } catch (_) {
      // giữ nguyên, thử lại lần poll sau.
    }
  }

  @override
  Widget build(BuildContext context) {
    final failed =
        _status == 'expired' || _status == 'error' || _status == 'not_found';
    return AlertDialog(
      backgroundColor: DanColors.surface,
      title: Text(failed
          ? '${t('Chưa hoàn tất kết nối')} ${widget.providerName}'
          : '${t('Đang chờ xác nhận trên')} ${widget.providerName}…'),
      content: SizedBox(
        width: dialogWidth(context, 420),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (!failed) ...[
              const LinearProgressIndicator(),
              const SizedBox(height: 12),
              Text(t(
                  'Hoàn tất đăng nhập và cấp quyền trong cửa sổ trình duyệt vừa mở. Màn này sẽ tự cập nhật khi xong.')),
            ] else
              Text(_status == 'expired'
                  ? t('Phiên kết nối đã hết hạn. Bấm "Thử lại".')
                  : t('Kết nối không thành công. Bấm "Thử lại".')),
            if (!widget.browserOpened) ...[
              const SizedBox(height: 12),
              Text(
                  t('Không tự mở được trình duyệt — sao chép liên kết và mở tay:'),
                  style: const TextStyle(fontSize: 12, color: DanColors.muted)),
              const SizedBox(height: 6),
              OutlinedButton.icon(
                onPressed: () {
                  Clipboard.setData(ClipboardData(text: widget.authUrl));
                  appToast(context, t('Đã sao chép liên kết'));
                },
                icon: const Icon(Icons.copy, size: 16),
                label: Text(t('Sao chép liên kết uỷ quyền')),
              ),
            ],
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(false),
          child: Text(failed ? t('Đóng') : t('Hủy')),
        ),
      ],
    );
  }
}
