import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../services/api_service.dart';
import '../../ui/app_theme.dart';
import '../../utils/business_datetime.dart';
import '../../utils/translation.dart';
import '../management/management_widgets.dart';
import 'phone_kit.dart';
import 'phone_printer_setup.dart';
import 'phone_scaffolds.dart';

/// MÀN MÁY IN bản điện thoại.
///
/// Dữ liệu thật: `GET /api/print/printers?live=1`, `GET /api/print/jobs`,
/// `POST /api/print/printers/:id/test`, `POST /api/print/jobs/:id/reprint`,
/// `POST /api/print/cash-drawer/open`.
///
/// Hai điều màn này PHẢI giữ đúng, vì chúng là các lỗi đã sửa ở server ngày
/// 2026-07-30 và rất dễ vô tình làm hỏng lại:
///  1. Trạng thái lấy từ `state`/`statusText`/`online` do server soi — TUYỆT ĐỐI
///     không suy từ cờ `active` (đó chỉ là ô "Đang sử dụng" trong Cài đặt, máy
///     POS tắt app vẫn `active: true`).
///  2. Máy in không sẵn sàng thì KHÔNG cho bấm In thử — trước đây bấm được và
///     lệnh nằm chờ tới lúc mở máy in mới ra giấy, người dùng tưởng đã in.
/// Server cũng đã lọc sẵn: người không có quyền quản lý máy in chỉ nhận về máy
/// in cắm vào chính máy họ + máy in LAN dùng chung.

num _n(dynamic v) {
  if (v is num) return v;
  return num.tryParse('${v ?? ''}') ?? 0;
}

String _s(dynamic v) => '${v ?? ''}';

class PhonePrintersScreen extends StatefulWidget {
  const PhonePrintersScreen({super.key});

  @override
  State<PhonePrintersScreen> createState() => _PhonePrintersScreenState();
}

class _PhonePrintersScreenState extends State<PhonePrintersScreen> {
  List<Map<String, dynamic>> _printers = [];
  List<Map<String, dynamic>> _jobs = [];
  bool _loading = true;
  String? _error;
  String _statusFilter = '';

  static const _statusLabels = {
    'queued': 'Chờ in',
    'printing': 'Đang in',
    'printed': 'Đã in',
    'failed': 'Lỗi',
    'cancelled': 'Đã huỷ',
  };

