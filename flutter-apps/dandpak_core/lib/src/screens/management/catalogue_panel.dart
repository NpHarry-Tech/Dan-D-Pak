import 'package:flutter/material.dart';

import '../../services/api_service.dart';
import '../../ui/app_theme.dart';
import '../../utils/translation.dart';
import 'book_menu_panel.dart';
import 'management_widgets.dart';

/// CÀI ĐẶT CATALOGUE BÁN LẺ — quyển ảnh cho màn khách ngoài quầy.
///
/// Song song với "Menu quyển" của FnB và dùng chung phần dựng trang, nhưng là
/// hai quyển TÁCH BIỆT: bật catalogue bán lẻ không được làm đổi menu đang chạy
/// trên iPad nhà hàng (xem sanitizeConfig ở server/services/bookMenu.js).
///
/// Trang được thêm TỪNG TẤM một. Cố ý không có "thêm cả thư mục": cửa hàng
/// thiết kế dần từng trang và muốn thấy ngay trang vừa thêm; thêm từng tấm cũng
/// cho phép chèn bổ sung hay thay một trang hỏng mà không phải dựng lại cả quyển.
class CataloguePanel extends StatefulWidget {
  final ApiService api;
  final Widget? moduleSwitcher;

  const CataloguePanel({super.key, required this.api, this.moduleSwitcher});

  @override
  State<CataloguePanel> createState() => _CataloguePanelState();
}

class _CataloguePanelState extends State<CataloguePanel> {
  List<Map<String, dynamic>> _devices = const [];
  bool _loading = true;
  bool _busy = false;
  String? _error;

