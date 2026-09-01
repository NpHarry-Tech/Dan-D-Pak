import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../services/api_service.dart';
import '../../ui/app_theme.dart';
import '../../utils/translation.dart';
import '../../utils/business_datetime.dart';
import 'phone_doc_form_screens.dart';
import 'phone_form_screens.dart';
import 'phone_kit.dart';
import 'phone_scaffolds.dart';

/// NHÓM ĐỐI TÁC + VẬN HÀNH bản điện thoại.
/// Dữ liệu thật: `/api/partners`, `/api/expenses`, `/api/purchase`,
/// `/api/warehouse/documents`, `/api/warehouse/stocktakes`.

num _n(dynamic v) {
  if (v is num) return v;
  return num.tryParse('${v ?? ''}'.replaceAll(',', '')) ?? 0;
}

String _s(dynamic v) => '${v ?? ''}';

List<Map<String, dynamic>> _rows(dynamic raw) {
  final list = raw is List
      ? raw
      : (raw is Map
          ? (raw['items'] ??
              raw['data'] ??
              raw['rows'] ??
              raw['partners'] ??
              raw['expenses'] ??
              raw['orders'] ??
              const [])
          : const []);
  return (list as List? ?? const [])
      .whereType<Map>()
      .map((e) => Map<String, dynamic>.from(e))
      .toList();
}

/// DANH BẠ — dùng chung cho Khách hàng và Nhà cung cấp (cùng endpoint
/// `/api/partners`, chỉ khác tham số `type`). Gộp lại để hai màn không lệch
/// nhau khi sửa.
class PhonePartnersScreen extends StatefulWidget {
  final String type; // 'customer' | 'supplier'
  const PhonePartnersScreen({super.key, required this.type});

  @override
  State<PhonePartnersScreen> createState() => _PhonePartnersScreenState();
}

class _PhonePartnersScreenState extends State<PhonePartnersScreen> {
  final _key = GlobalKey<PhoneListScaffoldState<Map<String, dynamic>>>();

  bool get _isCustomer => widget.type == 'customer';
  String get type => widget.type;

  @override
  Widget build(BuildContext context) {
    return PhoneListScaffold<Map<String, dynamic>>(
      key: _key,
      title: _isCustomer ? 'Khách hàng' : 'Nhà cung cấp',
      actions: [
        PhoneIconButton(
          icon: Icons.add,
          onTap: () async {
            final saved = await Navigator.of(context).push<bool>(
                MaterialPageRoute(
                    builder: (_) =>
                        PhonePartnerFormScreen(isCustomer: _isCustomer)));
            if (saved == true) _key.currentState?.reload();
          },
        ),
      ],
      searchHint: _isCustomer
          ? 'Tên, số điện thoại, mã khách'
          : 'Tên, mã số thuế, mã NCC',
      emptyTitle: _isCustomer ? 'Chưa có khách hàng' : 'Chưa có nhà cung cấp',
      emptyHint: 'Kéo xuống để tải lại',
      emptyIcon: Icons.people_outline,
      fetch: (q) async {
        final res =
            await context.read<ApiService>().getPartners(type: type, q: q);
        return _rows(res);
      },
      // Cột THẬT của bảng customers (server/db.js) sau normalizeRow():
      // code, name, phone, email, tax_code, company, address, total_spent,
      // total_orders, loyalty_points, loyalty_tier.
      // KHÔNG có cột `debt` — công nợ đối tác không nằm ở bảng này, nên đừng
      // dựng ô "công nợ" ở đây rồi hiện 0 mãi.
      metrics: (list) => [
        (t('Số đối tác'), phoneInt(list.length), null),
        (
          _isCustomer ? t('Tổng khách đã mua') : t('Tổng đã nhập'),
          phoneMoney(list.fold<num>(0, (a, m) => a + _n(m['total_spent']))),
          null
        ),
      ],
      rowBuilder: (ctx, m, _) => PhoneListRow(
        title: _s(m['name']),
        subtitle: [
          _s(m['code']),
          _s(m['phone']),
        ].where((e) => e.isNotEmpty).join(' · '),
        amount:
            _n(m['total_spent']) > 0 ? phoneMoney(_n(m['total_spent'])) : null,
        onTap: () => Navigator.of(ctx).push(MaterialPageRoute(
            builder: (_) =>
                PhonePartnerDetailScreen(partner: m, isCustomer: _isCustomer))),
      ),
    );
  }
}

