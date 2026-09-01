import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../models/retail_models.dart';
import '../../services/api_service.dart';
import '../../ui/app_theme.dart';
import '../../utils/translation.dart';
import '../management/management_widgets.dart';
import 'phone_kit.dart';
import 'phone_scaffolds.dart';

/// CHỌN KHÁCH HÀNG cho đơn bán lẻ trên bản điện thoại.
///
/// Dữ liệu THẬT: `GET /api/customers?q=…` và `POST /api/customers` — cùng hai
/// endpoint mà màn Khách hàng và bản desktop đang dùng, nên khách thêm ở đây
/// hiện ngay ở mọi nơi khác.
///
/// Tìm kiếm chạy TRÊN SERVER chứ không lọc danh sách tải sẵn: một chi nhánh có
/// hàng trăm khách, lọc cục bộ thì khách lâu không mua sẽ KHÔNG BAO GIỜ tìm
/// thấy — đúng lỗi đã sửa ở bản desktop (widgets/customer_picker_dialog.dart).

/// Kết quả chọn. `null` trả về từ màn = người dùng bấm quay lại (giữ nguyên).
/// [customer] `null` = "Bán cho người tiêu dùng" (không gắn khách vào hóa đơn).
class PhoneCustomerPick {
  final RetailCustomer? customer;
  const PhoneCustomerPick(this.customer);
}

Future<PhoneCustomerPick?> phoneChonKhachHang(BuildContext context,
    {RetailCustomer? dangChon}) {
  return Navigator.of(context).push<PhoneCustomerPick>(
    MaterialPageRoute(
      builder: (_) => PhoneCustomerPickerScreen(dangChon: dangChon),
    ),
  );
}

class PhoneCustomerPickerScreen extends StatefulWidget {
  final RetailCustomer? dangChon;
  const PhoneCustomerPickerScreen({super.key, this.dangChon});

  @override
  State<PhoneCustomerPickerScreen> createState() =>
      _PhoneCustomerPickerScreenState();
}

class _PhoneCustomerPickerScreenState extends State<PhoneCustomerPickerScreen> {
  final _timCtrl = TextEditingController();
  Timer? _debounce;

  List<Map<String, dynamic>> _rows = [];
  bool _dangTim = true;
  String? _loi;

  /// Chống kết quả về TRỄ đè lên kết quả mới: chỉ nhận lượt tìm mới nhất.
  int _luot = 0;

  @override
  void initState() {
    super.initState();
    _tim();
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _timCtrl.dispose();
    super.dispose();
  }

  Future<void> _tim() async {
    final luot = ++_luot;
    if (mounted) setState(() => _dangTim = true);
    try {
      final rows = await context
          .read<ApiService>()
          .getCustomers(q: _timCtrl.text.trim());
      if (!mounted || luot != _luot) return;
      setState(() {
        _rows = rows
            .whereType<Map>()
            .map((e) => Map<String, dynamic>.from(e))
            .toList();
        _dangTim = false;
        _loi = null;
      });
    } catch (e) {
      if (!mounted || luot != _luot) return;
      setState(() {
        // Tìm lỗi KHÔNG được hiện giống "không có khách nào" — hai chuyện khác
        // hẳn nhau, người dùng phải biết để thử lại.
        _rows = [];
        _dangTim = false;
        _loi = e.toString().replaceFirst('Exception: ', '');
      });
    }
  }

