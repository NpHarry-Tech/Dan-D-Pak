import 'dart:io';

import 'package:flutter/material.dart';
import 'package:path_provider/path_provider.dart';
import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;
import 'package:printing/printing.dart';
import 'package:provider/provider.dart';
import 'package:share_plus/share_plus.dart';

import '../../services/api_service.dart';
import '../../ui/app_theme.dart';
import '../../ui/format.dart';
import '../../utils/translation.dart';
import '../management/management_widgets.dart';
import 'online_shared.dart';

/// Chi tiết đơn Retail Online — thông tin đơn + vận chuyển + hành động xử lý
/// (xác nhận, chuẩn bị, giao, hoàn tất, hủy, hoàn tiền, phân công, in tem).
class OnlineOrderDetailDialog extends StatefulWidget {
  final String orderId;
  const OnlineOrderDetailDialog({super.key, required this.orderId});

  @override
  State<OnlineOrderDetailDialog> createState() =>
      _OnlineOrderDetailDialogState();
}

class _OnlineOrderDetailDialogState extends State<OnlineOrderDetailDialog> {
  Map<String, dynamic> _op = {};
  List<Map<String, dynamic>> _users = [];
  bool _loading = true;
  bool _busy = false;
  String? _error;
  int _tab = 0;
  // Lịch sử & hóa đơn — TÁI DÙNG /invoices/:id/detail (chỉ có dữ liệu khi đơn
  // đã đi qua pipeline hóa đơn, tức đã 'paid'; đơn pending/hủy chưa từng thanh
  // toán thì không có, giữ null để tab hiện trạng thái rỗng thay vì báo lỗi).
  Map<String, dynamic>? _invoiceDetail;
  bool _invoiceLoading = false;
  bool _invoiceLoaded = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    try {
      final api = context.read<ApiService>();
      final op = await api.getOnlineOperation(widget.orderId);
      List<dynamic> users = const [];
      try {
        users = await api.getUsers();
      } catch (_) {}
      if (!mounted) return;
      setState(() {
        _op = op;
        _users = users
            .whereType<Map>()
            .map((e) => Map<String, dynamic>.from(e))
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

  Future<void> _run(Future<dynamic> Function() action, String ok) async {
    setState(() => _busy = true);
    try {
      await action();
      if (mounted) appToast(context, ok);
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

  @override
  Widget build(BuildContext context) {
    return Dialog(
      shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(DanRadius.lg)),
      child: ConstrainedBox(
        constraints: BoxConstraints(
          maxWidth: dialogWidth(context, 640),
          maxHeight: MediaQuery.sizeOf(context).height * .88,
        ),
        child: _loading
            ? const SizedBox(
                height: 240, child: Center(child: CircularProgressIndicator()))
            : _error != null
                ? Padding(
                    padding: const EdgeInsets.all(30),
                    child: InlineMessage(_error!, error: true, onRetry: _load))
                : _content(),
      ),
    );
  }

  Widget _content() {
    final wf = workflowMeta(oStr(_op['workflow_status']));
    final billNo = oStr(_op['bill_no']);
    final code = oStr(_op['external_order_code']).isNotEmpty
        ? oStr(_op['external_order_code'])
        : oStr(_op['external_order_id']);
    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // Header
        Padding(
          padding: const EdgeInsets.fromLTRB(20, 18, 12, 8),
          child: Row(
            children: [
              const Text('Chi tiết đơn hàng',
                  style: TextStyle(fontSize: 17, fontWeight: FontWeight.w800)),
              const Spacer(),
              IconButton(
                  onPressed: () => Navigator.of(context).maybePop(),
                  icon: const Icon(Icons.close)),
            ],
          ),
        ),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 20),
          child: Wrap(
            crossAxisAlignment: WrapCrossAlignment.center,
            spacing: 10,
            runSpacing: 4,
            children: [
              ProviderBadge(oStr(_op['provider']), shop: oStr(_op['shop_name'])),
              // Mã đơn Dan D Pak (nội bộ) — LUÔN hiện trước, tách biệt mã đối
              // tác: đây là mã dùng xuyên suốt POS/kế toán/kho/hóa đơn/in ấn.
              if (billNo.isNotEmpty)
                Text('#$billNo',
                    style: const TextStyle(
                        fontFamily: 'JetBrains Mono',
                        fontWeight: FontWeight.w800,
                        color: DanColors.brand)),
              if (code.isNotEmpty)
                Text('· ${t("Đối tác")}: #$code',
                    style: const TextStyle(
                        fontFamily: 'JetBrains Mono',
                        fontWeight: FontWeight.w700,
                        color: DanColors.muted)),
              OnlinePill(wf.label, wf.color),
            ],
          ),
        ),
        const SizedBox(height: 10),
        // Tabs
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 20),
          child: Wrap(spacing: 6, runSpacing: 6, children: [
            _tabBtn(0, t('Thông tin đơn hàng')),
            _tabBtn(1, t('Thông tin vận chuyển')),
            _tabBtn(2, t('Lịch sử & hóa đơn')),
          ]),
        ),
        const Divider(height: 18, color: DanColors.border),
        Flexible(
          child: SingleChildScrollView(
            padding: const EdgeInsets.fromLTRB(20, 0, 20, 8),
            child: switch (_tab) {
              0 => _infoTab(),
              1 => _shippingTab(),
              _ => _historyTab(),
            },
          ),
        ),
        const Divider(height: 1, color: DanColors.border),
        _actionBar(),
      ],
    );
  }

  Widget _tabBtn(int i, String label) {
    final sel = _tab == i;
    return InkWell(
      onTap: () {
        setState(() => _tab = i);
        if (i == 2) _loadInvoiceDetail();
      },
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        decoration: BoxDecoration(
          color: sel ? DanColors.brandDim : Colors.transparent,
          borderRadius: BorderRadius.circular(DanRadius.sm),
        ),
        child: Text(label,
            style: TextStyle(
                fontSize: 13,
                fontWeight: FontWeight.w700,
                color: sel ? DanColors.brand : DanColors.muted)),
      ),
    );
  }

  Widget _infoTab() {
    final c = oMap(_op['customer']);
    final items = oList(_op['items']);
    final total = oNum(_op['total']);
    final discount = oNum(_op['discount']);
    final subtotal = items.fold<num>(
        0, (s, it) => s + oNum(it['qty']) * oNum(it['unit_price']));
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(t('Nguồn đơn'),
            style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13)),
        const SizedBox(height: 6),
        _kv('Mã đơn Dan D Pak', oStr(_op['bill_no'])),
        _kv('Nền tảng', providerMeta(oStr(_op['provider'])).name),
        _kv('Gian hàng', oStr(_op['shop_name'])),
        if (oStr(_op['shop_id']).isNotEmpty)
          _kv('Shop ID', oStr(_op['shop_id'])),
        _kv(
            'Mã đơn trên đối tác',
            oStr(_op['external_order_code']).isNotEmpty
                ? oStr(_op['external_order_code'])
                : oStr(_op['external_order_id'])),
        _kv('Chi nhánh nhận đơn', oStr(_op['branch_id'])),
        const Divider(height: 20, color: DanColors.border),
        _kv('Khách hàng', oStr(c['name'])),
        _kv('Điện thoại', oStr(c['phone'])),
        _kv('Địa chỉ', oStr(c['address'])),
        const SizedBox(height: 8),
        const Text('Sản phẩm',
            style: TextStyle(fontWeight: FontWeight.w800, fontSize: 13)),
        const SizedBox(height: 6),
        for (final it in items) _itemRow(it),
        const Divider(height: 20, color: DanColors.border),
        _totalRow('Tổng tiền hàng', subtotal),
        if (discount > 0) _totalRow('Giảm giá', -discount),
        _totalRow('Tổng thanh toán', total, bold: true),
        if (oNum(_op['unmapped_items']) > 0)
          Padding(
            padding: const EdgeInsets.only(top: 10),
            child: InlineMessage(
                t('Đơn có ${oNum(_op['unmapped_items']).toInt()} dòng hàng chưa liên kết SKU — cần đối chiếu ở mục Hàng hóa trước khi chốt.'),
                error: true),
          ),
      ],
    );
  }

  Widget _shippingTab() {
    final ship = oMap(_op['shipping']);
    final tracking = (ship['tracking_numbers'] as List?)?.join(', ') ?? '';
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _kv('Đơn vị vận chuyển', oStr(ship['carrier'])),
        _kv('Mã vận đơn', tracking),
        _kv('Trạng thái giao',
            t(workflowMeta(oStr(_op['workflow_status'])).label)),
        _kv('Người xử lý', oStr(_op['assignee_name'])),
        const SizedBox(height: 12),
        Row(children: [
          OutlinedButton.icon(
            onPressed: _busy ? null : () => printOrderLabel(context, _op),
            icon: const Icon(Icons.print_outlined, size: 16),
            label: Text(t('In tem vận đơn')),
          ),
        ]),
      ],
    );
  }

  Future<void> _loadInvoiceDetail() async {
    if (_invoiceLoaded || _invoiceLoading) return;
    setState(() => _invoiceLoading = true);
    try {
      final detail = await context.read<ApiService>().getInvoiceDetail(widget.orderId);
      if (!mounted) return;
      setState(() {
        _invoiceDetail = detail;
        _invoiceLoading = false;
        _invoiceLoaded = true;
      });
    } catch (_) {
      // Đơn chưa từng vào pipeline hóa đơn (chưa 'paid', hoặc đã hủy trước khi
      // trả tiền) — KHÔNG phải lỗi, chỉ là chưa có gì để hiện (giữ null).
      if (!mounted) return;
      setState(() {
        _invoiceDetail = null;
        _invoiceLoading = false;
        _invoiceLoaded = true;
      });
    }
  }

  Widget _historyTab() {
    if (_invoiceLoading) {
      return const Padding(
        padding: EdgeInsets.symmetric(vertical: 30),
        child: Center(child: CircularProgressIndicator()),
      );
    }
    final detail = _invoiceDetail;
    if (detail == null) {
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: 20),
        child: OnlineEmpty(
          t('Đơn chưa vào pipeline hóa đơn (chưa thanh toán hoặc đã hủy trước khi trả tiền).'),
          icon: Icons.receipt_long_outlined,
        ),
      );
    }
    final bill = oMap(detail['bill']);
    final timeline = oList(detail['timeline']);
    final payments = oList(detail['payment_history']);
    final returns = oList(detail['returns']);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(t('Hóa đơn điện tử'),
            style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13)),
        const SizedBox(height: 6),
        _kv('Trạng thái HĐĐT', oStr(bill['einvoice_status'])),
        if (oStr(bill['invoice_no']).isNotEmpty)
          _kv('Số hóa đơn', oStr(bill['invoice_no'])),
        if (oStr(bill['invoice_template']).isNotEmpty)
          _kv('Mẫu số', oStr(bill['invoice_template'])),
        if (oStr(bill['invoice_series']).isNotEmpty)
          _kv('Ký hiệu', oStr(bill['invoice_series'])),
        if (oStr(bill['lookup_code']).isNotEmpty)
          _kv('Mã tra cứu', oStr(bill['lookup_code'])),
        const Divider(height: 20, color: DanColors.border),
        Text(t('Dòng thời gian'),
            style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13)),
        const SizedBox(height: 6),
        if (timeline.isEmpty)
          Text(t('Chưa có sự kiện nào'),
              style: const TextStyle(fontSize: 12.5, color: DanColors.faint))
        else
          for (final e in timeline) _timelineRow(e),
        if (payments.isNotEmpty) ...[
          const Divider(height: 20, color: DanColors.border),
          Text(t('Lịch sử thanh toán'),
              style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13)),
          const SizedBox(height: 6),
          for (final p in payments)
            _kv(oStr(p['method']).isEmpty ? 'Thanh toán' : oStr(p['method']),
                Fmt.money(oNum(p['amount']))),
        ],
        if (returns.isNotEmpty) ...[
          const Divider(height: 20, color: DanColors.border),
          Text(t('Trả hàng / Hoàn tiền'),
              style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13)),
          const SizedBox(height: 6),
          for (final r in returns)
            _kv(t('Hoàn tiền'), Fmt.money(oNum(r['refund_total']))),
        ],
      ],
    );
  }

  Widget _timelineRow(Map<String, dynamic> e) {
    final at = oStr(e['created_at']);
    final action = oStr(e['action']);
    final newStatus = oStr(e['new_status']);
    final reason = oStr(e['reason']);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 3),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
              width: 130,
              child: Text(at,
                  style: const TextStyle(fontSize: 11, color: DanColors.faint))),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('$action${newStatus.isEmpty ? '' : ' → $newStatus'}',
                    style: const TextStyle(
                        fontSize: 12.5, fontWeight: FontWeight.w700)),
                if (reason.isNotEmpty)
                  Text(reason,
                      style: const TextStyle(
                          fontSize: 11.5, color: DanColors.muted)),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _itemRow(Map<String, dynamic> it) {
    final unmapped = it['sku_id'] == null && it['menu_item_id'] == null;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(oStr(it['name']), style: const TextStyle(fontSize: 12.5)),
                if (unmapped)
                  Text(t('Chưa liên kết SKU'),
                      style: const TextStyle(
                          fontSize: 11, color: Color(0xFFB91C1C))),
              ],
            ),
          ),
          Text('x${oNum(it['qty']).toInt()}',
              style: const TextStyle(fontSize: 12.5, color: DanColors.muted)),
          const SizedBox(width: 16),
          Text(Fmt.money(oNum(it['qty']) * oNum(it['unit_price'])),
              style:
                  const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700)),
        ],
      ),
    );
  }

  Widget _kv(String k, String v) {
    if (v.isEmpty) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
              width: 130,
              child: Text(t(k),
                  style:
                      const TextStyle(fontSize: 12.5, color: DanColors.muted))),
          Expanded(child: Text(v, style: const TextStyle(fontSize: 12.5))),
        ],
      ),
    );
  }

  Widget _totalRow(String label, num value, {bool bold = false}) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 3),
      child: Row(
        children: [
          Text(label,
              style: TextStyle(
                  fontSize: bold ? 14 : 12.5,
                  fontWeight: bold ? FontWeight.w800 : FontWeight.w500)),
          const Spacer(),
          Text(Fmt.money(value),
              style: TextStyle(
                  fontSize: bold ? 15 : 13,
                  fontWeight: bold ? FontWeight.w900 : FontWeight.w700)),
        ],
      ),
    );
  }

  Widget _actionBar() {
    final status = oStr(_op['workflow_status']);
    final id = oStr(_op['id']);
    final api = context.read<ApiService>();
    final actions = <Widget>[];

    void primary(String label, String action, String ok) {
      actions.add(FilledButton(
        onPressed: _busy
            ? null
            : () => _run(() => api.transitionOnlineOperation(id, action), ok),
        child: Text(label),
      ));
    }

    if (status == 'pending') {
      primary(t('Xác nhận đơn'), 'confirm', t('Đã xác nhận đơn'));
    } else if (status == 'processed' || status == 'preparing') {
      actions.add(OutlinedButton(
        onPressed: _busy
            ? null
            : () => _run(() => api.transitionOnlineOperation(id, 'preparing'),
                t('Đang chuẩn bị hàng')),
        child: Text(t('Chuẩn bị hàng')),
      ));
      primary(
          t('Sẵn sàng giao'), 'ready_to_ship', t('Đã chuyển sẵn sàng giao'));
    } else if (status == 'ready_to_ship') {
      primary(t('Giao cho ĐVVC'), 'mark_shipping', t('Đã bàn giao vận chuyển'));
    } else if (status == 'shipping') {
      primary(t('Hoàn tất giao'), 'close', t('Đã hoàn tất giao'));
    }

    if (status == 'delivered') {
      actions.add(OutlinedButton(
        onPressed: _busy
            ? null
            : () => _reasonThen(
                'Lý do hoàn tiền',
                (reason) =>
                    api.refundOnlineOperation(id, body: {'reason': reason}),
                t('Đã tạo hoàn tiền')),
        style: OutlinedButton.styleFrom(foregroundColor: DanColors.late),
        child: Text(t('Trả hàng/Hoàn tiền')),
      ));
    }

    // Assign
    actions.add(_assignMenu(id));

    // Print label
    actions.add(OutlinedButton.icon(
      onPressed: _busy ? null : () => printOrderLabel(context, _op),
      icon: const Icon(Icons.print_outlined, size: 16),
      label: Text(t('In tem')),
    ));

    // Cancel
    if (status != 'cancelled' && status != 'return_refund') {
      actions.add(TextButton(
        onPressed: _busy
            ? null
            : () => _reasonThen(
                'Lý do hủy đơn',
                (reason) =>
                    api.cancelOnlineOperation(id, body: {'reason': reason}),
                t('Đã hủy đơn')),
        style: TextButton.styleFrom(foregroundColor: DanColors.late),
        child: Text(t('Hủy đơn')),
      ));
    }

    return Padding(
      padding: const EdgeInsets.all(14),
      child: Wrap(spacing: 8, runSpacing: 8, children: actions),
    );
  }

  Widget _assignMenu(String id) {
    return PopupMenuButton<String>(
      enabled: !_busy,
      onSelected: (uid) => _run(
          () => context.read<ApiService>().assignOnlineOperation(id, uid),
          t('Đã phân công')),
      itemBuilder: (_) => [
        for (final u in _users)
          PopupMenuItem(value: oStr(u['id']), child: Text(oStr(u['name']))),
      ],
      child: OutlinedButton.icon(
        onPressed: null,
        icon: const Icon(Icons.person_add_alt, size: 16),
        label: Text(t('Phân công')),
      ),
    );
  }

  Future<void> _reasonThen(String title,
      Future<dynamic> Function(String reason) action, String ok) async {
    final ctrl = TextEditingController();
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        title: Text(t(title)),
        content: TextField(
          controller: ctrl,
          autofocus: true,
          decoration: InputDecoration(hintText: t('Nhập lý do…')),
        ),
        actions: [
          TextButton(
              onPressed: () => Navigator.of(context).pop(false),
              child: Text(t('Đóng'))),
          FilledButton(
              onPressed: () => Navigator.of(context).pop(true),
              child: Text(t('Xác nhận'))),
        ],
      ),
    );
    if (confirmed == true) {
      await _run(() => action(ctrl.text.trim()), ok);
    }
  }
}

