import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';
import 'package:share_plus/share_plus.dart';

import '../../providers/auth_provider.dart';
import '../../services/api_service.dart';
import '../../ui/app_theme.dart';
import '../../ui/file_pick.dart';
import '../../ui/format.dart';
import '../../widgets/dan_datetime_picker.dart';
import '../../widgets/dan_top_bar.dart';
import '../management/management_widgets.dart';
import '../shift_dialog.dart';
import '../../utils/business_datetime.dart';
import '../../utils/translation.dart';

String _s(dynamic v) => v?.toString() ?? '';
num _n(dynamic v) => v is num ? v : num.tryParse(_s(v)) ?? 0;

final _ymd = DateFormat('yyyy-MM-dd');

List<List<String>> get _sourceFilters => [
      ['', t('Tất cả')],
      ['drawer', t('Tiền két')],
      ['direct', t('Chi trực tiếp')],
    ];

/// Native port of the web Chi phí (expenses.html): expense log with category
/// breakdown, source/date filters and create/edit.
class ExpensesScreen extends StatefulWidget {
  ExpensesScreen({super.key});

  @override
  State<ExpensesScreen> createState() => _ExpensesScreenState();
}

class _ExpensesScreenState extends State<ExpensesScreen> {
  List<Map<String, dynamic>> _expenses = [];
  Map<String, dynamic> _summary = {};
  List<Map<String, dynamic>> _categories = [];
  String _source = '';
  String _categoryFilter = '';
  late DateTime _from;
  late DateTime _to;
  bool _loading = true;
  // Đổi bộ lọc (nguồn/danh mục/khoảng ngày) không được xoá cả sidebar+bảng để
  // hiện spinner toàn màn khi bộ lọc đang chọn có sẵn 0 kết quả.
  bool _hasLoadedOnce = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    final now = DateTime.now();
    _from = DateTime(now.year, now.month, 1);
    _to = now;
    _loadCategories();
    _load();
  }

  Future<void> _loadCategories() async {
    try {
      final rows = await context.read<ApiService>().getExpenseCategories();
      if (!mounted) return;
      setState(() => _categories = rows
          .whereType<Map>()
          .map((e) => Map<String, dynamic>.from(e))
          .toList());
    } catch (_) {}
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    try {
      final res = await context.read<ApiService>().getExpenses(
            from: _ymd.format(_from),
            to: _ymd.format(_to),
            source: _source,
            categoryId: _categoryFilter,
          );
      if (!mounted) return;
      setState(() {
        _expenses = (res['expenses'] is List)
            ? (res['expenses'] as List)
                .whereType<Map>()
                .map((e) => Map<String, dynamic>.from(e))
                .toList()
            : [];
        _summary = res['summary'] is Map
            ? Map<String, dynamic>.from(res['summary'])
            : {};
        _loading = false;
        _hasLoadedOnce = true;
        _error = null;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.toString().replaceFirst('Exception: ', '');
        _loading = false;
        _hasLoadedOnce = true;
      });
    }
  }

  Future<void> _openForm([Map<String, dynamic>? expense]) async {
    final saved = await showDialog<bool>(
      context: context,
      builder: (_) => _ExpenseForm(
        api: context.read<ApiService>(),
        expense: expense,
        categories: _categories,
      ),
    );
    if (saved == true) {
      _loadCategories();
      _load();
    }
  }

  Future<void> _openDetail(Map<String, dynamic> e) async {
    final action = await showDialog<String>(
      context: context,
      builder: (_) => _ExpenseDetailDialog(expense: e),
    );
    if (action == 'edit' && mounted) _openForm(e);
    if (action == 'reload' && mounted) _load();
  }

  Future<void> _delete(Map<String, dynamic> e) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: DanColors.surface,
        title: Text(t('Xóa chi phí')),
        content: Text('Xóa khoản chi ${Fmt.money(_n(e['amount']))}?'),
        actions: [
          TextButton(
              onPressed: () => Navigator.of(ctx).pop(false),
              child: Text(t('Hủy'))),
          FilledButton(
            onPressed: () => Navigator.of(ctx).pop(true),
            style: FilledButton.styleFrom(backgroundColor: DanColors.late),
            child: Text(t('Xóa')),
          ),
        ],
      ),
    );
    if (ok != true || !mounted) return;
    try {
      await context.read<ApiService>().deleteExpense(_s(e['id']));
      _load();
    } catch (err) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(
            content: Text(err.toString().replaceFirst('Exception: ', '')),
            backgroundColor: DanColors.late));
      }
    }
  }

  Future<void> _pickDate(bool isFrom) async {
    final picked = await showDatePicker(
      context: context,
      initialDate: isFrom ? _from : _to,
      firstDate: DateTime(2020),
      lastDate: DateTime(2100),
    );
    if (picked == null) return;
    setState(() {
      if (isFrom) {
        _from = picked;
      } else {
        _to = picked;
      }
    });
    _load();
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final user = auth.currentUser;
    final branch = auth.selectedBranch;

    return Scaffold(
      backgroundColor: DanColors.bg,
      appBar: DanModuleTopBar(
        brandName: branch.name.isNotEmpty ? branch.name : branch.id,
        title: t('Chi phí'),
        subtitle: '',
        titleIcon: Icons.receipt_long_outlined,
        userName: user?.name ?? '—',
        userRole: roleLabel(user?.role ?? ''),
        online: true,
        onBack: () => Navigator.of(context).maybePop(),
        onLogout: () => auth.logout(),
        actions: [
          DanTopBarButton(
            onPressed: () async {
              final ok = await showDialog<bool>(
                  context: context, builder: (_) => CashReimbursementDialog());
              if (ok == true) _load();
            },
            icon: Icons.assignment_return_outlined,
            label: t('Hoàn chi két'),
          ),
          DanTopBarButton(
            onPressed: () => _openForm(),
            icon: Icons.add,
            label: t('Thêm chi phí'),
          ),
        ],
      ),
      body: Column(
        children: [
          _filterBar(),
          Divider(height: 1, color: DanColors.border),
          Expanded(child: _body()),
        ],
      ),
    );
  }

  Widget _filterBar() {
    return Padding(
      padding: EdgeInsets.all(14),
      child: Wrap(
        spacing: 8,
        runSpacing: 8,
        crossAxisAlignment: WrapCrossAlignment.center,
        children: [
          for (final f in _sourceFilters)
            ChoiceChip(
              label: Text(f[1]),
              selected: _source == f[0],
              onSelected: (_) {
                setState(() => _source = f[0]);
                _load();
              },
            ),
          SizedBox(
            width: 180,
            child: DropdownButtonFormField<String>(
              initialValue: _categoryFilter,
              isExpanded: true,
              decoration: InputDecoration(isDense: true),
              items: [
                DropdownMenuItem(value: '', child: Text(t('Tất cả danh mục'))),
                for (final c in _categories)
                  DropdownMenuItem(
                      value: _s(c['id']),
                      child:
                          Text(_s(c['name']), overflow: TextOverflow.ellipsis)),
              ],
              onChanged: (v) {
                setState(() => _categoryFilter = v ?? '');
                _load();
              },
            ),
          ),
          OutlinedButton.icon(
            onPressed: () => _pickDate(true),
            icon: Icon(Icons.calendar_today, size: 14),
            label: Text(t('Từ ${_ymd.format(_from)}')),
            style: OutlinedButton.styleFrom(minimumSize: Size(0, 40)),
          ),
          OutlinedButton.icon(
            onPressed: () => _pickDate(false),
            icon: Icon(Icons.event, size: 14),
            label: Text(t('Đến ${_ymd.format(_to)}')),
            style: OutlinedButton.styleFrom(minimumSize: Size(0, 40)),
          ),
        ],
      ),
    );
  }

  Widget _body() {
    if (_loading && !_hasLoadedOnce) {
      return Center(child: CircularProgressIndicator());
    }
    if (_error != null && !_hasLoadedOnce) {
      return Padding(
        padding: EdgeInsets.all(40),
        child: InlineMessage(t('Không tải được chi phí ($_error)'),
            error: true, onRetry: _load),
      );
    }
    final total = _n(_summary['total']);
    final cats = (_summary['categories'] is List)
        ? (_summary['categories'] as List).whereType<Map>().toList()
        : [];
    final maxCat =
        cats.fold<num>(1, (m, c) => _n(c['amount']) > m ? _n(c['amount']) : m);

    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        padding: EdgeInsets.all(16),
        children: [
          Container(
            padding: EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: DanColors.surface,
              border: Border.all(color: DanColors.border),
              borderRadius: BorderRadius.circular(DanRadius.lg),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Row(
                  children: [
                    Text(t('Tổng chi trong kỳ'),
                        style: TextStyle(
                            fontSize: 13, fontWeight: FontWeight.w700)),
                    Spacer(),
                    Text(Fmt.money(total),
                        style: TextStyle(
                            fontSize: 20,
                            fontWeight: FontWeight.w900,
                            color: DanColors.late)),
                  ],
                ),
                if (cats.isNotEmpty) ...[
                  SizedBox(height: 12),
                  for (final c in cats)
                    StatBarRow(
                      label: _s(c['name']),
                      value: _n(c['amount']),
                      total: maxCat,
                      color: DanColors.late,
                      valueText: Fmt.money(_n(c['amount'])),
                    ),
                ],
              ],
            ),
          ),
          SizedBox(height: 16),
          if (_expenses.isEmpty)
            Padding(
              padding: EdgeInsets.symmetric(vertical: 30),
              child: Center(
                  child: Text(t('Chưa có khoản chi nào'),
                      style: TextStyle(color: DanColors.faint))),
            )
          else
            for (final e in _expenses) ...[
              _row(e),
              SizedBox(height: 8),
            ],
        ],
      ),
    );
  }

  Widget _row(Map<String, dynamic> e) {
    final drawer = _s(e['source']) == 'drawer';
    final date = DateTime.tryParse(_s(e['expense_date']));
    return InkWell(
      onTap: () => _openDetail(e),
      borderRadius: BorderRadius.circular(DanRadius.md),
      child: Container(
        padding: EdgeInsets.symmetric(horizontal: 14, vertical: 12),
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
                  Row(
                    children: [
                      Flexible(
                        child: Text(
                            _s(e['category_name']).isEmpty
                                ? t('— Khác')
                                : _s(e['category_name']),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(
                                fontSize: 14, fontWeight: FontWeight.w800)),
                      ),
                      SizedBox(width: 6),
                      Container(
                        padding:
                            EdgeInsets.symmetric(horizontal: 7, vertical: 2),
                        decoration: BoxDecoration(
                            color: (drawer ? DanColors.doing : DanColors.brand)
                                .withValues(alpha: .13),
                            borderRadius: BorderRadius.circular(5)),
                        child: Text(drawer ? t('Tiền két') : t('Trực tiếp'),
                            style: TextStyle(
                                fontSize: 10.5,
                                fontWeight: FontWeight.w800,
                                color: drawer
                                    ? Color(0xFFB45309)
                                    : DanColors.brand)),
                      ),
                    ],
                  ),
                  SizedBox(height: 3),
                  Text(
                    [
                      if (_s(e['payee_name']).isNotEmpty) _s(e['payee_name']),
                      if (date != null) Fmt.dmyHm(date).substring(6),
                      if (_s(e['note']).isNotEmpty) _s(e['note']),
                    ].join('  ·  '),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(fontSize: 12, color: DanColors.faint),
                  ),
                ],
              ),
            ),
            Text(Fmt.money(_n(e['amount'])),
                style: TextStyle(
                    fontSize: 14.5,
                    fontWeight: FontWeight.w900,
                    color: DanColors.late)),
            IconButton(
              onPressed: () => _delete(e),
              visualDensity: VisualDensity.compact,
              icon:
                  Icon(Icons.delete_outline, size: 18, color: DanColors.faint),
            ),
          ],
        ),
      ),
    );
  }
}

