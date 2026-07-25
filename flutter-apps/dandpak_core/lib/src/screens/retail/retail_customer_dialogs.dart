// GENERATED SPLIT of retail_screen.dart — dialog chọn/sửa khách (part of, cùng library).
part of 'retail_screen.dart';

class _CustomerPickerDialog extends StatefulWidget {
  final ApiService api;
  final List<RetailCustomer> customers;
  final RetailCustomer? selected;

  _CustomerPickerDialog({
    required this.api,
    required this.customers,
    required this.selected,
  });

  @override
  State<_CustomerPickerDialog> createState() => _CustomerPickerDialogState();
}

class _NoCustomer {
  _NoCustomer();
}

class _CustomerPickerDialogState extends State<_CustomerPickerDialog> {
  final _search = TextEditingController();
  String _q = '';
  // widget.customers is only the ~200 most-recently-updated customers preloaded
  // when the retail screen opened — with more customers than that (very common:
  // this branch alone has 668), a customer who hasn't transacted recently is
  // simply absent from that list, so filtering it locally can NEVER find them
  // no matter what's typed. Once the user types, query the server for real
  // (same /api/customers?q=... the "Khách hàng" screen already uses correctly).
  late List<RetailCustomer> _liveResults = widget.customers;
  bool _searching = false;
  final _debouncer = Debouncer(delay: Duration(milliseconds: 300));
  final _searchGuard = SearchRequestGuard();

  @override
  void dispose() {
    _search.dispose();
    _debouncer.dispose();
    super.dispose();
  }

