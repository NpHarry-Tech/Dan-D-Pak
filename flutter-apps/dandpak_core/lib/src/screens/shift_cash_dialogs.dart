// GENERATED SPLIT of shift_dialog.dart — dialog chi/hoàn tiền két (part of, cùng library).
part of 'shift_dialog.dart';

// ── Chi từ két ──────────────────────────────────────────────────────────────
class CashExpenseDialog extends StatefulWidget {
  CashExpenseDialog({super.key});

  @override
  State<CashExpenseDialog> createState() => _CashExpenseDialogState();
}

class _CashExpenseDialogState extends State<CashExpenseDialog> {
  final _amount = TextEditingController();
  final _counterparty = TextEditingController();
  final _reason = TextEditingController();
  final _product = TextEditingController();
  final _note = TextEditingController();
  DateTime _at = DateTime.now();
  String? _image;
  bool _busy = false;

  @override
  void dispose() {
    _amount.dispose();
    _counterparty.dispose();
    _reason.dispose();
    _product.dispose();
    _note.dispose();
    super.dispose();
  }

  void _toast(String msg, {bool error = false}) =>
      appToast(context, msg, isError: error);

  Future<void> _pickAt() async {
    final d = await showDatePicker(
      context: context,
      initialDate: _at,
      firstDate: DateTime(2020),
      lastDate: DateTime(2100),
    );
    if (d == null || !mounted) return;
    final t = await showTimePicker(
        context: context, initialTime: TimeOfDay.fromDateTime(_at));
    if (!mounted) return;
    setState(() => _at = DateTime(
        d.year, d.month, d.day, t?.hour ?? _at.hour, t?.minute ?? _at.minute));
  }

  Future<void> _pickImage() async {
    final data = await pickReceiptAsDataUrl();
    if (data != null && mounted) setState(() => _image = data);
  }

