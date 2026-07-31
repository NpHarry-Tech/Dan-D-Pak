import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../services/api_service.dart';
import '../../ui/app_theme.dart';
import '../../utils/translation.dart';
import '../management/management_widgets.dart';
import 'phone_kit.dart';
import 'phone_scaffolds.dart';

/// CÁC MÀN TẠO/SỬA bản điện thoại.
///
/// Mỗi biểu mẫu chỉ gửi lên ĐÚNG những trường server đọc — đối chiếu trực tiếp
/// với `server/services/*.js`, không gửi thừa khoá vô nghĩa:
///   - Chi phí  : createExpense() đọc amount, source, category_id/category_name,
///                payee_id, expense_date, note, method.
///   - Đối tác  : upsertCustomer() đọc name (BẮT BUỘC), code, phone, email,
///                tax_code, company, address, partner_type, note.

num _n(dynamic v) {
  if (v is num) return v;
  return num.tryParse('${v ?? ''}'.replaceAll('.', '').replaceAll(',', '')) ?? 0;
}

String _s(dynamic v) => '${v ?? ''}';

/// Khung biểu mẫu dùng chung: tiêu đề, nội dung cuộn, nút Lưu ghim đáy, và
/// CHỐNG BẤM ĐÔI khi mạng chậm.
class _FormShell extends StatelessWidget {
  final String title;
  final List<Widget> children;
  final bool saving;
  final VoidCallback? onSave;