  Future<void> _runServerSearch(String query) async {
    final trimmed = query.trim();
    if (trimmed.isEmpty) {
      _searchGuard.invalidate();
      if (mounted) setState(() { _liveResults = widget.customers; _searching = false; });
      return;
    }
    final generation = _searchGuard.next();
    if (mounted) setState(() => _searching = true);
    try {
      final rows = await widget.api.getCustomers(q: trimmed);
      if (!mounted || !_searchGuard.isCurrent(generation)) return;
      final parsed = rows
          .whereType<Map>()
          .map((e) => RetailCustomer.fromJson(Map<String, dynamic>.from(e)))
          .toList();
      setState(() { _liveResults = parsed; _searching = false; });
    } catch (e) {
      if (!mounted || !_searchGuard.isCurrent(generation)) return;
      // Previously swallowed silently — a failed search looked identical to a
      // real "no results", making this impossible to tell apart from the bug
      // this dialog was fixed for. Surface it instead.
      setState(() { _liveResults = []; _searching = false; });
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text('${t('Không tìm được khách hàng')}: $e')));
    }
  }

  List<RetailCustomer> get _rows => _liveResults;

  Future<void> _create() async {
    final saved = await showDialog<RetailCustomer>(
      context: context,
      builder: (_) => _CustomerEditDialog(api: widget.api),
    );
    if (saved != null && mounted) Navigator.of(context).pop(saved);
  }

  @override
  Widget build(BuildContext context) {
    return Dialog(
      backgroundColor: DanColors.surface,
      // Without an explicit shape + clip, Dialog doesn't clip its child to its
      // own rounded corners — the last (partially scrolled) row in a long list
      // can render past the visible rounded edge instead of being cut cleanly.
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(DanRadius.lg)),
      clipBehavior: Clip.antiAlias,
      child: ConstrainedBox(
        constraints: BoxConstraints(maxWidth: 560, maxHeight: 660),
        child: Column(
          children: [
            Padding(
              padding: EdgeInsets.fromLTRB(20, 18, 14, 10),
              child: Row(
                children: [
                  Expanded(
                    child: Text(t('Chọn khách hàng'),
                        style: TextStyle(
                            fontSize: 18, fontWeight: FontWeight.w900)),
                  ),
                  TextButton.icon(
                    onPressed: _create,
                    icon: Icon(Icons.add, size: 17),
                    label: Text(t('Thêm')),
                  ),
                  IconButton(
                      onPressed: () => Navigator.of(context).pop(),
                      icon: Icon(Icons.close)),
                ],
              ),
            ),
            Padding(
              padding: EdgeInsets.fromLTRB(16, 0, 16, 10),
              child: TextField(
                controller: _search,
                decoration: InputDecoration(
                  hintText: t('Tìm mã, tên, SĐT, MST...'),
                  prefixIcon: Icon(Icons.search),
                  suffixIcon: _searching
                      ? Padding(
                          padding: EdgeInsets.all(12),
                          child: SizedBox(
                            width: 16,
                            height: 16,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          ),
                        )
                      : null,
                  isDense: true,
                ),
                onChanged: (v) {
                  setState(() => _q = v);
                  _debouncer(() => _runServerSearch(v));
                },
                onSubmitted: (_) async {
                  // Enter may land before the debounce fires — search right now
                  // with whatever's in the box so we pick from fresh results.
                  await _runServerSearch(_q);
                  if (!mounted) return;
                  final candidate = searchSubmitCandidate(
                    _rows,
                    _q,
                    (customer) => [
                      customer.code,
                      customer.title,
                      customer.phone,
                      customer.taxCode,
                      customer.company,
                    ],
                  );
                  if (candidate != null) Navigator.of(context).pop(candidate);
                },
              ),
            ),
            Divider(height: 1, color: DanColors.border),
            ListTile(
              leading: Icon(Icons.person_off_outlined),
              title: Text(t('Bán cho người tiêu dùng')),
              onTap: () => Navigator.of(context).pop(_NoCustomer()),
            ),
            Expanded(
              child: _rows.isEmpty
                  ? Center(
                      child: Text(
                          _searching
                              ? t('Đang tìm...')
                              : (_q.trim().isEmpty
                                  ? t('Chưa có khách hàng')
                                  : t('Không tìm thấy khách hàng phù hợp')),
                          style: TextStyle(color: DanColors.faint)))
                  : ListView.separated(
                      padding: EdgeInsets.all(12),
                      itemCount: _rows.length,
                      separatorBuilder: (_, __) => SizedBox(height: 8),
                      itemBuilder: (_, i) {
                        final c = _rows[i];
                        final selected = c.id == widget.selected?.id;
                        return ListTile(
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(DanRadius.md),
                            side: BorderSide(
                                color: selected
                                    ? DanColors.brand
                                    : DanColors.border),
                          ),
                          tileColor:
                              selected ? DanColors.brandDim : DanColors.surface,
                          title: Text(c.title,
                              style: TextStyle(fontWeight: FontWeight.w900)),
                          subtitle: Text(c.subtitle.isEmpty ? '—' : c.subtitle),
                          trailing: selected
                              ? Icon(Icons.check_circle, color: DanColors.brand)
                              : null,
                          onTap: () => Navigator.of(context).pop(c),
                        );
                      },
                    ),
            ),
          ],
        ),
      ),
    );
  }
}

class _CustomerEditDialog extends StatefulWidget {
  final ApiService api;
  _CustomerEditDialog({required this.api});

  @override
  State<_CustomerEditDialog> createState() => _CustomerEditDialogState();
}

class _CustomerEditDialogState extends State<_CustomerEditDialog> {
  final _name = TextEditingController();
  final _phone = TextEditingController();
  final _email = TextEditingController();
  final _tax = TextEditingController();
  final _company = TextEditingController();
  final _address = TextEditingController();
  final _addressDetail = TextEditingController();
  final _addressWard = TextEditingController();
  final _addressProvince = TextEditingController();
  final _wardCode = TextEditingController();
  final _provinceCode = TextEditingController();
  final _perkValue = TextEditingController();
  String _perkType = 'none';
  bool _autoInvoice = false;
  bool _saving = false;
  // Truy xuất Cục Thuế theo MST; tên công ty + địa chỉ truy xuất được sẽ khóa.
  late final TaxLookupController _taxLookup = TaxLookupController(
    api: widget.api,
    mst: _tax,
    company: _company,
    address: _address,
  );

