import 'package:flutter/foundation.dart';
import 'package:flutter/painting.dart';
import 'package:flutter/scheduler.dart';

import 'black_box.dart';
import 'local_store.dart';
import 'system_log.dart';

/// Chế độ MÁY YẾU — app tự đo sức máy thật thay vì đoán theo cấu hình:
///
///  • Theo dõi frame timings ngay từ lúc chạy. Máy render kém (POS Celeron,
///    tablet cũ) sẽ lộ ra qua tỷ lệ frame chậm → BẬT chế độ máy yếu, LƯU lại
///    (lần mở sau áp ngay từ đầu, không cần đo lại).
///  • Chế độ máy yếu: tắt hiệu ứng chuyển trang + hiệu ứng chạm, hạ trần
///    ImageCache (100MB mặc định là quá tay với máy RAM 2-4GB → GC/nén RAM
///    chính là nguồn khựng hình).
///  • MỌI cú đứng hình ≥700ms đều vào nhật ký hệ thống (ui_freeze, kèm màn
///    hình + build/raster ms) và hộp đen — nếu sau đó app chết native thì
///    hồ sơ crash có ngay vệt "khựng ở màn nào, nặng bao nhiêu ms" ngay trước
///    điểm chết.
///
/// Không bao giờ ném lỗi; toàn bộ chi phí đo là 1 callback timings nhẹ.
class PerfMode {
  PerfMode._();

  /// true = máy yếu, UI nên tối giản hiệu ứng. Theme của MaterialApp lắng
  /// nghe notifier này để đổi pageTransitions/splash ngay khi quyết định.
  static final ValueNotifier<bool> lowEnd = ValueNotifier(false);

  static bool _decided = false;
  static int _observedFrames = 0;
  static int _slowFrames = 0;

  // Throttle nhật ký đứng hình: cụm khựng liên tiếp chỉ ghi 1 dòng / 30s
  // (kèm số lần bị nén) — vòng lặp khựng không được spam đầy queue log.
  static DateTime _lastFreezeLog = DateTime.fromMillisecondsSinceEpoch(0);
  static int _suppressedFreezes = 0;

  static Future<void> init() async {
    try {
      final saved = await LocalStore.instance.getString('perf_low_end');
      if (saved == '1') {
        _decided = true;
        _apply(true);
      } else if (saved == '0') {
        _decided = true;
      }
      SchedulerBinding.instance.addTimingsCallback(_onTimings);
    } catch (_) {/* đo hiệu năng không được phá boot */}
  }

  static void _onTimings(List<FrameTiming> timings) {
    try {
      for (final t in timings) {
        final totalMs = t.totalSpan.inMilliseconds;

        if (totalMs >= 700) _logFreeze(t, totalMs);

        if (_decided) continue;
        _observedFrames++;
        // >64ms = tụt dưới ~15fps — người đứng quầy cảm nhận được ngay.
        if (totalMs >= 64) _slowFrames++;
        // Quyết sớm khi đã đủ bằng chứng máy đuối, hoặc chốt sau ~2000 frame.
        if (_slowFrames >= 60) {
          _decide(true);
        } else if (_observedFrames >= 2000) {
          _decide(_slowFrames / _observedFrames >= 0.02);
        }
      }
    } catch (_) {/* callback timings không được ném */}
  }

  static void _decide(bool low) {
    _decided = true;
    LocalStore.instance.setString('perf_low_end', low ? '1' : '0');
    if (low) {
      _apply(true);
      SystemLog.log(
        level: 'info',
        source: 'flutter_app',
        eventType: 'perf_mode',
        title: 'Máy yếu — đã tự bật chế độ tiết kiệm hiệu năng',
        message:
            '$_slowFrames/$_observedFrames frame chậm (>64ms). Tắt hiệu ứng chuyển trang, hạ trần cache ảnh 48MB.',
      );
    }
  }

  static void _apply(bool low) {
    lowEnd.value = low;
    if (!low) return;
    final cache = PaintingBinding.instance.imageCache;
    cache.maximumSizeBytes = 48 << 20; // 48MB (mặc định 100MB)
    cache.maximumSize = 300; // số ảnh (mặc định 1000)
  }

  static void _logFreeze(FrameTiming t, int totalMs) {
    BlackBox.add('freeze', '${totalMs}ms @${BlackBox.screen}');
    final now = DateTime.now();
    if (now.difference(_lastFreezeLog).inSeconds < 30) {
      _suppressedFreezes++;
      return;
    }
    _lastFreezeLog = now;
    final suppressed = _suppressedFreezes;
    _suppressedFreezes = 0;
    SystemLog.log(
      level: 'warn',
      source: 'flutter_app',
      eventType: 'ui_freeze',
      title: 'Đứng hình ${totalMs}ms',
      message: 'build ${t.buildDuration.inMilliseconds}ms · '
          'raster ${t.rasterDuration.inMilliseconds}ms'
          '${suppressed > 0 ? ' · +$suppressed lần khựng khác trong 30s trước' : ''}',
      durationMs: totalMs,
    );
  }
}
