import 'package:flutter/material.dart';
import 'package:media_kit/media_kit.dart';

import '../ui/app_theme.dart';

/// CHUÔNG REO LIÊN TỤC khi có món KHÁCH TỰ GỌI (self-order) chưa xem — reo như
/// điện thoại đổ chuông tới khi nhân viên BẤM CHUÔNG để xem món thì mới ngưng.
/// Chưa xem mà đổi màn / tắt màn thì VẪN reo (đếm `pending` toàn cục, overlay
/// nổi trên mọi màn). Dùng cùng bộ giải mã Ogg với sound_player (media_kit).
class RingController {
  RingController._();
  static final RingController instance = RingController._();

  Player? _player;
  String _baseUrl = '';
  String _soundId = 'Information_Bell';

  /// CÁC VIỆC CHƯA XEM theo KHÓA ỔN ĐỊNH (order_id / table_id), KHÔNG phải đếm mù.
  /// Nhờ vậy:
  ///   1) cùng một sự kiện tới hai lần (Socket.IO gửi lại khi reconnect, hoặc
  ///      server phát lặp) KHÔNG cộng dồn → chuông không "kêu lặp lại";
  ///   2) món được XÁC NHẬN/TỪ CHỐI thì gỡ ĐÚNG khóa đó → chuông tự im mà không
  ///      cần bấm tay (sự cố "đã confirm nhưng vẫn reo");
  ///   3) reconcile() kéo tập việc về ĐÚNG sự thật server đang chờ (khi reconnect
  ///      hay tải lại sơ đồ) → không phát lại việc đã xử lý, không bỏ sót việc mới.
  final Set<String> _keys = <String>{};
  int _anonSeq = 0;

  /// Số việc chưa xem — >0 thì overlay chuông hiện + âm thanh lặp. Suy ra từ
  /// `_keys` nên luôn khớp số việc THẬT, không lệch theo số lần nhận sự kiện.
  final ValueNotifier<int> pending = ValueNotifier<int>(0);

  /// Mỗi lần TĂNG = một lần MÁY IN BẾP sắp in → nháy đèn hiệu trên màn (kèm tiếng
  /// "tít tít tít" do socket_service phát) để nhân viên biết có phiếu sắp ra.
  final ValueNotifier<int> kdsFlash = ValueNotifier<int>(0);
  void flashKds() => kdsFlash.value = kdsFlash.value + 1;

  /// true = đang chờ bấm nút Đóng LẦN NỮA để thoát → hiện banner giữa-trên màn.
  /// Nút cửa sổ nằm ngoài Overlay của Navigator nên KHÔNG tự chèn overlay được;
  /// dùng notifier này để RingOverlay (nằm đúng trong cây widget) vẽ banner hộ.
  final ValueNotifier<bool> closeConfirm = ValueNotifier<bool>(false);

  void configure({required String baseUrl, String? soundId}) {
    _baseUrl = baseUrl.replaceFirst(RegExp(r'/$'), '');
    if (soundId != null && soundId.trim().isNotEmpty) _soundId = soundId.trim();
  }

  /// Có việc mới cần xem → thêm theo KHÓA (dedup) rồi reo nếu chưa reo. [key] là
  /// mã ổn định của việc (order_id/table_id). Rỗng/null (vd nguồn không mang mã)
  /// → sinh khóa ẩn danh để VẪN reo, nhưng không dedup được (giữ hành vi cũ cho
  /// nguồn đó); server không biết khóa ẩn danh nên reconcile() giữ nguyên chúng.
  Future<void> ring([String? key]) async {
    final k = (key == null || key.trim().isEmpty)
        ? '_anon:${_anonSeq++}'
        : key.trim();
    if (_keys.add(k)) pending.value = _keys.length;
    await _startLoop();
  }

  /// Việc [key] đã được xử lý (nhân viên xác nhận/từ chối/mở xem) → gỡ khóa; hết
  /// việc thì chuông tự im. An toàn khi gọi với khóa không tồn tại.
  void clear(String key) {
    final k = key.trim();
    if (k.isEmpty) return;
    if (_keys.remove(k)) {
      pending.value = _keys.length;
      if (_keys.isEmpty) _stop();
    }
  }

  /// Kéo tập việc-chưa-xem về ĐÚNG sự thật từ server (gọi khi reconnect / tải lại
  /// sơ đồ bàn). Giữ lại các khóa ẩn danh (server không biết chúng).
  void reconcile(Iterable<String> keys) {
    final next = keys
        .map((e) => e.trim())
        .where((e) => e.isNotEmpty)
        .toSet()
      ..addAll(_keys.where((k) => k.startsWith('_anon:')));
    if (next.length == _keys.length && next.every(_keys.contains)) return;
    _keys
      ..clear()
      ..addAll(next);
    pending.value = _keys.length;
    if (_keys.isEmpty) _stop();
    else _startLoop();
  }

  /// Nhân viên bấm chuông xem hết → ngưng hẳn, xoá mọi khóa.
  void acknowledge() {
    if (_keys.isNotEmpty) _keys.clear();
    pending.value = 0;
    _stop();
  }

  Future<void> _startLoop() async {
    if (_player != null || _baseUrl.isEmpty) return;
    // Chặn tên file lạ luồn đường dẫn/URL (giống sound_player).
    if (!RegExp(r'^[A-Za-z0-9 _-]+$').hasMatch(_soundId)) return;
    try {
      final p = _player = Player();
      await p.setPlaylistMode(PlaylistMode.loop); // reo LẶP tới khi dừng
      await p.setVolume(100);
      await p
          .open(Media('$_baseUrl/assets/sounds/notifications/$_soundId.ogg'));
    } catch (_) {
      _stop();
    }
  }

