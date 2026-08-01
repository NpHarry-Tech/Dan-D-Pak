import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../services/api_service.dart';
import '../../ui/app_theme.dart';
import '../../utils/translation.dart';
import 'phone_kit.dart';
import 'phone_scaffolds.dart';

/// NỐI MÁY IN — trong màn Máy in (Nhiều hơn → Máy in).
///
/// Bản đầu CHỈ làm được máy in mạng: bắt nhập địa chỉ IP mới cho lưu. Sai — máy
/// in gắn liền trên máy POS cầm tay và máy in cắm USB vào máy POS đều KHÔNG có
/// IP, nên không ai nối được chúng. Giờ đủ hai loại:
///
///   • Máy in của máy này  — gắn liền hoặc cắm USB. Chọn tên từ danh sách máy
///                           báo lên, KHÔNG hỏi IP.
///   • Máy in mạng (LAN)   — nhập IP và cổng.
class PhonePrinterSetupSheet extends StatefulWidget {
  /// Tuyến đang sửa. `null` = thêm mới.
  final Map<String, dynamic>? printer;
  const PhonePrinterSetupSheet({super.key, this.printer});

  @override
  State<PhonePrinterSetupSheet> createState() => _PhonePrinterSetupSheetState();
}

class _PhonePrinterSetupSheetState extends State<PhonePrinterSetupSheet> {
  final _ten = TextEditingController();
  final _ip = TextEditingController();
  final _cong = TextEditingController(text: '9100');

  String _kieuNoi = 'system'; // 'system' = máy in của máy này | 'lan'
  String _tenHeDieuHanh = '';
  String _loaiPhieu = 'receipt';
  bool _coKet = false;
  bool _dangLuu = false;

  /// Máy in mà chính máy này đang báo lên. Nguồn cho ô chọn khi kiểu nối là
  /// 'system' — người dùng chọn tên có sẵn thay vì gõ tay, gõ sai một ký tự là
  /// phiếu không bao giờ tới nơi.
  List<String> _mayInCuaMay = [];
  bool _dangDo = true;

  static const _kieuNoiLabels = {
    'system': 'Máy in của máy này (gắn liền / USB)',
    'lan': 'Máy in mạng (LAN)',
  };

  static const _loaiPhieuLabels = {
    'receipt': 'Hóa đơn / Tạm tính',
    'kitchen_ticket': 'Phiếu bếp',
    'product_label': 'Tem sản phẩm',
    'cup_label': 'Tem ly',
    'report': 'Báo cáo (máy in A4)',
  };

  bool get _laSua => widget.printer != null;

  @override
  void initState() {
    super.initState();
    final p = widget.printer;
    if (p != null) {
      _ten.text = '${p['label'] ?? p['name'] ?? ''}';
      _ip.text = '${p['ip'] ?? ''}';
      _cong.text = '${p['port'] ?? 9100}';
      _tenHeDieuHanh = '${p['systemName'] ?? p['name'] ?? ''}';
      _coKet = p['cashDrawer'] == true || p['openDrawerOnPrint'] == true;
      final c = '${p['connection'] ?? 'system'}';
      if (_kieuNoiLabels.containsKey(c)) _kieuNoi = c;
      final out = '${p['output'] ?? 'receipt'}';
      if (_loaiPhieuLabels.containsKey(out)) _loaiPhieu = out;
    }
    _doMayIn();
  }

  @override
  void dispose() {
    _ten.dispose();
    _ip.dispose();
    _cong.dispose();
    super.dispose();
  }

  Future<void> _doMayIn() async {
    try {
      final api = context.read<ApiService>();
      // Máy in mà CHÍNH MÁY NÀY đang cắm — server lọc sẵn theo thiết bị.
      final ds = await api.getPrinters(live: true);
      final ten = ds
          .whereType<Map>()
          .where((e) => e['attached_to_me'] == true || e['implicit'] == true)
          .map((e) => '${e['systemName'] ?? e['name'] ?? ''}')
          .where((e) => e.isNotEmpty)
          .toSet()
          .toList();
      if (!mounted) return;
      setState(() {
        _mayInCuaMay = ten;
        _dangDo = false;
        // Thêm mới mà máy chỉ có đúng một máy in thì chọn sẵn — đỡ một thao tác.
        if (!_laSua && _tenHeDieuHanh.isEmpty && ten.length == 1) {
          _tenHeDieuHanh = ten.first;
          if (_ten.text.trim().isEmpty) _ten.text = ten.first;
        }
      });
    } catch (_) {
      if (mounted) setState(() => _dangDo = false);
    }
  }

