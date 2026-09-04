// Hộp thư chat phải PHÂN BIỆT trạng thái rỗng (sự cố 2026-09-04: luôn hiện
// "Chưa có hội thoại" dù chưa cấu hình kênh / đang tải / lỗi). chatListState là
// hàm thuần quyết định trạng thái để test được mà không cần dựng cả widget.
import 'package:flutter_test/flutter_test.dart';
import 'package:dandpak_core/src/screens/online/online_chat_section.dart';

ChatListState st({
  bool loading = false,
  bool hasError = false,
  bool capsLoaded = false,
  Map<String, dynamic> connectors = const {},
  int count = 0,
}) =>
    chatListState(
      loading: loading,
      hasError: hasError,
      capsLoaded: capsLoaded,
      connectors: connectors,
      conversationCount: count,
    );

void main() {
  test('đang tải → loading (ưu tiên cao nhất)', () {
    expect(st(loading: true, hasError: true, count: 5), ChatListState.loading);
  });

  test('lỗi (không tải) → error', () {
    expect(st(hasError: true), ChatListState.error);
  });

  test('có hội thoại → hasData (kể cả khi caps chưa biết)', () {
    expect(st(count: 3), ChatListState.hasData);
  });

  test('ĐÃ biết caps + không kênh nào → notConfigured (không phải "chưa có hội thoại")', () {
    expect(st(capsLoaded: true, connectors: const {}, count: 0),
        ChatListState.notConfigured);
  });

  test('có kênh nhưng chưa có hội thoại → empty', () {
    expect(
        st(capsLoaded: true, connectors: const {'facebook': {'outbound': true}}, count: 0),
        ChatListState.empty);
  });

  test('CHƯA biết caps → empty (không dám khẳng định "chưa kết nối")', () {
    expect(st(capsLoaded: false, connectors: const {}, count: 0),
        ChatListState.empty);
  });
}
