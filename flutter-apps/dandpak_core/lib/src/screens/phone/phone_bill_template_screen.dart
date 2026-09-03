import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../services/api_service.dart';
import '../../ui/app_theme.dart';
import '../../utils/translation.dart';
import '../management/management_widgets.dart';
import 'phone_kit.dart';
import 'phone_scaffolds.dart';

/// MẪU BILL trên bản điện thoại — KHỔ GIẤY và phần chữ ở đầu/chân bill.
///
/// Trình thiết kế mẫu in đầy đủ (canvas kéo thả) chỉ có trên máy để bàn, và
/// đúng là không nên bê lên màn 5 inch. Nhưng thứ NGƯỜI DÙNG MÁY CẦM TAY CẦN
/// đổi lại nằm ngoài cái canvas đó: máy Sunmi V2 in giấy **57/58mm**, còn mặc
/// định của hệ thống là **K80**. Chọn sai khổ thì bill dựng 48 ký tự/dòng rồi
/// TRÀN RA NGOÀI TỜ GIẤY — mất cột tiền bên phải.
///
/// Nên màn này chỉ làm đúng phần đó, đọc/ghi thẳng `print_config.bill` qua
/// `/api/settings/app` (không đụng `templates`, để bố cục mà cửa hàng đã căn
/// trên desktop giữ nguyên).
///
/// Số ký tự/dòng do server suy ra từ MÃ GIẤY trước, rồi mới tới số mm
/// (`paperWidthCharsFrom` trong `server/services/printing.js`) — nên ở đây ghi
/// CẢ HAI cho khớp: K57 → 57mm, K80 → 72mm.
class PhoneBillTemplateScreen extends StatefulWidget {
  const PhoneBillTemplateScreen({super.key});

  @override
  State<PhoneBillTemplateScreen> createState() =>
      _PhoneBillTemplateScreenState();
}

class _PhoneBillTemplateScreenState extends State<PhoneBillTemplateScreen> {
  final _tenCuaHang = TextEditingController();
  final _diaChi = TextEditingController();
  final _dienThoai = TextEditingController();
  final _mst = TextEditingController();
  final _chanBill = TextEditingController();

  String _kho = 'K80';
  String _doDam = 'dark';
  bool _tuIn = true;
  bool _hienQr = true;

  Map<String, dynamic> _printConfig = const {};
  bool _dangNap = true;
  bool _dangLuu = false;
  bool _coThayDoi = false;
  String? _loi;

  /// Bật cờ "chưa lưu" cho nút Lưu ở góc trên hiện ra. Các ô gõ chữ báo qua
  /// [_goChu] vì chúng không đi qua setState.
  void _doi([VoidCallback? thayDoi]) {
    setState(() {
      thayDoi?.call();
      _coThayDoi = true;
    });
  }

  void _goChu(String _) {
    if (!_coThayDoi) setState(() => _coThayDoi = true);
  }

  /// Mã giấy → (nhãn, số mm ghi kèm, số ký tự mỗi dòng).
  /// Số ký tự lấy ĐÚNG bảng của server (`PAPER_CHARS`) để câu mô tả không nói
  /// một đằng còn máy in ra một nẻo.
  static const _khoGiay = {
    'K57': ('Giấy 57/58mm (máy cầm tay, máy in mini)', 57, 32),
    'K80': ('Giấy 80mm (máy in quầy)', 72, 48),
  };

  static const _doDamLabels = {
    'light': 'Nhạt',
    'medium': 'Vừa',
    'dark': 'Đậm',
    'max': 'Đậm nhất',
  };

  @override
  void initState() {
    super.initState();
    _nap();
  }

