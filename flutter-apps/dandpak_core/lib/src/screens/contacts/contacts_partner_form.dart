// GENERATED SPLIT of contacts_screen.dart — form đối tác (part of, cùng library).
part of 'contacts_screen.dart';

class _PartnerForm extends StatefulWidget {
  final ApiService api;
  final Map<String, dynamic>? partner;
  final bool canDelete;
  _PartnerForm({required this.api, this.partner, this.canDelete = false});

  @override
  State<_PartnerForm> createState() => _PartnerFormState();
}

class _PartnerFormState extends State<_PartnerForm> {
  late final TextEditingController _code;
  late final TextEditingController _name;
  late final TextEditingController _company;
  late final TextEditingController _phone;
  late final TextEditingController _email;
  late final TextEditingController _tax;
  late final TextEditingController _contact;
  late final TextEditingController _address;
  late final TextEditingController _addressDetail;
  late final TextEditingController _addressWard;
  late final TextEditingController _addressProvince;
  late final TextEditingController _wardCode;
  late final TextEditingController _provinceCode;
  late final TextEditingController _perkValue;
  late final TextEditingController _note;
  late String _avatar;
  late String _partnerType;
  late String _perkType;
  late bool _active;
  late bool _autoInvoice;
  bool _uploadingAvatar = false;
  bool _saving = false;
  bool _searchingTaxCode = false;
  String? _taxHint;
  // Truy xuất Cục Thuế theo MST; công ty + địa chỉ truy xuất được sẽ khóa —
  // xóa MST để nhập/kiểm tra lại.
  late final TaxLookupController _taxLookup;

  bool get _isEdit => widget.partner != null;

  @override
  void initState() {
    super.initState();
    final c = widget.partner;
    _code = TextEditingController(text: _s(c?['code']));
    _name = TextEditingController(text: _s(c?['name']));
    _company = TextEditingController(text: _s(c?['company']));
    _phone = TextEditingController(text: _s(c?['phone']));
    _email = TextEditingController(text: _s(c?['email']));
    _tax = TextEditingController(text: _s(c?['tax_code']));
    _contact = TextEditingController(text: _s(c?['contact_person']));
    _address = TextEditingController(text: _s(c?['address']));
    _addressDetail = TextEditingController(text: _s(c?['address_detail']));
    _addressWard = TextEditingController(text: _s(c?['address_ward']));
    _addressProvince = TextEditingController(text: _s(c?['address_province']));
    _wardCode = TextEditingController(text: _s(c?['ward_code']));
    _provinceCode = TextEditingController(text: _s(c?['province_code']));
    _perkValue = TextEditingController(
        text: _n(c?['perk_value']) > 0
            ? _n(c?['perk_value']).round().toString()
            : '');
    _note = TextEditingController(text: _s(c?['note']));
    _avatar = _s(c?['avatar']);
    _partnerType =
        _s(c?['partner_type']).isNotEmpty ? _s(c?['partner_type']) : 'customer';
    final rawPerk =
        _s(c?['perk_type']) == 'percent' ? 'pct' : _s(c?['perk_type']);
    _perkType =
        {'none', 'pct', 'amount', 'free'}.contains(rawPerk) ? rawPerk : 'none';
    _active = c == null ? true : _b(c['active']);
    _autoInvoice = c == null ? false : _b(c['auto_invoice']);
    _taxLookup = TaxLookupController(
      api: widget.api,
      mst: _tax,
      company: _company,
      address: _address,
    );
    _taxLookup.addListener(() {
      if (mounted) setState(() {});
    });
  }