  @override
  void dispose() {
    _taxLookup.dispose();
    _name.dispose();
    _phone.dispose();
    _email.dispose();
    _tax.dispose();
    _company.dispose();
    _address.dispose();
    _addressDetail.dispose();
    _addressWard.dispose();
    _addressProvince.dispose();
    _wardCode.dispose();
    _provinceCode.dispose();
    _perkValue.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (_name.text.trim().isEmpty &&
        _phone.text.trim().isEmpty &&
        _company.text.trim().isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text(t('Nhập tên, SĐT hoặc tên công ty')),
          backgroundColor: DanColors.late));
      return;
    }
    setState(() => _saving = true);
    try {
      final saved = await widget.api.upsertCustomer({
        'name': _name.text.trim(),
        'phone': _phone.text.trim(),
        'email': _email.text.trim(),
        'tax_code': _tax.text.trim(),
        'company': _company.text.trim(),
        'address': _address.text.trim(),
        'address_detail': _addressDetail.text.trim(),
        'address_ward': _addressWard.text.trim(),
        'address_province': _addressProvince.text.trim(),
        'ward_code': _wardCode.text.trim(),
        'province_code': _provinceCode.text.trim(),
        'perk_type': _perkType,
        'perk_value': retailN(_perkValue.text.trim()).round(),
        'auto_invoice': _autoInvoice,
      });
      if (mounted) {
        Navigator.of(context)
            .pop(RetailCustomer.fromJson(Map<String, dynamic>.from(saved)));
      }
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
      title: Text(t('Thêm khách hàng')),
      content: SizedBox(
        width: dialogWidth(context, 520),
        child: SingleChildScrollView(
          child: ListenableBuilder(
            listenable: _taxLookup,
            builder: (context, _) => Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                TextField(
                    controller: _name,
                    decoration: InputDecoration(labelText: t('Tên khách'))),
                SizedBox(height: 8),
                TextField(
                    controller: _phone,
                    decoration: InputDecoration(labelText: t('Số điện thoại'))),
                SizedBox(height: 8),
                TextField(
                    controller: _email,
                    decoration: InputDecoration(labelText: 'Email')),
                SizedBox(height: 8),
                MstField(
                  lookup: _taxLookup,
                  isDense: false,
                  onMessage: (m, {bool error = false}) =>
                      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
                    content: Text(m),
                    backgroundColor: error ? DanColors.late : DanColors.text,
                  )),
                ),
                SizedBox(height: 8),
                TextField(
                    controller: _company,
                    readOnly: _taxLookup.companyLocked,
                    decoration: taxLockedDecoration(
                        label: t('Tên công ty'),
                        locked: _taxLookup.companyLocked,
                        isDense: false)),
                SizedBox(height: 8),
                AddressFields(
                  address: _address,
                  detail: _addressDetail,
                  ward: _addressWard,
                  province: _addressProvince,
                  wardCode: _wardCode,
                  provinceCode: _provinceCode,
                  locked: _taxLookup.addressLocked,
                ),
                SizedBox(height: 8),
                Row(
                  children: [
                    Expanded(
                      child: DropdownButtonFormField<String>(
                        initialValue: _perkType,
                        decoration: InputDecoration(labelText: t('Ưu đãi')),
                        items: [
                          DropdownMenuItem(
                              value: 'none', child: Text(t('Không'))),
                          DropdownMenuItem(value: 'pct', child: Text('Theo %')),
                          DropdownMenuItem(
                              value: 'amount', child: Text(t('Số tiền'))),
                        ],
                        onChanged: (v) =>
                            setState(() => _perkType = v ?? 'none'),
                      ),
                    ),
                    SizedBox(width: 8),
                    Expanded(
                      child: TextField(
                        controller: _perkValue,
                        keyboardType: TextInputType.number,
                        decoration: InputDecoration(labelText: t('Giá trị')),
                      ),
                    ),
                  ],
                ),
                SwitchListTile(
                  value: _autoInvoice,
                  title: Text(t('Tự bật xuất hóa đơn')),
                  onChanged: (v) => setState(() => _autoInvoice = v),
                ),
              ],
            ),
          ),
        ),
      ),
      actions: [
        TextButton(
            onPressed: _saving ? null : () => Navigator.of(context).pop(),
            child: Text(t('Hủy'))),
        FilledButton(
          onPressed: _saving ? null : _save,
          child: _saving
              ? SizedBox(
                  width: 18,
                  height: 18,
                  child: CircularProgressIndicator(
                      strokeWidth: 2, color: Colors.white))
              : Text(t('Lưu')),
        ),
      ],
    );
  }
}
