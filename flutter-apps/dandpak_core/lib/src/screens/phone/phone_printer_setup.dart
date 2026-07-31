import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../services/api_service.dart';
import '../../ui/app_theme.dart';
import '../../utils/translation.dart';
import 'phone_kit.dart';
import 'phone_scaffolds.dart';

/// NỐI MÁY IN — đặt ngay trong màn Máy in (Nhiều hơn → Máy in).
///
/// Trước đây việc này nằm trong Cài đặt → Kết nối, chung với cấu hình mạng, đồng
/// bộ cloud và lưu trữ. Người dùng đi tìm cách nối máy in thì vào mục "Máy in" là
/// tự nhiên nhất, không ai nghĩ tới "Kết nối". Nay gộp về đúng chỗ đó.
///
/// Chỉ giữ những thứ CẦN để một máy in chạy được:
///   - Máy in mạng (LAN): địa chỉ IP + cổng
///   - Máy in có nối ngăn kéo đựng tiền hay không
/// Phần cấu hình mạng, đồng bộ cloud, lưu trữ vẫn ở Cài đặt trên máy để bàn —
/// chúng không thuộc về việc nối một cái máy in.
class PhonePrinterSetupSheet extends StatefulWidget {
  /// Tuyến in đang sửa. `null` = thêm máy in LAN mới.
  final Map<String, dynamic>? printer;
  const PhonePrinterSetupSheet({super.key, this.printer});

  @override
  State<PhonePrinterSetupSheet> createState() => _PhonePrinterSetupSheetState();
}

class _PhonePrinterSetupSheetState extends State<PhonePrinterSetupSheet> {
  final _ten = TextEditingController();
  final _ip = TextEditingController();
  final _cong = TextEditingController(text: '9100');

  String _loaiPhieu = 'receipt';
  bool _coKet = false;
  bool _dangLuu = false;

  /// Loại phiếu mà máy in này nhận. Khớp `output` ở server
  /// (services/printing.js) — đổi giá trị ở đây là phiếu đi sai máy.
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
      _coKet = p['cashDrawer'] == true || p['openDrawerOnPrint'] == true;
      final out = '${p['output'] ?? 'receipt'}';
      if (_loaiPhieuLabels.containsKey(out)) _loaiPhieu = out;
    }
  }

  @override
  void dispose() {
    _ten.dispose();
    _ip.dispose();
    _cong.dispose();
    super.dispose();
  }

  /// Kiểm tra địa chỉ IP tại chỗ. Server không chặn được chuyện này — gõ sai thì
  /// job xếp hàng rồi hết giờ chờ, thu ngân chỉ thấy "không in được".
  String? _ipSai() {
    final s = _ip.text.trim();
    if (s.isEmpty) return t('Cần nhập địa chỉ IP của máy in');
    final phan = s.split('.');
    if (phan.length != 4) return t('Địa chỉ IP phải có dạng 192.168.1.50');
    for (final x in phan) {
      final n = int.tryParse(x);
      if (n == null || n < 0 || n > 255) {
        return t('Địa chỉ IP phải có dạng 192.168.1.50');
      }
    }
    return null;
  }

  Future<void> _luu() async {
    if (_ten.text.trim().isEmpty) {
      appToast(context, t('Cần đặt tên cho máy in'), isError: true);
      return;
    }
    final loiIp = _ipSai();
    if (loiIp != null) {
      appToast(context, loiIp, isError: true);
      return;
    }
    setState(() => _dangLuu = true);
    try {
      final api = context.read<ApiService>();
      // Đọc cấu hình HIỆN TẠI rồi chỉ thêm/sửa đúng một tuyến. Ghi đè cả khối là
      // xoá mất các máy in khác mà cửa hàng đã khai.
      final all = await api.getAppSettings();
      final cfg = Map<String, dynamic>.from(
          (all['print_config'] as Map?) ?? const {});
      final ds = [...((cfg['printers'] as List?) ?? const [])]
          .whereType<Map>()
          .map((e) => Map<String, dynamic>.from(e))
          .toList();

      final id = _laSua
          ? '${widget.printer!['id']}'
          : 'lan_${DateTime.now().millisecondsSinceEpoch}';
      final tuyen = {
        'id': id,
        'name': _ten.text.trim(),
        'label': _ten.text.trim(),
        'output': _loaiPhieu,
        'connection': 'lan',
        'ip': _ip.text.trim(),
        'port': int.tryParse(_cong.text.trim()) ?? 9100,
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

      await api.saveAppSettings({
        'print_config': {...cfg, 'printers': ds},
      });
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
                label: 'Tên máy in',
                required: true,
                hint: 'VD: Máy in bếp',
                controller: _ten,
              ),
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
              PhoneField(
                label: 'Loại phiếu',
                value: t(_loaiPhieuLabels[_loaiPhieu] ?? _loaiPhieu),
                onTap: () async {
                  await showPhoneSheet<void>(
                    context: context,
                    title: t('Máy in này in loại phiếu nào'),
                    builder: (c) => PhonePickList(
                      options: _loaiPhieuLabels.values.map(t).toList(),
                      selected: t(_loaiPhieuLabels[_loaiPhieu] ?? ''),
                      onPick: (v) {
                        Navigator.of(c).pop();
                        final k = _loaiPhieuLabels.entries
                            .firstWhere((e) => t(e.value) == v)
                            .key;
                        setState(() => _loaiPhieu = k);
                      },
                    ),
                  );
                },
              ),
              PhoneSwitchRow(
                label: t('Có nối ngăn kéo đựng tiền'),
                value: _coKet,
                onChanged: (v) => setState(() => _coKet = v),
              ),
              Padding(
                padding: const EdgeInsets.all(16),
                child: Text(
                    t('Máy in phải cùng mạng Wi-Fi với máy này. Cổng thường là 9100 — chỉ đổi khi hãng máy in ghi số khác.'),
                    style: const TextStyle(
                        fontSize: 11.5, height: 1.5, color: DanColors.faint)),
              ),
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
                child: PhoneCta(
                  label: t(_laSua ? 'Lưu máy in' : 'Thêm máy in'),
                  busy: _dangLuu,
                  onPressed: _dangLuu ? null : _luu,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