  void _goTim(String _) {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 320), _tim);
  }

  Future<void> _them() async {
    final moi = await Navigator.of(context).push<RetailCustomer>(
      MaterialPageRoute(builder: (_) => const PhoneCustomerFormScreen()),
    );
    if (moi != null && mounted) {
      Navigator.of(context).pop(PhoneCustomerPick(moi));
    }
  }

  @override
  Widget build(BuildContext context) {
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
                    title: t('Chọn khách hàng'),
                    onBack: () => Navigator.of(context).pop(),
                    actions: [
                      PhoneIconButton(icon: Icons.person_add_alt, onTap: _them),
                    ],
                  ),
                  Padding(
                    padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
                    child: PhoneSearchBar(
                      controller: _timCtrl,
                      hint: t('Tìm tên, SĐT, mã khách, MST'),
                      onChanged: _goTim,
                      onSubmit: _tim,
                    ),
                  ),
                ],
              ),
            ),
            _dongKhachLe(),
            Expanded(child: _danhSach()),
          ],
        ),
      ),
    );
  }

  Widget _dongKhachLe() {
    final chon = widget.dangChon == null;
    return InkWell(
      onTap: () => Navigator.of(context).pop(const PhoneCustomerPick(null)),
      child: Container(
        constraints: const BoxConstraints(minHeight: 64),
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
        decoration: BoxDecoration(
          color: chon ? const Color(0xFFE4F5F9) : DanColors.surface,
          border: const Border(
            top: BorderSide(color: DanColors.border),
            bottom: BorderSide(color: DanColors.border),
          ),
        ),
        child: Row(
          children: [
            const Icon(Icons.groups_outlined, size: 21, color: DanColors.muted),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(t('Bán cho người tiêu dùng'),
                      style: const TextStyle(
                          fontSize: 14, fontWeight: FontWeight.w800)),
                  const SizedBox(height: 2),
                  Text(t('Mặc định · không gắn khách vào hóa đơn'),
                      style: const TextStyle(
                          fontSize: 11.5, color: DanColors.muted)),
                ],
              ),
            ),
            if (chon) const Icon(Icons.check, size: 20, color: DanColors.brand),
          ],
        ),
      ),
    );
  }

  Widget _danhSach() {
    if (_dangTim && _rows.isEmpty) {
      return const Center(child: CircularProgressIndicator());
    }
    if (_loi != null) {
      return Padding(
        padding: const EdgeInsets.all(24),
        child: InlineMessage('${t('Không tìm được khách hàng')}: $_loi',
            error: true, onRetry: _tim),
      );
    }
    if (_rows.isEmpty) {
      return PhoneEmpty(
        title: _timCtrl.text.trim().isEmpty
            ? t('Chưa có khách hàng')
            : t('Không tìm thấy khách hàng phù hợp'),
        hint: t('Chạm biểu tượng thêm ở góc trên để tạo khách mới'),
        icon: Icons.people_outline,
      );
    }
    return RefreshIndicator(
      onRefresh: _tim,
      child: ListView.builder(
        padding: EdgeInsets.zero,
        itemCount: _rows.length,
        itemBuilder: (_, i) => _dong(_rows[i]),
      ),
    );
  }

  Widget _dong(Map<String, dynamic> raw) {
    final c = RetailCustomer.fromJson(raw);
    final chon = widget.dangChon != null && widget.dangChon!.id == c.id;
    final diem = raw['loyalty_points'];
    final chips = <String>[
      if (c.code.isNotEmpty) c.code,
      if (c.phone.isNotEmpty) c.phone,
      if (c.taxCode.isNotEmpty) 'MST ${c.taxCode}',
      if (diem != null && (num.tryParse('$diem') ?? 0) > 0)
        '${t('Điểm')} ${phoneInt(num.tryParse('$diem') ?? 0)}',
      if (c.perkLabel.isNotEmpty) c.perkLabel,
    ];
    final diaChi = [c.address, c.addressWard, c.addressProvince]
        .where((e) => e.isNotEmpty)
        .join(', ');

    return InkWell(
      onTap: () => Navigator.of(context).pop(PhoneCustomerPick(c)),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
        decoration: BoxDecoration(
          color: chon ? const Color(0xFFE4F5F9) : DanColors.surface,
          border: const Border(bottom: BorderSide(color: DanColors.border)),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              width: 34,
              height: 34,
              decoration: const BoxDecoration(
                  color: DanColors.surface2, shape: BoxShape.circle),
              alignment: Alignment.center,
              child: const Icon(Icons.person_outline,
                  size: 18, color: DanColors.muted),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(c.title,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                          fontSize: 14, fontWeight: FontWeight.w800)),
                  if (c.company.isNotEmpty)
                    Padding(
                      padding: const EdgeInsets.only(top: 2),
                      child: Text(c.company,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                              fontSize: 11.5, color: DanColors.muted)),
                    ),
                  if (diaChi.isNotEmpty)
                    Padding(
                      padding: const EdgeInsets.only(top: 2),
                      child: Text(diaChi,
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                              fontSize: 11.5,
                              height: 1.35,
                              color: DanColors.muted)),
                    ),
                  if (chips.isNotEmpty)
                    Padding(
                      padding: const EdgeInsets.only(top: 6),
                      child: Wrap(
                        spacing: 6,
                        runSpacing: 6,
                        children: [
                          for (final s in chips)
                            Container(
                              padding: const EdgeInsets.symmetric(
                                  horizontal: 8, vertical: 3),
                              decoration: BoxDecoration(
                                  color: DanColors.surface2,
                                  borderRadius: BorderRadius.circular(6)),
                              child: Text(s,
                                  style: const TextStyle(
                                      fontSize: 10.5,
                                      fontWeight: FontWeight.w700,
                                      color: DanColors.muted)),
                            ),
                        ],
                      ),
                    ),
                ],
              ),
            ),
            if (chon)
              const Padding(
                padding: EdgeInsets.only(left: 8),
                child: Icon(Icons.check, size: 20, color: DanColors.brand),
              ),
          ],
        ),
      ),
    );
  }
}