class _ExpenseForm extends StatefulWidget {
  final ApiService api;
  final Map<String, dynamic>? expense;
  final List<Map<String, dynamic>> categories;
  _ExpenseForm({required this.api, this.expense, required this.categories});

  @override
  State<_ExpenseForm> createState() => _ExpenseFormState();
}

class _ExpenseFormState extends State<_ExpenseForm> {
  late String _source;
  String _method = 'cash';
  String? _categoryId;
  final _amount = TextEditingController();
  final _note = TextEditingController();
  final _payee = TextEditingController();
  String? _image;
  late DateTime _date;
  bool _saving = false;

  bool get _isEdit => widget.expense != null;

  @override
  void initState() {
    super.initState();
    final e = widget.expense;
    _source = _s(e?['source']).isNotEmpty ? _s(e?['source']) : 'drawer';
    final rawMethod = _s(e?['method']);
    _method = {'cash', 'transfer'}.contains(rawMethod) ? rawMethod : 'cash';
    _categoryId = _s(e?['category_id']).isNotEmpty
        ? _s(e?['category_id'])
        : (widget.categories.isNotEmpty
            ? _s(widget.categories.first['id'])
            : null);
    _amount.text =
        _n(e?['amount']) > 0 ? _n(e?['amount']).round().toString() : '';
    _note.text = _s(e?['note']);
    _payee.text = _s(e?['payee_name']);
    _image = _s(e?['invoice_image']).isEmpty ? null : _s(e?['invoice_image']);
    _date =
        BusinessDateTime.parseApi(e?['expense_date']) ?? BusinessDateTime.now();
  }