  @override
  void dispose() {
    for (final c in [_tenCuaHang, _diaChi, _dienThoai, _mst, _chanBill]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _nap() async {
    if (mounted) setState(() => _dangNap = true);
    try {
      final all = await context.read<ApiService>().getAppSettings();
      final cfg =
          Map<String, dynamic>.from((all['print_config'] as Map?) ?? const {});
      final bill = Map<String, dynamic>.from((cfg['bill'] as Map?) ?? const {});
      if (!mounted) return;
      setState(() {
        _printConfig = cfg;
        _tenCuaHang.text = '${bill['storeName'] ?? ''}';
        _diaChi.text = '${bill['address'] ?? ''}';
        _dienThoai.text = '${bill['phone'] ?? ''}';
        _mst.text = '${bill['taxCode'] ?? ''}';
        _chanBill.text = '${bill['footer'] ?? ''}';
        _kho = _docKho(bill);
        final dam = '${bill['printDensity'] ?? 'dark'}';
        if (_doDamLabels.containsKey(dam)) _doDam = dam;
        _tuIn = '${bill['autoPrint'] ?? '1'}' != '0';
        _hienQr = '${bill['showQr'] ?? '1'}' != '0';
        _coThayDoi = false;
        _dangNap = false;
        _loi = null;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _loi = e.toString().replaceFirst('Exception: ', '');
        _dangNap = false;
      });
    }
  }

  /// Cấu hình cũ có thể chỉ có `widthMm` mà không có mã giấy, và `widthMm` ở
  /// hai chỗ mang hai nghĩa (bề ngang tờ giấy 57/80 hoặc bề ngang in được
  /// 48/72). Đọc mã trước, không có mã mới suy từ mm — đúng thứ tự của server.
  String _docKho(Map<String, dynamic> bill) {
    final ma = '${bill['paper'] ?? ''}'
        .toUpperCase()
        .replaceAll(RegExp(r'[^A-Z0-9]'), '');
    if (ma == 'K57' || ma == 'K58') return 'K57';
    if (ma == 'K80') return 'K80';
    final mm = num.tryParse('${bill['widthMm'] ?? ''}') ?? 72;
    return mm <= 60 ? 'K57' : 'K80';
  }

  int get _soKyTu => _khoGiay[_kho]?.$3 ?? 48;

  Future<bool> _luu() async {
    if (_dangLuu) return false;
    setState(() => _dangLuu = true);
    try {
      final api = context.read<ApiService>();
      // Đọc lại cấu hình HIỆN TẠI ngay trước khi ghi rồi chỉ sửa phần `bill` —
      // ghi đè cả khối là xoá mất danh mục máy in và cấu hình hoá đơn điện tử.
      final all = await api.getAppSettings();
      final cfg = Map<String, dynamic>.from(
          (all['print_config'] as Map?) ?? _printConfig);
      final bill = Map<String, dynamic>.from((cfg['bill'] as Map?) ?? const {});
      bill['storeName'] = _tenCuaHang.text.trim();
      bill['address'] = _diaChi.text.trim();
      bill['phone'] = _dienThoai.text.trim();
      bill['taxCode'] = _mst.text.trim();
      bill['footer'] = _chanBill.text.trim();
      bill['paper'] = _kho;
      bill['widthMm'] = _khoGiay[_kho]?.$2 ?? 72;
      bill['printDensity'] = _doDam;
      bill['autoPrint'] = _tuIn ? '1' : '0';
      bill['showQr'] = _hienQr ? '1' : '0';
      await api.saveAppSettings({
        'print_config': {...cfg, 'bill': bill},
      });
      if (!mounted) return true;
      setState(() {
        _printConfig = {...cfg, 'bill': bill};
        _coThayDoi = false;
        _dangLuu = false;
      });
      appToast(context, t('Đã lưu mẫu bill'));
      return true;
    } catch (e) {
      if (!mounted) return false;
      setState(() => _dangLuu = false);
      appToast(context, e.toString().replaceFirst('Exception: ', ''),
          isError: true);
      return false;
    }
  }

  Future<void> _chonKho() async {
    await showPhoneSheet<void>(
      context: context,
      title: t('Khổ giấy'),
      builder: (c) => PhonePickList(
        options: [for (final e in _khoGiay.entries) t(e.value.$1)],
        selected: t(_khoGiay[_kho]?.$1 ?? ''),
        onPick: (v) {
          Navigator.of(c).pop();
          _doi(() => _kho =
              _khoGiay.entries.firstWhere((e) => t(e.value.$1) == v).key);
        },
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return PhoneUnsavedGuard(
      dirty: _coThayDoi,
      onSave: _luu,
      child: Scaffold(
        backgroundColor: DanColors.bg,
        body: SafeArea(
          bottom: false,
          child: Column(
            children: [
              PhoneHeader(
                title: t('Mẫu bill'),
                subtitle: _dangNap
                    ? null
                    : (_coThayDoi
                        ? t('Có thay đổi chưa lưu')
                        : '$_kho · $_soKyTu ${t('ký tự/dòng')}'),
                subtitleColor: _coThayDoi ? DanColors.late : null,
                onBack: () => Navigator.of(context).maybePop(),
                actions: [
                  PhoneSaveAction(
                      dirty: _coThayDoi, busy: _dangLuu, onSave: _luu),
                ],
              ),
              Expanded(
                child: _dangNap
                    ? const Center(child: CircularProgressIndicator())
                    : _loi != null
                        ? Padding(
                            padding: const EdgeInsets.all(24),
                            child: InlineMessage(_loi!,
                                error: true, onRetry: _nap),
                          )
                        : ListView(
                            padding: const EdgeInsets.only(bottom: 20),
                            children: [
                              PhoneSectionTitle(t('KHỔ GIẤY')),
                              PhoneField(
                                label: 'Khổ giấy máy in bill',
                                value: t(_khoGiay[_kho]?.$1 ?? ''),
                                onTap: _chonKho,
                              ),
                              _xemTruoc(),
                              PhoneSectionTitle(t('ĐẦU BILL')),
                              PhoneField(
                                  label: 'Tên cửa hàng',
                                  controller: _tenCuaHang,
                                  onChanged: _goChu,
                                  hint: 'Dan-D Pak'),
                              PhoneField(
                                  label: 'Địa chỉ',
                                  controller: _diaChi,
                                  onChanged: _goChu,
                                  hint: 'Số nhà, đường, phường, tỉnh'),
                              PhoneField(
                                  label: 'Điện thoại',
                                  controller: _dienThoai,
                                  onChanged: _goChu,
                                  keyboardType: TextInputType.phone,
                                  hint: '0938 525 659'),
                              PhoneField(
                                  label: 'Mã số thuế',
                                  controller: _mst,
                                  onChanged: _goChu,
                                  keyboardType: TextInputType.number,
                                  hint: 'Để trống nếu không in MST'),
                              PhoneSectionTitle(t('CHÂN BILL')),
                              PhoneField(
                                  label: 'Dòng cảm ơn',
                                  controller: _chanBill,
                                  onChanged: _goChu,
                                  hint: 'Xin cảm ơn và hẹn gặp lại'),
                              PhoneToggleRow(
                                label: 'In mã QR tra cứu hóa đơn',
                                value: _hienQr,
                                onChanged: (v) => _doi(() => _hienQr = v),
                              ),
                              PhoneSectionTitle(t('BẢN IN')),
                              PhoneField(
                                label: 'Độ đậm',
                                value: t(_doDamLabels[_doDam] ?? ''),
                                onTap: () async {
                                  await showPhoneSheet<void>(
                                    context: context,
                                    title: t('Độ đậm bản in'),
                                    builder: (c) => PhonePickList(
                                      options:
                                          _doDamLabels.values.map(t).toList(),
                                      selected: t(_doDamLabels[_doDam] ?? ''),
                                      onPick: (v) {
                                        Navigator.of(c).pop();
                                        _doi(() => _doDam = _doDamLabels.entries
                                            .firstWhere((e) => t(e.value) == v)
                                            .key);
                                      },
                                    ),
                                  );
                                },
                              ),
                              PhoneToggleRow(
                                label: 'Tự in bill khi thu tiền xong',
                                value: _tuIn,
                                onChanged: (v) => _doi(() => _tuIn = v),
                              ),
                              Padding(
                                padding:
                                    const EdgeInsets.fromLTRB(16, 14, 16, 0),
                                child: Text(
                                    t(
                                        'Bố cục chi tiết của bill (thứ tự các dòng, logo, cỡ chữ) thiết kế ở bản máy để bàn. Màn này đổi khổ giấy và phần chữ — không phá bố cục đã căn.'),
                                    style: const TextStyle(
                                        fontSize: 11.5,
                                        height: 1.5,
                                        color: DanColors.faint)),
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

  /// Xem trước bề ngang THẬT: dựng đúng số ký tự mà server sẽ dùng, để người
  /// dùng thấy ngay chọn sai khổ thì cột tiền bị đẩy đi đâu.
  Widget _xemTruoc() {
    final w = _soKyTu;
    String hai(String trai, String phai) {
      final chua = w - trai.length - phai.length;
      return chua <= 0 ? '$trai $phai' : '$trai${' ' * chua}$phai';
    }

    final dong = <String>[
      _giua(
          _tenCuaHang.text.trim().isEmpty
              ? 'DAN D PAK'
              : _tenCuaHang.text.trim().toUpperCase(),
          w),
      '-' * w,
      hai('Hat dieu rang muoi', '165.000'),
      hai('2 x 82.500', ''),
      '-' * w,
      hai('TONG CONG', '165.000'),
    ];

    return Container(
      margin: const EdgeInsets.fromLTRB(16, 12, 16, 4),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
      decoration: BoxDecoration(
        color: Colors.white,
        border: Border.all(color: DanColors.border),
        borderRadius: BorderRadius.circular(10),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('${t('XEM TRƯỚC')} · $w ${t('ký tự/dòng')}',
              style: const TextStyle(
                  fontSize: 10,
                  fontWeight: FontWeight.w800,
                  letterSpacing: .6,
                  color: DanColors.faint)),
          const SizedBox(height: 8),
          // Cuộn ngang chứ KHÔNG xuống dòng: xuống dòng sẽ che mất đúng cái
          // hiện tượng tràn giấy mà khối này sinh ra để chỉ cho người dùng.
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: Text(dong.join('\n'),
                style: const TextStyle(
                    fontFamily: 'JetBrains Mono',
                    fontSize: 10,
                    height: 1.6,
                    color: DanColors.text)),
          ),
        ],
      ),
    );
  }

  String _giua(String s, int w) {
    if (s.length >= w) return s.substring(0, w);
    final trai = ((w - s.length) / 2).floor();
    return '${' ' * trai}$s';
  }
}