  @override
  void dispose() {
    _taxLookup.dispose();
    for (final c in [
      _code,
      _name,
      _company,
      _phone,
      _email,
      _tax,
      _contact,
      _address,
      _addressDetail,
      _addressWard,
      _addressProvince,
      _wardCode,
      _provinceCode,
      _perkValue,
      _note,
    ]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _save() async {
    if (_name.text.trim().isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text(t('Cần nhập tên liên hệ')),
          backgroundColor: DanColors.late));
      return;
    }
    final body = <String, dynamic>{
      if (_isEdit) 'id': widget.partner!['id'],
      'code': _code.text.trim(),
      'partner_type': _partnerType,
      'name': _name.text.trim(),
      'avatar': _avatar,
      'company': _company.text.trim(),
      'phone': _phone.text.trim(),
      'email': _email.text.trim(),
      'tax_code': _tax.text.trim(),
      'contact_person': (_partnerType == 'supplier' || _partnerType == 'both')
          ? _contact.text.trim()
          : '',
      'address': _address.text.trim(),
      'address_detail': _addressDetail.text.trim(),
      'address_ward': _addressWard.text.trim(),
      'address_province': _addressProvince.text.trim(),
      'ward_code': _wardCode.text.trim(),
      'province_code': _provinceCode.text.trim(),
      'perk_type': (_partnerType == 'customer' ||
              _partnerType == 'both' ||
              _partnerType == 'staff')
          ? _perkType
          : 'none',
      'perk_value': (_partnerType == 'customer' ||
              _partnerType == 'both' ||
              _partnerType == 'staff')
          ? (int.tryParse(_perkValue.text.trim()) ?? 0)
          : 0,
      'note': _note.text.trim(),
      'active': _active ? 1 : 0,
      'auto_invoice': (_partnerType == 'customer' || _partnerType == 'both')
          ? (_autoInvoice ? 1 : 0)
          : 0,
    };
    setState(() => _saving = true);
    try {
      await widget.api.upsertPartner(body);
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

  Future<void> _lookupTax() async {
    setState(() {
      _searchingTaxCode = true;
      _taxHint = null;
    });
    // Controller dùng chung: điền + KHÓA công ty/địa chỉ; xóa MST để mở khóa.
    final err = await _taxLookup.lookup();
    if (!mounted) return;
    setState(() {
      _searchingTaxCode = false;
      if (err != null) {
        _taxHint = err;
      } else {
        final res = _taxLookup.lastResult ?? {};
        // Tên liên hệ (người) vẫn nhập tay — chỉ gợi ý khi đang trống.
        if (_name.text.isEmpty && _s(res['name']).isNotEmpty) {
          _name.text = _s(res['name']);
        }
        _taxHint =
            '✓ ${_company.text}${_address.text.isNotEmpty ? ' · ${_address.text}' : ''}';
      }
    });
  }

  Future<void> _pickAvatar() async {
    final path = await _pickImagePath();
    if (path == null || path.isEmpty) return;

    final file = File(path);
    final length = await file.length();
    if (length > 20 * 1024 * 1024) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text(t('Ảnh tối đa 20MB')),
          backgroundColor: DanColors.late));
      return;
    }