  static const _typeLabels = {
    'receipt': 'Hóa đơn / Tạm tính',
    'kitchen_ticket': 'Phiếu bếp',
    'cup_label': 'Tem ly',
    'product_label': 'Tem sản phẩm',
    'shipping_label': 'Tem vận đơn',
    'runner': 'Phiếu chạy món',
    'test': 'In thử',
    'cash_drawer': 'Mở két tiền',
    'inventory_document': 'Phiếu kho',
    'purchase': 'Phiếu mua hàng',
    'refund': 'Hoàn / trả hàng',
  };

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    if (mounted) setState(() => _loading = true);
    try {
      final api = context.read<ApiService>();
      // live: server dò thật (máy POS cắm máy in có đang chạy app không, máy in
      // LAN có trả lời không). Thiếu cờ này server trả 'ready' vô điều kiện.
      final printers = await api.getPrinters(live: true);
      final jobs = await api.getPrintJobs();
      if (!mounted) return;
      setState(() {
        _printers = printers
            .whereType<Map>()
            .map((e) => Map<String, dynamic>.from(e))
            .toList();
        _jobs = jobs
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

  Future<void> _test(Map<String, dynamic> p) async {
    try {
      await context.read<ApiService>().testPrinter(_s(p['id']));
      if (!mounted) return;
      appToast(context, t('Đã gửi lệnh in thử tới ${_label(p)}'));
      _load();
    } catch (e) {
      if (!mounted) return;
      // Server trả 403 kèm câu tiếng Việt khi với sang máy in của máy POS khác.
      appToast(context, e.toString().replaceFirst('Exception: ', ''),
          isError: true);
    }
  }

  Future<void> _reprint(Map<String, dynamic> j) async {
    try {
      await context.read<ApiService>().reprintJob(_s(j['id']));
      if (!mounted) return;
      appToast(context, t('Đã tạo lệnh in lại'));
      _load();
    } catch (e) {
      if (!mounted) return;
      appToast(context, e.toString().replaceFirst('Exception: ', ''),
          isError: true);
    }
  }

  /// Chạm vào một máy in → xem thông tin đầy đủ, rồi sửa hoặc xoá.
  Future<void> _moChiTiet(Map<String, dynamic> p) async {
    final tuNhan = p['implicit'] == true;
    await showPhoneSheet<void>(
      context: context,
      title: _label(p),
      builder: (c) => ListView(
        shrinkWrap: true,
        children: [
          PhoneInfoCard(rows: [
            (
              t('Kiểu kết nối'),
              _s(p['connection']) == 'lan'
                  ? t('Máy in mạng (LAN)')
                  : t('Máy in của máy này')
            ),
            if (_s(p['systemName']).isNotEmpty)
              (t('Tên hệ điều hành'), _s(p['systemName'])),
            if (_s(p['ip']).isNotEmpty)
              (t('Địa chỉ IP'), '${_s(p['ip'])}:${_s(p['port'])}'),
            (
              t('Loại phiếu'),
              t(_typeLabels[_s(p['output'])] ?? _s(p['output']))
            ),
            (
              t('Ngăn kéo tiền'),
              p['cashDrawer'] == true ? t('Có') : t('Không')
            ),
            (
              t('Trạng thái'),
              _s(p['statusText']).isNotEmpty
                  ? _s(p['statusText'])
                  : (p['online'] == true ? t('Sẵn sàng') : t('Không rõ'))
            ),
            if (tuNhan) (t('Nguồn'), t('Tự nhận từ máy này')),
          ]),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 4, 16, 16),
            child: Column(
              children: [
                PhoneSecondaryButton(
                  label: t('In thử'),
                  icon: Icons.print_outlined,
                  onPressed: () {
                    Navigator.of(c).pop();
                    _test(p);
                  },
                ),
                if (!tuNhan) ...[
                  const SizedBox(height: 8),
                  PhoneCta(
                    label: t('Sửa máy in'),
                    onPressed: () {
                      Navigator.of(c).pop();
                      _moCaiDat(p);
                    },
                  ),
                ] else ...[
                  const SizedBox(height: 10),
                  Text(t('Máy in này được máy tự nhận, không nằm trong cấu hình nên không sửa hay xoá được. Rút máy in ra là nó tự biến mất.'),
                      style: const TextStyle(
                          fontSize: 11.5, height: 1.5, color: DanColors.faint)),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }

  /// Mở bảng nối máy in. [p] = null là thêm mới.
  Future<void> _moCaiDat(Map<String, dynamic>? p) async {
    final luu = await showPhoneSheet<bool>(
      context: context,
      title: t(p == null ? 'Thêm máy in mới' : 'Sửa máy in'),
      builder: (_) => PhonePrinterSetupSheet(printer: p),
    );
    if (luu == true) _load();
  }

  Future<void> _openDrawer() async {
    try {
      await context.read<ApiService>().openCashDrawer();
      if (!mounted) return;
      appToast(context, t('Đã gửi lệnh mở két tiền'));
    } catch (e) {
      if (!mounted) return;
      appToast(context, e.toString().replaceFirst('Exception: ', ''),
          isError: true);
    }
  }

  String _label(Map<String, dynamic> p) =>
      _s(p['label']).isNotEmpty ? _s(p['label']) : _s(p['name']);

  String _printerName(String id) {
    for (final p in _printers) {
      if (_s(p['id']) == id) return _label(p);
    }
    return id.isEmpty ? '-' : id;
  }

  @override
  Widget build(BuildContext context) {
    final jobs = _statusFilter.isEmpty
        ? _jobs
        : _jobs.where((j) => _s(j['status']) == _statusFilter).toList();

    return Scaffold(
      backgroundColor: DanColors.bg,
      body: SafeArea(
        bottom: false,
        child: Column(
          children: [
            PhoneHeader(
              title: t('Máy in'),
              subtitle: _printers.isEmpty
                  ? null
                  : '${_printers.length} ${t('máy in')}',
              onBack: () => Navigator.of(context).maybePop(),
              actions: [
                // NỐI MÁY IN đặt ngay đây, không bắt vào Cài đặt → Kết nối nữa:
                // người đi tìm cách nối máy in thì vào mục "Máy in" là tự nhiên.
                PhoneIconButton(icon: Icons.add, onTap: () => _moCaiDat(null)),
                PhoneIconButton(icon: Icons.refresh, onTap: _load),
              ],
            ),
            Expanded(
              child: _loading && _printers.isEmpty && _jobs.isEmpty
                  ? const Center(child: CircularProgressIndicator())
                  : _error != null && _printers.isEmpty
                      ? Padding(
                          padding: const EdgeInsets.all(24),
                          child: InlineMessage(
                              '${t('Không tải được máy in')}: $_error',
                              error: true,
                              onRetry: _load),
                        )
                      : RefreshIndicator(
                          onRefresh: _load,
                          child: ListView(
                            padding: const EdgeInsets.only(bottom: 20),
                            children: [
                              PhoneSectionTitle(t('Thiết bị máy in')),
                              if (_printers.isEmpty)
                                PhoneEmpty(
                                    title: t('Máy này chưa cắm máy in nào'),
                                    hint: t(
                                        'Máy in của máy POS khác do Quản lý/Admin xem và thiết lập.'),
                                    icon: Icons.print_outlined)
                              else
                                for (final p in _printers)
                                  _PrinterCard(
                                    printer: p,
                                    label: _label(p),
                                    onTest: () => _test(p),
                                    // Chỉ máy in LAN mới sửa được ở đây: máy in
                                    // cắm USB vào máy POS khác do máy đó khai,
                                    // sửa từ xa chỉ tạo cấu hình ma.
                                    // Chạm CẢ THẺ để xem chi tiết. Tuyến tự
                                    // nhận (implicit) không sửa được — nó không
                                    // nằm trong cấu hình, sửa chỉ tạo tuyến ma.
                                    onEdit: p['implicit'] == true
                                        ? null
                                        : () => _moChiTiet(p),
                                  ),
                              PhoneSectionTitle(
                                t('Lịch sử lệnh in'),
                                trailing: PhoneChip(
                                  label: _statusFilter.isEmpty
                                      ? t('Tất cả')
                                      : t(_statusLabels[_statusFilter] ??
                                          _statusFilter),
                                  active: _statusFilter.isNotEmpty,
                                  caret: true,
                                  onTap: _pickStatus,
                                ),
                              ),
                              if (jobs.isEmpty)
                                PhoneEmpty(
                                    title: t('Chưa có lệnh in nào'),
                                    hint: t('Bán một đơn để thấy lệnh in'),
                                    icon: Icons.receipt_long_outlined)
                              else
                                for (final j in jobs.take(60)) _jobRow(j),
                            ],
                          ),
                        ),
            ),
            PhoneActionBar(
              child: PhoneSecondaryButton(
                label: t('Mở két tiền'),
                icon: Icons.point_of_sale,
                onPressed: _openDrawer,
              ),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _pickStatus() async {
    final options = <String>[t('Tất cả'), ..._statusLabels.values.map(t)];
    await showPhoneSheet<void>(
      context: context,
      title: t('Lọc theo trạng thái'),
      builder: (c) => PhonePickList(
        options: options,
        selected: _statusFilter.isEmpty
            ? t('Tất cả')
            : t(_statusLabels[_statusFilter] ?? ''),
        onPick: (v) {
          Navigator.of(c).pop();
          setState(() {
            if (v == t('Tất cả')) {
              _statusFilter = '';
            } else {
              _statusFilter = _statusLabels.entries
                  .firstWhere((e) => t(e.value) == v,
                      orElse: () => const MapEntry('', ''))
                  .key;
            }
          });
        },
      ),
    );
  }

  Widget _jobRow(Map<String, dynamic> j) {
    final status = _s(j['status']);
    final created = BusinessDateTime.dateTime(j['created_at']);
    return PhoneListRow(
      title: t(_typeLabels[_s(j['type'])] ?? _s(j['type'])),
      subtitle: [
        _printerName(_s(j['printer'])),
        if (created != '—') created,
        if (_n(j['attempts']) > 1) '${t('thử')} ${phoneInt(_n(j['attempts']))}',
      ].where((e) => e.isNotEmpty).join(' · '),
      badge: t(_statusLabels[status] ?? status),
      badgeTone: switch (status) {
        'printed' => PhoneTone.ok,
        'failed' => PhoneTone.bad,
        'cancelled' => PhoneTone.bad,
        'printing' => PhoneTone.warn,
        _ => PhoneTone.neutral,
      },
      onTap: () => _showJob(j),
    );
  }

  /// Chạm vào một lệnh in để xem lý do lỗi và in lại. Lý do lỗi phải hiện
  /// NGUYÊN VĂN của server — đó là thứ nói được vì sao giấy không ra.
  Future<void> _showJob(Map<String, dynamic> j) async {
    await showPhoneSheet<void>(
      context: context,
      title: t(_typeLabels[_s(j['type'])] ?? _s(j['type'])),
      builder: (c) => ListView(
        shrinkWrap: true,
        children: [
          PhoneInfoCard(
            rows: [
              (t('Máy in'), _printerName(_s(j['printer']))),
              (
                t('Trạng thái'),
                t(_statusLabels[_s(j['status'])] ?? _s(j['status']))
              ),
              if (_s(j['target']).isNotEmpty) (t('Đích'), _s(j['target'])),
              if (_n(j['attempts']) > 0)
                (t('Số lần thử'), phoneInt(_n(j['attempts']))),
              if (_s(j['printed_at']).isNotEmpty)
                (t('In lúc'), BusinessDateTime.dateTime(j['printed_at'])),
            ],
          ),
          if (_s(j['error']).isNotEmpty)
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
              child: Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: const Color(0xFFFFF1F1),
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Text(_s(j['error']),
                    style: const TextStyle(
                        fontSize: 12,
                        height: 1.5,
                        fontWeight: FontWeight.w600,
                        color: Color(0xFFD94A4A))),
              ),
            ),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
            child: PhoneCta(
              label: t('In lại'),
              onPressed: () {
                Navigator.of(c).pop();
                _reprint(j);
              },
            ),
          ),
        ],
      ),
    );
  }
}

class _PrinterCard extends StatelessWidget {
  final Map<String, dynamic> printer;
  final String label;
  final VoidCallback onTest;
  final VoidCallback? onEdit;

  const _PrinterCard(
      {required this.printer,
      required this.label,
      required this.onTest,
      this.onEdit});

  @override
  Widget build(BuildContext context) {
    final p = printer;
    // SỰ THẬT do server soi, KHÔNG suy từ cờ cấu hình `active`.
    final state = _s(p['state']);
    final online = p['online'] == true;
    final ready = state.isEmpty ? online : state == 'ok';
    final warn = state == 'warn';
    final tone = ready
        ? const Color(0xFF047857)
        : (warn ? const Color(0xFFB4740A) : const Color(0xFFD94A4A));
    final statusText = _s(p['statusText']).isNotEmpty
        ? _s(p['statusText'])
        : (ready ? t('Sẵn sàng') : t('Không sẵn sàng'));

    return Container(
      margin: const EdgeInsets.fromLTRB(16, 0, 16, 10),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: DanColors.surface,
        border: Border.all(color: DanColors.border),
        borderRadius: BorderRadius.circular(10),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(label,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                        fontSize: 14, fontWeight: FontWeight.w800)),
              ),
              if (p['attached_to_me'] == true)
                PhoneBadge(t('Máy này'), tone: PhoneTone.ok),
              if (onEdit != null)
                PhoneIconButton(icon: Icons.edit_outlined, onTap: onEdit!),
            ],
          ),
          const SizedBox(height: 4),
          Text(
              [
                _s(p['connection']),
                _s(p['target']),
                if (_s(p['owner_device_name']).isNotEmpty &&
                    p['attached_to_me'] != true)
                  _s(p['owner_device_name']),
              ].where((e) => e.isNotEmpty).join(' · '),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(fontSize: 11, color: DanColors.muted)),
          const SizedBox(height: 10),
          Row(
            children: [
              Container(
                width: 8,
                height: 8,
                decoration: BoxDecoration(color: tone, shape: BoxShape.circle),
              ),
              const SizedBox(width: 6),
              Expanded(
                child: Text(statusText,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                        fontSize: 11.5,
                        fontWeight: FontWeight.w700,
                        color: tone)),
              ),
              const SizedBox(width: 8),
              // Không sẵn sàng thì KHÔNG cho bấm — lệnh sẽ nằm chờ và người
              // dùng tưởng đã in.
              SizedBox(
                height: 40,
                child: OutlinedButton(
                  onPressed: ready ? onTest : null,
                  style: OutlinedButton.styleFrom(
                      padding: const EdgeInsets.symmetric(horizontal: 14)),
                  child: Text(t('In thử'),
                      style: const TextStyle(
                          fontSize: 12.5, fontWeight: FontWeight.w800)),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