  /// Chỉ kiểm IP khi thật sự là máy in mạng. Máy in gắn liền không có IP —
  /// bắt nhập là chặn người dùng khỏi chính máy in của họ.
  String? _kiemTra() {
    if (_ten.text.trim().isEmpty) return t('Cần đặt tên cho máy in');
    if (_kieuNoi == 'lan') {
      final s = _ip.text.trim();
      if (s.isEmpty) return t('Máy in mạng cần địa chỉ IP');
      final phan = s.split('.');
      if (phan.length != 4) return t('Địa chỉ IP phải có dạng 192.168.1.50');
      for (final x in phan) {
        final n = int.tryParse(x);
        if (n == null || n < 0 || n > 255) {
          return t('Địa chỉ IP phải có dạng 192.168.1.50');
        }
      }
    } else if (_tenHeDieuHanh.trim().isEmpty) {
      return t('Chọn máy in của máy này');
    }
    return null;
  }

  Future<Map<String, dynamic>> _docCauHinh(ApiService api) async {
    final all = await api.getAppSettings();
    return Map<String, dynamic>.from((all['print_config'] as Map?) ?? const {});
  }

  Future<void> _luu() async {
    final loi = _kiemTra();
    if (loi != null) {
      appToast(context, loi, isError: true);
      return;
    }
    setState(() => _dangLuu = true);
    try {
      final api = context.read<ApiService>();
      // Đọc cấu hình HIỆN TẠI rồi chỉ sửa đúng một tuyến — ghi đè cả khối là xoá
      // mất các máy in khác mà cửa hàng đã khai.
      final cfg = await _docCauHinh(api);
      final ds = [...((cfg['printers'] as List?) ?? const [])]
          .whereType<Map>()
          .map((e) => Map<String, dynamic>.from(e))
          .toList();

      final laLan = _kieuNoi == 'lan';
      final id = _laSua
          ? '${widget.printer!['id']}'
          : '${laLan ? 'lan' : 'sys'}_${DateTime.now().millisecondsSinceEpoch}';
      final tuyen = <String, dynamic>{
        'id': id,
        'name': laLan ? _ten.text.trim() : _tenHeDieuHanh.trim(),
        'label': _ten.text.trim(),
        'systemName': laLan ? '' : _tenHeDieuHanh.trim(),
        'output': _loaiPhieu,
        'connection': _kieuNoi,
        'ip': laLan ? _ip.text.trim() : '',
        'port': laLan ? (int.tryParse(_cong.text.trim()) ?? 9100) : 0,
        'active': true,
        'auto': true,
        'cashDrawer': _coKet,
        'openDrawerOnPrint': _coKet && _loaiPhieu == 'receipt',
      };

      final i = ds.indexWhere((e) => '${e['id']}' == id);
      if (i >= 0) {
        ds[i] = {...ds[i], ...tuyen};
      } else {
        ds.add(tuyen);
      }

      await api.saveAppSettings({'print_config': {...cfg, 'printers': ds}});
      if (!mounted) return;
      Navigator.of(context).pop(true);
    } catch (e) {
      if (!mounted) return;
      setState(() => _dangLuu = false);
      appToast(context, e.toString().replaceFirst('Exception: ', ''),
          isError: true);
    }
  }