    setState(() => _uploadingAvatar = true);
    try {
      final bytes = await file.readAsBytes();
      final name = path.split(RegExp(r'[\\/]')).last;
      final res = await widget.api.uploadPartnerAvatar(
        originalName: name,
        mimeType: _mimeForFileName(name),
        data: base64Encode(bytes),
      );
      if (!mounted) return;
      setState(() {
        _avatar = _s(res['url']);
        _uploadingAvatar = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() => _uploadingAvatar = false);
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text(e.toString().replaceFirst('Exception: ', '')),
          backgroundColor: DanColors.late));
    }
  }

  // Helper chung: tablet/điện thoại mở thư viện ảnh (image_picker), desktop
  // mở hộp thoại hệ điều hành — bản cũ chỉ có PowerShell nên trên Android
  // bấm nút không có phản ứng gì.
  Future<String?> _pickImagePath() =>
      pickImagePathCross(title: 'Chọn ảnh đại diện');

  Future<void> _delete() async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: DanColors.surface,
        title: Text(t('Xóa liên hệ')),
        content: Text('${t('Xóa')} "${_name.text.trim()}"?'),
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
    if (ok != true) return;
    try {
      await widget.api.deletePartner('${widget.partner!['id']}');
      if (mounted) Navigator.of(context).pop(true);
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(
            content: Text(e.toString().replaceFirst('Exception: ', '')),
            backgroundColor: DanColors.late));
      }
    }
  }

  Widget _typeSelector() {
    final options = [
      ('customer', Icons.shopping_bag_outlined, t('Khách hàng')),
      ('supplier', Icons.storefront_outlined, t('Nhà cung cấp')),
      ('both', Icons.people_outline, t('Cả hai')),
      ('staff', Icons.badge_outlined, t('Nhân viên')),
    ];
    return Row(
      children: [
        for (var i = 0; i < options.length; i++) ...[
          Expanded(
            child: InkWell(
              onTap: () {
                setState(() {
                  _partnerType = options[i].$1;
                });
              },
              borderRadius: BorderRadius.circular(DanRadius.md),
              child: Container(
                padding: EdgeInsets.symmetric(vertical: 8),
                decoration: BoxDecoration(
                  color: _partnerType == options[i].$1
                      ? DanColors.brand.withValues(alpha: 0.08)
                      : Colors.transparent,
                  border: Border.all(
                    color: _partnerType == options[i].$1
                        ? DanColors.brand
                        : DanColors.border,
                    width: _partnerType == options[i].$1 ? 1.5 : 1,
                  ),
                  borderRadius: BorderRadius.circular(DanRadius.md),
                ),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Icon(
                      options[i].$2,
                      size: 16,
                      color: _partnerType == options[i].$1
                          ? DanColors.brand
                          : DanColors.text,
                    ),
                    SizedBox(width: 5),
                    Text(
                      options[i].$3,
                      style: TextStyle(
                        fontSize: 12,
                        fontWeight: _partnerType == options[i].$1
                            ? FontWeight.bold
                            : FontWeight.normal,
                        color: _partnerType == options[i].$1
                            ? DanColors.brand
                            : DanColors.text,
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
          if (i < options.length - 1) SizedBox(width: 8),
        ],
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    return Dialog(
      backgroundColor: DanColors.surface,
      clipBehavior: Clip.antiAlias,
      child: ConstrainedBox(
        constraints: BoxConstraints(maxWidth: 580, maxHeight: 720),
        child: Scaffold(
          backgroundColor: DanColors.surface,
          body: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Padding(
                padding: EdgeInsets.fromLTRB(20, 18, 12, 4),
                child: Row(
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(_isEdit ? t('Sửa liên hệ') : t('Thêm liên hệ'),
                              style: TextStyle(
                                  fontSize: 19, fontWeight: FontWeight.w900)),
                          SizedBox(height: 3),
                          Text(t('Khách hàng, nhà cung cấp hoặc nhân viên'),
                              style: TextStyle(
                                  fontSize: 12.5, color: DanColors.muted)),
                        ],
                      ),
                    ),
                    IconButton(
                        onPressed: () => Navigator.of(context).pop(),
                        icon: Icon(Icons.close)),
                  ],
                ),
              ),
              Divider(height: 1, color: DanColors.border),
              Flexible(
                child: ListView(
                  padding: EdgeInsets.all(20),
                  children: [
                    Text(t('LOẠI LIÊN HỆ'),
                        style: TextStyle(
                            fontSize: 12,
                            fontWeight: FontWeight.w700,
                            color: DanColors.text)),
                    SizedBox(height: 6),
                    _typeSelector(),
                    SizedBox(height: 14),
                    _avatarEditor(),
                    _field(t('MÃ KH'), _code,
                        hint: t('Để trống tự sinh DC000001')),
                    SizedBox(height: 8),
                    _field(
                      t('TÊN *'),
                      _name,
                      hint: _partnerType == 'staff'
                          ? t('Tên nhân viên')
                          : t('Tên khách / tên nhà cung cấp'),
                    ),
                    _field(t('CÔNG TY'), _company,
                        hint: t('Tên công ty (nếu có)'),
                        locked: _taxLookup.companyLocked),
                    Row(
                      children: [
                        Expanded(
                          child: _field(t('SỐ ĐIỆN THOẠI'), _phone,
                              hint: '09xx xxx xxx'),
                        ),
                        SizedBox(width: 12),
                        Expanded(
                          child: _field('EMAIL', _email, hint: 'email@vd.com'),
                        ),
                      ],
                    ),
                    _field(
                      t('MÃ SỐ THUẾ'),
                      _tax,
                      hint: t('10 hoặc 13 chữ số'),
                      suffix: Padding(
                        padding: EdgeInsets.only(right: 6),
                        child: TextButton(
                          onPressed: _searchingTaxCode ? null : _lookupTax,
                          style: TextButton.styleFrom(
                            padding: EdgeInsets.symmetric(horizontal: 12),
                            minimumSize: Size.zero,
                            tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                            side: BorderSide(color: DanColors.border),
                            shape: RoundedRectangleBorder(
                                borderRadius:
                                    BorderRadius.circular(DanRadius.sm)),
                          ),
                          child: _searchingTaxCode
                              ? SizedBox(
                                  width: 14,
                                  height: 14,
                                  child: CircularProgressIndicator(
                                      strokeWidth: 2, color: DanColors.brand))
                              : Text(
                                  t('Tra cứu'),
                                  style: TextStyle(
                                    fontSize: 12,
                                    fontWeight: FontWeight.bold,
                                    color: DanColors.text,
                                  ),
                                ),
                        ),
                      ),
                    ),
                    if (_taxHint != null)
                      Padding(
                        padding: EdgeInsets.only(bottom: 8),
                        child: Text(
                          _taxHint!,
                          style: TextStyle(
                            fontSize: 12,
                            color: _taxHint!.startsWith('✓')
                                ? DanColors.done
                                : DanColors.late,
                          ),
                        ),
                      ),
                    if (_partnerType == 'supplier' || _partnerType == 'both')
                      _field(t('NGƯỜI LIÊN HỆ'), _contact,
                          hint: t('Tên người phụ trách bên NCC')),
                    AddressFields(
                      address: _address,
                      detail: _addressDetail,
                      ward: _addressWard,
                      province: _addressProvince,
                      wardCode: _wardCode,
                      provinceCode: _provinceCode,
                      label: t('Địa chỉ giao / nhận hàng'),
                      locked: _taxLookup.addressLocked,
                    ),
                    if (_partnerType == 'customer' ||
                        _partnerType == 'both' ||
                        _partnerType == 'staff') ...[
                      Row(
                        children: [
                          Expanded(
                            child: Padding(
                              padding: EdgeInsets.symmetric(vertical: 7),
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(
                                    _partnerType == 'staff'
                                        ? t('ƯU ĐÃI MẶC ĐỊNH CHO NHÂN VIÊN')
                                        : t('ƯU ĐÃI MẶC ĐỊNH CHO KHÁCH'),
                                    style: TextStyle(
                                        fontSize: 12,
                                        fontWeight: FontWeight.w700,
                                        color: DanColors.text),
                                  ),
                                  SizedBox(height: 5),
                                  DropdownButtonFormField<String>(
                                    initialValue: _perkType,
                                    decoration: InputDecoration(isDense: true),
                                    items: [
                                      DropdownMenuItem(
                                          value: 'none',
                                          child: Text(t('Không ưu đãi'))),
                                      DropdownMenuItem(
                                          value: 'pct',
                                          child: Text(t('Giảm theo %'))),
                                      DropdownMenuItem(
                                          value: 'amount',
                                          child: Text(t('Giảm số tiền'))),
                                      DropdownMenuItem(
                                          value: 'free',
                                          child: Text(t('Miễn phí'))),
                                    ],
                                    onChanged: (v) =>
                                        setState(() => _perkType = v ?? 'none'),
                                  ),
                                ],
                              ),
                            ),
                          ),
                          SizedBox(width: 12),
                          Expanded(
                            child: _field(t('Giá trị'), _perkValue,
                                number: true, hint: t('Giá trị')),
                          ),
                        ],
                      ),
                    ],
                    _field(t('GHI CHÚ'), _note,
                        lines: 2, hint: t('Ghi chú nội bộ')),
                    SizedBox(height: 12),
                    Row(
                      children: [
                        Checkbox(
                          value: _active,
                          onChanged: (v) =>
                              setState(() => _active = v ?? false),
                        ),
                        Expanded(
                          child: RichText(
                            text: TextSpan(
                              style: TextStyle(
                                fontFamily: 'Be Vietnam Pro',
                                fontSize: 13,
                                color: DanColors.text,
                              ),
                              children: [
                                TextSpan(
                                    text: t('Active — đang hoạt động'),
                                    style:
                                        TextStyle(fontWeight: FontWeight.bold)),
                                TextSpan(
                                    text: t(
                                        ' (bỏ chọn = Inactive, lưu trữ — không xóa)'),
                                    style: TextStyle(color: DanColors.muted)),
                              ],
                            ),
                          ),
                        ),
                      ],
                    ),
                    if (_partnerType == 'customer' ||
                        _partnerType == 'both') ...[
                      SizedBox(height: 8),
                      Row(
                        children: [
                          Checkbox(
                            value: _autoInvoice,
                            onChanged: (v) =>
                                setState(() => _autoInvoice = v ?? false),
                          ),
                          Expanded(
                            child: Text(
                              t('Tự động chọn xuất hóa đơn VAT khi thanh toán'),
                              style: TextStyle(
                                fontFamily: 'Be Vietnam Pro',
                                fontSize: 13,
                                color: DanColors.text,
                              ),
                            ),
                          ),
                        ],
                      ),
                    ],
                  ],
                ),
              ),
              Divider(height: 1, color: DanColors.border),
              Padding(
                padding: EdgeInsets.all(14),
                child: Row(
                  children: [
                    if (_isEdit && widget.canDelete)
                      TextButton.icon(
                        onPressed: _delete,
                        icon: Icon(Icons.delete_outline, size: 18),
                        label: Text(t('Xóa')),
                        style: TextButton.styleFrom(
                            foregroundColor: DanColors.late),
                      ),
                    Spacer(),
                    TextButton(
                        onPressed: () => Navigator.of(context).pop(),
                        child: Text(t('Hủy'))),
                    SizedBox(width: 8),
                    FilledButton(
                      onPressed: _saving ? null : _save,
                      child: _saving
                          ? SizedBox(
                              width: 18,
                              height: 18,
                              child: CircularProgressIndicator(
                                  strokeWidth: 2, color: Colors.white))
                          : Text(_isEdit ? t('Lưu') : t('Tạo')),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _field(String label, TextEditingController c,
      {bool number = false,
      int lines = 1,
      String? hint,
      Widget? suffix,
      bool locked = false}) {
    return Padding(
      padding: EdgeInsets.symmetric(vertical: 7),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Text(label.replaceAll('*', '').trim(),
                  style: TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.w700,
                      color: DanColors.text)),
              if (label.contains('*'))
                Text(' *',
                    style: TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.w700,
                        color: DanColors.late)),
            ],
          ),
          SizedBox(height: 5),
          TextField(
            controller: c,
            maxLines: lines,
            readOnly: locked,
            keyboardType: number ? TextInputType.number : null,
            decoration: InputDecoration(
              isDense: true,
              hintText: hint,
              // Field khóa (dữ liệu tự truy xuất): chỉ tối nền, KHÔNG icon khóa.
              filled: locked,
              fillColor: locked ? DanColors.surface3 : null,
              suffixIcon: locked ? null : suffix,
              suffixIconConstraints: BoxConstraints(minHeight: 0, minWidth: 0),
            ),
          ),
        ],
      ),
    );
  }

  Widget _avatarEditor() {
    return Container(
      padding: EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: DanColors.surface2,
        border: Border.all(color: DanColors.border),
        borderRadius: BorderRadius.circular(DanRadius.md),
      ),
      child: Row(
        children: [
          _ContactAvatar(
            name: _name.text.trim(),
            avatar: _avatar,
            baseUrl: widget.api.baseUrl,
            radius: 28,
          ),
          SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(t('Ảnh đại diện'),
                    style:
                        TextStyle(fontSize: 12.5, fontWeight: FontWeight.w800)),
                SizedBox(height: 3),
                Text(
                  _avatar.isEmpty
                      ? t('Chưa có ảnh')
                      : t('Đã chọn ảnh đại diện'),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(fontSize: 12, color: DanColors.faint),
                ),
              ],
            ),
          ),
          TextButton.icon(
            onPressed: _uploadingAvatar ? null : _pickAvatar,
            icon: _uploadingAvatar
                ? SizedBox(
                    width: 15,
                    height: 15,
                    child: CircularProgressIndicator(strokeWidth: 2))
                : Icon(Icons.photo_camera_outlined, size: 17),
            label: Text(_uploadingAvatar ? t('Đang tải') : t('Chọn ảnh')),
          ),
          if (_avatar.isNotEmpty)
            IconButton(
              tooltip: t('Xóa ảnh'),
              onPressed:
                  _uploadingAvatar ? null : () => setState(() => _avatar = ''),
              icon: Icon(Icons.close, size: 18),
            ),
        ],
      ),
    );
  }
}
