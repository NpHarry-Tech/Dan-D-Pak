import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../providers/auth_provider.dart';
import '../../services/api_service.dart';
import '../../ui/app_theme.dart';
import '../../utils/translation.dart';
import '../management/management_widgets.dart';
import 'phone_kit.dart';
import 'phone_scaffolds.dart';

/// NHÓM TỔNG QUAN bản điện thoại: Tổng quan, Doanh thu, Ca & két tiền.
/// Dữ liệu thật: `GET /api/dashboard`, `/api/dashboard/trends`,
/// `/api/shifts/current`, `/api/cash-drawer/current`.

num _n(dynamic v) {
  if (v is num) return v;
  return num.tryParse('${v ?? ''}'.replaceAll(',', '')) ?? 0;
}

String _s(dynamic v) => '${v ?? ''}';

/// Đọc số theo nhiều tên khoá — chỉ dùng cho chỗ server thật sự có nhiều biến
/// thể. Tên khoá CHÍNH phải luôn đứng đầu và phải khớp code server.
num _pick(Map<String, dynamic> m, List<String> keys) {
  for (final k in keys) {
    if (m[k] != null) return _n(m[k]);
  }
  return 0;
}

class PhoneHomeScreen extends StatefulWidget {
  const PhoneHomeScreen({super.key});

  @override
  State<PhoneHomeScreen> createState() => _PhoneHomeScreenState();
}

class _PhoneHomeScreenState extends State<PhoneHomeScreen> {
  Map<String, dynamic> _data = {};
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    if (mounted) setState(() => _loading = true);
    try {
      final d = await context.read<ApiService>().getDashboard();
      if (!mounted) return;
      setState(() {
        _data = d;
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
    final auth = context.watch<AuthProvider>();
    // Tên trường ĐỐI CHIẾU TỪ server/services/reports.js → dashboard():
    // { revenue, bills, avg, openOrders, byHour, byChannel, methods, topItems,
    //   lowStock, stations, window }. Trước đây đoán 'orders'/'refunds' nên hai
    // ô đó luôn hiện 0 — dashboard KHÔNG hề trả về khoản trả hàng.
    final revenue = _n(_data['revenue']);
    final bills = _n(_data['bills']);
    final avg = _n(_data['avg']);
    final openOrders = _n(_data['openOrders']);
    final lowStock = (_data['lowStock'] as List?)?.length ?? 0;

    return Scaffold(
      backgroundColor: DanColors.bg,
      body: SafeArea(
        bottom: false,
        child: Column(
          children: [
            Container(
              height: 56,
              color: DanColors.surface,
              padding: const EdgeInsets.only(left: 16, right: 6),
              child: Row(
                children: [
                  Expanded(
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                            auth.selectedBranch.name.isNotEmpty
                                ? auth.selectedBranch.name
                                : t('Tổng quan'),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                                fontSize: 13, fontWeight: FontWeight.w800)),
                        Padding(
                          padding: const EdgeInsets.only(top: 1),
                          child: Text(auth.currentUser?.name ?? '',
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(
                                  fontSize: 10.5,
                                  fontWeight: FontWeight.w700,
                                  color: DanColors.muted)),
                        ),
                      ],
                    ),
                  ),
                  PhoneIconButton(icon: Icons.refresh, onTap: _load),
                ],
              ),
            ),
            Expanded(
              child: _loading && _data.isEmpty
                  ? const Center(child: CircularProgressIndicator())
                  : _error != null && _data.isEmpty
                      ? Padding(
                          padding: const EdgeInsets.all(24),
                          child: InlineMessage(
                              '${t('Không tải được số liệu')}: $_error',
                              error: true,
                              onRetry: _load),
                        )
                      : RefreshIndicator(
                          onRefresh: _load,
                          child: ListView(
                            padding: const EdgeInsets.only(bottom: 20),
                            children: [
                              Container(
                                width: double.infinity,
                                color: DanColors.surface,
                                padding:
                                    const EdgeInsets.fromLTRB(16, 16, 16, 16),
                                child: Column(
                                  crossAxisAlignment:
                                      CrossAxisAlignment.start,
                                  children: [
                                    Text(t('DOANH THU'),
                                        style: const TextStyle(
                                            fontSize: 11,
                                            fontWeight: FontWeight.w800,
                                            letterSpacing: .8,
                                            color: DanColors.muted)),
                                    const SizedBox(height: 6),
                                    Text(phoneMoney(revenue),
                                        style: const TextStyle(
                                            fontSize: 34,
                                            fontWeight: FontWeight.w800,
                                            letterSpacing: -.8,
                                            fontFeatures: [
                                              FontFeature.tabularFigures()
                                            ])),
                                    const SizedBox(height: 8),
                                    Text(
                                        '${phoneInt(bills)} ${t('hóa đơn')}',
                                        style: const TextStyle(
                                            fontSize: 11.5,
                                            fontWeight: FontWeight.w600,
                                            color: DanColors.muted)),
                                  ],
                                ),
                              ),
                              const SizedBox(height: 1),
                              PhoneMetricStrip([
                                (t('Trung bình / hóa đơn'), phoneMoney(avg),
                                    null),
                                (
                                  t('Bill đang mở'),
                                  phoneInt(openOrders),
                                  openOrders > 0 ? DanColors.doing : null
                                ),
                                (
                                  t('Sắp hết hàng'),
                                  phoneInt(lowStock),
                                  lowStock > 0 ? DanColors.late : null
                                ),
                                (t('Chi nhánh'), auth.selectedBranch.id, null),
                              ]),
                              _bestSellers(),
                            ],
                          ),
                        ),
            ),
          ],
        ),
      ),
    );
  }

  /// Hàng bán chạy — server trả `topItems` (reports.js), mỗi dòng gồm
  /// { name, emoji, qty, revenue }. KHÔNG có `unit` nên đừng ghép vào phụ đề.
  Widget _bestSellers() {
    final raw = _data['topItems'] as List?;
    if (raw == null || raw.isEmpty) return const SizedBox.shrink();
    final items = raw.whereType<Map>().toList();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        PhoneSectionTitle(t('Hàng bán chạy')),
        for (var i = 0; i < items.length; i++)
          PhoneListRow(
            leadingIndex: (i + 1).toString().padLeft(2, '0'),
            title: '${_s(items[i]['emoji'])} ${_s(items[i]['name'])}'.trim(),
            subtitle: '${t('Đã bán')} ${phoneInt(_n(items[i]['qty']))}',
            amount: phoneMoney(_n(items[i]['revenue'])),
          ),
      ],
    );
  }
}