const _sanProviders = {'shopee', 'lazada', 'tiktokshop'};

/// Điểm vào IN TEM cho đơn online — tự chọn cách in theo kênh:
/// • Sàn (Shopee/Lazada/TikTok): tải WAYBILL PDF CHÍNH THỨC của sàn rồi mở/in
///   (dùng đúng mẫu tem của sàn, KHÔNG tự thiết kế).
/// • Haravan/website/khác: tem văn bản tự dựng (chọn khổ 100×150/76×130).
Future<void> printOrderLabel(
    BuildContext context, Map<String, dynamic> op) async {
  final provider = oStr(op['provider']);
  if (_sanProviders.contains(provider)) {
    final ref = oStr(op['external_order_code']).isNotEmpty
        ? oStr(op['external_order_code'])
        : oStr(op['external_order_id']);
    await _openSanWaybill(context, provider, ref);
  } else {
    await showShippingLabelDialog(context, oStr(op['id']));
  }
}

Future<void> _openSanWaybill(
    BuildContext context, String provider, String ref) async {
  final api = context.read<ApiService>();
  try {
    final bytes = await api.getConnectorWaybill(provider, ref);
    final dir = await getTemporaryDirectory();
    final f = File('${dir.path}/waybill-$provider-$ref.pdf');
    await f.writeAsBytes(bytes, flush: true);
    if (Platform.isWindows) {
      // Mở bằng trình xem PDF mặc định (có nút In).
      await Process.start('cmd', ['/c', 'start', '', f.path]);
    } else {
      await Share.shareXFiles([XFile(f.path)],
          subject: 'Tem vận đơn ${providerMeta(provider).name}');
    }
    if (context.mounted) appToast(context, t('Đã tải tem vận đơn của sàn'));
  } catch (e) {
    if (context.mounted) {
      appToast(context, e.toString().replaceFirst('Exception: ', ''),
          isError: true);
    }
  }
}

