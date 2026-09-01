import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart' show rootBundle;
import 'package:provider/provider.dart';

import '../../services/api_service.dart';
import '../../services/socket_service.dart';
import '../../ui/app_theme.dart';
import '../../ui/sound_player.dart';
import '../../utils/translation.dart';
import '../management/management_widgets.dart';
import '../management/settings_tab.dart' show settingsPin;
import 'phone_kit.dart';
import 'phone_scaffolds.dart';

/// BỐN MỤC CÀI ĐẶT dựng riêng cho màn nhỏ: Kho & kênh bán · Cấu hình bàn ·
/// Cấu hình thông báo · Chi nhánh.
///
/// Trước đây bốn mục này bọc thẳng panel của desktop trong khung điện thoại.
/// Vào được, nhưng các panel đó đặt bề rộng cứng 300–380px và xếp nhãn + ô nhập
/// + nút trên MỘT hàng ngang — trên máy Sunmi rộng ~393dp thì tràn và bấm trượt.
///
/// Bản này gọi ĐÚNG các API mà panel desktop gọi, giữ nguyên mọi luật (PIN quản
/// lý khi sửa cấu hình, kênh bán của kho, đồng bộ retail F&B), chỉ đổi cách bày:
/// danh sách dọc, mỗi thao tác một màn, nút chính ghim đáy.

String _s(dynamic v) => '${v ?? ''}';
bool _flag(dynamic v) => v == true || v == 1 || v == '1';

// ═══════════════════════════════════════════════════════════════════════════
// 1. KHO & KÊNH BÁN
// ═══════════════════════════════════════════════════════════════════════════

/// Kênh bán mà một kho có thể nối tới. Giữ ĐÚNG danh sách của desktop —
/// server lưu thẳng các khoá này vào `warehouses.sales_channels`.
const _kenhBan = <(String, String)>[
  ('retail', 'Retail POS'),
  ('pos', 'POS nhà hàng'),
  ('ipad', 'iPad self-order'),
  ('online', 'Kênh online chung'),
  ('grabmerchant', 'GrabFood / GrabMerchant'),
  ('shopeefood', 'ShopeeFood'),
  ('befood', 'beFood'),
  ('grabmart', 'GrabMart'),
  ('website', 'Website order'),
];

class PhoneWarehouseSettingsScreen extends StatefulWidget {
  const PhoneWarehouseSettingsScreen({super.key});

  @override
  State<PhoneWarehouseSettingsScreen> createState() =>
      _PhoneWarehouseSettingsScreenState();
}

