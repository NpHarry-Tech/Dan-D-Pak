import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';

import '../../providers/auth_provider.dart';
import '../../services/api_service.dart';
import '../../ui/app_theme.dart';
import '../../ui/format.dart';
import '../../widgets/dan_top_bar.dart';
import '../management/management_widgets.dart';

String _s(dynamic v) => v?.toString() ?? '';
num _n(dynamic v) => v is num ? v : num.tryParse(_s(v)) ?? 0;

final _ymd = DateFormat('yyyy-MM-dd');

const _sourceFilters = [
  ['', 'Tất cả'],
  ['drawer', 'Tiền két'],
  ['direct', 'Chi trực tiếp'],
];

/// Native port of the web Chi phí (expenses.html): expense log with category
/// breakdown, source/date filters and create/edit.
class ExpensesScreen extends StatefulWidget {
  const ExpensesScreen({super.key});

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

  Future<void> _delete(Map<String, dynamic> e) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: DanColors.surface,
        title: const Text('Xóa chi phí'),
        content: Text('Xóa khoản chi ${Fmt.money(_n(e['amount']))}?'),
        actions: [
          TextButton(
              onPressed: () => Navigator.of(ctx).pop(false),
              child: const Text('Hủy')),
          FilledButton(
            onPressed: () => Navigator.of(ctx).pop(true),
            style: FilledButton.styleFrom(backgroundColor: DanColors.late),
            child: const Text('Xóa'),
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
        title: 'Chi phí',
        subtitle: '',
        titleIcon: Icons.receipt_long_outlined,
        userName: user?.name ?? '—',
        userRole: roleLabel(user?.role ?? ''),
        online: true,
        onBack: () => Navigator.of(context).maybePop(),
        onLogout: () => auth.logout(),
        actions: [
          DanTopBarButton(
            onPressed: () => _openForm(),
            icon: Icons.add,
            label: 'Thêm chi phí',
          ),
        ],
      ),
      body: Column(
        children: [
          _filterBar(),
          const Divider(height: 1, color: DanColors.border),
          Expanded(child: _body()),
        ],
      ),
    );
  }

  Widget _filterBar() {
    return Padding(
      padding: const EdgeInsets.all(14),
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
              decoration: const InputDecoration(isDense: true),
              items: [
                const DropdownMenuItem(value: '', child: Text('Tất cả danh mục')),
                for (final c in _categories)
                  DropdownMenuItem(
                      value: _s(c['id']),
                      child: Text(_s(c['name']), overflow: TextOverflow.ellipsis)),
              ],
              onChanged: (v) {
                setState(() => _categoryFilter = v ?? '');
                _load();
              },
            ),
          ),
          OutlinedButton.icon(
            onPressed: () => _pickDate(true),
            icon: const Icon(Icons.calendar_today, size: 14),
            label: Text('Từ ${_ymd.format(_from)}'),
            style: OutlinedButton.styleFrom(minimumSize: const Size(0, 40)),
          ),
          OutlinedButton.icon(
            onPressed: () => _pickDate(false),
            icon: const Icon(Icons.event, size: 14),
            label: Text('Đến ${_ymd.format(_to)}'),
            style: OutlinedButton.styleFrom(minimumSize: const Size(0, 40)),
          ),
        ],
      ),
    );
  }

  Widget _body() {
    if (_loading && _expenses.isEmpty) {
      return const Center(child: CircularProgressIndicator());
    }
    if (_error != null && _expenses.isEmpty) {
      return Padding(
        padding: const EdgeInsets.all(40),
        child: InlineMessage('Không tải được chi phí ($_error)',
            error: true, onRetry: _load),
      );
    }
    final total = _n(_summary['total']);
    final cats = (_summary['categories'] is List)
        ? (_summary['categories'] as List).whereType<Map>().toList()
        : [];
    final maxCat = cats.fold<num>(1, (m, c) => _n(c['amount']) > m ? _n(c['amount']) : m);

    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Container(
            padding: const EdgeInsets.all(16),
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
                    const Text('Tổng chi trong kỳ',
                        style: TextStyle(
                            fontSize: 13, fontWeight: FontWeight.w700)),
                    const Spacer(),
                    Text(Fmt.money(total),
                        style: const TextStyle(
                            fontSize: 20,
                            fontWeight: FontWeight.w900,
                            color: DanColors.late)),
                  ],
                ),
                if (cats.isNotEmpty) ...[
                  const SizedBox(height: 12),
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
          const SizedBox(height: 16),
          if (_expenses.isEmpty)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 30),
              child: Center(
                  child: Text('Chưa có khoản chi nào',
                      style: TextStyle(color: DanColors.faint))),
            )
          else
            for (final e in _expenses) ...[
              _row(e),
              const SizedBox(height: 8),
            ],
        ],
      ),
    );
  }

  Widget _row(Map<String, dynamic> e) {
    final drawer = _s(e['source']) == 'drawer';
    final date = DateTime.tryParse(_s(e['expense_date']));
    return InkWell(
      onTap: () => _openForm(e),
      borderRadius: BorderRadius.circular(DanRadius.md),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
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
                                ? '— Khác'
                                : _s(e['category_name']),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                                fontSize: 14, fontWeight: FontWeight.w800)),
                      ),
                      const SizedBox(width: 6),
                      Container(
                        padding: const EdgeInsets.symmetric(
                            horizontal: 7, vertical: 2),
                        decoration: BoxDecoration(
                            color: (drawer ? DanColors.doing : DanColors.brand)
                                .withValues(alpha: .13),
                            borderRadius: BorderRadius.circular(5)),
                        child: Text(drawer ? 'Tiền két' : 'Trực tiếp',
                            style: TextStyle(
                                fontSize: 10.5,
                                fontWeight: FontWeight.w800,
                                color: drawer ? const Color(0xFFB45309) : DanColors.brand)),
                      ),
                    ],
                  ),
                  const SizedBox(height: 3),
                  Text(
                    [
                      if (_s(e['payee_name']).isNotEmpty) _s(e['payee_name']),
                      if (date != null) Fmt.dmyHm(date).substring(6),
                      if (_s(e['note']).isNotEmpty) _s(e['note']),
                    ].join('  ·  '),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontSize: 12, color: DanColors.faint),
                  ),
                ],
              ),
            ),
            Text(Fmt.money(_n(e['amount'])),
                style: const TextStyle(
                    fontSize: 14.5,
                    fontWeight: FontWeight.w900,
                    color: DanColors.late)),
            IconButton(
              onPressed: () => _delete(e),
              visualDensity: VisualDensity.compact,
              icon: const Icon(Icons.delete_outline,
                  size: 18, color: DanColors.faint),
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
  const _ExpenseForm(
      {required this.api, this.expense, required this.categories});

  @override
  State<_ExpenseForm> createState() => _ExpenseFormState();
}

