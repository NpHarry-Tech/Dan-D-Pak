import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../services/api_service.dart';
import '../../services/local_store.dart';
import '../../ui/app_theme.dart';
import '../../utils/translation.dart';
import 'phone_kit.dart';
import 'phone_scaffolds.dart';

/// THIẾT LẬP BÁN HÀNG — mục mở nhiều nhất trong Cài đặt.
///
/// LƯU Ở HAI CHỖ KHÁC NHAU, và đây là quyết định có chủ đích:
///
///   • Thói quen của TỪNG MÁY (tiếng bíp, rung, chọn nhiều sản phẩm, tự điền
///     tiền khách đưa) → lưu CỤC BỘ trên máy đó.
///     Đưa lên server là mọi máy dùng chung: tắt tiếng bíp trên máy cầm tay thì
///     máy để bàn ngoài quầy cũng câm theo. Máy cầm tay có loa và mô-tơ rung,
///     máy để bàn thì không — không thể chung một cài đặt.
///
///   • Cấu hình KINH DOANH (bảng giá, phương thức thanh toán mặc định, gộp hàng
///     khi in) → lưu trên SERVER, vì cả cửa hàng phải giống nhau. Hai máy cùng
///     quầy mà áp hai bảng giá khác nhau là sai số tiền.
class PhoneSellSettingsScreen extends StatefulWidget {
  const PhoneSellSettingsScreen({super.key});

  @override
  State<PhoneSellSettingsScreen> createState() =>
      _PhoneSellSettingsScreenState();
}

class _PhoneSellSettingsScreenState extends State<PhoneSellSettingsScreen> {
  // ── Thói quen của máy này (cục bộ) ──────────────────────────────────────
  bool _chonNhieu = true;
  bool _tiengBip = true;
  bool _rungKhiQuet = true;
  bool _tuDienTien = true;

  // ── Cấu hình kinh doanh (server) ────────────────────────────────────────
  bool _tuHoanTatKhiNganHangXacNhan = false;
  bool _gopHangGiongNhau = true;
  bool _chiaSeBillSauKhiXong = false;
  String _phuongThucMacDinh = 'cash';
  String _tenBangGia = '';
  int _soBangGia = 0;

  bool _dangNap = true;

  static const _phuongThuc = {
    'cash': 'Tiền mặt',
    'card': 'Thẻ',
    'transfer': 'Chuyển khoản',
    'qr': 'QR',
  };

  /// Tiền tố khoá cục bộ. Đặt tên rõ để sau này ai đọc LocalStore cũng biết
  /// đây là thói quen máy chứ không phải dữ liệu kinh doanh.
  static const _k = 'sell_pref_';

  @override
  void initState() {
    super.initState();
    _nap();
  }

  Future<void> _nap() async {
    final ls = LocalStore.instance;
    Future<bool> doc(String k, bool macDinh) async {
      final v = await ls.getString('$_k$k');
      return v == null ? macDinh : v == '1';
    }

    final chonNhieu = await doc('multi', true);
    final bip = await doc('beep', true);
    final rung = await doc('vibrate', true);
    final dienTien = await doc('autocash', true);

    Map<String, dynamic> cfg = const {};
    try {
      cfg = await context.read<ApiService>().getAppSettings();
    } catch (_) {/* mất mạng thì vẫn cho chỉnh phần cục bộ */}

    if (!mounted) return;
    final sell = ((cfg['sell_config'] as Map?) ?? const {});
    final rc = ((cfg['retail_config'] as Map?) ?? const {});
    final st = ((rc['standalone'] as Map?) ?? const {});
    setState(() {
      _chonNhieu = chonNhieu;
      _tiengBip = bip;
      _rungKhiQuet = rung;
      _tuDienTien = dienTien;
      _tuHoanTatKhiNganHangXacNhan = sell['auto_complete_on_bank'] == true;
      _gopHangGiongNhau = sell['merge_same_items'] != false;
      _chiaSeBillSauKhiXong = sell['share_after_done'] == true;
      final pt = '${sell['default_method'] ?? 'cash'}';
      if (_phuongThuc.containsKey(pt)) _phuongThucMacDinh = pt;
      _tenBangGia = '${st['price_list_name'] ?? st['priceListName'] ?? ''}';
      _soBangGia = ((rc['price_lists'] as List?) ?? const []).length;
      _dangNap = false;
    });
  }

  Future<void> _luuCucBo(String k, bool v) async {
    await LocalStore.instance.setString('$_k$k', v ? '1' : '0');
  }