/// Hộp thoại chọn khổ tem (100×150 mặc định / 76×130) + số bản, rồi in tem
/// vận đơn qua máy in tem đã cấu hình.
Future<void> showShippingLabelDialog(
    BuildContext context, String orderId) async {
  String size = '100x150';
  int copies = 1;
  await showDialog<void>(
    context: context,
    builder: (dialogCtx) => StatefulBuilder(
      builder: (ctx, setLocal) => AlertDialog(
        title: Text(t('In tem vận đơn')),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(t('Khổ tem'),
                style: const TextStyle(fontWeight: FontWeight.w700)),
            const SizedBox(height: 6),
            Wrap(spacing: 8, children: [
              for (final s in const ['100x150', '76x130'])
                ChoiceChip(
                  label: Text(s == '100x150' ? '100 × 150 mm' : '76 × 130 mm'),
                  selected: size == s,
                  onSelected: (_) => setLocal(() => size = s),
                ),
            ]),
            const SizedBox(height: 8),
            Row(children: [
              Text(t('Số bản')),
              const SizedBox(width: 12),
              IconButton(
                  onPressed: copies > 1 ? () => setLocal(() => copies--) : null,
                  icon: const Icon(Icons.remove_circle_outline)),
              Text('$copies',
                  style: const TextStyle(fontWeight: FontWeight.w800)),
              IconButton(
                  onPressed: copies < 5 ? () => setLocal(() => copies++) : null,
                  icon: const Icon(Icons.add_circle_outline)),
            ]),
          ],
        ),
        actions: [
          TextButton(
              onPressed: () => Navigator.of(dialogCtx).pop(),
              child: Text(t('Đóng'))),
          FilledButton.icon(
            icon: const Icon(Icons.print, size: 16),
            label: Text(t('In')),
            onPressed: () async {
              // Không còn bắt buộc cấu hình máy in tem trong hệ thống — lấy
              // dữ liệu thuần, tự dựng PDF đúng khổ rồi mở hộp thoại in của hệ
              // điều hành (giống nút "In" QR bàn BYOD), người dùng tự chọn máy in.
              try {
                final data = await ctx
                    .read<ApiService>()
                    .getShippingLabelData(orderId, size: size);
                if (dialogCtx.mounted) Navigator.of(dialogCtx).pop();
                await Printing.layoutPdf(
                  name: 'tem-van-don-$orderId.pdf',
                  onLayout: (_) => _shippingLabelPdf(data, copies).save(),
                );
              } catch (e) {
                if (context.mounted) {
                  appToast(
                      context, e.toString().replaceFirst('Exception: ', ''),
                      isError: true);
                }
              }
            },
          ),
        ],
      ),
    ),
  );
}