  @override
  void dispose() {
    _amount.dispose();
    _note.dispose();
    _payee.dispose();
    super.dispose();
  }

  Future<void> _pickImage() async {
    final data = await pickReceiptAsDataUrl();
    if (data != null && mounted) setState(() => _image = data);
  }

  Future<void> _addCategory() async {
    final ctrl = TextEditingController();
    final name = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: DanColors.surface,
        title: Text(t('Danh mục mới')),
        content: TextField(
            controller: ctrl,
            autofocus: true,
            decoration: InputDecoration(labelText: t('Tên danh mục'))),
        actions: [
          TextButton(
              onPressed: () => Navigator.of(ctx).pop(), child: Text(t('Hủy'))),
          FilledButton(
              onPressed: () => Navigator.of(ctx).pop(ctrl.text.trim()),
              child: Text(t('Tạo'))),
        ],
      ),
    );
    if (name == null || name.isEmpty) return;
    try {
      final c = await widget.api.upsertExpenseCategory({'name': name});
      setState(() {
        widget.categories.add(c);
        _categoryId = _s(c['id']);
      });
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(
            content: Text(e.toString().replaceFirst('Exception: ', '')),
            backgroundColor: DanColors.late));
      }
    }
  }

  Future<void> _save() async {
    final amount = num.tryParse(_amount.text.trim()) ?? 0;
    if (amount <= 0) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text(t('Nhập số tiền')), backgroundColor: DanColors.late));
      return;
    }
    final body = {
      'source': _source,
      'method': _source == 'direct' ? _method : 'cash',
      'category_id': _categoryId,
      'amount': amount,
      'expense_date': BusinessDateTime.toApiUtc(_date),
      'note': _note.text.trim(),
      'payee_name': _payee.text.trim(),
      'invoice_image': _image ?? '',
    };
    setState(() => _saving = true);
    try {
      if (_isEdit) {
        await widget.api.updateExpense(_s(widget.expense!['id']), body);
      } else {
        await widget.api.createExpense(body);
      }
      if (mounted) Navigator.of(context).pop(true);
    } catch (e) {
      if (mounted) {
        setState(() => _saving = false);
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(
            content: Text(e.toString().replaceFirst('Exception: ', '')),
            backgroundColor: DanColors.late));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      backgroundColor: DanColors.surface,
      title: Text(_isEdit ? t('Sửa chi phí') : t('Thêm chi phí'),
          style: TextStyle(fontWeight: FontWeight.w900, fontSize: 18)),
      content: SizedBox(
        width: dialogWidth(context, 400),
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Wrap(
                spacing: 8,
                children: [
                  for (final src in [
                    ['drawer', t('Tiền két')],
                    ['direct', t('Chi trực tiếp')],
                  ])
                    ChoiceChip(
                      label: Text(src[1]),
                      selected: _source == src[0],
                      onSelected: (_) => setState(() => _source = src[0]),
                    ),
                ],
              ),
              if (_source == 'direct') ...[
                SizedBox(height: 12),
                DropdownButtonFormField<String>(
                  initialValue: _method,
                  decoration: InputDecoration(labelText: t('Hình thức')),
                  items: [
                    DropdownMenuItem(value: 'cash', child: Text(t('Tiền mặt'))),
                    DropdownMenuItem(
                        value: 'transfer', child: Text(t('Chuyển khoản'))),
                  ],
                  onChanged: (v) => setState(() => _method = v ?? 'cash'),
                ),
              ],
              SizedBox(height: 12),
              Row(
                children: [
                  Expanded(
                    child: DropdownButtonFormField<String>(
                      initialValue: _categoryId,
                      isExpanded: true,
                      decoration: InputDecoration(labelText: t('Danh mục')),
                      items: [
                        for (final c in widget.categories)
                          DropdownMenuItem(
                              value: _s(c['id']),
                              child: Text(_s(c['name']),
                                  overflow: TextOverflow.ellipsis)),
                      ],
                      onChanged: (v) => setState(() => _categoryId = v),
                    ),
                  ),
                  IconButton(
                    onPressed: _addCategory,
                    icon: Icon(Icons.add_circle, color: DanColors.brand),
                    tooltip: t('Thêm danh mục'),
                  ),
                ],
              ),
              SizedBox(height: 12),
              TextField(
                controller: _amount,
                autofocus: true,
                keyboardType: TextInputType.number,
                decoration: InputDecoration(labelText: t('Số tiền')),
              ),
              SizedBox(height: 12),
              TextField(
                controller: _payee,
                decoration: InputDecoration(
                    labelText: t('Bên nhận / NCC'),
                    hintText: t('VD: Điện lực, Ahamove, cô Ba...')),
              ),
              SizedBox(height: 12),
              InkWell(
                onTap: () async {
                  final picked = await pickDanDateTime(context, initial: _date);
                  if (picked != null) setState(() => _date = picked);
                },
                child: InputDecorator(
                  decoration: InputDecoration(labelText: t('Ngày giờ chi')),
                  child: Text(Fmt.dmyHm(_date)),
                ),
              ),
              SizedBox(height: 12),
              TextField(
                controller: _note,
                decoration: InputDecoration(labelText: t('Lý do / Ghi chú')),
              ),
              SizedBox(height: 12),
              OutlinedButton.icon(
                onPressed: _pickImage,
                icon: Icon(_image == null
                    ? Icons.add_a_photo_outlined
                    : Icons.check_circle),
                label: Text(_image == null
                    ? t('Đính kèm ảnh hóa đơn')
                    : t('Đã có ảnh hóa đơn — đổi ảnh')),
                style: OutlinedButton.styleFrom(
                    minimumSize: const Size(double.infinity, 42),
                    foregroundColor:
                        _image == null ? DanColors.muted : DanColors.done),
              ),
            ],
          ),
        ),
      ),
      actions: [
        TextButton(
            onPressed: () => Navigator.of(context).pop(),
            child: Text(t('Hủy'))),
        FilledButton(
          onPressed: _saving ? null : _save,
          child: _saving
              ? SizedBox(
                  width: 18,
                  height: 18,
                  child: CircularProgressIndicator(
                      strokeWidth: 2, color: Colors.white))
              : Text(_isEdit ? t('Lưu') : t('Ghi chi phí')),
        ),
      ],
    );
  }
}