  /// Ghi cấu hình kinh doanh lên server. Đọc nguyên khối rồi chỉ sửa phần của
  /// mình — ghi đè cả khối là xoá mất cấu hình của nhóm khác.
  Future<void> _luuServer() async {
    try {
      final api = context.read<ApiService>();
      final all = await api.getAppSettings();
      final cu = Map<String, dynamic>.from(
          (all['sell_config'] as Map?) ?? const {});
      await api.saveAppSettings({
        'sell_config': {
          ...cu,
          'auto_complete_on_bank': _tuHoanTatKhiNganHangXacNhan,
          'merge_same_items': _gopHangGiongNhau,
          'share_after_done': _chiaSeBillSauKhiXong,
          'default_method': _phuongThucMacDinh,
        },
      });
    } catch (e) {
      if (!mounted) return;
      appToast(context, e.toString().replaceFirst('Exception: ', ''),
          isError: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_dangNap) {
      return Scaffold(
        backgroundColor: DanColors.bg,
        body: SafeArea(
          bottom: false,
          child: Column(children: [
            PhoneHeader(
                title: t('Thiết lập bán hàng'),
                onBack: () => Navigator.of(context).maybePop()),
            const Expanded(child: Center(child: CircularProgressIndicator())),
          ]),
        ),
      );
    }

    return Scaffold(
      backgroundColor: DanColors.bg,
      body: SafeArea(
        bottom: false,
        child: Column(
          children: [
            PhoneHeader(
              title: t('Thiết lập bán hàng'),
              onBack: () => Navigator.of(context).maybePop(),
            ),
            Expanded(
              child: ListView(
                padding: const EdgeInsets.only(bottom: 24),
                children: [
                  PhoneSectionTitle(t('BẢNG GIÁ')),
                  PhoneField(
                    label: 'Bảng giá áp dụng khi bán',
                    value: _tenBangGia.isEmpty ? t('Chưa chọn') : _tenBangGia,
                    onTap: null, // đổi bảng giá làm ở mục Kho & kênh bán
                  ),
                  PhoneListRow(
                    title: t('Bảng giá & kênh bán'),
                    subtitle: _soBangGia > 0
                        ? '$_soBangGia ${t('bảng giá')}'
                        : t('Mở mục Kho & kênh bán để thiết lập'),
                  ),

                  PhoneSectionTitle(t('HÀNG HÓA & QUÉT MÃ')),
                  PhoneSwitchRow(
                    label: t('Chọn nhiều sản phẩm'),
                    hint: t('Chạm liên tục nhiều mặt hàng không đóng danh sách'),
                    value: _chonNhieu,
                    onChanged: (v) {
                      setState(() => _chonNhieu = v);
                      _luuCucBo('multi', v);
                    },
                  ),
                  PhoneSwitchRow(
                    label: t('Tiếng bíp khi quét'),
                    value: _tiengBip,
                    onChanged: (v) {
                      setState(() => _tiengBip = v);
                      _luuCucBo('beep', v);
                    },
                  ),
                  PhoneSwitchRow(
                    label: t('Rung khi quét'),
                    value: _rungKhiQuet,
                    onChanged: (v) {
                      setState(() => _rungKhiQuet = v);
                      _luuCucBo('vibrate', v);
                    },
                  ),

                  PhoneSectionTitle(t('THANH TOÁN')),
                  PhoneSwitchRow(
                    label: t('Tự điền tiền khách đưa'),
                    hint: t('Gợi ý đúng số khách cần trả'),
                    value: _tuDienTien,
                    onChanged: (v) {
                      setState(() => _tuDienTien = v);
                      _luuCucBo('autocash', v);
                    },
                  ),
                  PhoneSwitchRow(
                    label: t('Tự hoàn tất khi ngân hàng xác nhận'),
                    value: _tuHoanTatKhiNganHangXacNhan,
                    onChanged: (v) {
                      setState(() => _tuHoanTatKhiNganHangXacNhan = v);
                      _luuServer();
                    },
                  ),
                  PhoneField(
                    label: 'Phương thức mặc định',
                    value: t(_phuongThuc[_phuongThucMacDinh] ?? ''),
                    onTap: () async {
                      await showPhoneSheet<void>(
                        context: context,
                        title: t('Phương thức mặc định'),
                        builder: (c) => PhonePickList(
                          options: _phuongThuc.values.map(t).toList(),
                          selected: t(_phuongThuc[_phuongThucMacDinh] ?? ''),
                          onPick: (v) {
                            Navigator.of(c).pop();
                            final k = _phuongThuc.entries
                                .firstWhere((e) => t(e.value) == v)
                                .key;
                            setState(() => _phuongThucMacDinh = k);
                            _luuServer();
                          },
                        ),
                      );
                    },
                  ),

                  PhoneSectionTitle(t('IN & CHIA SẺ')),
                  PhoneSwitchRow(
                    label: t('Gộp hàng giống nhau khi in'),
                    value: _gopHangGiongNhau,
                    onChanged: (v) {
                      setState(() => _gopHangGiongNhau = v);
                      _luuServer();
                    },
                  ),
                  PhoneSwitchRow(
                    label: t('Chia sẻ bill sau khi hoàn tất'),
                    value: _chiaSeBillSauKhiXong,
                    onChanged: (v) {
                      setState(() => _chiaSeBillSauKhiXong = v);
                      _luuServer();
                    },
                  ),

                  Padding(
                    padding: const EdgeInsets.all(16),
                    child: Text(
                        t('Tiếng bíp, rung, chọn nhiều sản phẩm và tự điền tiền '
                            'khách đưa chỉ áp dụng cho MÁY NÀY. Các thiết lập còn '
                            'lại áp cho cả cửa hàng.'),
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
    );
  }
}