/// CA & KÉT TIỀN — số liệu ca đang mở + các khoản thu/chi trong két.
class PhoneShiftScreen extends StatefulWidget {
  const PhoneShiftScreen({super.key});

  @override
  State<PhoneShiftScreen> createState() => _PhoneShiftScreenState();
}

class _PhoneShiftScreenState extends State<PhoneShiftScreen> {
  Map<String, dynamic>? _shift;
  Map<String, dynamic> _drawer = {};
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    if (mounted) setState(() => _loading = true);
    try {
      final api = context.read<ApiService>();
      // Két tiền hỏng KHÔNG được che mất thông tin ca — hai lời gọi độc lập.
      final shift = await api.getCurrentShift();
      final drawer = await api
          .getCashDrawer()
          .catchError((_) => <String, dynamic>{});
      if (!mounted) return;
      setState(() {
        _shift = shift;
        // `/api/cash-drawer/current` trả { shift, summary, entries,
        // reimbursable_expenses } — số tiền nằm trong `summary`, không phải ở
        // gốc. Đọc thẳng gốc thì mọi ô tiền đều hiện 0.
        final s = drawer['summary'];
        _drawer = s is Map ? Map<String, dynamic>.from(s) : <String, dynamic>{};
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
    final s = _shift;
    final open = s != null && _s(s['status']) != 'closed';
    return Scaffold(
      backgroundColor: DanColors.bg,
      body: SafeArea(
        bottom: false,
        child: Column(
          children: [
            PhoneHeader(
              title: t('Ca & két tiền'),
              subtitle: open ? t('Ca đang mở') : t('Chưa mở ca'),
              subtitleColor:
                  open ? const Color(0xFF047857) : DanColors.late,
              onBack: () => Navigator.of(context).maybePop(),
              actions: [
                PhoneIconButton(icon: Icons.refresh, onTap: _load),
              ],
            ),
            Expanded(
              child: _loading
                  ? const Center(child: CircularProgressIndicator())
                  : _error != null
                      ? Padding(
                          padding: const EdgeInsets.all(24),
                          child: InlineMessage(_error!,
                              error: true, onRetry: _load),
                        )
                      : RefreshIndicator(
                          onRefresh: _load,
                          child: ListView(
                            padding: const EdgeInsets.only(top: 12, bottom: 20),
                            children: [
                              if (!open)
                                Padding(
                                  padding:
                                      const EdgeInsets.fromLTRB(16, 0, 16, 12),
                                  child: InlineMessage(
                                      t('Chưa có ca nào đang mở. Mở ca ở bản desktop hoặc tablet trước khi bán.')),
                                ),
                              // Cột ca: shifts.opened_at / opening_cash
                              // (server/services/shifts.js publicShift).
                              if (s != null)
                                PhoneInfoCard(
                                  title: t('CA LÀM VIỆC'),
                                  rows: [
                                    (t('Mã ca'), _s(s['id'])),
                                    if (_s(s['opened_at']).isNotEmpty)
                                      (t('Mở lúc'), _s(s['opened_at'])),
                                    if (_s(s['opened_by']).isNotEmpty)
                                      (t('Người mở'), _s(s['opened_by'])),
                                    (
                                      t('Tiền đầu ca'),
                                      phoneMoney(_pick(
                                          s, ['opening_cash', 'opening_balance']))
                                    ),
                                  ],
                                ),
                              // Két: summaryForShift() trả opening_cash,
                              // cash_sales, expenses, reimbursements,
                              // expected_cash, movement_count.
                              if (_drawer.isNotEmpty)
                                PhoneInfoCard(
                                  title: t('KÉT TIỀN'),
                                  rows: [
                                    (t('Tiền đầu ca'),
                                        phoneMoney(_n(_drawer['opening_cash']))),
                                    (t('Tiền mặt bán được'),
                                        phoneMoney(_n(_drawer['cash_sales']))),
                                    (t('Chi từ két'),
                                        phoneMoney(_n(_drawer['expenses']))),
                                    (t('Hoàn ứng'),
                                        phoneMoney(
                                            _n(_drawer['reimbursements']))),
                                    (t('TIỀN MẶT PHẢI CÓ'),
                                        phoneMoney(
                                            _n(_drawer['expected_cash']))),
                                  ],
                                ),
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