class PhonePartnerDetailScreen extends StatelessWidget {
  final Map<String, dynamic> partner;
  final bool isCustomer;
  const PhonePartnerDetailScreen(
      {super.key, required this.partner, required this.isCustomer});

  @override
  Widget build(BuildContext context) {
    final p = partner;
    return Scaffold(
      backgroundColor: DanColors.bg,
      body: SafeArea(
        bottom: false,
        child: Column(
          children: [
            PhoneHeader(
              title: _s(p['name']),
              subtitle: _s(p['code']),
              onBack: () => Navigator.of(context).maybePop(),
            ),
            Expanded(
              child: ListView(
                padding: const EdgeInsets.only(top: 12, bottom: 20),
                children: [
                  PhoneInfoCard(
                    title: t('LIÊN HỆ'),
                    rows: [
                      if (_s(p['phone']).isNotEmpty)
                        (t('Điện thoại'), _s(p['phone'])),
                      if (_s(p['email']).isNotEmpty)
                        (t('Email'), _s(p['email'])),
                      if (_s(p['address']).isNotEmpty)
                        (t('Địa chỉ'), _s(p['address'])),
                      if (_s(p['tax_code']).isNotEmpty)
                        (t('Mã số thuế'), _s(p['tax_code'])),
                    ],
                  ),
                  PhoneInfoCard(
                    title: t('GIAO DỊCH'),
                    rows: [
                      (
                        isCustomer ? t('Tổng đã mua') : t('Tổng đã nhập'),
                        phoneMoney(_n(p['total_spent']))
                      ),
                      (t('Số đơn'), phoneInt(_n(p['total_orders']))),
                      if (isCustomer)
                        (t('Điểm tích lũy'), phoneInt(_n(p['loyalty_points']))),
                      if (isCustomer && _s(p['loyalty_tier']).isNotEmpty)
                        (t('Hạng'), _s(p['loyalty_tier'])),
                      if (_s(p['last_visit_at']).isNotEmpty)
                        (t('Lần cuối'), _s(p['last_visit_at'])),
                    ],
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// CHI PHÍ.
class PhoneExpensesScreen extends StatefulWidget {
  const PhoneExpensesScreen({super.key});

  @override
  State<PhoneExpensesScreen> createState() => _PhoneExpensesScreenState();
}

class _PhoneExpensesScreenState extends State<PhoneExpensesScreen> {
  final _key = GlobalKey<PhoneListScaffoldState<Map<String, dynamic>>>();

  @override
  Widget build(BuildContext context) {
    return PhoneListScaffold<Map<String, dynamic>>(
      key: _key,
      title: 'Chi phí',
      actions: [
        PhoneIconButton(
          icon: Icons.add,
          onTap: () async {
            final saved = await Navigator.of(context).push<bool>(
                MaterialPageRoute(
                    builder: (_) => const PhoneExpenseFormScreen()));
            if (saved == true) _key.currentState?.reload();
          },
        ),
      ],
      emptyTitle: 'Chưa có khoản chi nào',
      emptyHint: 'Kéo xuống để tải lại',
      emptyIcon: Icons.account_balance_wallet_outlined,
      fetch: (_) async => _rows(await context.read<ApiService>().getExpenses()),
      metrics: (list) => [
        (t('Số khoản chi'), phoneInt(list.length), null),
        (
          t('Tổng chi'),
          phoneMoney(list.fold<num>(0, (a, m) => a + _n(m['amount']))),
          DanColors.late
        ),
      ],
      // Cột THẬT bảng expenses (expenseOut): code, payee_name, category_name,
      // amount, source ('drawer' | 'direct'), expense_date, note.
      rowBuilder: (ctx, m, _) => PhoneListRow(
        title: [_s(m['payee_name']), _s(m['note'])]
                .firstWhere((e) => e.isNotEmpty, orElse: () => '')
                .isEmpty
            ? _s(m['code'])
            : [_s(m['payee_name']), _s(m['note'])]
                .firstWhere((e) => e.isNotEmpty),
        subtitle: [
          _s(m['category_name']),
          BusinessDateTime.date(m['expense_date']),
          _s(m['source']) == 'drawer' ? t('Chi từ két') : t('Chi trực tiếp'),
        ].where((e) => e.isNotEmpty).join(' · '),
        amount: phoneMoney(_n(m['amount'])),
        amountColor: DanColors.late,
      ),
    );
  }
}

/// NHẬP HÀNG (phiếu mua).
class PhonePurchaseScreen extends StatefulWidget {
  const PhonePurchaseScreen({super.key});

  @override
  State<PhonePurchaseScreen> createState() => _PhonePurchaseScreenState();
}

class _PhonePurchaseScreenState extends State<PhonePurchaseScreen> {
  final _key = GlobalKey<PhoneListScaffoldState<Map<String, dynamic>>>();
  String _status = '';
  bool _thisMonth = true;

  @override
  Widget build(BuildContext context) {
    return PhoneListScaffold<Map<String, dynamic>>(
      key: _key,
      title: 'Nhập hàng',
      actions: [
        PhoneIconButton(
          icon: Icons.add,
          onTap: () async {
            final saved = await Navigator.of(context).push<bool>(
                MaterialPageRoute(
                    builder: (_) => const PhonePurchaseFormScreen()));
            if (saved == true) _key.currentState?.reload();
          },
        ),
      ],
      searchHint: 'Mã phiếu, nhà cung cấp',
      emptyTitle: 'Chưa có phiếu nhập',
      emptyHint: 'Kéo xuống để tải lại',
      emptyIcon: Icons.local_shipping_outlined,
      fetch: (q) async {
        var rows =
            _rows(await context.read<ApiService>().getPurchaseOrders(q: q));
        if (_status.isNotEmpty) {
          rows = rows.where((m) => _s(m['status']) == _status).toList();
        }
        if (_thisMonth) {
          final now = BusinessDateTime.now();
          rows = rows.where((m) {
            final date =
                BusinessDateTime.parseApi(m['order_date'] ?? m['created_at']);
            return date != null &&
                date.year == now.year &&
                date.month == now.month;
          }).toList();
        }
        return rows;
      },
      // decoratePO() trả: code, supplier_name, status, subtotal, vat_amount,
      // total, amount_paid, amount_due, received_value, fully_received, lines,
      // payments, created_at.
      metrics: (list) => [
        (t('Số phiếu'), phoneInt(list.length), null),
        (
          t('Tổng tiền nhập'),
          phoneMoney(list.fold<num>(0, (a, m) => a + _n(m['total']))),
          null
        ),
        (
          t('Còn phải trả'),
          phoneMoney(list.fold<num>(0, (a, m) => a + _n(m['amount_due']))),
          DanColors.late
        ),
      ],
      metricColumns: 3,
      filters: (ctx) => [
        PhoneChip(
          label: t(_thisMonth ? 'Tháng này' : 'Tất cả thời gian'),
          active: _thisMonth,
          onTap: () {
            setState(() => _thisMonth = !_thisMonth);
            _key.currentState?.reload();
          },
        ),
        for (final entry in const {
          '': 'Tất cả',
          'draft': 'Phiếu tạm',
          'confirmed': 'Đã xác nhận',
          'received': 'Đã nhập',
          'cancelled': 'Đã hủy',
        }.entries)
          PhoneChip(
            label: t(entry.value),
            active: _status == entry.key,
            onTap: () {
              setState(() => _status = entry.key);
              _key.currentState?.reload();
            },
          ),
      ],
      rowBuilder: (ctx, m, _) => PhoneListRow(
        title: _s(m['code']).isEmpty ? _s(m['id']) : _s(m['code']),
        subtitle: [
          _s(m['supplier_name']),
          BusinessDateTime.date(m['created_at'], fallback: _s(m['created_at'])),
        ].where((e) => e.isNotEmpty).join(' · '),
        amount: phoneMoney(_n(m['total'])),
        badge: _n(m['amount_due']) > 0
            ? '${t('Còn')} ${phoneMoney(_n(m['amount_due']))}'
            : (_s(m['status']).isEmpty ? null : _s(m['status'])),
        badgeTone: _n(m['amount_due']) > 0
            ? PhoneTone.warn
            : switch (_s(m['status'])) {
                'completed' || 'received' => PhoneTone.ok,
                'cancelled' => PhoneTone.bad,
                _ => PhoneTone.neutral,
              },
        onTap: () => Navigator.of(ctx).push(MaterialPageRoute(
            builder: (_) => PhoneDocDetailScreen(
                title: _s(m['code']).isEmpty ? _s(m['id']) : _s(m['code']),
                subtitle: _s(m['supplier_name']),
                doc: m))),
      ),
    );
  }
}

/// CHUYỂN HÀNG giữa kho.
class PhoneTransferScreen extends StatefulWidget {
  const PhoneTransferScreen({super.key});

  @override
  State<PhoneTransferScreen> createState() => _PhoneTransferScreenState();
}

class _PhoneTransferScreenState extends State<PhoneTransferScreen> {
  final _key = GlobalKey<PhoneListScaffoldState<Map<String, dynamic>>>();

  @override
  Widget build(BuildContext context) {
    return PhoneListScaffold<Map<String, dynamic>>(
      key: _key,
      title: 'Chuyển hàng',
      actions: [
        PhoneIconButton(
          icon: Icons.add,
          onTap: () async {
            final saved = await Navigator.of(context).push<bool>(
                MaterialPageRoute(
                    builder: (_) => const PhoneTransferFormScreen()));
            if (saved == true) _key.currentState?.reload();
          },
        ),
      ],
      emptyTitle: 'Chưa có phiếu chuyển',
      emptyHint: 'Kéo xuống để tải lại',
      emptyIcon: Icons.swap_horiz,
      fetch: (_) async => _rows(await context
          .read<ApiService>()
          .getWarehouseDocuments(type: 'transfer')),
      // listDocuments() trả cột bảng inventory_documents + warehouse_name,
      // to_warehouse_name, line_count, total_value. Kho NGUỒN là
      // `warehouse_name` (không phải from_warehouse_name).
      metrics: (list) => [
        (t('Số phiếu'), phoneInt(list.length), null),
        (
          t('Tổng giá trị'),
          phoneMoney(list.fold<num>(0, (a, m) => a + _n(m['total_value']))),
          null
        ),
      ],
      rowBuilder: (ctx, m, _) => PhoneListRow(
        title: _s(m['code']).isEmpty ? _s(m['id']) : _s(m['code']),
        subtitle: [
          _s(m['warehouse_name']),
          _s(m['to_warehouse_name']),
        ].where((e) => e.isNotEmpty).join(' → '),
        amount: '${phoneInt(_n(m['line_count']))} ${t('dòng')}',
        badge: _s(m['status']).isEmpty ? null : _s(m['status']),
        badgeTone: PhoneTone.warn,
        onTap: () => Navigator.of(ctx).push(MaterialPageRoute(
            builder: (_) => PhoneDocDetailScreen(
                title: _s(m['code']).isEmpty ? _s(m['id']) : _s(m['code']),
                subtitle: t('Phiếu chuyển kho'),
                doc: m))),
      ),
    );
  }
}

/// KIỂM KHO.
class PhoneStocktakeScreen extends StatefulWidget {
  const PhoneStocktakeScreen({super.key});

  @override
  State<PhoneStocktakeScreen> createState() => _PhoneStocktakeScreenState();
}

class _PhoneStocktakeScreenState extends State<PhoneStocktakeScreen> {
  final _key = GlobalKey<PhoneListScaffoldState<Map<String, dynamic>>>();
  bool _thisMonth = true;

  @override
  Widget build(BuildContext context) {
    return PhoneListScaffold<Map<String, dynamic>>(
      key: _key,
      title: 'Kiểm kho',
      searchHint: 'Mã phiếu kiểm',
      emptyTitle: 'Chưa có phiếu kiểm kho',
      emptyHint: 'Kéo xuống để tải lại',
      emptyIcon: Icons.fact_check_outlined,
      fetch: (q) async {
        var rows = _rows(await context.read<ApiService>().getStocktakes(q: q));
        if (_thisMonth) {
          final now = BusinessDateTime.now();
          rows = rows.where((m) {
            final date =
                BusinessDateTime.parseApi(m['created_at'] ?? m['date']);
            return date != null &&
                date.year == now.year &&
                date.month == now.month;
          }).toList();
        }
        return rows;
      },
      metrics: (list) => [
        (t('Số phiếu'), phoneInt(list.length), null),
        (
          t('Tổng đơn vị đã đếm'),
          phoneInt(list.fold<num>(
              0,
              (a, m) =>
                  a +
                  _n(m['total_counted'] ??
                      m['counted_qty'] ??
                      m['total_qty']))),
          null
        ),
      ],
      filters: (_) => [
        PhoneChip(
          label: t(_thisMonth ? 'Tháng này' : 'Tất cả thời gian'),
          active: _thisMonth,
          onTap: () {
            setState(() => _thisMonth = !_thisMonth);
            _key.currentState?.reload();
          },
        ),
      ],
      rowBuilder: (ctx, m, _) => PhoneListRow(
        title: _s(m['code'] ?? m['id']),
        subtitle: [
          if (_n(m['line_count'] ?? m['item_count']) > 0)
            '${phoneInt(_n(m['line_count'] ?? m['item_count']))} ${t('mặt hàng')}',
          _s(m['warehouse_name']),
          BusinessDateTime.date(m['created_at'] ?? m['date'],
              fallback: _s(m['created_at'] ?? m['date'])),
          if (_n(m['difference_count'] ?? m['difference']) != 0)
            '${t('Dòng lệch')}: ${phoneInt(_n(m['difference_count'] ?? m['difference']))}',
        ].where((e) => e.isNotEmpty).join(' · '),
        badge: _s(m['status']).isEmpty ? null : _s(m['status']),
        badgeTone: switch (_s(m['status'])) {
          'approved' || 'balanced' => PhoneTone.ok,
          'cancelled' => PhoneTone.bad,
          _ => PhoneTone.warn,
        },
        onTap: () => Navigator.of(ctx).push(MaterialPageRoute(
            builder: (_) => PhoneDocDetailScreen(
                title: _s(m['code'] ?? m['id']),
                subtitle: t('Phiếu kiểm kho'),
                doc: m))),
      ),
    );
  }
}

/// CHI TIẾT CHỨNG TỪ dùng chung cho phiếu nhập / chuyển / kiểm kho — cả ba đều
/// có cùng hình dạng: thông tin đầu phiếu + danh sách dòng hàng.
class PhoneDocDetailScreen extends StatelessWidget {
  final String title;
  final String subtitle;
  final Map<String, dynamic> doc;

  const PhoneDocDetailScreen(
      {super.key,
      required this.title,
      required this.subtitle,
      required this.doc});

  @override
  Widget build(BuildContext context) {
    final lines = (doc['items'] ?? doc['lines']) as List? ?? const [];
    return Scaffold(
      backgroundColor: DanColors.bg,
      body: SafeArea(
        bottom: false,
        child: Column(
          children: [
            PhoneHeader(
              title: title,
              subtitle: subtitle,
              onBack: () => Navigator.of(context).maybePop(),
            ),
            Expanded(
              child: ListView(
                padding: const EdgeInsets.only(top: 12, bottom: 20),
                children: [
                  PhoneInfoCard(
                    title: t('THÔNG TIN PHIẾU'),
                    rows: [
                      if (_s(doc['status']).isNotEmpty)
                        (t('Trạng thái'), _s(doc['status'])),
                      if (_s(doc['created_at'] ?? doc['date']).isNotEmpty)
                        (
                          t('Ngày lập'),
                          BusinessDateTime.dateTime(
                              doc['created_at'] ?? doc['date'],
                              fallback: _s(doc['created_at'] ?? doc['date']))
                        ),
                      if (_s(doc['created_by'] ?? doc['staff']).isNotEmpty)
                        (t('Người lập'), _s(doc['created_by'] ?? doc['staff'])),
                      if (_n(doc['total']) > 0)
                        (t('Tổng giá trị'), phoneMoney(_n(doc['total']))),
                      if (_s(doc['note']).isNotEmpty)
                        (t('Ghi chú'), _s(doc['note'])),
                    ],
                  ),
                  if (lines.isNotEmpty) ...[
                    PhoneSectionTitle(t('Dòng hàng')),
                    for (final raw in lines.whereType<Map>())
                      PhoneListRow(
                        title: _s(raw['name'] ?? raw['sku_name']),
                        subtitle:
                            '${phoneInt(_n(raw['qty'] ?? raw['quantity']))} ${_s(raw['unit'])}',
                        amount: _n(raw['total'] ?? raw['line_total']) > 0
                            ? phoneMoney(_n(raw['total'] ?? raw['line_total']))
                            : null,
                      ),
                  ] else
                    Padding(
                      padding: const EdgeInsets.only(top: 20),
                      child: PhoneEmpty(
                          title: t('Phiếu chưa có dòng hàng'),
                          hint: t('Mở bản desktop để chỉnh sửa phiếu'),
                          icon: Icons.list_alt_outlined),
                    ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