/// Dựng PDF tem vận đơn từ dữ liệu thuần (server/services/printing.js
/// buildShippingLabelPayload) — khổ giấy đúng bằng paperWidthMm, KHÔNG cần
/// máy in tem cấu hình sẵn; hộp thoại in của hệ điều hành lo phần chọn máy.
pw.Document _shippingLabelPdf(Map<String, dynamic> data, int copies) {
  final widthMm = (data['paperWidthMm'] as num?)?.toDouble() ?? 100;
  final heightMm = widthMm >= 90 ? 150.0 : 130.0;
  final receiver = Map<String, dynamic>.from(data['receiver'] as Map? ?? {});
  final sender = Map<String, dynamic>.from(data['sender'] as Map? ?? {});
  final items = (data['items'] as List? ?? [])
      .map((e) => Map<String, dynamic>.from(e as Map))
      .toList();
  final doc = pw.Document();
  pw.Page buildPage() => pw.Page(
    pageFormat: PdfPageFormat(widthMm * PdfPageFormat.mm,
        heightMm * PdfPageFormat.mm,
        marginAll: 4 * PdfPageFormat.mm),
    build: (_) => pw.Column(
      crossAxisAlignment: pw.CrossAxisAlignment.start,
      children: [
        pw.Row(
          mainAxisAlignment: pw.MainAxisAlignment.spaceBetween,
          children: [
            pw.Text(oStr(data['shopName']),
                style:
                    pw.TextStyle(fontSize: 10, fontWeight: pw.FontWeight.bold)),
            pw.Text(oStr(data['providerLabel']),
                style: const pw.TextStyle(fontSize: 9)),
          ],
        ),
        pw.Divider(thickness: 0.6),
        pw.Text('Ma don: ${oStr(data['orderCode'])}',
            style:
                pw.TextStyle(fontSize: 11, fontWeight: pw.FontWeight.bold)),
        if (oStr(data['trackingNumber']).isNotEmpty)
          pw.Text(
              'Van don: ${oStr(data['trackingNumber'])}'
              '${oStr(data['carrier']).isNotEmpty ? ' (${oStr(data['carrier'])})' : ''}',
              style: const pw.TextStyle(fontSize: 9)),
        pw.SizedBox(height: 6),
        pw.Text('NGUOI NHAN',
            style: pw.TextStyle(fontSize: 8, color: PdfColors.grey700)),
        pw.Text('${oStr(receiver['name'])} - ${oStr(receiver['phone'])}',
            style:
                pw.TextStyle(fontSize: 10, fontWeight: pw.FontWeight.bold)),
        pw.Text(oStr(receiver['address']),
            style: const pw.TextStyle(fontSize: 9)),
        pw.SizedBox(height: 6),
        pw.Text('NGUOI GUI',
            style: pw.TextStyle(fontSize: 8, color: PdfColors.grey700)),
        pw.Text('${oStr(sender['name'])} - ${oStr(sender['phone'])}',
            style: const pw.TextStyle(fontSize: 9)),
        pw.Text(oStr(sender['address']),
            style: const pw.TextStyle(fontSize: 8)),
        pw.Divider(thickness: 0.6),
        for (final it in items)
          pw.Text('- ${oStr(it['name'])} x${it['qty']}',
              style: const pw.TextStyle(fontSize: 8)),
        pw.Spacer(),
        pw.Divider(thickness: 0.6),
        pw.Row(
          mainAxisAlignment: pw.MainAxisAlignment.spaceBetween,
          children: [
            pw.Text('COD', style: const pw.TextStyle(fontSize: 9)),
            pw.Text(Fmt.money((data['codAmount'] as num?)?.toInt() ?? 0),
                style:
                    pw.TextStyle(fontSize: 13, fontWeight: pw.FontWeight.bold)),
          ],
        ),
        if (oStr(data['weight']).isNotEmpty)
          pw.Text('KL: ${oStr(data['weight'])}',
              style: const pw.TextStyle(fontSize: 8)),
        if (oStr(data['note']).isNotEmpty)
          pw.Text('Ghi chu: ${oStr(data['note'])}',
              style: const pw.TextStyle(fontSize: 8)),
      ],
    ),
  );
  for (var i = 0; i < copies; i++) doc.addPage(buildPage());
  return doc;
}