class _PhoneWarehouseSettingsScreenState
    extends State<PhoneWarehouseSettingsScreen> {
  List<Map<String, dynamic>> _khos = [];
  List<Map<String, dynamic>> _bangGia = [];
  Map<String, dynamic> _retailCfg = {
    'sync': true,
    'standalone': {'warehouse_id': '', 'price_book_id': 'default'},
    'fnb': {'warehouse_id': '', 'price_book_id': 'default'},
  };

  bool _dangNap = true;
  bool _dangLuuCfg = false;
  bool _coThayDoi = false;
  String? _loi;

  ApiService get _api => context.read<ApiService>();

  @override
  void initState() {
    super.initState();
    _nap();
  }

  Future<void> _nap() async {
    if (mounted) setState(() => _dangNap = true);
    try {
      final khos = await _api.getWarehouses();
      // Bảng giá / cấu hình retail hỏng KHÔNG được làm trống danh sách kho.
      final books = await _api.getPriceBooks().catchError((_) => <dynamic>[]);
      final st =
          await _api.getAppSettings().catchError((_) => <String, dynamic>{});
      if (!mounted) return;
      setState(() {
        _khos = khos
            .whereType<Map>()
            .map((e) => Map<String, dynamic>.from(e))
            .toList();
        _bangGia = books
            .whereType<Map>()
            .map((e) => Map<String, dynamic>.from(e))
            .toList();
        if (st['retail_config'] is Map) {
          _retailCfg =
              _chuanHoa(Map<String, dynamic>.from(st['retail_config']));
        }
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

  Map<String, dynamic> _chuanHoa(Map<String, dynamic> raw) {
    Map<String, dynamic> phan(dynamic v) => {
          'warehouse_id': _s(v is Map ? v['warehouse_id'] : ''),
          'price_book_id': _s(v is Map ? v['price_book_id'] : '').isEmpty
              ? 'default'
              : _s(v is Map ? v['price_book_id'] : ''),
        };
    return {
      'sync': raw['sync'] != false,
      'standalone': phan(raw['standalone']),
      'fnb': phan(raw['fnb']),
    };
  }

  /// Chỉ đổi trong bộ nhớ màn hình rồi bật nút Lưu ở góc trên. Trước đây mỗi
  /// lần chọn là gửi ngay một request — bấm nhầm là cửa hàng lấy hàng sai kho
  /// mà không kịp hoàn tác.
  void _doi(VoidCallback thayDoi) {
    setState(() {
      thayDoi();
      _coThayDoi = true;
    });
  }

  Future<bool> _luuCfg() async {
    if (_dangLuuCfg) return false;
    setState(() => _dangLuuCfg = true);
    try {
      await _api.saveAppSettings({'retail_config': _retailCfg});
      if (!mounted) return true;
      setState(() {
        _coThayDoi = false;
        _dangLuuCfg = false;
      });
      appToast(context, t('Đã lưu cấu hình bán retail'));
      return true;
    } catch (e) {
      if (!mounted) return false;
      setState(() => _dangLuuCfg = false);
      appToast(context, e.toString().replaceFirst('Exception: ', ''),
          isError: true);
      return false;
    }
  }

  String _tenKho(String id) {
    if (id.isEmpty) return t('Theo liên kết kênh bán');
    for (final w in _khos) {
      if (_s(w['id']) == id) return _s(w['name']);
    }
    return id;
  }

  String _tenBangGia(String id) {
    for (final b in _bangGia) {
      if (_s(b['id']) == id) return _s(b['name']);
    }
    return id == 'default' ? t('Bảng giá chung') : id;
  }

  Future<void> _suaKho(Map<String, dynamic>? kho) async {
    final ok = await Navigator.of(context).push<bool>(
      MaterialPageRoute(builder: (_) => _KhoFormScreen(kho: kho)),
    );
    if (ok == true) _nap();
  }

  Future<void> _themBangGia() async {
    final ctrl = TextEditingController();
    final ten = await showPhoneSheet<String>(
      context: context,
      title: t('Tạo bảng giá'),
      builder: (c) => Padding(
        padding: const EdgeInsets.fromLTRB(16, 4, 16, 16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(
              controller: ctrl,
              autofocus: true,
              decoration: InputDecoration(
                  labelText: t('Tên bảng giá'), hintText: t('VD: Giá sỉ')),
            ),
            const SizedBox(height: 14),
            PhoneCta(
                label: t('Tạo bảng giá'),
                onPressed: () => Navigator.of(c).pop(ctrl.text.trim())),
          ],
        ),
      ),
    );
    ctrl.dispose();
    if (ten == null || ten.isEmpty || !mounted) return;
    try {
      await _api.savePriceBook({'name': ten, 'status': 'active'});
      if (!mounted) return;
      appToast(context, '${t('Đã tạo bảng giá')} $ten');
      _nap();
    } catch (e) {
      if (!mounted) return;
      appToast(context, e.toString().replaceFirst('Exception: ', ''),
          isError: true);
    }
  }

  Future<void> _xoaBangGia(Map<String, dynamic> b) async {
    final id = _s(b['id']);
    if (id == 'default' || b['builtin'] == true) {
      appToast(context, t('Không xoá được bảng giá chung'), isError: true);
      return;
    }
    final ok = await showPhoneSheet<bool>(
      context: context,
      title: '${t('Xoá')} ${_s(b['name'])}?',
      builder: (c) => Padding(
        padding: const EdgeInsets.fromLTRB(16, 4, 16, 16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(t('Giá riêng của các mặt hàng trong bảng giá này sẽ mất. Kênh nào đang áp bảng giá này sẽ quay về giá chung.'),
                style: const TextStyle(
                    fontSize: 12.5, height: 1.5, color: DanColors.muted)),
            const SizedBox(height: 14),
            PhoneCta(
                label: t('Xoá bảng giá'),
                color: DanColors.late,
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
    try {
      await _api.deletePriceBook(id);
      if (!mounted) return;
      _nap();
    } catch (e) {
      if (!mounted) return;
      appToast(context, e.toString().replaceFirst('Exception: ', ''),
          isError: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    return PhoneUnsavedGuard(
      dirty: _coThayDoi,
      onSave: _luuCfg,
      child: Scaffold(
        backgroundColor: DanColors.bg,
        body: SafeArea(
          bottom: false,
          child: Column(
            children: [
              PhoneHeader(
                title: t('Kho & kênh bán'),
                subtitle: _dangNap
                    ? null
                    : (_coThayDoi
                        ? t('Có thay đổi chưa lưu')
                        : '${_khos.length} ${t('kho')} · ${_bangGia.length} ${t('bảng giá')}'),
                subtitleColor: _coThayDoi ? DanColors.late : null,
                onBack: () => Navigator.of(context).maybePop(),
                actions: [
                  PhoneSaveAction(
                      dirty: _coThayDoi, busy: _dangLuuCfg, onSave: _luuCfg),
                  if (!_coThayDoi)
                    PhoneIconButton(icon: Icons.refresh, onTap: _nap),
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
                        : RefreshIndicator(
                            onRefresh: _nap,
                            child: ListView(
                              padding: const EdgeInsets.only(bottom: 20),
                              children: [
                                PhoneSectionTitle(
                                    t('BÁN RETAIL LẤY HÀNG Ở ĐÂU')),
                                _cfgRetail(),
                                PhoneSectionTitle(
                                  t('KHO'),
                                  trailing: PhoneChip(
                                      label: t('+ Tạo kho'),
                                      onTap: () => _suaKho(null)),
                                ),
                                if (_khos.isEmpty)
                                  PhoneEmpty(
                                      title: t('Chưa có kho nào'),
                                      hint: t('Tạo kho để gán kênh bán'),
                                      icon: Icons.warehouse_outlined)
                                else
                                  for (final w in _khos) _dongKho(w),
                                PhoneSectionTitle(
                                  t('BẢNG GIÁ'),
                                  trailing: PhoneChip(
                                      label: t('+ Tạo bảng giá'),
                                      onTap: _themBangGia),
                                ),
                                for (final b in _bangGia) _dongBangGia(b),
                                Padding(
                                  padding:
                                      const EdgeInsets.fromLTRB(16, 14, 16, 0),
                                  child: Text(
                                      t(
                                          'Đặt giá riêng cho từng mặt hàng trong một bảng giá làm ở màn Kho trên máy để bàn — ở đây tạo/xoá bảng giá và chọn bảng giá áp cho từng kênh.'),
                                      style: const TextStyle(
                                          fontSize: 11.5,
                                          height: 1.5,
                                          color: DanColors.faint)),
                                ),
                              ],
                            ),
                          ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _cfgRetail() {
    final sync = _retailCfg['sync'] != false;
    final st = Map<String, dynamic>.from(_retailCfg['standalone'] as Map);
    final fnb = Map<String, dynamic>.from(_retailCfg['fnb'] as Map);
    // Kho bếp không bán retail — desktop cũng lọc như vậy.
    final khoRetail = _khos.where((w) => _s(w['type']) != 'kitchen').toList();

    Future<void> chonKho(String phan) async {
      await showPhoneSheet<void>(
        context: context,
        title: t('Kho lấy hàng'),
        builder: (c) => PhonePickList(
          options: [
            t('Theo liên kết kênh bán'),
            for (final w in khoRetail) _s(w['name']),
          ],
          selected: _tenKho(_s((_retailCfg[phan] as Map)['warehouse_id'])),
          onPick: (v) {
            Navigator.of(c).pop();
            final id = v == t('Theo liên kết kênh bán')
                ? ''
                : _s(khoRetail.firstWhere((w) => _s(w['name']) == v)['id']);
            _doi(() {
              (_retailCfg[phan] as Map)['warehouse_id'] = id;
              if (sync && phan == 'standalone') {
                _retailCfg['fnb'] =
                    Map<String, dynamic>.from(_retailCfg['standalone'] as Map);
              }
            });
          },
        ),
      );
    }

    Future<void> chonBangGia(String phan) async {
      await showPhoneSheet<void>(
        context: context,
        title: t('Bảng giá'),
        builder: (c) => PhonePickList(
          options: [for (final b in _bangGia) _s(b['name'])],
          selected: _tenBangGia(_s((_retailCfg[phan] as Map)['price_book_id'])),
          onPick: (v) {
            Navigator.of(c).pop();
            final id = _s(_bangGia.firstWhere((b) => _s(b['name']) == v)['id']);
            _doi(() {
              (_retailCfg[phan] as Map)['price_book_id'] = id;
              if (sync && phan == 'standalone') {
                _retailCfg['fnb'] =
                    Map<String, dynamic>.from(_retailCfg['standalone'] as Map);
              }
            });
          },
        ),
      );
    }

    return Column(
      children: [
        PhoneToggleRow(
          label: 'Dùng chung cho cả hai kênh retail',
          hint:
              'POS bán lẻ và mục retail trong POS nhà hàng dùng cùng kho, cùng bảng giá',
          value: sync,
          onChanged: (v) {
            _doi(() {
              _retailCfg['sync'] = v;
              if (v) {
                _retailCfg['fnb'] =
                    Map<String, dynamic>.from(_retailCfg['standalone'] as Map);
              }
            });
          },
        ),
        PhoneField(
          label: sync ? 'Kho lấy hàng' : 'Kho lấy hàng — POS bán lẻ',
          value: _tenKho(_s(st['warehouse_id'])),
          onTap: _dangLuuCfg ? () {} : () => chonKho('standalone'),
        ),
        PhoneField(
          label: sync ? 'Bảng giá' : 'Bảng giá — POS bán lẻ',
          value: _tenBangGia(_s(st['price_book_id'])),
          onTap: _dangLuuCfg ? () {} : () => chonBangGia('standalone'),
        ),
        if (!sync) ...[
          PhoneField(
            label: 'Kho lấy hàng — retail trong POS nhà hàng',
            value: _tenKho(_s(fnb['warehouse_id'])),
            onTap: _dangLuuCfg ? () {} : () => chonKho('fnb'),
          ),
          PhoneField(
            label: 'Bảng giá — retail trong POS nhà hàng',
            value: _tenBangGia(_s(fnb['price_book_id'])),
            onTap: _dangLuuCfg ? () {} : () => chonBangGia('fnb'),
          ),
        ],
      ],
    );
  }

  Widget _dongKho(Map<String, dynamic> w) {
    final kenh = (w['sales_channels'] as List?) ?? const [];
    final bat = w['active'] != false;
    return PhoneListRow(
      title: _s(w['name']),
      subtitle: [
        if (_s(w['code']).isNotEmpty) _s(w['code']),
        _s(w['type']) == 'kitchen' ? t('Kho bếp / vật dụng') : t('Kho retail'),
        if (kenh.isEmpty)
          t('Chưa nối kênh bán hàng')
        else
          kenh
              .map((c) => _kenhBan
                  .firstWhere((e) => e.$1 == _s(c), orElse: () => ('', _s(c)))
                  .$2)
              .join(', '),
      ].join(' · '),
      badge: bat ? t('Đang bật') : t('Đang tắt'),
      badgeTone: bat ? PhoneTone.ok : PhoneTone.neutral,
      onTap: () => _suaKho(w),
    );
  }

  Widget _dongBangGia(Map<String, dynamic> b) {
    final builtin = b['builtin'] == true || _s(b['id']) == 'default';
    return PhoneListRow(
      title: _s(b['name']),
      subtitle: builtin
          ? t('Giá chung của hàng hóa · không sửa/xoá được')
          : '${_s(b['item_count'])} ${t('mặt hàng có giá riêng')} · ${t('chạm để xoá')}',
      badge: builtin ? t('Mặc định') : null,
      onTap: builtin ? null : () => _xoaBangGia(b),
    );
  }
}

/// Tạo / sửa MỘT kho.
class _KhoFormScreen extends StatefulWidget {
  final Map<String, dynamic>? kho;
  const _KhoFormScreen({this.kho});

  @override
  State<_KhoFormScreen> createState() => _KhoFormScreenState();
}

class _KhoFormScreenState extends State<_KhoFormScreen> {
  final _ten = TextEditingController();
  final _ma = TextEditingController();
  final _thuTu = TextEditingController();
  String _loai = 'retail';
  bool _bat = true;
  Set<String> _kenh = {};
  bool _dangLuu = false;
  bool _coThayDoi = false;

  /// Gõ dở một cái kho rồi bấm back là mất sạch — cờ này để bộ chặn thoát hỏi
  /// lại trước khi đóng màn.
  void _doi([VoidCallback? thayDoi]) {
    setState(() {
      thayDoi?.call();
      _coThayDoi = true;
    });
  }

  bool get _laSua => widget.kho != null;

  @override
  void initState() {
    super.initState();
    final w = widget.kho;
    if (w != null) {
      _ten.text = _s(w['name']);
      _ma.text = _s(w['code']);
      _thuTu.text = _s(w['sort']);
      _loai = _s(w['type']) == 'kitchen' ? 'kitchen' : 'retail';
      _bat = w['active'] != false;
      _kenh = ((w['sales_channels'] as List?) ?? const [])
          .map(_s)
          .where((e) => e.isNotEmpty)
          .toSet();
    } else {
      // Kho mới mặc định phục vụ bán lẻ — đúng thứ máy cầm tay cần nhất.
      _kenh = {'retail'};
    }
  }

  @override
  void dispose() {
    _ten.dispose();
    _ma.dispose();
    _thuTu.dispose();
    super.dispose();
  }

  /// Trả `true` khi đã ghi xong lên server. KHÔNG tự đóng màn — bộ chặn thoát
  /// dùng lại đúng hàm này rồi mới tự đóng.
  Future<bool> _luu() async {
    final ten = _ten.text.trim();
    if (ten.isEmpty) {
      appToast(context, t('Nhập tên kho'), isError: true);
      return false;
    }
    // Sửa cấu hình kho vẫn PHẢI có PIN quản lý, y như bản desktop — đây là thứ
    // quyết định hàng bán ra trừ vào kho nào.
    final pin = await settingsPin(
        context, _laSua ? t('Cập nhật kho "$ten".') : t('Tạo kho "$ten".'));
    if (pin == null || !mounted) return false;

    setState(() => _dangLuu = true);
    try {
      final api = context.read<ApiService>();
      final body = <String, dynamic>{
        'name': ten,
        'code': _ma.text.trim(),
        'type': _loai,
        'active': _bat,
        'sales_channels': _kenh.toList(),
        'security_pin': pin,
      };
      final thuTu = int.tryParse(_thuTu.text.trim());
      if (thuTu != null) body['sort'] = thuTu;

      if (_laSua) {
        await api.updateWarehouse(_s(widget.kho!['id']), body);
      } else {
        await api.createWarehouse(body);
      }
      if (!mounted) return true;
      setState(() => _coThayDoi = false);
      return true;
    } catch (e) {
      if (!mounted) return false;
      setState(() => _dangLuu = false);
      appToast(context, e.toString().replaceFirst('Exception: ', ''),
          isError: true);
      return false;
    }
  }

  Future<void> _luuVaThoat() async {
    if (await _luu() && mounted) Navigator.of(context).pop(true);
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
                title: t(_laSua ? 'Sửa kho' : 'Tạo kho'),
                subtitle: _coThayDoi ? t('Chưa lưu') : null,
                subtitleColor: _coThayDoi ? DanColors.late : null,
                onBack: () => Navigator.of(context).maybePop(),
                actions: [
                  PhoneSaveAction(
                      dirty: _coThayDoi, busy: _dangLuu, onSave: _luuVaThoat),
                ],
              ),
              Expanded(
                child: ListView(
                  padding: const EdgeInsets.only(bottom: 20),
                  children: [
                    PhoneField(
                        label: 'Tên kho',
                        required: true,
                        hint: 'VD: Kho quầy Thủ Đức',
                        controller: _ten,
                        onChanged: (_) => _doi()),
                    PhoneField(
                        label: 'Mã kho',
                        hint: 'VD: KHO-TD',
                        controller: _ma,
                        onChanged: (_) => _doi()),
                    PhoneField(
                      label: 'Loại kho',
                      value: t(_loai == 'kitchen'
                          ? 'Kho bếp / vật dụng'
                          : 'Kho retail / showroom'),
                      onTap: () async {
                        const map = {
                          'retail': 'Kho retail / showroom',
                          'kitchen': 'Kho bếp / vật dụng',
                        };
                        await showPhoneSheet<void>(
                          context: context,
                          title: t('Loại kho'),
                          builder: (c) => PhonePickList(
                            options: map.values.map(t).toList(),
                            selected: t(map[_loai] ?? ''),
                            onPick: (v) {
                              Navigator.of(c).pop();
                              _doi(() => _loai = map.entries
                                  .firstWhere((e) => t(e.value) == v)
                                  .key);
                            },
                          ),
                        );
                      },
                    ),
                    PhoneField(
                        label: 'Thứ tự hiển thị',
                        hint: '0',
                        controller: _thuTu,
                        keyboardType: TextInputType.number,
                        onChanged: (_) => _doi()),
                    PhoneToggleRow(
                      label: 'Đang sử dụng',
                      hint:
                          'Tắt thì kho không còn được chọn khi bán / nhập hàng',
                      value: _bat,
                      onChanged: (v) => _doi(() => _bat = v),
                    ),
                    PhoneSectionTitle(t('KÊNH BÁN NỐI VỚI KHO NÀY')),
                    for (final (key, nhan) in _kenhBan)
                      PhoneToggleRow(
                        label: nhan,
                        value: _kenh.contains(key),
                        onChanged: (v) => _doi(() {
                          if (v) {
                            _kenh.add(key);
                          } else {
                            _kenh.remove(key);
                          }
                        }),
                      ),
                    Padding(
                      padding: const EdgeInsets.fromLTRB(16, 14, 16, 0),
                      child: Text(
                          t(
                              'Kênh nào nối tới kho này thì hàng bán qua kênh đó trừ tồn ở đây. Không nối kênh nào thì kho chỉ dùng để nhập/chuyển hàng.'),
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
                  label: t(_laSua ? 'Lưu kho' : 'Tạo kho'),
                  busy: _dangLuu,
                  onPressed: _dangLuu ? null : _luuVaThoat,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. CẤU HÌNH BÀN
// ═══════════════════════════════════════════════════════════════════════════

class PhoneTablesSettingsScreen extends StatefulWidget {
  const PhoneTablesSettingsScreen({super.key});

  @override
  State<PhoneTablesSettingsScreen> createState() =>
      _PhoneTablesSettingsScreenState();
}

class _PhoneTablesSettingsScreenState extends State<PhoneTablesSettingsScreen> {
  List<Map<String, dynamic>> _ban = [];
  bool _dangNap = true;
  String? _loi;

  ApiService get _api => context.read<ApiService>();

  @override
  void initState() {
    super.initState();
    _nap();
  }

  Future<void> _nap() async {
    if (mounted) setState(() => _dangNap = true);
    try {
      final rows = await _api.getTables();
      if (!mounted) return;
      setState(() {
        _ban = rows
            .whereType<Map>()
            .map((e) => Map<String, dynamic>.from(e))
            .toList();
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

  /// Nhóm theo khu vực, giữ thứ tự server trả về.
  Map<String, List<Map<String, dynamic>>> get _theoKhu {
    final out = <String, List<Map<String, dynamic>>>{};
    for (final b in _ban) {
      final khu = _s(b['zone']).isEmpty ? t('Chưa đặt khu vực') : _s(b['zone']);
      out.putIfAbsent(khu, () => []).add(b);
    }
    return out;
  }

  Future<void> _sua(Map<String, dynamic>? ban) async {
    final ok = await Navigator.of(context).push<bool>(
      MaterialPageRoute(builder: (_) => _BanFormScreen(ban: ban)),
    );
    if (ok == true) _nap();
  }

  @override
  Widget build(BuildContext context) {
    final nhom = _theoKhu;
    return Scaffold(
      backgroundColor: DanColors.bg,
      body: SafeArea(
        bottom: false,
        child: Column(
          children: [
            PhoneHeader(
              title: t('Cấu hình bàn'),
              subtitle: _dangNap
                  ? null
                  : '${_ban.length} ${t('bàn')} · ${nhom.length} ${t('khu vực')}',
              onBack: () => Navigator.of(context).maybePop(),
              actions: [
                PhoneIconButton(icon: Icons.add, onTap: () => _sua(null)),
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
                      : _ban.isEmpty
                          ? PhoneEmpty(
                              title: t('Chưa có bàn nào'),
                              hint: t('Chạm dấu + để thêm bàn'),
                              icon: Icons.table_restaurant_outlined)
                          : RefreshIndicator(
                              onRefresh: _nap,
                              child: ListView(
                                padding: const EdgeInsets.only(bottom: 20),
                                children: [
                                  for (final e in nhom.entries) ...[
                                    PhoneSectionTitle(e.key),
                                    for (final b in e.value)
                                      PhoneListRow(
                                        title: '${t('Bàn')} ${_s(b['code'])}',
                                        subtitle:
                                            '${_s(b['seats'])} ${t('chỗ')}',
                                        badge: _s(b['status']).isEmpty
                                            ? t('Trống')
                                            : _s(b['status']),
                                        onTap: () => _sua(b),
                                      ),
                                  ],
                                  Padding(
                                    padding: const EdgeInsets.fromLTRB(
                                        16, 14, 16, 0),
                                    child: Text(
                                        t(
                                            'Chạm một bàn để sửa hoặc xoá. Sơ đồ bàn kéo thả nằm ở bản máy để bàn.'),
                                        style: const TextStyle(
                                            fontSize: 11.5,
                                            height: 1.5,
                                            color: DanColors.faint)),
                                  ),
                                ],
                              ),
                            ),
            ),
          ],
        ),
      ),
    );
  }
}

class _BanFormScreen extends StatefulWidget {
  final Map<String, dynamic>? ban;
  const _BanFormScreen({this.ban});

  @override
  State<_BanFormScreen> createState() => _BanFormScreenState();
}

class _BanFormScreenState extends State<_BanFormScreen> {
  final _khu = TextEditingController();
  final _ma = TextEditingController();
  final _cho = TextEditingController(text: '4');
  bool _dangLuu = false;

  bool get _laSua => widget.ban != null;

  @override
  void initState() {
    super.initState();
    final b = widget.ban;
    if (b != null) {
      _khu.text = _s(b['zone']);
      _ma.text = _s(b['code']);
      _cho.text = _s(b['seats']).isEmpty ? '4' : _s(b['seats']);
    }
  }

  @override
  void dispose() {
    _khu.dispose();
    _ma.dispose();
    _cho.dispose();
    super.dispose();
  }

  Future<void> _luu() async {
    if (_khu.text.trim().isEmpty || _ma.text.trim().isEmpty) {
      appToast(context, t('Cần nhập khu vực và số bàn'), isError: true);
      return;
    }
    final pin = await settingsPin(
        context,
        _laSua
            ? t('Cập nhật bàn "${_ma.text.trim()}".')
            : t('Tạo bàn "${_ma.text.trim()}".'));
    if (pin == null || !mounted) return;

    setState(() => _dangLuu = true);
    try {
      final api = context.read<ApiService>();
      final body = {
        'zone': _khu.text.trim(),
        'code': _ma.text.trim(),
        'seats': int.tryParse(_cho.text.trim()) ?? 4,
        'security_pin': pin,
      };
      if (_laSua) {
        await api.updateTable(_s(widget.ban!['id']), body);
      } else {
        await api.createTable(body);
      }
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
      title: '${t('Xoá bàn')} ${_s(widget.ban!['code'])}?',
      builder: (c) => Padding(
        padding: const EdgeInsets.fromLTRB(16, 4, 16, 16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            PhoneCta(
                label: t('Xoá bàn'),
                color: DanColors.late,
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
    final pin =
        await settingsPin(context, t('Xoá bàn "${_s(widget.ban!['code'])}".'));
    if (pin == null || !mounted) return;
    setState(() => _dangLuu = true);
    try {
      await context.read<ApiService>().deleteTable(_s(widget.ban!['id']), pin);
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
    return Scaffold(
      backgroundColor: DanColors.bg,
      body: SafeArea(
        bottom: false,
        child: Column(
          children: [
            PhoneHeader(
              title: t(_laSua ? 'Sửa bàn' : 'Thêm bàn'),
              onBack: () => Navigator.of(context).maybePop(),
            ),
            Expanded(
              child: ListView(
                padding: const EdgeInsets.only(bottom: 20),
                children: [
                  PhoneField(
                      label: 'Khu vực',
                      required: true,
                      hint: 'VD: Tầng 1, Sân vườn',
                      controller: _khu),
                  PhoneField(
                      label: 'Số bàn / Mã bàn',
                      required: true,
                      hint: 'VD: A01',
                      controller: _ma),
                  PhoneField(
                      label: 'Số chỗ ngồi',
                      hint: '4',
                      controller: _cho,
                      keyboardType: TextInputType.number),
                ],
              ),
            ),
            PhoneActionBar(
              child: Column(
                children: [
                  PhoneCta(
                    label: t(_laSua ? 'Lưu bàn' : 'Tạo bàn'),
                    busy: _dangLuu,
                    onPressed: _dangLuu ? null : _luu,
                  ),
                  if (_laSua) ...[
                    const SizedBox(height: 8),
                    PhoneSecondaryButton(
                        label: t('Xoá bàn này'),
                        icon: Icons.delete_outline,
                        onPressed: _dangLuu ? null : _xoa),
                  ],
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. CẤU HÌNH THÔNG BÁO
// ═══════════════════════════════════════════════════════════════════════════

/// Sự kiện có âm riêng: khoá · nhãn · âm mặc định. Khớp DEFAULT_EVENTS của web.
const _suKienAm = <(String, String, String)>[
  ('online_order', 'Đơn hàng online mới', 'Doorbell'),
  ('table_order', 'Khách tự gọi món (iPad)', 'Information_Bell'),
  ('staff_call', 'Khách gọi nhân viên', 'Alarmed'),
  ('payment', 'Thanh toán thành công', 'Glass'),
  ('kds_new_order', 'Món mới lên màn hình bếp (KDS)', 'Beeper'),
];

/// Nhóm thông báo định tuyến được: khoá · nhãn.
const _nhomThongBao = <(String, String)>[
  ('fnb_order', 'Đơn F&B tại bàn / POS'),
  ('online_order', 'Đơn hàng online'),
  ('inventory', 'Kho / Tồn thấp'),
  ('invoice', 'Hóa đơn & Thanh toán'),
];

const _vaiTro = <(String, String)>[
  ('cashier', 'Thu ngân'),
  ('kitchen', 'Bếp'),
  ('warehouse', 'Kho'),
  ('manager', 'Quản lý'),
  ('owner', 'Admin'),
];

const _dinhTuyenMacDinh = <String, List<String>>{
  'fnb_order': ['cashier', 'kitchen', 'manager', 'owner'],
  'online_order': ['cashier', 'manager', 'owner'],
  'inventory': ['warehouse', 'manager', 'owner'],
  'invoice': ['cashier', 'manager', 'owner'],
};

class PhoneNotifySettingsScreen extends StatefulWidget {
  const PhoneNotifySettingsScreen({super.key});

  @override
  State<PhoneNotifySettingsScreen> createState() =>
      _PhoneNotifySettingsScreenState();
}

class _PhoneNotifySettingsScreenState extends State<PhoneNotifySettingsScreen> {
  bool _batAm = true;
  double _amLuong = 1.0;
  final Map<String, Map<String, dynamic>> _am = {};
  List<Map<String, dynamic>> _khoAm = [];
  final Map<String, Set<String>> _dinhTuyen = {};

  bool _dangNap = true;
  bool _dangLuu = false;
  bool _coThayDoi = false;
  String? _loi;

  ApiService get _api => context.read<ApiService>();

  @override
  void initState() {
    super.initState();
    _nap();
  }

  /// Mọi thay đổi chỉ nằm trong bộ nhớ màn hình cho tới khi bấm Lưu — nên phải
  /// bật cờ này để nút Lưu hiện ra, nếu không thoát ra là mất.
  void _doi(VoidCallback thayDoi) {
    setState(() {
      thayDoi();
      _coThayDoi = true;
    });
  }

  Future<List<Map<String, dynamic>>> _napKhoAm() async {
    try {
      final raw = await rootBundle
          .loadString('assets/brand/sounds/notifications/catalog.json');
      final json = jsonDecode(raw);
      if (json is Map && json['sounds'] is List) {
        final ds = (json['sounds'] as List)
            .whereType<Map>()
            .map((e) => Map<String, dynamic>.from(e))
            .toList();
        if (ds.isNotEmpty) return ds;
      }
    } catch (_) {}
    return [
      for (final e in _suKienAm) {'id': e.$3, 'name': e.$3},
    ];
  }

  Future<void> _nap() async {
    if (mounted) setState(() => _dangNap = true);
    try {
      final st = await _api.getAppSettings();
      final kho = await _napKhoAm();
      if (!mounted) return;

      final amCfg = st['notification_sound_config'];
      final amMap =
          amCfg is Map ? Map<String, dynamic>.from(amCfg) : <String, dynamic>{};
      final evRaw = amMap['events'] is Map
          ? Map<String, dynamic>.from(amMap['events'])
          : <String, dynamic>{};
      final idHopLe = kho.map((c) => _s(c['id'])).toSet();

      _am.clear();
      for (final (key, _, macDinh) in _suKienAm) {
        final saved = evRaw[key] is Map
            ? Map<String, dynamic>.from(evRaw[key])
            : <String, dynamic>{};
        var am = _s(saved['sound']).isEmpty ? macDinh : _s(saved['sound']);
        // Âm đã lưu mà không còn trong kho âm (đổi bộ âm) thì rơi về mặc định,
        // không giữ một id không phát được.
        if (!idHopLe.contains(am)) {
          am = idHopLe.contains(macDinh)
              ? macDinh
              : (kho.isEmpty ? macDinh : _s(kho.first['id']));
        }
        _am[key] = {
          'enabled': saved['enabled'] == null ? true : _flag(saved['enabled']),
          'sound': am,
        };
      }

      final dtCfg = st['notification_routing_config'];
      final dtMap =
          dtCfg is Map ? Map<String, dynamic>.from(dtCfg) : <String, dynamic>{};
      final rolesRaw = dtMap['roles'] is Map
          ? Map<String, dynamic>.from(dtMap['roles'])
          : <String, dynamic>{};
      _dinhTuyen.clear();
      for (final (key, _) in _nhomThongBao) {
        final saved = rolesRaw[key];
        _dinhTuyen[key] = saved is List
            ? saved.map(_s).where((e) => e.isNotEmpty).toSet()
            : {..._dinhTuyenMacDinh[key]!};
      }

      setState(() {
        _khoAm = kho;
        _batAm = amMap['enabled'] == null ? true : _flag(amMap['enabled']);
        _amLuong = amMap['volume'] is num
            ? (amMap['volume'] as num).toDouble().clamp(0.0, 1.0)
            : 1.0;
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

  Future<bool> _luu() async {
    if (_dangLuu) return false;
    setState(() => _dangLuu = true);
    try {
      final roles = <String, List<String>>{};
      for (final (key, _) in _nhomThongBao) {
        roles[key] = (_dinhTuyen[key] ?? <String>{}).toList()..sort();
      }
      await _api.saveAppSettings({
        'notification_sound_config': {
          'enabled': _batAm,
          'volume': double.parse(_amLuong.toStringAsFixed(2)),
          'events': _am,
        },
        // Ghi đè 'roles' nhưng GIỮ NGUYÊN 'overrides' (ngoại lệ theo từng người)
        // — màn nhỏ không sửa phần đó, xoá đi là mất thiết lập của cửa hàng.
        'notification_routing_config': {'roles': roles},
      });
      await SocketService().reloadSoundConfig();
      if (!mounted) return true;
      setState(() {
        _coThayDoi = false;
        _dangLuu = false;
      });
      appToast(context, t('Đã lưu cấu hình thông báo'));
      return true;
    } catch (e) {
      if (!mounted) return false;
      setState(() => _dangLuu = false);
      appToast(context, e.toString().replaceFirst('Exception: ', ''),
          isError: true);
      return false;
    }
  }

  String _tenAm(String id) {
    for (final c in _khoAm) {
      if (_s(c['id']) == id) return _s(c['name']);
    }
    return id;
  }

  Future<void> _chonAm(String key) async {
    if (_khoAm.isEmpty) return;
    await showPhoneSheet<void>(
      context: context,
      title: t('Chọn âm báo'),
      builder: (c) => PhonePickList(
        options: [for (final s in _khoAm) _s(s['name'])],
        selected: _tenAm(_s(_am[key]?['sound'])),
        onPick: (v) {
          Navigator.of(c).pop();
          final id = _s(_khoAm.firstWhere((s) => _s(s['name']) == v)['id']);
          _doi(() => _am[key]?['sound'] = id);
          _ngheThu(id);
        },
      ),
    );
  }

  void _ngheThu(String id) {
    if (!_batAm || id.isEmpty) return;
    playNotificationSound(_api.baseUrl, id, volume: _amLuong);
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
                title: t('Cấu hình thông báo'),
                subtitle: _coThayDoi ? t('Có thay đổi chưa lưu') : null,
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
                              PhoneToggleRow(
                                label: 'Bật âm thanh thông báo',
                                value: _batAm,
                                onChanged: (v) => _doi(() => _batAm = v),
                              ),
                              Padding(
                                padding:
                                    const EdgeInsets.fromLTRB(16, 12, 16, 0),
                                child: Row(
                                  children: [
                                    const Icon(Icons.volume_up_outlined,
                                        size: 18, color: DanColors.muted),
                                    Expanded(
                                      child: Slider(
                                        value: _amLuong,
                                        onChanged: _batAm
                                            ? (v) => _doi(() => _amLuong = v)
                                            : null,
                                      ),
                                    ),
                                    SizedBox(
                                      width: 42,
                                      child: Text(
                                          '${(_amLuong * 100).round()}%',
                                          textAlign: TextAlign.right,
                                          style: const TextStyle(
                                              fontSize: 12,
                                              fontWeight: FontWeight.w800,
                                              color: DanColors.muted)),
                                    ),
                                  ],
                                ),
                              ),
                              PhoneSectionTitle(t('ÂM RIÊNG TỪNG SỰ KIỆN')),
                              for (final (key, nhan, _) in _suKienAm)
                                _dongAm(key, nhan),
                              PhoneSectionTitle(t('AI NHẬN THÔNG BÁO NÀO')),
                              for (final (key, nhan) in _nhomThongBao)
                                _dongDinhTuyen(key, nhan),
                              Padding(
                                padding:
                                    const EdgeInsets.fromLTRB(16, 14, 16, 0),
                                child: Text(
                                    t(
                                        'Ngoại lệ theo từng nhân viên (bật/tắt riêng cho một người) chỉnh ở bản máy để bàn — màn này chỉ đổi theo vai trò và không xoá phần ngoại lệ đã lưu.'),
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

  Widget _dongAm(String key, String nhan) {
    final bat = _am[key]?['enabled'] == true;
    final am = _s(_am[key]?['sound']);
    return Container(
      padding: const EdgeInsets.fromLTRB(16, 10, 8, 10),
      decoration: const BoxDecoration(
        color: DanColors.surface,
        border: Border(bottom: BorderSide(color: DanColors.border)),
      ),
      child: Row(
        children: [
          Expanded(
            child: InkWell(
              onTap: () => _chonAm(key),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(t(nhan),
                      style: const TextStyle(
                          fontSize: 13.5, fontWeight: FontWeight.w700)),
                  const SizedBox(height: 2),
                  Text(_tenAm(am),
                      style: const TextStyle(
                          fontSize: 11.5, color: DanColors.muted)),
                ],
              ),
            ),
          ),
          PhoneIconButton(
              icon: Icons.play_arrow_rounded,
              color: _batAm && bat ? DanColors.brand : DanColors.faint,
              onTap: _batAm && bat ? () => _ngheThu(am) : null),
          Switch(
            value: bat,
            onChanged: (v) => _doi(() => _am[key]?['enabled'] = v),
          ),
        ],
      ),
    );
  }

  Widget _dongDinhTuyen(String key, String nhan) {
    final chon = _dinhTuyen[key] ?? <String>{};
    return Container(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
      decoration: const BoxDecoration(
        color: DanColors.surface,
        border: Border(bottom: BorderSide(color: DanColors.border)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(t(nhan),
              style:
                  const TextStyle(fontSize: 13.5, fontWeight: FontWeight.w700)),
          const SizedBox(height: 8),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              for (final (role, label) in _vaiTro)
                PhoneChip(
                  label: t(label),
                  active: chon.contains(role),
                  onTap: () => _doi(() {
                    if (chon.contains(role)) {
                      chon.remove(role);
                    } else {
                      chon.add(role);
                    }
                    _dinhTuyen[key] = chon;
                  }),
                ),
            ],
          ),
        ],
      ),
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 4. CHI NHÁNH
// ═══════════════════════════════════════════════════════════════════════════

class PhoneBranchesSettingsScreen extends StatefulWidget {
  const PhoneBranchesSettingsScreen({super.key});

  @override
  State<PhoneBranchesSettingsScreen> createState() =>
      _PhoneBranchesSettingsScreenState();
}

class _PhoneBranchesSettingsScreenState
    extends State<PhoneBranchesSettingsScreen> {
  List<Map<String, dynamic>> _cn = [];
  bool _dangNap = true;
  String? _loi;

  ApiService get _api => context.read<ApiService>();

  @override
  void initState() {
    super.initState();
    _nap();
  }

  Future<void> _nap() async {
    if (mounted) setState(() => _dangNap = true);
    try {
      final rows = await _api.getSettingsBranches();
      if (!mounted) return;
      setState(() {
        _cn = rows
            .whereType<Map>()
            .map((e) => Map<String, dynamic>.from(e))
            .toList();
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

  Future<void> _sua(Map<String, dynamic>? b) async {
    final ok = await Navigator.of(context).push<bool>(
      MaterialPageRoute(builder: (_) => _ChiNhanhFormScreen(chiNhanh: b)),
    );
    if (ok == true) _nap();
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
              title: t('Chi nhánh'),
              subtitle: _dangNap ? null : '${_cn.length} ${t('chi nhánh')}',
              onBack: () => Navigator.of(context).maybePop(),
              actions: [
                PhoneIconButton(icon: Icons.add, onTap: () => _sua(null)),
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
                      : RefreshIndicator(
                          onRefresh: _nap,
                          child: ListView(
                            padding: const EdgeInsets.only(bottom: 20),
                            children: [
                              for (final b in _cn)
                                PhoneListRow(
                                  title: _s(b['name']),
                                  subtitle: [
                                    if (_s(b['code']).isNotEmpty) _s(b['code']),
                                    if (_s(b['address']).isNotEmpty)
                                      _s(b['address']),
                                  ].join(' · '),
                                  badge: b['active'] != false
                                      ? t('Đang mở')
                                      : t('Đã đóng'),
                                  badgeTone: b['active'] != false
                                      ? PhoneTone.ok
                                      : PhoneTone.neutral,
                                  onTap: () => _sua(b),
                                ),
                            ],
                          ),
                        ),
            ),
          ],
        ),
      ),
    );
  }
}

class _ChiNhanhFormScreen extends StatefulWidget {
  final Map<String, dynamic>? chiNhanh;
  const _ChiNhanhFormScreen({this.chiNhanh});

  @override
  State<_ChiNhanhFormScreen> createState() => _ChiNhanhFormScreenState();
}

class _ChiNhanhFormScreenState extends State<_ChiNhanhFormScreen> {
  final _ten = TextEditingController();
  final _ma = TextEditingController();
  final _diaChi = TextEditingController();
  final _phuong = TextEditingController();
  final _tinh = TextEditingController();
  bool _bat = true;
  bool _fnb = true;
  bool _retail = true;
  bool _kds = true;
  bool _dangLuu = false;

  bool get _laSua => widget.chiNhanh != null;

  @override
  void initState() {
    super.initState();
    final b = widget.chiNhanh;
    if (b != null) {
      _ten.text = _s(b['name']);
      _ma.text = _s(b['code']);
      _diaChi.text = _s(b['address']);
      _phuong.text = _s(b['address_ward']);
      _tinh.text = _s(b['address_province']);
      _bat = b['active'] != false;
      final mod = b['sales_modules'];
      if (mod is Map) {
        _fnb = mod['fnb'] != false;
        _retail = mod['retail'] != false;
        _kds = mod['kds'] != false;
      }
    }
  }

  @override
  void dispose() {
    for (final c in [_ten, _ma, _diaChi, _phuong, _tinh]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _luu() async {
    if (_ten.text.trim().isEmpty) {
      appToast(context, t('Cần nhập tên chi nhánh'), isError: true);
      return;
    }
    setState(() => _dangLuu = true);
    try {
      final api = context.read<ApiService>();
      final body = {
        'name': _ten.text.trim(),
        'code': _ma.text.trim(),
        'address': _diaChi.text.trim(),
        'address_ward': _phuong.text.trim(),
        'address_province': _tinh.text.trim(),
        'active': _bat,
        'sales_modules': {'fnb': _fnb, 'retail': _retail, 'kds': _kds},
      };
      if (_laSua) {
        await api.updateBranch(_s(widget.chiNhanh!['id']), body);
      } else {
        await api.createBranch(body);
      }
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
    return Scaffold(
      backgroundColor: DanColors.bg,
      body: SafeArea(
        bottom: false,
        child: Column(
          children: [
            PhoneHeader(
              title: t(_laSua ? 'Sửa chi nhánh' : 'Thêm chi nhánh'),
              onBack: () => Navigator.of(context).maybePop(),
            ),
            Expanded(
              child: ListView(
                padding: const EdgeInsets.only(bottom: 20),
                children: [
                  PhoneField(
                      label: 'Tên chi nhánh',
                      required: true,
                      hint: 'VD: BCM Thủ Đức',
                      controller: _ten),
                  PhoneField(
                      label: 'Mã chi nhánh', hint: 'VD: TD', controller: _ma),
                  PhoneField(
                      label: 'Địa chỉ',
                      hint: 'Số nhà, đường',
                      controller: _diaChi),
                  PhoneField(label: 'Phường / Xã', controller: _phuong),
                  PhoneField(label: 'Tỉnh / Thành phố', controller: _tinh),
                  PhoneToggleRow(
                    label: 'Đang hoạt động',
                    value: _bat,
                    onChanged: (v) => setState(() => _bat = v),
                  ),
                  PhoneSectionTitle(t('MODULE BÁN HÀNG CỦA CHI NHÁNH')),
                  PhoneToggleRow(
                      label: 'Bán lẻ (Retail)',
                      value: _retail,
                      onChanged: (v) => setState(() => _retail = v)),
                  PhoneToggleRow(
                      label: 'Nhà hàng (F&B)',
                      value: _fnb,
                      onChanged: (v) => setState(() => _fnb = v)),
                  PhoneToggleRow(
                      label: 'Màn hình bếp (KDS)',
                      value: _kds,
                      onChanged: (v) => setState(() => _kds = v)),
                ],
              ),
            ),
            PhoneActionBar(
              child: PhoneCta(
                label: t(_laSua ? 'Lưu chi nhánh' : 'Tạo chi nhánh'),
                busy: _dangLuu,
                onPressed: _dangLuu ? null : _luu,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