/// THÊM KHÁCH HÀNG — chỉ những ô mà server THẬT SỰ lưu
/// (`server/services/customers.js: upsertCustomer`). Không dựng ô "cho đẹp"
/// rồi gõ xong mất dữ liệu.
class PhoneCustomerFormScreen extends StatefulWidget {
  const PhoneCustomerFormScreen({super.key});

  @override
  State<PhoneCustomerFormScreen> createState() =>
      _PhoneCustomerFormScreenState();
}

class _PhoneCustomerFormScreenState extends State<PhoneCustomerFormScreen> {
  final _ten = TextEditingController();
  final _sdt = TextEditingController();
  final _email = TextEditingController();
  final _ma = TextEditingController();
  final _diaChi = TextEditingController();
  final _phuong = TextEditingController();
  final _tinh = TextEditingController();
  final _mst = TextEditingController();
  final _congTy = TextEditingController();
  final _ghiChu = TextEditingController();
  final _uuDaiGiaTri = TextEditingController();

  String _ngaySinh = ''; // yyyy-MM-dd — server chỉ nhận đúng dạng này.
  String _uuDai = 'none';
  bool _tuXuatHoaDon = false;
  bool _dangLuu = false;

  static const _uuDaiLabels = {
    'none': 'Không có ưu đãi',
    'pct': 'Giảm theo %',
    'amount': 'Giảm số tiền',
  };

