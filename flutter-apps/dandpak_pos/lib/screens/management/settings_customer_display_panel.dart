import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../providers/customer_display_controller.dart';
import '../../services/api_service.dart';
import '../../ui/app_theme.dart';
import '../../ui/file_pick.dart';
import '../customer_display/customer_display_route.dart';
import '../customer_display/second_screen.dart';
import 'management_widgets.dart';
import 'settings_tab.dart';

/// Settings → "Màn hình phụ": manage the ad slideshow images (stored inline
/// as data URLs) and the seconds-per-image interval used by the 2nd screen.
class CustomerDisplaySettingsPanel extends StatefulWidget {
  final ApiService api;
  const CustomerDisplaySettingsPanel({super.key, required this.api});

  @override
  State<CustomerDisplaySettingsPanel> createState() =>
      _CustomerDisplaySettingsPanelState();
}

class _CustomerDisplaySettingsPanelState
    extends State<CustomerDisplaySettingsPanel> {
  static const int _maxImages = 12;

  bool _loading = true;
  bool _saving = false;
  String? _error;

  bool _enabled = false;
  int _seconds = 20;
  List<String> _images = [];

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final s = await widget.api.getAppSettings();
      final cd = s['customer_display'];
      if (!mounted) return;
      setState(() {
        if (cd is Map) {
          _enabled = cd['enabled'] == true;
          _seconds = (cd['secondsPerImage'] is num)
              ? (cd['secondsPerImage'] as num).toInt()
              : 20;
          _images = (cd['images'] is List)
              ? (cd['images'] as List)
                  .map((e) => e.toString())
                  .where((e) => e.isNotEmpty)
                  .toList()
              : <String>[];
        }
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.toString().replaceFirst('Exception: ', '');
        _loading = false;
      });
    }
  }

  Future<void> _save() async {
    setState(() => _saving = true);
    try {
      await widget.api.saveAppSettings({
        'customer_display': {
          'enabled': _enabled,
          'secondsPerImage': _seconds,
          'images': _images,
        },
      });
      if (mounted) {
        final display = context.read<CustomerDisplayController>();
        await display.loadConfig();
        if (_enabled) {
          await SecondScreen.instance.open(display);
        } else {
          await SecondScreen.instance.close();
        }
      }
      _toast('Đã lưu màn hình phụ');
    } catch (e) {
      _toast(e.toString().replaceFirst('Exception: ', ''), error: true);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Future<void> _addImage() async {
    if (_images.length >= _maxImages) {
      _toast('Tối đa $_maxImages ảnh/video', error: true);
      return;
    }
    final dataUrl = await pickAdFileAsDataUrl();
    if (dataUrl == null) return;
    if (!dataUrl.startsWith('data:image/') && !dataUrl.startsWith('data:video/')) return;
    setState(() => _images = [..._images, dataUrl]);
  }

  void _removeImage(int i) {
    setState(() => _images = [
          for (int j = 0; j < _images.length; j++)
            if (j != i) _images[j]
        ]);
  }

  void _toast(String msg, {bool error = false}) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(
      content: Text(msg),
      backgroundColor: error ? DanColors.late : DanColors.text,
    ));
  }

  /// Mở màn hình phụ trên màn 2 — điểm mở DUY NHẤT của toàn app (nút ở
  /// topbar POS đã bỏ). Màn hình phụ dùng chung cho FnB lẫn Retail: controller
  /// toàn cục tự mirror giỏ hàng đang thao tác và QR khi thanh toán.
  Future<void> _openCustomerDisplay() async {
    try {
      await SecondScreen.instance
          .open(context.read<CustomerDisplayController>());
      _toast(
          'Đã mở màn hình phụ. Rê chuột lên mép trên của nó để kéo đi chỗ khác hoặc nhấp đúp để phóng to / thu nhỏ.');
    } catch (_) {
      // Fallback khi plugin đa cửa sổ không khả dụng: route toàn màn hình.
      if (!mounted) return;
      Navigator.of(context).push(
        MaterialPageRoute(builder: (_) => const CustomerDisplayRoute()),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return SettingsPanelScaffold(
      title: 'Màn hình phụ',
      onRefresh: _load,
      child: settingsState(
        loading: _loading,
        error: _error,
        onRetry: _load,
        child: ListView(
          padding: const EdgeInsets.all(18),
          children: [
            Panel(
              title: 'Kích hoạt',
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  SwitchListTile(
                    value: _enabled,
                    onChanged: (v) => setState(() => _enabled = v),
                    contentPadding: EdgeInsets.zero,
                    title: const Text('Bật màn hình phụ (màn hình hướng về khách)'),
                    subtitle: const Text(
                        'Màn hình thứ hai quay về phía khách hàng: chiếu quảng cáo khi quầy rảnh, '
                        'hiện chi tiết đơn hàng khi nhân viên đang lên món / quét hàng, '
                        'và hiện mã QR chuyển khoản khi thanh toán. Dùng chung cho cả nhà hàng và bán lẻ.'),
                  ),
                  const SizedBox(height: 10),
                  Align(
                    alignment: Alignment.centerLeft,
                    child: FilledButton.icon(
                      onPressed: _openCustomerDisplay,
                      icon:
                          const Icon(Icons.desktop_windows_outlined, size: 18),
                      label: const Text('Mở màn hình phụ trên màn 2'),
                    ),
                  ),
                  const SizedBox(height: 6),
                  Row(
                    children: [
                      const Text('Thời gian mỗi ảnh:'),
                      const SizedBox(width: 12),
                      SizedBox(
                        width: 120,
                        child: DropdownButtonFormField<int>(
                          initialValue: _seconds.clamp(5, 120),
                          decoration: const InputDecoration(
                              isDense: true, border: OutlineInputBorder()),
                          items: const [
                            DropdownMenuItem(value: 15, child: Text('15 giây')),
                            DropdownMenuItem(value: 20, child: Text('20 giây')),
                            DropdownMenuItem(value: 25, child: Text('25 giây')),
                            DropdownMenuItem(value: 30, child: Text('30 giây')),
                          ],
                          onChanged: (v) => setState(() => _seconds = v ?? 20),
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
            const SizedBox(height: 14),
            const Panel(
              title: 'Cách sử dụng',
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  _GuideLine(
                      'Khi bật, màn hình phụ tự mở sang màn hình thứ hai và phủ kín toàn màn hình.'),
                  _GuideLine(
                      'Muốn dời vị trí: rê chuột lên sát mép trên của màn hình phụ, một thanh công cụ mờ sẽ hiện ra — giữ chuột vào thanh này rồi kéo cửa sổ tới nơi mong muốn.'),
                  _GuideLine(
                      'Muốn phóng to hoặc thu nhỏ: nhấp đúp chuột vào thanh công cụ đó để chuyển qua lại giữa chế độ toàn màn hình và chế độ cửa sổ.'),
                  _GuideLine(
                      'Bình thường thanh công cụ này ẩn hoàn toàn, khách hàng không nhìn thấy.'),
                ],
              ),
            ),
            const SizedBox(height: 14),
            Panel(
              title: 'Ảnh quảng cáo',
              trailing: Text('${_images.length}/$_maxImages',
                  style: const TextStyle(fontSize: 12, color: DanColors.faint)),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  const Text(
                    '1 ảnh → hiển thị cố định. Nhiều ảnh → chạy luân phiên theo thời gian đã chọn.',
                    style: TextStyle(color: DanColors.muted, fontSize: 12.5),
                  ),
                  const SizedBox(height: 12),
                  if (_images.isEmpty)
                    const Padding(
                      padding: EdgeInsets.symmetric(vertical: 20),
                      child: InlineMessage(
                          'Chưa có ảnh — màn hình phụ sẽ hiện logo khi rảnh.'),
                    )
                  else
                    Wrap(
                      spacing: 10,
                      runSpacing: 10,
                      children: [
                        for (int i = 0; i < _images.length; i++)
                          _thumb(_images[i], i),
                      ],
                    ),
                  const SizedBox(height: 12),
                  Align(
                    alignment: Alignment.centerLeft,
                    child: OutlinedButton.icon(
                      onPressed: _addImage,
                      icon: const Icon(Icons.add_photo_alternate_outlined,
                          size: 18),
                      label: const Text('Thêm ảnh'),
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 16),
            Align(
              alignment: Alignment.centerRight,
              child: FilledButton.icon(
                onPressed: _saving ? null : _save,
                icon: _saving
                    ? const SizedBox(
                        width: 15,
                        height: 15,
                        child: CircularProgressIndicator(strokeWidth: 2))
                    : const Icon(Icons.save_outlined),
                label: const Text('Lưu'),
              ),
            ),
          ],
        ),
      ),
    );
  }

  bool _isVideo(String src) {
    final s = src.toLowerCase();
    return s.startsWith('data:video/') ||
        s.endsWith('.mp4') ||
        s.endsWith('.mov') ||
        s.endsWith('.avi') ||
        s.endsWith('.mkv');
  }

  Widget _thumb(String src, int i) {
    return Stack(
      children: [
        ClipRRect(
          borderRadius: BorderRadius.circular(8),
          child: Container(
            width: 150,
            height: 96,
            color: Colors.white,
            child: _isVideo(src)
                ? Container(
                    color: Colors.black87,
                    child: const Center(
                      child: Column(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          Icon(Icons.play_circle_fill, size: 36, color: Colors.white70),
                          SizedBox(height: 4),
                          Text('VIDEO', style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: Colors.white70)),
                        ],
                      ),
                    ),
                  )
                : (src.startsWith('data:image/')
                    ? Image.memory(_dataUrlBytes(src),
                        fit: BoxFit.contain,
                        // 150x96 preview tile — decode small, ad sources can be huge.
                        cacheWidth: 300,
                        errorBuilder: (_, __, ___) =>
                            const Icon(Icons.broken_image_outlined))
                    : Image.network(src, fit: BoxFit.contain, cacheWidth: 300)),
          ),
        ),
        Positioned(
          top: 2,
          right: 2,
          child: InkWell(
            onTap: () => _removeImage(i),
            child: Container(
              decoration: const BoxDecoration(
                  color: DanColors.late, shape: BoxShape.circle),
              padding: const EdgeInsets.all(3),
              child: const Icon(Icons.close, size: 15, color: Colors.white),
            ),
          ),
        ),
      ],
    );
  }
}

Uint8List _dataUrlBytes(String dataUrl) {
  final comma = dataUrl.indexOf(',');
  return base64Decode(comma >= 0 ? dataUrl.substring(comma + 1) : dataUrl);
}

/// Một dòng hướng dẫn có chấm đầu dòng, dùng trong panel "Cách sử dụng".
class _GuideLine extends StatelessWidget {
  final String text;
  const _GuideLine(this.text);

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Padding(
            padding: EdgeInsets.only(top: 6, right: 8),
            child: Icon(Icons.circle, size: 5, color: DanColors.muted),
          ),
          Expanded(
            child: Text(text,
                style: const TextStyle(
                    color: DanColors.muted, fontSize: 12.5, height: 1.45)),
          ),
        ],
      ),
    );
  }
}