  Future<void> _submit() async {
    final amount = int.tryParse(_amount.text.trim()) ?? 0;
    if (amount <= 0) return _toast(t('Nhập số tiền chi'), error: true);
    if (_counterparty.text.trim().isEmpty) {
      return _toast(t('Nhập bên nhận tiền / NCC'), error: true);
    }
    if (_reason.text.trim().isEmpty) {
      return _toast(t('Nhập lý do chi'), error: true);
    }
    setState(() => _busy = true);
    try {
      await context.read<PosProvider>().createCashExpense({
        'amount': amount,
        'occurred_at': _at.toIso8601String(),
        'counterparty': _counterparty.text.trim(),
        'reason': _reason.text.trim(),
        'product': _product.text.trim(),
        'invoice_image': _image ?? '',
        'note': _note.text.trim(),
      });
      if (mounted) {
        Navigator.of(context).pop(true);
        _toast(t('Đã ghi nhận chi tiền két'));
      }
    } catch (e) {
      if (mounted) {
        setState(() => _busy = false);
        _toast(e.toString().replaceFirst('Exception: ', ''), error: true);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Dialog(
      backgroundColor: DanColors.surface,
      insetPadding: EdgeInsets.all(20),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)),
      child: ConstrainedBox(
        constraints: BoxConstraints(maxWidth: 480),
        child: SingleChildScrollView(
          padding: EdgeInsets.all(18),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(t('Chi từ két'),
                  style: TextStyle(fontSize: 18, fontWeight: FontWeight.w900)),
              SizedBox(height: 14),
              _field(t('Số tiền *'), _amount,
                  keyboard: TextInputType.number,
                  formatters: [FilteringTextInputFormatter.digitsOnly],
                  hint: 'VD: 50000'),
              SizedBox(height: 10),
              _labeled(
                t('Ngày giờ chi'),
                OutlinedButton.icon(
                  onPressed: _pickAt,
                  icon: Icon(Icons.event, size: 16),
                  label: Text(DateFormat('dd/MM/yyyy HH:mm').format(_at)),
                  style: OutlinedButton.styleFrom(
                      alignment: Alignment.centerLeft,
                      minimumSize: Size.fromHeight(42)),
                ),
              ),
              SizedBox(height: 10),
              _field(t('Bên nhận tiền / NCC *'), _counterparty,
                  hint: t('Tên người / nhà cung cấp nhận tiền')),
              SizedBox(height: 10),
              _field(t('Lý do *'), _reason, hint: t('Lý do chi tiền')),
              SizedBox(height: 10),
              _field(t('Hàng hóa / dịch vụ'), _product,
                  hint: t('(không bắt buộc)')),
              SizedBox(height: 10),
              _labeled(t('Ảnh hóa đơn'), _imagePicker()),
              SizedBox(height: 10),
              _field(t('Ghi chú'), _note,
                  hint: t('(không bắt buộc)'), maxLines: 2),
              SizedBox(height: 18),
              Row(
                children: [
                  OutlinedButton(
                      onPressed:
                          _busy ? null : () => Navigator.of(context).pop(false),
                      child: Text(t('Hủy'))),
                  Spacer(),
                  FilledButton(
                    onPressed: _busy ? null : _submit,
                    style: FilledButton.styleFrom(
                        backgroundColor: DanColors.late,
                        minimumSize: Size(0, 44)),
                    child: _busy ? _Spinner() : Text(t('Xác nhận chi tiền')),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _imagePicker() {
    if (_image == null) {
      return OutlinedButton.icon(
        onPressed: _pickImage,
        icon: Icon(Icons.attach_file, size: 16),
        label: Text(t('Chọn ảnh / PDF hóa đơn')),
        style: OutlinedButton.styleFrom(
            alignment: Alignment.centerLeft, minimumSize: Size.fromHeight(42)),
      );
    }
    final isImage = _image!.startsWith('data:image');
    return Container(
      padding: EdgeInsets.all(8),
      decoration: BoxDecoration(
        color: DanColors.surface2,
        borderRadius: BorderRadius.circular(DanRadius.md),
        border: Border.all(color: DanColors.border),
      ),
      child: Row(
        children: [
          if (isImage)
            ClipRRect(
              borderRadius: BorderRadius.circular(6),
              child: Image.memory(
                _decodeDataUrl(_image!),
                width: 44,
                height: 44,
                fit: BoxFit.cover,
                errorBuilder: (_, __, ___) =>
                    Icon(Icons.image_not_supported, size: 24),
              ),
            )
          else
            Icon(Icons.picture_as_pdf, size: 30, color: DanColors.late),
          SizedBox(width: 10),
          Expanded(
            child: Text(t('Đã đính kèm tài liệu'),
                style: TextStyle(fontWeight: FontWeight.w700, fontSize: 13)),
          ),
          IconButton(
            onPressed: () => setState(() => _image = null),
            icon: Icon(Icons.close, size: 18),
            tooltip: t('Bỏ ảnh'),
          ),
        ],
      ),
    );
  }

  Widget _labeled(String label, Widget child) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label,
            style: TextStyle(
                fontSize: 12,
                color: DanColors.muted,
                fontWeight: FontWeight.w700)),
        SizedBox(height: 5),
        child,
      ],
    );
  }

  Widget _field(String label, TextEditingController c,
      {String? hint,
      int maxLines = 1,
      TextInputType? keyboard,
      List<TextInputFormatter>? formatters}) {
    return _labeled(
      label,
      TextField(
        controller: c,
        maxLines: maxLines,
        keyboardType: keyboard,
        inputFormatters: formatters,
        decoration: InputDecoration(isDense: true, hintText: hint),
      ),
    );
  }
}

Uint8List _decodeDataUrl(String dataUrl) {
  final i = dataUrl.indexOf(',');
  return base64Decode(i >= 0 ? dataUrl.substring(i + 1) : dataUrl);
}

// ── Hoàn chi ────────────────────────────────────────────────────────────────
class CashReimbursementDialog extends StatefulWidget {
  CashReimbursementDialog({super.key});

  @override
  State<CashReimbursementDialog> createState() =>
      _CashReimbursementDialogState();
}

class _CashReimbursementDialogState extends State<CashReimbursementDialog> {
  final Map<int, TextEditingController> _ctrls = {};
  final Set<String> _selected = {};
  final _counterparty = TextEditingController();
  final _note = TextEditingController();
  DateTime _at = DateTime.now();

  List<int> _denoms = [];
  List<Map<String, dynamic>> _expenses = [];
  num _drawerBefore = 0;
  bool _loading = true;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _load());
  }

  Future<void> _load() async {
    final pos = context.read<PosProvider>();
    _denoms = pos.shiftDenominations;
    for (final d in _denoms) {
      _ctrls.putIfAbsent(d, () => TextEditingController(text: '0'));
    }
    try {
      final data = await pos.getCashDrawer();
      final ex = data['reimbursable_expenses'];
      final summary = data['summary'];
      if (mounted) {
        setState(() {
          _expenses = ex is List
              ? ex
                  .whereType<Map>()
                  .map((e) => Map<String, dynamic>.from(e))
                  .toList()
              : [];
          _drawerBefore = summary is Map ? _num(summary['expected_cash']) : 0;
          _loading = false;
        });
      }
    } catch (_) {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  void dispose() {
    for (final c in _ctrls.values) {
      c.dispose();
    }
    _counterparty.dispose();
    _note.dispose();
    super.dispose();
  }

  void _toast(String msg, {bool error = false}) =>
      appToast(context, msg, isError: error);

  int _actual() {
    var t = 0;
    for (final d in _denoms) {
      t += d * (int.tryParse(_ctrls[d]?.text.trim() ?? '') ?? 0);
    }
    return t;
  }

  num _due() {
    num t = 0;
    for (final e in _expenses) {
      if (_selected.contains(_s(e['id']))) {
        t += _num(e['outstanding_amount']);
      }
    }
    return t;
  }

  Future<void> _submit() async {
    final amount = _actual();
    if (amount <= 0) {
      return _toast(t('Vui lòng kiểm đếm số tiền thực nhận'), error: true);
    }
    final due = _due();
    if (_selected.isNotEmpty && amount > due) {
      return _toast(
          t('Tiền thực nhận lớn hơn số phải hoàn của các khoản đã chọn'),
          error: true);
    }
    setState(() => _busy = true);
    try {
      await context.read<PosProvider>().createCashReimbursement({
        'amount': amount,
        'occurred_at': _at.toIso8601String(),
        'counterparty': _counterparty.text.trim(),
        'note': _note.text.trim(),
        'reimburses_entry_ids': _selected.toList(),
      });
      if (mounted) {
        Navigator.of(context).pop(true);
        _toast(t('Đã ghi nhận hoàn chi'));
      }
    } catch (e) {
      if (mounted) {
        setState(() => _busy = false);
        _toast(e.toString().replaceFirst('Exception: ', ''), error: true);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final size = MediaQuery.of(context).size;
    final actual = _actual();
    return Dialog(
      backgroundColor: DanColors.surface,
      insetPadding: EdgeInsets.all(18),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)),
      child: ConstrainedBox(
        constraints: BoxConstraints(maxWidth: 900, maxHeight: size.height - 36),
        child: Padding(
          padding: EdgeInsets.all(16),
          child: _loading
              ? SizedBox(
                  height: 200,
                  child: Center(child: CircularProgressIndicator()))
              : Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Text(t('Hoàn chi'),
                        style: TextStyle(
                            fontSize: 18, fontWeight: FontWeight.w900)),
                    SizedBox(height: 10),
                    _summaryCards(actual),
                    SizedBox(height: 12),
                    Flexible(
                      child: LayoutBuilder(builder: (context, c) {
                        final narrow = c.maxWidth < 640;
                        final left = _expenseList();
                        final right = _denomCount();
                        if (narrow) {
                          return SingleChildScrollView(
                            child: Column(
                                children: [left, SizedBox(height: 12), right]),
                          );
                        }
                        return Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Expanded(child: left),
                            SizedBox(width: 14),
                            SizedBox(width: 300, child: right),
                          ],
                        );
                      }),
                    ),
                    SizedBox(height: 12),
                    Row(
                      children: [
                        OutlinedButton(
                            onPressed: _busy
                                ? null
                                : () => Navigator.of(context).pop(false),
                            child: Text(t('Hủy'))),
                        Spacer(),
                        FilledButton(
                          onPressed: _busy ? null : _submit,
                          style:
                              FilledButton.styleFrom(minimumSize: Size(0, 44)),
                          child:
                              _busy ? _Spinner() : Text(t('Xác nhận hoàn chi')),
                        ),
                      ],
                    ),
                  ],
                ),
        ),
      ),
    );
  }

  Widget _summaryCards(int actual) {
    Widget card(String label, String value, Color color) => Expanded(
          child: Container(
            padding: EdgeInsets.all(10),
            margin: EdgeInsets.only(right: 8),
            decoration: BoxDecoration(
              color: DanColors.surface2,
              borderRadius: BorderRadius.circular(DanRadius.md),
              border: Border.all(color: DanColors.border),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(label.toUpperCase(),
                    style: TextStyle(
                        fontSize: 9.5,
                        fontWeight: FontWeight.w800,
                        color: DanColors.muted)),
                SizedBox(height: 4),
                Text(value,
                    style: TextStyle(
                        fontSize: 17,
                        fontWeight: FontWeight.w900,
                        fontFamily: 'JetBrains Mono',
                        color: color)),
              ],
            ),
          ),
        );
    return Row(
      children: [
        card(t('Két trước hoàn chi'), fmtMoney(_drawerBefore), DanColors.text),
        card(t('Số phải hoàn (đã chọn)'), fmtMoney(_due()), DanColors.late),
        card(t('Thực nhận đã kiểm đếm'), fmtMoney(actual), DanColors.brand),
        Container(
          padding: EdgeInsets.all(10),
          constraints: BoxConstraints(minWidth: 150),
          decoration: BoxDecoration(
            color: DanColors.surface2,
            borderRadius: BorderRadius.circular(DanRadius.md),
            border: Border.all(color: DanColors.border),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(t('KÉT SAU HOÀN CHI'),
                  style: TextStyle(
                      fontSize: 9.5,
                      fontWeight: FontWeight.w800,
                      color: DanColors.muted)),
              SizedBox(height: 4),
              Text(fmtMoney(_drawerBefore + actual),
                  style: TextStyle(
                      fontSize: 17,
                      fontWeight: FontWeight.w900,
                      fontFamily: 'JetBrains Mono',
                      color: Color(0xFF047857))),
            ],
          ),
        ),
      ],
    );
  }

  Widget _expenseList() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(t('Chọn các khoản chi được hoàn'),
            style: TextStyle(
                fontSize: 12,
                color: DanColors.muted,
                fontWeight: FontWeight.w700)),
        SizedBox(height: 6),
        Container(
          constraints: BoxConstraints(maxHeight: 240),
          padding: EdgeInsets.all(8),
          decoration: BoxDecoration(
            color: DanColors.surface2,
            borderRadius: BorderRadius.circular(DanRadius.md),
            border: Border.all(color: DanColors.border),
          ),
          child: _expenses.isEmpty
              ? Padding(
                  padding: EdgeInsets.all(10),
                  child: Text(t('Không có khoản chi nào đang chờ hoàn'),
                      style: TextStyle(color: DanColors.muted)))
              : SingleChildScrollView(
                  child: Column(
                    children: [
                      for (final e in _expenses) _expenseRow(e),
                    ],
                  ),
                ),
        ),
        SizedBox(height: 10),
        Row(
          children: [
            Expanded(
              child: _labeled(
                t('Ngày giờ hoàn'),
                OutlinedButton.icon(
                  onPressed: _pickAt,
                  icon: Icon(Icons.event, size: 15),
                  label: Text(DateFormat('dd/MM HH:mm').format(_at),
                      style: TextStyle(fontSize: 12)),
                  style: OutlinedButton.styleFrom(
                      minimumSize: Size.fromHeight(40)),
                ),
              ),
            ),
            SizedBox(width: 8),
            Expanded(
              child: _labeled(
                t('Người hoàn tiền'),
                TextField(
                  controller: _counterparty,
                  decoration: InputDecoration(
                      isDense: true, hintText: t('Kế toán / người giao')),
                ),
              ),
            ),
          ],
        ),
        SizedBox(height: 8),
        _labeled(
          t('Ghi chú'),
          TextField(
            controller: _note,
            maxLines: 2,
            decoration:
                InputDecoration(isDense: true, hintText: t('(không bắt buộc)')),
          ),
        ),
      ],
    );
  }

  Future<void> _pickAt() async {
    final d = await showDatePicker(
        context: context,
        initialDate: _at,
        firstDate: DateTime(2020),
        lastDate: DateTime(2100));
    if (d == null || !mounted) return;
    final t = await showTimePicker(
        context: context, initialTime: TimeOfDay.fromDateTime(_at));
    if (!mounted) return;
    setState(() => _at = DateTime(
        d.year, d.month, d.day, t?.hour ?? _at.hour, t?.minute ?? _at.minute));
  }

  Widget _expenseRow(Map<String, dynamic> e) {
    final id = _s(e['id']);
    final checked = _selected.contains(id);
    return InkWell(
      onTap: () => setState(() {
        if (checked) {
          _selected.remove(id);
        } else {
          _selected.add(id);
        }
      }),
      child: Container(
        margin: EdgeInsets.only(bottom: 6),
        padding: EdgeInsets.symmetric(horizontal: 8, vertical: 7),
        decoration: BoxDecoration(
          color: DanColors.surface,
          borderRadius: BorderRadius.circular(9),
          border:
              Border.all(color: checked ? DanColors.brand : DanColors.border),
        ),
        child: Row(
          children: [
            Icon(checked ? Icons.check_box : Icons.check_box_outline_blank,
                size: 20, color: checked ? DanColors.brand : DanColors.faint),
            SizedBox(width: 8),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                      _s(e['title']).isNotEmpty
                          ? _s(e['title'])
                          : (_s(e['reason']).isNotEmpty
                              ? _s(e['reason'])
                              : _s(e['id'])),
                      style: TextStyle(
                          fontSize: 12.5, fontWeight: FontWeight.w700)),
                  Text(_fmtDateTime(e['occurred_at']),
                      style: TextStyle(fontSize: 10.5, color: DanColors.muted)),
                ],
              ),
            ),
            Text(fmtMoney(_num(e['outstanding_amount'])),
                style: TextStyle(
                    fontFamily: 'JetBrains Mono',
                    fontWeight: FontWeight.w800,
                    fontSize: 12.5,
                    color: DanColors.late)),
          ],
        ),
      ),
    );
  }

  Widget _denomCount() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(t('Kiểm đếm tiền thực nhận'),
            style: TextStyle(
                fontSize: 12,
                color: DanColors.muted,
                fontWeight: FontWeight.w700)),
        SizedBox(height: 6),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            for (final d in _denoms)
              _DenomField(
                denom: d,
                controller: _ctrls[d]!,
                onChanged: () => setState(() {}),
              ),
          ],
        ),
      ],
    );
  }

  Widget _labeled(String label, Widget child) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label,
            style: TextStyle(
                fontSize: 12,
                color: DanColors.muted,
                fontWeight: FontWeight.w700)),
        SizedBox(height: 5),
        child,
      ],
    );
  }
}
