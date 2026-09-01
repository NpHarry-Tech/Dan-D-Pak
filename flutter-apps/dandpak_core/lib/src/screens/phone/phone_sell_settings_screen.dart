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

  /// Bảng giá áp cho POS bán lẻ. Khoá THẬT trên server là
  /// `retail_config.standalone.price_book_id` (xem
  /// `server/services/settings/retail.js`) — bản trước đọc `price_list_name`,
  /// một khoá KHÔNG TỒN TẠI, nên ô này luôn hiện "Chưa chọn" và bấm vào không
  /// làm gì.
  String _bangGiaId = 'default';
  List<Map<String, dynamic>> _bangGia = const [];

  /// `retail_config.sync = true` nghĩa là mục "retail trong POS F&B" dùng chung
  /// cấu hình với POS bán lẻ. Phải giữ nguyên khi lưu, nếu không mỗi lần đổi
  /// bảng giá là vô tình tách đôi hai kênh.
  Map<String, dynamic> _retailConfig = const {};

  bool _dangNap = true;

  /// Có thay đổi chưa gửi lên server. Chỉ tính phần CẤU HÌNH KINH DOANH — thói
  /// quen của máy (bíp/rung) ghi thẳng xuống máy nên không có gì để "lưu".
  bool _coThayDoi = false;
  bool _dangLuu = false;

  /// Bốn phương thức CHUẨN của hệ thống. Bản trước dùng 'card'/'transfer'/'qr'
  /// — server quy hết về cash/bank/visa/voucher (`canonicalMethodKey`), nên ghi
  /// khoá khác là lưu xong đọc lại không khớp và ô này nhảy về "Tiền mặt".
  static const _phuongThuc = {
    'cash': 'Tiền mặt',
    'bank': 'Chuyển khoản',
    'visa': 'Thẻ',
    'voucher': 'Voucher',
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
    List<dynamic> books = const [];
    try {
      final api = context.read<ApiService>();
      cfg = await api.getAppSettings();
      // Danh sách bảng giá hỏng KHÔNG được làm trống cả màn — các thiết lập
      // khác vẫn phải chỉnh được.
      books = await api.getPriceBooks().catchError((_) => <dynamic>[]);
    } catch (_) {/* mất mạng thì vẫn cho chỉnh phần cục bộ */}

    if (!mounted) return;
    final sell = ((cfg['sell_config'] as Map?) ?? const {});
    final rc = ((cfg['retail_config'] as Map?) ?? const {});
    final st = ((rc['standalone'] as Map?) ?? const {});
    setState(() {
      _retailConfig = Map<String, dynamic>.from(rc);
      _bangGia = books
          .whereType<Map>()
          .map((e) => Map<String, dynamic>.from(e))
          .where((e) => '${e['status'] ?? 'active'}' != 'inactive')
          .toList();
      final id = '${st['price_book_id'] ?? ''}';
      _bangGiaId = id.isEmpty ? 'default' : id;
      _chonNhieu = chonNhieu;
      _tiengBip = bip;
      _rungKhiQuet = rung;
      _tuDienTien = dienTien;
      _tuHoanTatKhiNganHangXacNhan = sell['auto_complete_on_bank'] == true;
      _gopHangGiongNhau = sell['merge_same_items'] != false;
      _chiaSeBillSauKhiXong = sell['share_after_done'] == true;
      final pt = '${sell['default_method'] ?? 'cash'}';
      if (_phuongThuc.containsKey(pt)) _phuongThucMacDinh = pt;
      _coThayDoi = false;
      _dangNap = false;
    });
  }

  /// Đổi một thiết lập kinh doanh: chỉ ghi vào bộ nhớ màn hình và bật nút Lưu.
  /// Trước đây mỗi lần gạt công tắc là gửi ngay một request — vừa nặng, vừa
  /// không có cách nào hoàn tác nếu bấm nhầm.
  void _doi(VoidCallback thayDoi) {
    setState(() {
      thayDoi();
      _coThayDoi = true;
    });
  }

  String get _tenBangGia {
    for (final b in _bangGia) {
      if ('${b['id']}' == _bangGiaId) return '${b['name']}';
    }
    return _bangGiaId == 'default' ? t('Bảng giá chung') : _bangGiaId;
  }

  /// Đổi bảng giá áp cho POS bán lẻ. Ghi đúng khoá server đọc lúc tính tiền
  /// (`applyChannelPrice` trong `inventory.js`), nên lưu xong là giá trên màn
  /// bán đổi theo ngay.
  Future<void> _chonBangGia() async {
    if (_bangGia.isEmpty) {
      appToast(context, t('Chưa tải được danh sách bảng giá'), isError: true);
      return;
    }
    await showPhoneSheet<void>(
      context: context,
      title: t('Bảng giá áp dụng khi bán'),
      builder: (c) => PhonePickList(
        options: [for (final b in _bangGia) '${b['name']}'],
        selected: _tenBangGia,
        onPick: (v) {
          Navigator.of(c).pop();
          final chon = _bangGia.firstWhere((b) => '${b['name']}' == v);
          _doi(() => _bangGiaId = '${chon['id']}');
        },
      ),
    );
  }

  Future<void> _luuCucBo(String k, bool v) async {
    await LocalStore.instance.setString('$_k$k', v ? '1' : '0');
  }

  /// Ghi cấu hình kinh doanh lên server.
  ///
  /// Trả `true` khi lưu XONG — nút Lưu và bộ chặn thoát đều dựa vào giá trị
  /// này; lưu hỏng mà báo thành công là mất thiết lập không ai biết.
  Future<bool> _luuServer() async {
    if (_dangLuu) return false;
    setState(() => _dangLuu = true);
    try {
      // Bảng giá nằm trong retail_config; gửi kèm để một lần bấm Lưu là xong
      // hết, không để người dùng đoán ô nào lưu ngay ô nào không.
      final rc = Map<String, dynamic>.from(_retailConfig);
      final st = Map<String, dynamic>.from(
          (rc['standalone'] as Map?) ?? const <String, dynamic>{});
      st['price_book_id'] = _bangGiaId;
      rc['standalone'] = st;

      await context.read<ApiService>().saveAppSettings({
        // Server gộp với cấu hình đang có (xem settings/core.js), nên chỉ cần
        // gửi đúng phần màn này quản.
        'sell_config': {
          'auto_complete_on_bank': _tuHoanTatKhiNganHangXacNhan,
          'merge_same_items': _gopHangGiongNhau,
          'share_after_done': _chiaSeBillSauKhiXong,
          'default_method': _phuongThucMacDinh,
        },
        // sync=true thì server tự chép sang nhánh fnb; giữ nguyên cờ, không tự
        // ý tách hai kênh ra.
        'retail_config': rc,
      });
      if (!mounted) return true;
      setState(() {
        _retailConfig = rc;
        _coThayDoi = false;
        _dangLuu = false;
      });
      appToast(context, t('Đã lưu thiết lập bán hàng'));
      return true;
    } catch (e) {
      if (!mounted) return false;
      setState(() => _dangLuu = false);
      appToast(context, e.toString().replaceFirst('Exception: ', ''),
          isError: true);
      return false;
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

    return PhoneUnsavedGuard(
      dirty: _coThayDoi,
      onSave: _luuServer,
      child: Scaffold(
        backgroundColor: DanColors.bg,
        body: SafeArea(
          bottom: false,
          child: Column(
            children: [
              PhoneHeader(
                title: t('Thiết lập bán hàng'),
                subtitle: _coThayDoi ? t('Có thay đổi chưa lưu') : null,
                subtitleColor: _coThayDoi ? DanColors.late : null,
                onBack: () => Navigator.of(context).maybePop(),
                actions: [
                  PhoneSaveAction(
                    dirty: _coThayDoi,
                    busy: _dangLuu,
                    onSave: _luuServer,
                  ),
                ],
              ),
              Expanded(
                child: ListView(
                  padding: const EdgeInsets.only(bottom: 24),
                  children: [
                    PhoneSectionTitle(t('BẢNG GIÁ')),
                    PhoneField(
                      label: 'Bảng giá áp dụng khi bán',
                      value: _tenBangGia,
                      hint: 'Chọn bảng giá',
                      onTap: _dangLuu ? () {} : _chonBangGia,
                    ),
                    Padding(
                      padding: const EdgeInsets.fromLTRB(16, 10, 16, 2),
                      child: Text(
                          _bangGia.length <= 1
                              ? t(
                                  'Chỉ có Bảng giá chung. Tạo thêm bảng giá ở Cài đặt → Kho & kênh bán.')
                              : '${_bangGia.length} ${t('bảng giá')} · ${t('áp cho POS bán lẻ; giá trên màn bán đổi theo ngay')}',
                          style: const TextStyle(
                              fontSize: 11.5,
                              height: 1.5,
                              color: DanColors.faint)),
                    ),
                    PhoneSectionTitle(t('HÀNG HÓA & QUÉT MÃ')),
                    PhoneSwitchRow(
                      label: t('Chọn nhiều sản phẩm'),
                      hint: t(
                          'Chạm liên tục nhiều mặt hàng không đóng danh sách'),
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
                      hint: t(
                          'Tiền về là chốt bill luôn, thu ngân không phải bấm'),
                      value: _tuHoanTatKhiNganHangXacNhan,
                      onChanged: (v) =>
                          _doi(() => _tuHoanTatKhiNganHangXacNhan = v),
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
                              _doi(() => _phuongThucMacDinh = k);
                            },
                          ),
                        );
                      },
                    ),
                    PhoneSectionTitle(t('IN & CHIA SẺ')),
                    PhoneSwitchRow(
                      label: t('Gộp hàng giống nhau khi in'),
                      value: _gopHangGiongNhau,
                      onChanged: (v) => _doi(() => _gopHangGiongNhau = v),
                    ),
                    PhoneSwitchRow(
                      label: t('Chia sẻ bill sau khi hoàn tất'),
                      value: _chiaSeBillSauKhiXong,
                      onChanged: (v) => _doi(() => _chiaSeBillSauKhiXong = v),
                    ),
                    Padding(
                      padding: const EdgeInsets.all(16),
                      child: Text(
                          t(
                              'Tiếng bíp, rung, chọn nhiều sản phẩm và tự điền tiền '
                              'khách đưa chỉ áp cho MÁY NÀY và lưu ngay khi gạt. '
                              'Các thiết lập còn lại áp cho cả cửa hàng — đổi xong '
                              'phải bấm Lưu ở góc trên bên phải.'),
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
}