  @override
  void dispose() {
    for (final c in [
      _ten,
      _sdt,
      _email,
      _ma,
      _diaChi,
      _phuong,
      _tinh,
      _mst,
      _congTy,
      _ghiChu,
      _uuDaiGiaTri,
    ]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _chonNgaySinh() async {
    final now = DateTime.now();
    final d = await showDatePicker(
      context: context,
      initialDate: DateTime(now.year - 25, now.month, now.day),
      firstDate: DateTime(1920),
      lastDate: now,
    );
    if (d == null) return;
    setState(() => _ngaySinh =
        '${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}');
  }

  Future<void> _luu() async {
    if (_ten.text.trim().isEmpty) {
      appToast(context, t('Nhập họ và tên khách'), isError: true);
      return;
    }
    setState(() => _dangLuu = true);
    try {
      final saved = await context.read<ApiService>().upsertCustomer({
        'name': _ten.text.trim(),
        'phone': _sdt.text.trim(),
        'email': _email.text.trim(),
        // Bỏ trống = server tự cấp mã (DC000001…).
        'code': _ma.text.trim(),
        'birthday': _ngaySinh,
        'address': _diaChi.text.trim(),
        'address_ward': _phuong.text.trim(),
        'address_province': _tinh.text.trim(),
        'tax_code': _mst.text.trim(),
        'company': _congTy.text.trim(),
        'note': _ghiChu.text.trim(),
        'perk_type': _uuDai,
        'perk_value': _uuDai == 'none'
            ? 0
            : (num.tryParse(_uuDaiGiaTri.text.trim()) ?? 0).round(),
        'auto_invoice': _tuXuatHoaDon ? 1 : 0,
      });
      if (!mounted) return;
      Navigator.of(context)
          .pop(RetailCustomer.fromJson(Map<String, dynamic>.from(saved)));
    } catch (e) {
      if (!mounted) return;
      setState(() => _dangLuu = false);
      appToast(context, e.toString().replaceFirst('Exception: ', ''),
          isError: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: DanColors.bg,
      body: SafeArea(
        bottom: false,
        child: Column(
          children: [
            PhoneHeader(
              title: t('Thêm khách hàng'),
              onBack: () => Navigator.of(context).pop(),
            ),
            Expanded(
              child: ListView(
                padding: const EdgeInsets.only(bottom: 20),
                children: [
                  PhoneSectionTitle(t('Thông tin chính')),
                  PhoneField(
                      label: 'Họ và tên',
                      required: true,
                      hint: 'VD: Nguyễn Minh Lâm',
                      controller: _ten),
                  PhoneField(
                      label: 'Số điện thoại',
                      hint: '09xx xxx xxx',
                      controller: _sdt,
                      keyboardType: TextInputType.phone),
                  PhoneField(
                      label: 'Email',
                      hint: 'ten@vidu.com',
                      controller: _email,
                      keyboardType: TextInputType.emailAddress),
                  PhoneField(
                    label: 'Ngày sinh',
                    value: _ngaySinh,
                    hint: 'Chọn ngày',
                    onTap: _chonNgaySinh,
                  ),
                  PhoneField(
                      label: 'Mã khách hàng',
                      hint: 'Để trống là hệ thống tự cấp',
                      controller: _ma),
                  PhoneSectionTitle(t('Địa chỉ')),
                  PhoneField(
                      label: 'Số nhà, đường',
                      hint: 'VD: 7 Hoàng Văn Thái',
                      controller: _diaChi),
                  PhoneField(
                      label: 'Phường / Xã', hint: '', controller: _phuong),
                  PhoneField(
                      label: 'Tỉnh / Thành phố', hint: '', controller: _tinh),
                  PhoneSectionTitle(t('Thông tin xuất hóa đơn')),
                  PhoneField(
                      label: 'Mã số thuế',
                      hint: '0316 442 118',
                      controller: _mst,
                      keyboardType: TextInputType.number),
                  PhoneField(
                      label: 'Tên công ty',
                      hint: 'VD: Công ty TNHH Bảo An',
                      controller: _congTy),
                  PhoneToggleRow(
                    label: 'Tự bật xuất hóa đơn',
                    hint: 'Đơn của khách này mặc định xuất hóa đơn điện tử',
                    value: _tuXuatHoaDon,
                    onChanged: (v) => setState(() => _tuXuatHoaDon = v),
                  ),
                  PhoneSectionTitle(t('Ưu đãi')),
                  PhoneField(
                    label: 'Loại ưu đãi',
                    value: t(_uuDaiLabels[_uuDai] ?? ''),
                    onTap: _chonUuDai,
                  ),
                  if (_uuDai != 'none')
                    PhoneField(
                        label: _uuDai == 'pct' ? 'Giảm (%)' : 'Giảm (đ)',
                        hint: '0',
                        controller: _uuDaiGiaTri,
                        keyboardType: TextInputType.number),
                  PhoneField(label: 'Ghi chú', hint: '', controller: _ghiChu),
                  Padding(
                    padding: const EdgeInsets.fromLTRB(16, 14, 16, 0),
                    child: Text(
                        t(
                            'Ưu đãi khách được TRỪ THẲNG vào đơn khi chọn khách này ở màn bán lẻ.'),
                        style: const TextStyle(
                            fontSize: 11.5,
                            height: 1.5,
                            color: DanColors.faint)),
                  ),
                ],
              ),
            ),
            PhoneActionBar(
              child: PhoneCta(
                label: t('Lưu khách hàng'),
                busy: _dangLuu,
                onPressed: _dangLuu ? null : _luu,
              ),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _chonUuDai() async {
    await showPhoneSheet<void>(
      context: context,
      title: t('Loại ưu đãi'),
      builder: (c) => PhonePickList(
        options: _uuDaiLabels.values.map(t).toList(),
        selected: t(_uuDaiLabels[_uuDai] ?? ''),
        onPick: (v) {
          Navigator.of(c).pop();
          setState(() => _uuDai =
              _uuDaiLabels.entries.firstWhere((e) => t(e.value) == v).key);
        },
      ),
    );
  }
}