class _ExpenseFormState extends State<_ExpenseForm> {
  late String _source;
  String _method = 'cash';
  String? _categoryId;
  final _amount = TextEditingController();
  final _note = TextEditingController();
  late DateTime _date;
  bool _saving = false;

  bool get _isEdit => widget.expense != null;

  @override
  void initState() {
    super.initState();
    final e = widget.expense;
    _source = _s(e?['source']).isNotEmpty ? _s(e?['source']) : 'drawer';
    final rawMethod = _s(e?['method']);
    _method = const {'cash', 'transfer'}.contains(rawMethod) ? rawMethod : 'cash';
    _categoryId = _s(e?['category_id']).isNotEmpty
        ? _s(e?['category_id'])
        : (widget.categories.isNotEmpty ? _s(widget.categories.first['id']) : null);
    _amount.text = _n(e?['amount']) > 0 ? _n(e?['amount']).round().toString() : '';
    _note.text = _s(e?['note']);
    _date = DateTime.tryParse(_s(e?['expense_date'])) ?? DateTime.now();
  }

  @override
  void dispose() {
    _amount.dispose();
    _note.dispose();
    super.dispose();
  }

  Future<void> _addCategory() async {
    final ctrl = TextEditingController();
    final name = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: DanColors.surface,
        title: const Text('Danh mục mới'),
        content: TextField(
            controller: ctrl,
            autofocus: true,
            decoration: const InputDecoration(labelText: 'Tên danh mục')),
        actions: [
          TextButton(
              onPressed: () => Navigator.of(ctx).pop(),
              child: const Text('Hủy')),
          FilledButton(
              onPressed: () => Navigator.of(ctx).pop(ctrl.text.trim()),
              child: const Text('Tạo')),
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
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
          content: Text('Nhập số tiền'), backgroundColor: DanColors.late));
      return;
    }
    final body = {
      'source': _source,
      'method': _source == 'direct' ? _method : 'cash',
      'category_id': _categoryId,
      'amount': amount,
      'expense_date': _ymd.format(_date),
      'note': _note.text.trim(),
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
      title: Text(_isEdit ? 'Sửa chi phí' : 'Thêm chi phí',
          style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 18)),
      content: SizedBox(
        width: 400,
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Wrap(
                spacing: 8,
                children: [
                  for (final src in const [
                    ['drawer', 'Tiền két'],
                    ['direct', 'Chi trực tiếp'],
                  ])
                    ChoiceChip(
                      label: Text(src[1]),
                      selected: _source == src[0],
                      onSelected: (_) => setState(() => _source = src[0]),
                    ),
                ],
              ),
              if (_source == 'direct') ...[
                const SizedBox(height: 12),
                DropdownButtonFormField<String>(
                  initialValue: _method,
                  decoration: const InputDecoration(labelText: 'Hình thức'),
                  items: const [
                    DropdownMenuItem(value: 'cash', child: Text('Tiền mặt')),
                    DropdownMenuItem(value: 'transfer', child: Text('Chuyển khoản')),
                  ],
                  onChanged: (v) => setState(() => _method = v ?? 'cash'),
                ),
              ],
              const SizedBox(height: 12),
              Row(
                children: [
                  Expanded(
                    child: DropdownButtonFormField<String>(
                      initialValue: _categoryId,
                      isExpanded: true,
                      decoration: const InputDecoration(labelText: 'Danh mục'),
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
                    icon: const Icon(Icons.add_circle, color: DanColors.brand),
                    tooltip: 'Thêm danh mục',
                  ),
                ],
              ),
              const SizedBox(height: 12),
              TextField(
                controller: _amount,
                autofocus: true,
                keyboardType: TextInputType.number,
                decoration: const InputDecoration(labelText: 'Số tiền'),
              ),
              const SizedBox(height: 12),
              InkWell(
                onTap: () async {
                  final picked = await showDatePicker(
                    context: context,
                    initialDate: _date,
                    firstDate: DateTime(2020),
                    lastDate: DateTime(2100),
                  );
                  if (picked != null) setState(() => _date = picked);
                },
                child: InputDecorator(
                  decoration: const InputDecoration(labelText: 'Ngày chi'),
                  child: Text(_ymd.format(_date)),
                ),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: _note,
                decoration: const InputDecoration(labelText: 'Ghi chú'),
              ),
            ],
          ),
        ),
      ),
      actions: [
        TextButton(
            onPressed: () => Navigator.of(context).pop(), child: const Text('Hủy')),
        FilledButton(
          onPressed: _saving ? null : _save,
          child: _saving
              ? const SizedBox(
                  width: 18,
                  height: 18,
                  child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
              : Text(_isEdit ? 'Lưu' : 'Ghi chi phí'),
        ),
      ],
    );
  }
}