  const _FormShell({
    required this.title,
    required this.children,
    required this.saving,
    required this.onSave,
  });

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: DanColors.bg,
      body: SafeArea(
        bottom: false,
        child: Column(
          children: [
            PhoneHeader(
              title: t(title),
              onBack: () => Navigator.of(context).maybePop(),
            ),
            Expanded(
              child: ListView(
                padding: const EdgeInsets.only(top: 12, bottom: 20),
                children: children,
              ),
            ),
            PhoneActionBar(
              child: PhoneCta(
                label: t('Lưu'),
                busy: saving,
                onPressed: saving ? null : onSave,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

// ── THÊM / SỬA CHI PHÍ ──────────────────────────────────────────────────────
class PhoneExpenseFormScreen extends StatefulWidget {
  /// Có [expense] = sửa, không có = thêm mới.
  final Map<String, dynamic>? expense;
  const PhoneExpenseFormScreen({super.key, this.expense});

  @override
  State<PhoneExpenseFormScreen> createState() => _PhoneExpenseFormScreenState();
}

class _PhoneExpenseFormScreenState extends State<PhoneExpenseFormScreen> {
  final _amount = TextEditingController();
  final _payee = TextEditingController();
  final _note = TextEditingController();

  String _source = 'direct'; // 'direct' | 'drawer' — khớp SOURCES ở server
  String _categoryId = '';
  String _categoryName = '';
  List<Map<String, dynamic>> _categories = [];
  bool _saving = false;

  bool get _isEdit => widget.expense != null;

  @override
  void initState() {
    super.initState();
    final e = widget.expense;
    if (e != null) {
      _amount.text = _n(e['amount']).round().toString();
      _payee.text = _s(e['payee_name']);
      _note.text = _s(e['note']);
      _source = _s(e['source']) == 'drawer' ? 'drawer' : 'direct';
      _categoryId = _s(e['category_id']);
      _categoryName = _s(e['category_name']);
    }
    _loadCategories();
  }

  @override
  void dispose() {
    _amount.dispose();
    _payee.dispose();
    _note.dispose();
    super.dispose();
  }

  Future<void> _loadCategories() async {
    try {
      final rows = await context.read<ApiService>().getExpenseCategories();
      if (!mounted) return;
      setState(() => _categories = rows
          .whereType<Map>()
          .map((e) => Map<String, dynamic>.from(e))
          .toList());
    } catch (_) {/* thiếu danh mục không chặn ghi chi phí */}
  }

  Future<void> _save() async {
    final amount = _n(_amount.text);
    // Server cũng chặn (createExpense ném "Số tiền chi phải lớn hơn 0"), nhưng
    // chặn tại chỗ để người dùng biết ngay thay vì chờ một vòng mạng.
    if (amount <= 0) {
      appToast(context, t('Số tiền chi phải lớn hơn 0'), isError: true);
      return;
    }
    setState(() => _saving = true);
    try {
      final api = context.read<ApiService>();
      final body = <String, dynamic>{
        'amount': amount.round(),
        'source': _source,
        if (_categoryId.isNotEmpty) 'category_id': _categoryId,
        if (_categoryId.isEmpty && _categoryName.isNotEmpty)
          'category_name': _categoryName,
        'note': _note.text.trim(),
      };
      if (_isEdit) {
        await api.updateExpense(_s(widget.expense!['id']), body);
      } else {
        await api.createExpense(body);
      }
      if (!mounted) return;
      Navigator.of(context).pop(true);
    } catch (e) {
      if (!mounted) return;
      setState(() => _saving = false);
      appToast(context, e.toString().replaceFirst('Exception: ', ''),
          isError: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    return _FormShell(
      title: _isEdit ? 'Sửa chi phí' : 'Thêm chi phí',
      saving: _saving,
      onSave: _save,
      children: [
        PhoneField(
          label: 'Số tiền',
          required: true,
          hint: '0',
          controller: _amount,
          keyboardType: TextInputType.number,
        ),
        PhoneField(
          label: 'Chi cho',
          hint: 'Tên người / đơn vị nhận',
          controller: _payee,
        ),
        PhoneField(
          label: 'Danh mục',
          value: _categoryName,
          hint: 'Chọn danh mục',
          onTap: _categories.isEmpty
              ? null
              : () async {
                  await showPhoneSheet<void>(
                    context: context,
                    title: t('Danh mục chi phí'),
                    builder: (c) => PhonePickList(
                      options:
                          _categories.map((e) => _s(e['name'])).toList(),
                      selected: _categoryName,
                      onPick: (v) {
                        Navigator.of(c).pop();
                        final hit = _categories
                            .firstWhere((e) => _s(e['name']) == v);
                        setState(() {
                          _categoryName = v;
                          _categoryId = _s(hit['id']);
                        });
                      },
                    ),
                  );
                },
        ),
        PhoneField(
          label: 'Nguồn chi',
          value: _source == 'drawer' ? t('Chi từ két') : t('Chi trực tiếp'),
          onTap: () async {
            await showPhoneSheet<void>(
              context: context,
              title: t('Nguồn chi'),
              builder: (c) => PhonePickList(
                options: [t('Chi trực tiếp'), t('Chi từ két')],
                selected:
                    _source == 'drawer' ? t('Chi từ két') : t('Chi trực tiếp'),
                onPick: (v) {
                  Navigator.of(c).pop();
                  setState(() =>
                      _source = v == t('Chi từ két') ? 'drawer' : 'direct');
                },
              ),
            );
          },
        ),
        PhoneField(label: 'Ghi chú', hint: 'Không bắt buộc', controller: _note),
        Padding(
          padding: const EdgeInsets.all(16),
          child: Text(
              t('Chọn "Chi từ két" sẽ trừ thẳng vào tiền mặt của ca đang mở và hiện trong đối chiếu cuối ca.'),
              style: const TextStyle(
                  fontSize: 11.5, height: 1.5, color: DanColors.faint)),
        ),
      ],
    );
  }
}

// ── THÊM / SỬA ĐỐI TÁC (khách hàng · nhà cung cấp) ──────────────────────────
class PhonePartnerFormScreen extends StatefulWidget {
  final bool isCustomer;
  final Map<String, dynamic>? partner;
  const PhonePartnerFormScreen(
      {super.key, required this.isCustomer, this.partner});

  @override
  State<PhonePartnerFormScreen> createState() => _PhonePartnerFormScreenState();
}

class _PhonePartnerFormScreenState extends State<PhonePartnerFormScreen> {
  final _name = TextEditingController();
  final _phone = TextEditingController();
  final _email = TextEditingController();
  final _company = TextEditingController();
  final _taxCode = TextEditingController();
  final _address = TextEditingController();
  final _note = TextEditingController();
  bool _saving = false;

  bool get _isEdit => widget.partner != null;

  @override
  void initState() {
    super.initState();
    final p = widget.partner;
    if (p != null) {
      _name.text = _s(p['name']);
      _phone.text = _s(p['phone']);
      _email.text = _s(p['email']);
      _company.text = _s(p['company']);
      _taxCode.text = _s(p['tax_code']);
      _address.text = _s(p['address']);
      _note.text = _s(p['note']);
    }
  }

  @override
  void dispose() {
    for (final c in [
      _name, _phone, _email, _company, _taxCode, _address, _note
    ]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _save() async {
    if (_name.text.trim().isEmpty) {
      appToast(context, t('Thiếu tên liên hệ'), isError: true);
      return;
    }
    setState(() => _saving = true);
    try {
      await context.read<ApiService>().upsertPartner({
        if (_isEdit) 'id': _s(widget.partner!['id']),
        'name': _name.text.trim(),
        'phone': _phone.text.trim(),
        'email': _email.text.trim(),
        'company': _company.text.trim(),
        'tax_code': _taxCode.text.trim(),
        'address': _address.text.trim(),
        'note': _note.text.trim(),
        // partner_type quyết định đối tác này hiện ở danh sách Khách hàng hay
        // Nhà cung cấp (customers.partner_type trên server).
        'partner_type': widget.isCustomer ? 'customer' : 'supplier',
      });
      if (!mounted) return;
      Navigator.of(context).pop(true);
    } catch (e) {
      if (!mounted) return;
      setState(() => _saving = false);
      appToast(context, e.toString().replaceFirst('Exception: ', ''),
          isError: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    final what = widget.isCustomer ? 'khách hàng' : 'nhà cung cấp';
    return _FormShell(
      title: _isEdit ? 'Sửa $what' : 'Thêm $what',
      saving: _saving,
      onSave: _save,
      children: [
        PhoneField(
            label: 'Tên', required: true, hint: 'Bắt buộc', controller: _name),
        PhoneField(
            label: 'Điện thoại',
            controller: _phone,
            keyboardType: TextInputType.phone),
        PhoneField(
            label: 'Email',
            controller: _email,
            keyboardType: TextInputType.emailAddress),
        PhoneField(label: 'Công ty', controller: _company),
        PhoneField(label: 'Mã số thuế', controller: _taxCode),
        PhoneField(label: 'Địa chỉ', controller: _address),
        PhoneField(label: 'Ghi chú', controller: _note),
      ],
    );
  }
}

// ── BÁO CÁO ─────────────────────────────────────────────────────────────────
/// Danh mục báo cáo lấy từ server (`/api/reports/catalog`) rồi xem trước từng
/// báo cáo — KHÔNG cắm cứng danh sách báo cáo ở client, vì server mới là nơi
/// quyết định người dùng được xem báo cáo nào.
class PhoneReportsScreen extends StatelessWidget {
  const PhoneReportsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return PhoneListScaffold<Map<String, dynamic>>(
      title: 'Báo cáo',
      emptyTitle: 'Không có báo cáo nào',
      emptyHint: 'Tài khoản của bạn chưa được cấp báo cáo nào',
      emptyIcon: Icons.bar_chart_outlined,
      fetch: (_) async {
        final res = await context.read<ApiService>().getReportsCatalog();
        final raw = (res['reports'] ?? res['items'] ?? res['catalog']) as List?;
        return (raw ?? const [])
            .whereType<Map>()
            .map((e) => Map<String, dynamic>.from(e))
            .toList();
      },
      rowBuilder: (ctx, r, _) => PhoneListRow(
        title: _s(r['label']).isEmpty ? _s(r['name']) : _s(r['label']),
        subtitle: _s(r['description']),
        onTap: () => Navigator.of(ctx).push(MaterialPageRoute(
            builder: (_) => PhoneReportPreviewScreen(
                type: _s(r['type']).isEmpty ? _s(r['key']) : _s(r['type']),
                title: _s(r['label']).isEmpty ? _s(r['name']) : _s(r['label'])))),
      ),
    );
  }
}

class PhoneReportPreviewScreen extends StatefulWidget {
  final String type;
  final String title;
  const PhoneReportPreviewScreen(
      {super.key, required this.type, required this.title});

  @override
  State<PhoneReportPreviewScreen> createState() =>
      _PhoneReportPreviewScreenState();
}

class _PhoneReportPreviewScreenState extends State<PhoneReportPreviewScreen> {
  Map<String, dynamic>? _data;
  bool _loading = true;
  String? _error;
  String _period = 'today';

  static const _periods = {
    'today': 'Hôm nay',
    'yesterday': 'Hôm qua',
    'week': 'Tuần này',
    'month': 'Tháng này',
  };

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    try {
      final r = await context
          .read<ApiService>()
          .getReportPreview(widget.type, period: _period);
      if (!mounted) return;
      setState(() {
        _data = r;
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
    final rows = (_data?['rows'] ?? _data?['items']) as List? ?? const [];
    final columns = (_data?['columns'] ?? _data?['headers']) as List? ?? const [];
    return Scaffold(
      backgroundColor: DanColors.bg,
      body: SafeArea(
        bottom: false,
        child: Column(
          children: [
            Container(
              color: DanColors.surface,
              child: Column(
                children: [
                  PhoneHeader(
                    title: widget.title,
                    onBack: () => Navigator.of(context).maybePop(),
                    actions: [
                      PhoneIconButton(icon: Icons.refresh, onTap: _load),
                    ],
                  ),
                  Padding(
                    padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
                    child: Row(
                      children: [
                        PhoneChip(
                          label: t(_periods[_period] ?? _period),
                          active: true,
                          caret: true,
                          onTap: () async {
                            await showPhoneSheet<void>(
                              context: context,
                              title: t('Kỳ báo cáo'),
                              builder: (c) => PhonePickList(
                                options: _periods.values.map(t).toList(),
                                selected: t(_periods[_period] ?? ''),
                                onPick: (v) {
                                  Navigator.of(c).pop();
                                  final key = _periods.entries
                                      .firstWhere((e) => t(e.value) == v)
                                      .key;
                                  setState(() => _period = key);
                                  _load();
                                },
                              ),
                            );
                          },
                        ),
                      ],
                    ),
                  ),
                ],
              ),
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
                      : rows.isEmpty
                          ? PhoneEmpty(
                              title: t('Kỳ này chưa có số liệu'),
                              hint: t('Chọn kỳ khác để xem'),
                              icon: Icons.bar_chart_outlined)
                          : ListView(
                              padding: const EdgeInsets.only(bottom: 20),
                              children: [
                                for (final raw in rows.whereType<Map>())
                                  _reportRow(
                                      Map<String, dynamic>.from(raw), columns),
                              ],
                            ),
            ),
          ],
        ),
      ),
    );
  }

  /// Báo cáo có hình dạng KHÁC NHAU tuỳ loại, nên dựng theo cột server khai báo
  /// thay vì đoán tên trường. Không có `columns` thì hiện hai trường đầu.
  Widget _reportRow(Map<String, dynamic> row, List columns) {
    if (columns.isNotEmpty) {
      final keys = columns
          .map((c) => c is Map ? _s(c['key'] ?? c['field']) : _s(c))
          .where((k) => k.isNotEmpty)
          .toList();
      if (keys.isNotEmpty) {
        return PhoneListRow(
          title: _s(row[keys.first]),
          subtitle: keys.length > 2
              ? keys.sublist(1, keys.length - 1).map((k) => _s(row[k])).join(' · ')
              : '',
          amount: keys.length > 1 ? _s(row[keys.last]) : null,
        );
      }
    }
    final entries = row.entries.toList();
    return PhoneListRow(
      title: entries.isNotEmpty ? _s(entries.first.value) : '',
      amount: entries.length > 1 ? _s(entries[1].value) : null,
    );
  }
}