  final _welcome = TextEditingController();

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _welcome.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final cfg = await widget.api.getCatalogueSettings();
      final devices = await widget.api.getCatalogueDevices();
      if (!mounted) return;
      setState(() {
        _devices = devices;
        _welcome.text = '${cfg['welcomeText'] ?? ''}';
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = e.toString().replaceFirst('Exception: ', '');
      });
    }
  }

  void _toast(String msg, {bool error = false}) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(
      content: Text(msg),
      backgroundColor: error ? DanColors.late : DanColors.text,
    ));
  }

  Future<void> _saveCfg(Map<String, dynamic> patch) async {
    setState(() => _busy = true);
    try {
      await widget.api.saveCatalogueSettings(patch);
      if (!mounted) return;
      setState(() => _busy = false);
      _toast(t('Đã lưu cấu hình catalogue'));
    } catch (e) {
      if (!mounted) return;
      setState(() => _busy = false);
      _toast(e.toString().replaceFirst('Exception: ', ''), error: true);
    }
  }

  // ── Thêm / xoá trang ──────────────────────────────────────────────────────

  Future<void> _renameDevice(Map<String, dynamic> d) async {
    final ctrl = TextEditingController(text: '${d['name'] ?? ''}');
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: Text(t('Đặt tên thiết bị')),
        content: SizedBox(
          width: 380,
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            Text(t('Tên này hiện thay cho "Hóa đơn 01" trên POS khi khách chọn hàng từ máy đó — đặt theo vị trí đặt máy, ví dụ "Kệ hạt điều".'),
                style: const TextStyle(
                    fontSize: 12, color: DanColors.muted, height: 1.4)),
            const SizedBox(height: 12),
            TextField(
                controller: ctrl,
                autofocus: true,
                decoration: InputDecoration(labelText: t('Tên thiết bị'))),
          ]),
        ),
        actions: [
          TextButton(
              onPressed: () => Navigator.of(c).pop(false),
              child: Text(t('Hủy'))),
          FilledButton(
              onPressed: () => Navigator.of(c).pop(true),
              child: Text(t('Lưu'))),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await widget.api
          .renameCatalogueDevice('${d['device_id']}', ctrl.text.trim());
      await _load();
      _toast(t('Đã đổi tên thiết bị'));
    } catch (e) {
      _toast(e.toString().replaceFirst('Exception: ', ''), error: true);
    }
  }

  // ── Giao diện ─────────────────────────────────────────────────────────────

  @override
  Widget build(BuildContext context) {
    if (_loading) return const Center(child: CircularProgressIndicator());
    if (_error != null) {
      return Padding(
        padding: const EdgeInsets.all(40),
        child: InlineMessage(t('Không tải được cấu hình ($_error)'),
            error: true, onRetry: _load),
      );
    }
    // TRÌNH DỰNG QUYỂN dùng chung với Menu quyển FnB — nhờ vậy catalogue có
    // đủ: tải ảnh trang, import PubHTML5, kéo thả chấm điểm gắn HÀNG HOÁ vào
    // trang, và nút Lưu. Bản rút gọn trước đây thiếu cả bốn.
    return Column(
      children: [
        if (widget.moduleSwitcher != null) widget.moduleSwitcher!,
        const Divider(height: 1, color: DanColors.border),
        Expanded(
          child: DefaultTabController(
            length: 2,
            child: Column(
              children: [
                TabBar(
                  isScrollable: true,
                  tabAlignment: TabAlignment.start,
                  tabs: [
                    Tab(text: t('Quyển catalogue')),
                    Tab(text: t('Màn khách & thiết bị')),
                  ],
                ),
                const Divider(height: 1, color: DanColors.border),
                Expanded(
                  child: TabBarView(
                    children: [
                      BookMenuPanel(api: widget.api, kind: 'retail'),
                      ListView(
                        padding: const EdgeInsets.all(16),
                        children: [
                          _manKhachPanel(),
                          const SizedBox(height: 14),
                          _thietBiPanel(),
                        ],
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }

  /// MÀN KHÁCH — chỉ còn lời chào.
  ///
  /// Mục "Thanh toán trên màn khách" đã bỏ khỏi đây: hình thức thanh toán và
  /// ảnh QR nằm ở Cài đặt → Liên kết. Giữ bản sao thứ hai ở đây là mời gọi hai
  /// nơi lệch nhau — catalogue hiện một mã, màn phụ hiện mã khác.
  ///
  /// Mật khẩu thoát cũng đã bỏ: dùng chung PIN ở Cài đặt → Thiết bị khách.
  Widget _manKhachPanel() {
    return Panel(
      title: t('Màn hình khách'),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(t('Khách bấm Thanh toán thì tab bên POS chuyển ĐỎ. Màn khách KHÔNG tự tạo đơn và không thu tiền — nhân viên vẫn xác nhận và thu như bình thường.'),
              style: const TextStyle(
                  fontSize: 12, color: DanColors.muted, height: 1.4)),
          const SizedBox(height: 12),
          TextField(
            controller: _welcome,
            decoration: InputDecoration(
                labelText: t('Lời chào trên màn khách'), isDense: true),
          ),
          const SizedBox(height: 10),
          _chiDan(Icons.qr_code_2,
              t('Hình thức thanh toán và ảnh mã QR: Cài đặt → Liên kết.')),
          const SizedBox(height: 8),
          _chiDan(Icons.lock_outline,
              t('Mật khẩu thoát màn khách: Cài đặt → Thiết bị khách (dùng chung với iPad khách).')),
          const SizedBox(height: 12),
          Align(
            alignment: Alignment.centerRight,
            child: FilledButton(
              onPressed: _busy
                  ? null
                  : () => _saveCfg({'welcomeText': _welcome.text.trim()}),
              child: Text(t('Lưu cấu hình')),
            ),
          ),
        ],
      ),
    );
  }

  Widget _chiDan(IconData icon, String text) => Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: DanColors.surface2,
          borderRadius: BorderRadius.circular(8),
        ),
        child: Row(children: [
          Icon(icon, size: 20, color: DanColors.muted),
          const SizedBox(width: 10),
          Expanded(
            child: Text(text,
                style: const TextStyle(
                    fontSize: 12, color: DanColors.muted, height: 1.4)),
          ),
        ]),
      );

  Widget _thietBiPanel() {
    return Panel(
      title: t('Thiết bị catalogue (${_devices.length})'),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(t('Mỗi máy mở màn khách sẽ tự xuất hiện ở đây. Đặt tên theo vị trí đặt máy — tên đó thay cho "Hóa đơn 01" trên POS để thu ngân biết khách đang đứng ở đâu.'),
              style: const TextStyle(
                  fontSize: 12, color: DanColors.muted, height: 1.4)),
          const SizedBox(height: 10),
          if (_devices.isEmpty)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 18),
              child: Center(
                child: Text(t('Chưa có máy nào mở màn khách'),
                    style: const TextStyle(color: DanColors.faint)),
              ),
            )
          else
            for (final d in _devices)
              ListTile(
                contentPadding: EdgeInsets.zero,
                leading: const Icon(Icons.tablet_android_outlined),
                title: Text('${d['name'] ?? ''}',
                    style: const TextStyle(fontWeight: FontWeight.w700)),
                subtitle: Text('${d['device_id'] ?? ''}',
                    style: const TextStyle(fontSize: 11)),
                trailing: TextButton(
                  onPressed: () => _renameDevice(d),
                  child: Text(t('Đổi tên')),
                ),
              ),
        ],
      ),
    );
  }
}
