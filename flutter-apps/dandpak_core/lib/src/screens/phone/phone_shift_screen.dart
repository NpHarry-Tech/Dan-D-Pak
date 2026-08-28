import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../providers/auth_provider.dart';
import '../../providers/pos_provider.dart';
import '../../ui/app_theme.dart';
import '../../utils/business_datetime.dart';
import '../../utils/translation.dart';
import '../management/management_widgets.dart';
import 'phone_kit.dart';
import 'phone_scaffolds.dart';

/// MỞ CA / KẾT CA ngay trên máy điện thoại — POS cầm tay.
///
/// Trước đây bản điện thoại chỉ BÁO "chưa mở ca, mở ở desktop/tablet", nên máy
/// cầm tay đứng một mình là không bán được gì. Màn này dùng ĐÚNG luồng ca của
/// desktop (`PosProvider.openShiftCounts` / `closeShiftCounts` →
/// `POST /api/shifts/open|close`), nên hai bên chung một ca, một két, một báo
/// cáo — không đẻ ra ca riêng của điện thoại.
///
/// Danh sách ca lấy từ CÀI ĐẶT VẬN HÀNH của chi nhánh
/// (`operations_config.shifts.labels`, đã lọc `enabled != false`) chứ không
/// phải danh sách cứng — cửa hàng khai bao nhiêu ca thì ở đây thấy đúng bấy
/// nhiêu.
class PhoneShiftControlScreen extends StatefulWidget {
  const PhoneShiftControlScreen({super.key});

  @override
  State<PhoneShiftControlScreen> createState() =>
      _PhoneShiftControlScreenState();
}

/// Mở màn ca; trả về `true` nếu trạng thái ca ĐÃ ĐỔI (mở hoặc kết) để màn gọi
/// biết mà nạp lại.
Future<bool> moManCa(BuildContext context) async {
  final doi = await Navigator.of(context).push<bool>(
    MaterialPageRoute(builder: (_) => const PhoneShiftControlScreen()),
  );
  return doi == true;
}

class _PhoneShiftControlScreenState extends State<PhoneShiftControlScreen> {
  String _shiftKey = '';

  /// Tiền kiểm đếm người dùng gõ. Rỗng = CHƯA đụng tới → mở ca thì để server
  /// dùng tiền két gốc/ca trước (`cash_manual: false`), y như desktop.
  String _tien = '';