  void _stop() {
    final p = _player;
    _player = null;
    try {
      p?.dispose();
    } catch (_) {}
  }
}

/// Bọc quanh toàn app: khi có món chưa xem thì hiện NÚT CHUÔNG nổi (đang rung),
/// bấm vào là ngưng chuông. Đặt ở MaterialApp.builder nên nổi trên MỌI màn.
class RingOverlay extends StatelessWidget {
  final Widget child;
  const RingOverlay({super.key, required this.child});

  @override
  Widget build(BuildContext context) {
    return Stack(
      children: [
        child,
        // NHÁY ĐÈN HIỆU: chớp cả màn một cái mỗi khi có phiếu bếp sắp in.
        Positioned.fill(
          child: IgnorePointer(
            child: ValueListenableBuilder<int>(
              valueListenable: RingController.instance.kdsFlash,
              builder: (context, tick, _) => _KdsFlash(tick: tick),
            ),
          ),
        ),
        ValueListenableBuilder<int>(
          valueListenable: RingController.instance.pending,
          builder: (context, n, _) {
            if (n <= 0) return const SizedBox.shrink();
            return Positioned(
              right: 18,
              bottom: 18,
              child: _RingingBell(count: n),
            );
          },
        ),
        // BANNER "bấm thêm 1 lần nữa để tắt app" — giữa-trên màn (khoảng 1/5 từ
        // đỉnh). Nút Đóng chỉ bật/tắt cờ; overlay này vẽ hộ vì nút cửa sổ không
        // có Overlay tổ tiên.
        ValueListenableBuilder<bool>(
          valueListenable: RingController.instance.closeConfirm,
          builder: (context, show, _) {
            if (!show) return const SizedBox.shrink();
            return Positioned(
              top: MediaQuery.of(context).size.height * 0.18,
              left: 0,
              right: 0,
              child: const IgnorePointer(
                  child: Center(child: _CloseConfirmToast())),
            );
          },
        ),
      ],
    );
  }
}

/// Thông báo "bấm thêm lần nữa để tắt" — song ngữ Anh/Việt.
class _CloseConfirmToast extends StatelessWidget {
  const _CloseConfirmToast();

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 22, vertical: 14),
        decoration: BoxDecoration(
          color: const Color(0xF01A2230),
          borderRadius: BorderRadius.circular(14),
          boxShadow: [
            BoxShadow(
                color: Colors.black.withValues(alpha: .28),
                blurRadius: 24,
                offset: const Offset(0, 8)),
          ],
        ),
        child: const Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Row(mainAxisSize: MainAxisSize.min, children: [
              Icon(Icons.power_settings_new,
                  color: Color(0xFFFF6B6B), size: 20),
              SizedBox(width: 10),
              Text('Bấm thêm 1 lần nữa để tắt app',
                  style: TextStyle(
                      color: Colors.white,
                      fontWeight: FontWeight.w800,
                      fontSize: 15)),
            ]),
            SizedBox(height: 3),
            Text('Press the close button again to quit the app',
                style: TextStyle(color: Colors.white70, fontSize: 12.5)),
          ],
        ),
      ),
    );
  }
}

/// Chớp đèn hiệu: mỗi lần `tick` đổi thì nháy màn 3 cái (như đèn báo) rồi tắt.
class _KdsFlash extends StatefulWidget {
  final int tick;
  const _KdsFlash({required this.tick});
  @override
  State<_KdsFlash> createState() => _KdsFlashState();
}

class _KdsFlashState extends State<_KdsFlash>
    with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(
      vsync: this, duration: const Duration(milliseconds: 900));

  @override
  void didUpdateWidget(_KdsFlash old) {
    super.didUpdateWidget(old);
    if (widget.tick != old.tick && widget.tick > 0) {
      _c.forward(from: 0);
    }
  }

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _c,
      builder: (context, _) {
        if (_c.isDismissed) return const SizedBox.shrink();
        // 3 nhịp chớp trong 0.9s.
        final blink = ((_c.value * 3) % 1) < 0.5 ? 1.0 : 0.0;
        final fade = (1 - _c.value).clamp(0.0, 1.0);
        return Container(
          color: DanColors.brand.withValues(alpha: .38 * blink * fade),
        );
      },
    );
  }
}

class _RingingBell extends StatefulWidget {
  final int count;
  const _RingingBell({required this.count});

  @override
  State<_RingingBell> createState() => _RingingBellState();
}

class _RingingBellState extends State<_RingingBell>
    with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(
      vsync: this, duration: const Duration(milliseconds: 600))
    ..repeat(reverse: true);

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        borderRadius: BorderRadius.circular(40),
        onTap: () => RingController.instance.acknowledge(),
        child: AnimatedBuilder(
          animation: _c,
          builder: (context, _) {
            // Rung nhẹ trái–phải cho giống chuông đang đổ.
            final angle = (_c.value - .5) * .5;
            return Container(
              padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 12),
              decoration: BoxDecoration(
                color: DanColors.late,
                borderRadius: BorderRadius.circular(40),
                boxShadow: [
                  BoxShadow(
                      color: DanColors.late.withValues(alpha: .5),
                      blurRadius: 18,
                      spreadRadius: 2),
                ],
              ),
              child: Row(mainAxisSize: MainAxisSize.min, children: [
                Transform.rotate(
                    angle: angle,
                    child: const Icon(Icons.notifications_active,
                        color: Colors.white, size: 24)),
                const SizedBox(width: 10),
                Text(
                  widget.count > 1
                      ? '${widget.count} món mới — bấm để xem'
                      : 'Món mới — bấm để xem',
                  style: const TextStyle(
                      color: Colors.white, fontWeight: FontWeight.w800),
                ),
              ]),
            );
          },
        ),
      ),
    );
  }
}