/// Chi tiết một khoản chi: hiện rõ mọi trường + ảnh hóa đơn (xem/tải) + in
/// phiếu chi. Khoản "Chi từ két" (from_drawer) chỉ đọc — không sửa/xoá ở đây.
class _ExpenseDetailDialog extends StatefulWidget {
  final Map<String, dynamic> expense;
  const _ExpenseDetailDialog({required this.expense});

  @override
  State<_ExpenseDetailDialog> createState() => _ExpenseDetailDialogState();
}

class _ExpenseDetailDialogState extends State<_ExpenseDetailDialog> {
  bool _printing = false;

  Map<String, dynamic> get e => widget.expense;
  bool get _fromDrawer =>
      e['from_drawer'] == true || _s(e['id']).startsWith('drawer:');

  Uint8List? _imageBytes() {
    final raw = _s(e['invoice_image']);
    if (raw.isEmpty) return null;
    try {
      final b64 = raw.contains(',') ? raw.split(',').last : raw;
      return base64Decode(b64);
    } catch (_) {
      return null;
    }
  }

  Future<void> _print() async {
    setState(() => _printing = true);
    try {
      await context.read<ApiService>().printExpenseVoucher(_s(e['id']));
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(t('Đã gửi in phiếu chi'))));
      }
    } catch (err) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(
            content: Text(err.toString().replaceFirst('Exception: ', '')),
            backgroundColor: DanColors.late));
      }
    } finally {
      if (mounted) setState(() => _printing = false);
    }
  }

  Future<void> _saveImage(Uint8List bytes) async {
    try {
      await Share.shareXFiles(
        [
          XFile.fromData(bytes,
              name: 'hoa-don-${_s(e['code'])}.png', mimeType: 'image/png')
        ],
        subject: t('Ảnh hóa đơn chi'),
      );
    } catch (_) {
      // Một số nền tảng (desktop) không có share sheet — bỏ qua im lặng.
    }
  }

  void _viewImage(Uint8List bytes) {
    showDialog<void>(
      context: context,
      builder: (_) => Dialog(
        backgroundColor: Colors.black,
        insetPadding: const EdgeInsets.all(16),
        child: Stack(
          children: [
            InteractiveViewer(
              maxScale: 5,
              child: Center(child: Image.memory(bytes)),
            ),
            Positioned(
              top: 4,
              right: 4,
              child: IconButton(
                icon: const Icon(Icons.close, color: Colors.white),
                onPressed: () => Navigator.of(context).pop(),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _kv(String k, String v) {
    if (v.trim().isEmpty) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
              width: 118,
              child: Text(k,
                  style:
                      const TextStyle(fontSize: 12.5, color: DanColors.muted))),
          Expanded(
              child: Text(v,
                  style: const TextStyle(
                      fontSize: 13, fontWeight: FontWeight.w600))),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final date = DateTime.tryParse(_s(e['expense_date']));
    final bytes = _imageBytes();
    return AlertDialog(
      backgroundColor: DanColors.surface,
      title: Row(children: [
        Expanded(
            child: Text(t('Chi tiết khoản chi'),
                style: const TextStyle(
                    fontWeight: FontWeight.w900, fontSize: 17))),
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
          decoration: BoxDecoration(
              color: (_fromDrawer ? DanColors.doing : DanColors.brand)
                  .withValues(alpha: .13),
              borderRadius: BorderRadius.circular(6)),
          child: Text(_fromDrawer ? t('Tiền két') : t('Trực tiếp'),
              style: TextStyle(
                  fontSize: 11,
                  fontWeight: FontWeight.w800,
                  color:
                      _fromDrawer ? const Color(0xFFB45309) : DanColors.brand)),
        ),
      ]),
      content: SizedBox(
        width: dialogWidth(context, 420),
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Center(
                child: Text(Fmt.money(_n(e['amount'])),
                    style: const TextStyle(
                        fontSize: 26,
                        fontWeight: FontWeight.w900,
                        color: DanColors.late)),
              ),
              const SizedBox(height: 12),
              _kv(t('Số phiếu'), _s(e['code'])),
              _kv(t('Người chi'), _s(e['actor_name'])),
              _kv(t('Ngày giờ chi'),
                  date != null ? Fmt.dmyHm(date) : _s(e['expense_date'])),
              _kv(t('Bên nhận / NCC'), _s(e['payee_name'])),
              _kv(t('Danh mục'), _s(e['category_name'])),
              _kv(
                  t('Hình thức'),
                  _s(e['method']) == 'transfer'
                      ? t('Chuyển khoản')
                      : t('Tiền mặt')),
              _kv(t('Lý do / Ghi chú'), _s(e['note'])),
              if (bytes != null) ...[
                const SizedBox(height: 12),
                const Divider(height: 1, color: DanColors.border),
                const SizedBox(height: 10),
                Row(children: [
                  Text(t('Ảnh hóa đơn'),
                      style: const TextStyle(
                          fontSize: 12.5, fontWeight: FontWeight.w700)),
                  const Spacer(),
                  TextButton.icon(
                    onPressed: () => _saveImage(bytes),
                    icon: const Icon(Icons.download, size: 16),
                    label: Text(t('Tải ảnh')),
                  ),
                ]),
                const SizedBox(height: 6),
                InkWell(
                  onTap: () => _viewImage(bytes),
                  child: ClipRRect(
                    borderRadius: BorderRadius.circular(DanRadius.md),
                    child: Image.memory(bytes,
                        height: 160, width: double.infinity, fit: BoxFit.cover),
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
      actions: [
        if (!_fromDrawer)
          TextButton.icon(
            onPressed: () => Navigator.of(context).pop('edit'),
            icon: const Icon(Icons.edit_outlined, size: 16),
            label: Text(t('Sửa')),
          ),
        OutlinedButton.icon(
          onPressed: _printing ? null : _print,
          icon: _printing
              ? const SizedBox(
                  width: 15,
                  height: 15,
                  child: CircularProgressIndicator(strokeWidth: 2))
              : const Icon(Icons.print_outlined, size: 16),
          label: Text(t('In phiếu chi')),
        ),
        FilledButton(
          onPressed: () => Navigator.of(context).pop(),
          child: Text(t('Đóng')),
        ),
      ],
    );
  }
}