  bool _dangNap = true;
  bool _dangLuu = false;
  bool _daDoi = false;
  String? _loi;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _nap());
  }

  PosProvider get _pos => context.read<PosProvider>();

  Future<void> _nap() async {
    if (mounted) setState(() => _dangNap = true);
    try {
      await _pos.loadShift();
      if (!mounted) return;
      setState(() {
        _dongBoCa();
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

  /// Ca đang chọn: ưu tiên ca của bản ghi đang mở, không có thì lấy ca đầu
  /// danh sách trong cài đặt.
  void _dongBoCa() {
    final labels = _pos.shiftLabels;
    final dangMo = '${_pos.rawShift?['shift_key'] ?? ''}';
    if (labels.any((l) => '${l['key']}' == dangMo)) {
      _shiftKey = dangMo;
    } else if (labels.isNotEmpty && _shiftKey.isEmpty) {
      _shiftKey = '${labels.first['key']}';
    }
  }

  String get _nhanCa {
    final labels = _pos.shiftLabels;
    for (final l in labels) {
      if ('${l['key']}' == _shiftKey) return '${l['label']}';
    }
    return labels.isEmpty ? '' : '${labels.first['label']}';
  }

  num get _soTien => num.tryParse(_tien) ?? 0;

  num _n(dynamic v) => v is num ? v : num.tryParse('${v ?? ''}') ?? 0;

  void _phim(String k) {
    setState(() {
      if (k == 'del') {
        _tien = _tien.isEmpty ? '' : _tien.substring(0, _tien.length - 1);
      } else {
        final next = _tien + k;
        if (next.length <= 12) _tien = next;
      }
    });
  }

  Future<void> _chonCa() async {
    final labels = _pos.shiftLabels;
    if (labels.isEmpty) return;
    await showPhoneSheet<void>(
      context: context,
      title: t('Ca làm việc'),
      builder: (c) => PhonePickList(
        options: [for (final l in labels) '${l['label']}'],
        selected: _nhanCa,
        onPick: (v) {
          Navigator.of(c).pop();
          final found = labels.where((l) => '${l['label']}' == v).toList();
          if (found.isNotEmpty) {
            setState(() => _shiftKey = '${found.first['key']}');
          }
        },
      ),
    );
  }

  // ── Mở ca ───────────────────────────────────────────────────────────────
  Future<void> _moCa() async {
    if (_shiftKey.isEmpty) {
      appToast(context, t('Chọn ca làm việc trước'), isError: true);
      return;
    }
    setState(() => _dangLuu = true);
    try {
      await _pos.openShiftCounts(
        shiftKey: _shiftKey,
        counts: const {},
        openingCash: _soTien.round(),
        // Không gõ tiền = để server lấy tiền két gốc / ca trước, ĐÚNG như
        // desktop. Gõ rồi mới coi là kiểm đếm tay.
        cashManual: _tien.isNotEmpty,
      );
      if (!mounted) return;
      _daDoi = true;
      setState(() {
        _tien = '';
        _dangLuu = false;
      });
      appToast(context, t('Đã mở ca'));
    } catch (e) {
      if (!mounted) return;
      setState(() => _dangLuu = false);
      appToast(context, e.toString().replaceFirst('Exception: ', ''),
          isError: true);
    }
  }

  // ── Kết ca ──────────────────────────────────────────────────────────────
  Future<void> _ketCa() async {
    final ok = await showPhoneSheet<bool>(
      context: context,
      title: t('Kết ca hiện tại?'),
      builder: (c) => Padding(
        padding: const EdgeInsets.fromLTRB(16, 4, 16, 16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(t('Hệ thống chốt báo cáo ca và ĐĂNG XUẤT khỏi máy này — giống hệt bản desktop. Ca đã kết thì không mở lại được.'),
                style: const TextStyle(
                    fontSize: 12.5, height: 1.5, color: DanColors.muted)),
            const SizedBox(height: 14),
            PhoneCta(
                label: t('Kết ca'),
                color: DanColors.late,
                onPressed: () => Navigator.of(c).pop(true)),
            const SizedBox(height: 8),
            PhoneSecondaryButton(
                label: t('Để ca chạy tiếp'),
                onPressed: () => Navigator.of(c).pop(false)),
          ],
        ),
      ),
    );
    if (ok != true || !mounted) return;
    await _guiKetCa();
  }

  Future<void> _guiKetCa({String? pinQuanLy}) async {
    setState(() => _dangLuu = true);
    final auth = context.read<AuthProvider>();
    try {
      await _pos.closeShiftCounts(
        shiftKey: _shiftKey,
        counts: const {},
        closingCash: _soTien.round(),
        managerOverridePin: pinQuanLy,
      );
      if (!mounted) return;
      _daDoi = true;
      appToast(context,
          pinQuanLy == null ? t('Đã kết ca') : t('Đã kết ca (quản lý bỏ qua)'));
      Navigator.of(context).pop(true);
      // Kết ca là hết phiên làm việc — nhả máy cho người sau, đúng luật của
      // bản desktop (giữ nguyên chi nhánh để khỏi chọn lại).
      await auth.logout(keepBranch: true);
    } catch (e) {
      if (!mounted) return;
      setState(() => _dangLuu = false);
      final msg = e.toString().replaceFirst('Exception: ', '');
      // Server chặn kết ca khi còn hóa đơn điện tử lỗi/chưa xuất — cho phép
      // quản lý nhập PIN bỏ qua, y hệt desktop.
      if (msg.contains('hóa đơn') || msg.contains('PIN')) {
        final pin = await _hoiPin(msg);
        if (pin != null && pin.trim().isNotEmpty && mounted) {
          await _guiKetCa(pinQuanLy: pin.trim());
          return;
        }
      }
      appToast(context, msg, isError: true);
    }
  }

  Future<String?> _hoiPin(String canhBao) async {
    final ctrl = TextEditingController();
    final pin = await showPhoneSheet<String>(
      context: context,
      title: t('Cần PIN Quản lý'),
      builder: (c) => Padding(
        padding: const EdgeInsets.fromLTRB(16, 4, 16, 16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(canhBao,
                style: const TextStyle(
                    fontSize: 12.5, height: 1.5, color: DanColors.late)),
            const SizedBox(height: 12),
            TextField(
              controller: ctrl,
              obscureText: true,
              keyboardType: TextInputType.number,
              autofocus: true,
              decoration: InputDecoration(labelText: t('Mã PIN Quản lý')),
            ),
            const SizedBox(height: 14),
            PhoneCta(
                label: t('Bỏ qua & Kết ca'),
                color: DanColors.late,
                onPressed: () => Navigator.of(c).pop(ctrl.text)),
          ],
        ),
      ),
    );
    ctrl.dispose();
    return pin;
  }

  @override
  Widget build(BuildContext context) {
    final pos = context.watch<PosProvider>();
    final auth = context.watch<AuthProvider>();
    final dangMo = pos.currentShift != null;
    final raw = pos.rawShift;
    final bc = pos.shiftReport;
    if (_shiftKey.isEmpty) _dongBoCa();

    final duKien = _n(bc['expected_cash']);

    return Scaffold(
      backgroundColor: DanColors.bg,
      body: SafeArea(
        bottom: false,
        child: Column(
          children: [
            PhoneHeader(
              title: t(dangMo ? 'Ca đang mở' : 'Mở ca làm việc'),
              subtitle: dangMo
                  ? '${raw?['shift_label'] ?? ''} · ${raw?['user_name'] ?? ''}'
                  : t('Chưa mở ca — không bán, không thu tiền được'),
              subtitleColor: dangMo ? const Color(0xFF047857) : DanColors.late,
              onBack: () => Navigator.of(context).pop(_daDoi),
              actions: [
                PhoneIconButton(icon: Icons.refresh, onTap: _nap),
              ],
            ),
            Expanded(
              child: _dangNap
                  ? const Center(child: CircularProgressIndicator())
                  : _loi != null
                      ? Padding(
                          padding: const EdgeInsets.all(24),
                          child:
                              InlineMessage(_loi!, error: true, onRetry: _nap),
                        )
                      : ListView(
                          padding: const EdgeInsets.only(bottom: 20),
                          children: [
                            if (!dangMo)
                              Padding(
                                padding:
                                    const EdgeInsets.fromLTRB(16, 12, 16, 4),
                                child: _banner(t(
                                    'Chưa mở ca — không thể bán, thu tiền hay in bill.')),
                              ),
                            _oTien(dangMo, duKien, pos),
                            PhoneField(
                              label: 'Ca làm việc',
                              value: _nhanCa,
                              hint: 'Chọn ca',
                              // Ca đang mở thì không cho đổi tên ca giữa chừng —
                              // báo cáo ca sẽ lệch với thứ đã ghi lúc mở.
                              onTap: dangMo ? null : _chonCa,
                            ),
                            PhoneInfoCard(
                              rows: [
                                (t('Nhân viên'), auth.currentUser?.name ?? '—'),
                                (
                                  t('Chi nhánh'),
                                  auth.selectedBranch.name.isNotEmpty
                                      ? auth.selectedBranch.name
                                      : auth.selectedBranchId
                                ),
                                if (dangMo &&
                                    '${raw?['opened_at'] ?? ''}'.isNotEmpty)
                                  (
                                    t('Mở lúc'),
                                    BusinessDateTime.dateTime(raw?['opened_at'])
                                  ),
                                if (dangMo)
                                  (
                                    t('Tiền đầu ca'),
                                    phoneMoney(_n(raw?['opening_cash']))
                                  ),
                                if (dangMo)
                                  (
                                    t('Số bill'),
                                    phoneInt(_n(bc['bill_count']))
                                  ),
                                if (dangMo)
                                  (
                                    t('Tiền mặt bán hàng'),
                                    phoneMoney(_n(bc['cash_sales']))
                                  ),
                                if (dangMo)
                                  (t('TIỀN MẶT DỰ KIẾN'), phoneMoney(duKien)),
                              ],
                            ),
                            Padding(
                              padding:
                                  const EdgeInsets.symmetric(horizontal: 10),
                              child: PhoneNumPad(onKey: _phim),
                            ),
                            Padding(
                              padding: const EdgeInsets.fromLTRB(16, 14, 16, 0),
                              child: Text(
                                  dangMo
                                      ? t(
                                          'Không gõ tiền thì hệ thống ghi 0đ kiểm đếm cuối ca. Chênh lệch so với dự kiến vẫn được ghi vào báo cáo.')
                                      : t(
                                          'Không gõ tiền thì hệ thống dùng tiền két gốc / ca trước.'),
                                  style: const TextStyle(
                                      fontSize: 11.5,
                                      height: 1.5,
                                      color: DanColors.faint)),
                            ),
                          ],
                        ),
            ),
            if (!_dangNap && _loi == null)
              PhoneActionBar(
                child: dangMo
                    ? PhoneCta(
                        label: t('Kết ca'),
                        color: DanColors.late,
                        busy: _dangLuu,
                        onPressed: _dangLuu ? null : _ketCa,
                      )
                    : PhoneCta(
                        label: t('Mở ca'),
                        trailing: _tien.isEmpty
                            ? phoneMoney(pos.openingSuggestion)
                            : phoneMoney(_soTien),
                        busy: _dangLuu,
                        onPressed: _dangLuu ? null : _moCa,
                      ),
              ),
          ],
        ),
      ),
    );
  }

  Widget _banner(String msg) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
        decoration: BoxDecoration(
          color: const Color(0xFFFFF1F1),
          borderRadius: BorderRadius.circular(10),
        ),
        child: Row(
          children: [
            const Icon(Icons.lock_outline, size: 18, color: Color(0xFFD94A4A)),
            const SizedBox(width: 10),
            Expanded(
              child: Text(msg,
                  style: const TextStyle(
                      fontSize: 12.5,
                      height: 1.45,
                      fontWeight: FontWeight.w800,
                      color: Color(0xFFD94A4A))),
            ),
          ],
        ),
      );

  /// Ô tiền lớn + các mức bấm nhanh. Ca đang mở thì mức nhanh là "đúng bằng
  /// tiền dự kiến" — thu ngân đếm khớp két là bấm một cái xong.
  Widget _oTien(bool dangMo, num duKien, PosProvider pos) {
    final goiY = dangMo ? duKien : pos.openingSuggestion;
    return Container(
      width: double.infinity,
      color: DanColors.surface,
      padding: const EdgeInsets.fromLTRB(16, 14, 16, 14),
      margin: const EdgeInsets.only(top: 12, bottom: 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(t(dangMo ? 'TIỀN MẶT CUỐI CA' : 'TIỀN MẶT ĐẦU CA'),
              style: const TextStyle(
                  fontSize: 11,
                  fontWeight: FontWeight.w800,
                  letterSpacing: .8,
                  color: DanColors.muted)),
          const SizedBox(height: 4),
          Text(_tien.isEmpty ? phoneMoney(goiY) : phoneMoney(_soTien),
              style: TextStyle(
                  fontSize: 32,
                  fontWeight: FontWeight.w800,
                  letterSpacing: -.6,
                  fontFeatures: const [FontFeature.tabularFigures()],
                  color: _tien.isEmpty ? DanColors.faint : DanColors.text)),
          if (_tien.isEmpty)
            Padding(
              padding: const EdgeInsets.only(top: 2),
              child: Text(
                  t(dangMo ? 'Chưa kiểm đếm' : 'Gợi ý từ ca trước / két gốc'),
                  style: const TextStyle(fontSize: 11, color: DanColors.faint)),
            ),
          const SizedBox(height: 12),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              if (goiY > 0)
                PhoneChip(
                  label: dangMo ? t('Đúng bằng dự kiến') : t('Theo gợi ý'),
                  active: _soTien == goiY && _tien.isNotEmpty,
                  onTap: () => setState(() => _tien = goiY.round().toString()),
                ),
              for (final v in const [500000, 1000000, 2000000, 5000000])
                PhoneChip(
                  label: phoneInt(v),
                  active: _tien.isNotEmpty && _soTien == v,
                  onTap: () => setState(() => _tien = v.toString()),
                ),
              if (_tien.isNotEmpty)
                PhoneChip(
                    label: t('Xoá'), onTap: () => setState(() => _tien = '')),
            ],
          ),
        ],
      ),
    );
  }
}
