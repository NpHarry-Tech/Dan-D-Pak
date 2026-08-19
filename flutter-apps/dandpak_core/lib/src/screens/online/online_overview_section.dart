import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../services/api_service.dart';
import '../../ui/app_theme.dart';
import '../../ui/format.dart';
import '../../utils/translation.dart';
import '../management/management_widgets.dart';
import 'online_shared.dart';

/// Tổng quan — "Việc cần làm" theo bucket + trạng thái kết nối kênh.
class OnlineOverviewSection extends StatefulWidget {
  final void Function(String section) onOpenSection;
  const OnlineOverviewSection({super.key, required this.onOpenSection});

  @override
  State<OnlineOverviewSection> createState() => _OnlineOverviewSectionState();
}

class _OnlineOverviewSectionState extends State<OnlineOverviewSection> {
  Map<String, dynamic> _summary = {};
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    try {
      final s = await context.read<ApiService>().getOnlineOperationsSummary();
      if (!mounted) return;
      setState(() {
        _summary = s;
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

  @override
  Widget build(BuildContext context) {
    if (_loading) return const Center(child: CircularProgressIndicator());
    if (_error != null) {
      return Padding(
        padding: const EdgeInsets.all(40),
        child: InlineMessage(t('Không tải được tổng quan ($_error)'),
            error: true, onRetry: _load),
      );
    }
    final buckets = oMap(_summary['buckets']);
    final caps = oMap(oMap(_summary['capabilities'])['haravan']);
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          Text(t('Việc cần làm'),
              style:
                  const TextStyle(fontSize: 16, fontWeight: FontWeight.w800)),
          const SizedBox(height: 12),
          Wrap(
            spacing: 14,
            runSpacing: 14,
            children: [
              _tile('Chờ xử lý', oNum(buckets['pending']).toInt(),
                  const Color(0xFFB45309), Icons.pending_actions),
              _tile('Đã xử lý', oNum(buckets['processed']).toInt(),
                  DanColors.brand, Icons.check_circle_outline),
              _tile('Đang giao', oNum(buckets['shipping']).toInt(),
                  const Color(0xFF2563EB), Icons.local_shipping_outlined),
              _tile('Đã giao', oNum(buckets['delivered']).toInt(),
                  const Color(0xFF047857), Icons.done_all),
              _tile('Cần xử lý hàng hóa',
                  oNum(buckets['product_attention']).toInt(),
                  const Color(0xFFB91C1C), Icons.link_off),
            ],
          ),
          const SizedBox(height: 26),
          Text(t('Kết nối kênh bán'),
              style:
                  const TextStyle(fontSize: 16, fontWeight: FontWeight.w800)),
          const SizedBox(height: 12),
          _connectorCard(caps),
        ],
      ),
    );
  }

  Widget _tile(String label, int count, Color color, IconData icon) {
    return InkWell(
      onTap: () => widget.onOpenSection('orders'),
      borderRadius: BorderRadius.circular(DanRadius.lg),
      child: Container(
        width: 220,
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: DanColors.surface,
          border: Border.all(color: DanColors.border),
          borderRadius: BorderRadius.circular(DanRadius.lg),
        ),
        child: Row(
          children: [
            Container(
              width: 42,
              height: 42,
              decoration: BoxDecoration(
                  color: color.withValues(alpha: .12),
                  borderRadius: BorderRadius.circular(10)),
              child: Icon(icon, color: color, size: 22),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('$count',
                      style: TextStyle(
                          fontSize: 22,
                          fontWeight: FontWeight.w900,
                          color: color)),
                  Text(t(label),
                      maxLines: 2,
                      style: const TextStyle(
                          fontSize: 12, color: DanColors.muted)),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _connectorCard(Map<String, dynamic> haravan) {
    final active = haravan['active'] == true || haravan['inbound'] == true;
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: DanColors.surface,
        border: Border.all(color: DanColors.border),
        borderRadius: BorderRadius.circular(DanRadius.lg),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const ProviderBadge('haravan'),
              const SizedBox(width: 10),
              OnlinePill(active ? t('Đã kết nối') : t('Chờ cấp quyền'),
                  active ? DanColors.done : DanColors.doing),
              const Spacer(),
              TextButton(
                onPressed: () => widget.onOpenSection('channels'),
                child: Text(t('Thiết lập kênh')),
              ),
            ],
          ),
          const SizedBox(height: 6),
          Text(
            t('Shopee, TikTok Shop, Lazada, Tiki, Facebook, Instagram, Zalo OA — cấu hình và cấp quyền trong mục Thiết lập kênh. Doanh thu online đi qua kho, báo cáo và hóa đơn như đơn tại quầy.'),
            style: const TextStyle(
                fontSize: 12.5, color: DanColors.muted, height: 1.5),
          ),
          const SizedBox(height: 4),
          Text('${t('Tổng đơn online')}: ${Fmt.int0(oNum(_summary['total']))}',
              style: const TextStyle(
                  fontSize: 12.5, fontWeight: FontWeight.w700)),
        ],
      ),
    );
  }
}