  Future<void> _xoa() async {
    final ok = await showPhoneSheet<bool>(
      context: context,
      title: t('Xoá máy in này?'),
      builder: (c) => Padding(
        padding: const EdgeInsets.fromLTRB(16, 4, 16, 16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
                t('Phiếu đang chờ ở máy in này sẽ không in được nữa. Có thể thêm lại bất cứ lúc nào.'),
                style: const TextStyle(
                    fontSize: 12.5, height: 1.5, color: DanColors.muted)),
            const SizedBox(height: 14),
            PhoneCta(
                label: t('Xoá máy in'),
                onPressed: () => Navigator.of(c).pop(true)),
            const SizedBox(height: 8),
            PhoneSecondaryButton(
                label: t('Giữ lại'),
                onPressed: () => Navigator.of(c).pop(false)),
          ],
        ),
      ),
    );
    if (ok != true || !mounted) return;

    setState(() => _dangLuu = true);
    try {
      final api = context.read<ApiService>();
      final cfg = await _docCauHinh(api);
      final id = '${widget.printer!['id']}';
      final ds = [...((cfg['printers'] as List?) ?? const [])]
          .whereType<Map>()
          .map((e) => Map<String, dynamic>.from(e))
          .where((e) => '${e['id']}' != id)
          .toList();
      await api.saveAppSettings({'print_config': {...cfg, 'printers': ds}});
      if (!mounted) return;
      Navigator.of(context).pop(true);
    } catch (e) {
      if (!mounted) return;
      setState(() => _dangLuu = false);
      appToast(context, e.toString().replaceFirst('Exception: ', ''),
          isError: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    final laLan = _kieuNoi == 'lan';
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
      child: SafeArea(
        top: false,
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              PhoneField(
                label: 'Kiểu kết nối',
                value: t(_kieuNoiLabels[_kieuNoi] ?? ''),
                onTap: () => _chon(
                  t('Kiểu kết nối'),
                  _kieuNoiLabels,
                  _kieuNoi,
                  (k) => setState(() => _kieuNoi = k),
                ),
              ),

              if (!laLan)
                PhoneField(
                  label: 'Máy in của máy này',
                  required: true,
                  value: _tenHeDieuHanh,
                  hint: _dangDo
                      ? t('Đang dò...')
                      : (_mayInCuaMay.isEmpty
                          ? t('Máy này chưa thấy máy in nào')
                          : t('Chọn máy in')),
                  onTap: _mayInCuaMay.isEmpty
                      ? null
                      : () async {
                          await showPhoneSheet<void>(
                            context: context,
                            title: t('Máy in của máy này'),
                            builder: (c) => PhonePickList(
                              options: _mayInCuaMay,
                              selected: _tenHeDieuHanh,
                              onPick: (v) {
                                Navigator.of(c).pop();
                                setState(() {
                                  _tenHeDieuHanh = v;
                                  if (_ten.text.trim().isEmpty) _ten.text = v;
                                });
                              },
                            ),
                          );
                        },
                ),

              PhoneField(
                label: 'Tên hiển thị',
                required: true,
                hint: 'VD: Máy in tại quầy',
                controller: _ten,
              ),

              if (laLan) ...[
                PhoneField(
                  label: 'Địa chỉ IP',
                  required: true,
                  hint: '192.168.1.50',
                  controller: _ip,
                  keyboardType: TextInputType.number,
                ),
                PhoneField(
                  label: 'Cổng',
                  hint: '9100',
                  controller: _cong,
                  keyboardType: TextInputType.number,
                ),
              ],

              PhoneField(
                label: 'Loại phiếu',
                value: t(_loaiPhieuLabels[_loaiPhieu] ?? _loaiPhieu),
                onTap: () => _chon(
                  t('Máy in này in loại phiếu nào'),
                  _loaiPhieuLabels,
                  _loaiPhieu,
                  (k) => setState(() => _loaiPhieu = k),
                ),
              ),
              PhoneSwitchRow(
                label: t('Có nối ngăn kéo đựng tiền'),
                value: _coKet,
                onChanged: (v) => setState(() => _coKet = v),
              ),

              Padding(
                padding: const EdgeInsets.all(16),
                child: Text(
                    laLan
                        ? t('Máy in mạng phải cùng mạng Wi-Fi với máy này. Cổng thường là 9100.')
                        : t('Máy in gắn liền và máy in cắm USB không có địa chỉ IP — chỉ cần chọn đúng tên.'),
                    style: const TextStyle(
                        fontSize: 11.5, height: 1.5, color: DanColors.faint)),
              ),

              Padding(
                padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
                child: Column(
                  children: [
                    PhoneCta(
                      label: t(_laSua ? 'Lưu máy in' : 'Thêm máy in'),
                      busy: _dangLuu,
                      onPressed: _dangLuu ? null : _luu,
                    ),
                    if (_laSua) ...[
                      const SizedBox(height: 8),
                      PhoneSecondaryButton(
                        label: t('Xoá máy in này'),
                        icon: Icons.delete_outline,
                        onPressed: _dangLuu ? null : _xoa,
                      ),
                    ],
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Future<void> _chon(String tieuDe, Map<String, String> nhan, String dangChon,
      void Function(String) khiChon) async {
    await showPhoneSheet<void>(
      context: context,
      title: tieuDe,
      builder: (c) => PhonePickList(
        options: nhan.values.map(t).toList(),
        selected: t(nhan[dangChon] ?? ''),
        onPick: (v) {
          Navigator.of(c).pop();
          khiChon(nhan.entries.firstWhere((e) => t(e.value) == v).key);
        },
      ),
    );
  }
}
