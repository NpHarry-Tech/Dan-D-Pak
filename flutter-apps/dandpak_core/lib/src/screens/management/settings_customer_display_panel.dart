import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../providers/customer_display_controller.dart';
import '../../services/api_service.dart';
import '../../ui/app_theme.dart';
import '../../ui/file_pick.dart';
import '../customer_display/second_screen.dart';
import 'management_widgets.dart';
import 'settings_tab.dart';
import '../../utils/translation.dart';

/// Settings → t("Màn hình phụ"): manage the ad slideshow images (stored inline
/// as data URLs) and the seconds-per-image interval used by the 2nd screen.
class CustomerDisplaySettingsPanel extends StatefulWidget {
  final ApiService api;
  CustomerDisplaySettingsPanel({super.key, required this.api});

  @override
  State<CustomerDisplaySettingsPanel> createState() =>
      _CustomerDisplaySettingsPanelState();
}

class _CustomerDisplaySettingsPanelState
    extends State<CustomerDisplaySettingsPanel> {
  static int _maxImages = 12;

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
      _toast(t('Đã lưu màn hình phụ'));
    } catch (e) {
      _toast(e.toString().replaceFirst('Exception: ', ''), error: true);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Future<void> _addImage() async {
    if (_images.length >= _maxImages) {
      _toast(t('Tối đa $_maxImages ảnh/video'), error: true);
      return;
    }
    final dataUrl = await pickAdFileAsDataUrl();
    if (dataUrl == null) return;
    if (!dataUrl.startsWith('data:image/') &&
        !dataUrl.startsWith('data:video/')) return;
    setState(() => _images = [..._images, dataUrl]);
  }

  void _removeImage(int i) {
    setState(() => _images = [
          for (int j = 0; j < _images.length; j++)
            if (j != i) _images[j]
        ]);
  }

  void _toast(String msg, {bool error = false}) =>
      appToast(context, msg, isError: error);

  @override
  Widget build(BuildContext context) {
    return SettingsPanelScaffold(
      title: t('Màn hình phụ'),
      onRefresh: _load,
      child: settingsState(
        loading: _loading,
        error: _error,
        onRetry: _load,
        child: ListView(
          padding: EdgeInsets.all(18),
          children: [
            Panel(
              title: t('Kích hoạt'),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  SwitchListTile(
                    value: _enabled,
                    onChanged: (v) => setState(() => _enabled = v),
                    contentPadding: EdgeInsets.zero,
                    title:
                        Text(t('Bật màn hình phụ (màn hình hướng về khách)')),
                    subtitle: Text(t(
                        'Màn hình thứ hai quay về phía khách hàng: chiếu quảng cáo khi quầy rảnh, hiện chi tiết đơn hàng khi nhân viên đang lên món / quét hàng, và hiện mã QR chuyển khoản khi thanh toán. Dùng chung cho cả nhà hàng và bán lẻ.')),
                  ),
                  SizedBox(height: 10),
                  Row(
                    children: [
                      Text(t('Thời gian mỗi ảnh:')),
                      SizedBox(width: 12),
                      SizedBox(
                        width: 120,
                        child: DropdownButtonFormField<int>(
                          initialValue: _seconds.clamp(5, 120),
                          decoration: InputDecoration(
                              isDense: true, border: OutlineInputBorder()),
                          items: [
                            DropdownMenuItem(
                                value: 15, child: Text(t('15 giây'))),
                            DropdownMenuItem(
                                value: 20, child: Text(t('20 giây'))),
                            DropdownMenuItem(
                                value: 25, child: Text(t('25 giây'))),
                            DropdownMenuItem(
                                value: 30, child: Text(t('30 giây'))),
                          ],
                          onChanged: (v) => setState(() => _seconds = v ?? 20),
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
            SizedBox(height: 14),
            Panel(
              title: t('Cách sử dụng'),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  _GuideLine(t(
                      'Khi bật, màn hình phụ tự mở sang màn hình thứ hai và phủ kín toàn màn hình.')),
                  _GuideLine(t(
                      'Muốn dời vị trí: rê chuột lên sát mép trên của màn hình phụ, một thanh công cụ mờ sẽ hiện ra — giữ chuột vào thanh này rồi kéo cửa sổ tới nơi mong muốn.')),
                  _GuideLine(t(
                      'Muốn phóng to hoặc thu nhỏ: nhấp đúp chuột vào thanh công cụ đó để chuyển qua lại giữa chế độ toàn màn hình và chế độ cửa sổ.')),
                  _GuideLine(t(
                      'Bình thường thanh công cụ này ẩn hoàn toàn, khách hàng không nhìn thấy.')),
                ],
              ),
            ),
            SizedBox(height: 14),
            Panel(
              title: t('Ảnh quảng cáo'),
              trailing: Text('${_images.length}/$_maxImages',
                  style: TextStyle(fontSize: 12, color: DanColors.faint)),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text(
                    t('1 ảnh → hiển thị cố định. Nhiều ảnh → chạy luân phiên theo thời gian đã chọn.'),
                    style: TextStyle(color: DanColors.muted, fontSize: 12.5),
                  ),
                  SizedBox(height: 12),
                  if (_images.isEmpty)
                    Padding(
                      padding: EdgeInsets.symmetric(vertical: 20),
                      child: InlineMessage(t(
                          'Chưa có ảnh — màn hình phụ sẽ hiện logo khi rảnh.')),
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
                  SizedBox(height: 12),
                  Align(
                    alignment: Alignment.centerLeft,
                    child: OutlinedButton.icon(
                      onPressed: _addImage,
                      icon: Icon(Icons.add_photo_alternate_outlined, size: 18),
                      label: Text(t('Thêm ảnh')),
                    ),
                  ),
                ],
              ),
            ),
            SizedBox(height: 16),
            Align(
              alignment: Alignment.centerRight,
              child: FilledButton.icon(
                onPressed: _saving ? null : _save,
                icon: _saving
                    ? SizedBox(
                        width: 15,
                        height: 15,
                        child: CircularProgressIndicator(strokeWidth: 2))
                    : Icon(Icons.save_outlined),
                label: Text(t('Lưu')),
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
                    child: Center(
                      child: Column(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          Icon(Icons.play_circle_fill,
                              size: 36, color: Colors.white70),
                          SizedBox(height: 4),
                          Text('VIDEO',
                              style: TextStyle(
                                  fontSize: 11,
                                  fontWeight: FontWeight.bold,
                                  color: Colors.white70)),
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
                            Icon(Icons.broken_image_outlined))
                    : Image.network(src, fit: BoxFit.contain, cacheWidth: 300)),
          ),
        ),
        Positioned(
          top: 2,
          right: 2,
          child: InkWell(
            onTap: () => _removeImage(i),
            child: Container(
              decoration:
                  BoxDecoration(color: DanColors.late, shape: BoxShape.circle),
              padding: EdgeInsets.all(3),
              child: Icon(Icons.close, size: 15, color: Colors.white),
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

/// Một dòng hướng dẫn có chấm đầu dòng, dùng trong panel t("Cách sử dụng").
class _GuideLine extends StatelessWidget {
  final String text;
  _GuideLine(this.text);

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(bottom: 6),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: EdgeInsets.only(top: 6, right: 8),
            child: Icon(Icons.circle, size: 5, color: DanColors.muted),
          ),
          Expanded(
            child: Text(text,
                style: TextStyle(
                    color: DanColors.muted, fontSize: 12.5, height: 1.45)),
          ),
        ],
      ),
    );
  }
}
