// §9 UI advisory (owner: KHÔNG enforce cap). Chứng minh màn tạo/sửa CTKM:
//  • hiện section "Lưu ý pháp lý" với LINK lấy từ CẤU HÌNH server (không hardcode);
//  • hiện banner CẢNH BÁO khi CTKM % vượt ngưỡng cấu hình — nhưng KHÔNG chặn (nút
//    Lưu vẫn bật). Advisory chỉ nhắc, không sửa giá.
import 'package:dandpak_core/src/screens/management/settings_promotions_panel.dart';
import 'package:dandpak_core/src/services/api_service.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

// Các API cấp cao (getVouchers/getOperationsConfig…) là EXTENSION on ApiService →
// KHÔNG override được. Chặn ở tầng HTTP getJson: '/operations/config' trả cấu hình
// advisory; còn lại trả list rỗng (listFrom([]) = []).
class _FakeApi extends ApiService {
  @override
  Future<dynamic> getJson(String path,
      {Duration timeout = const Duration(seconds: 30), String? errorMessage}) async {
    if (path.contains('/operations/config')) {
      return {
        'promotions': {
          'advisoryThresholdPct': 50,
          'legalNoteText': 'Tuân thủ Nghị định về khuyến mại.',
          'legalNoteUrl': 'https://vanban.example/khuyen-mai',
        },
      };
    }
    return <dynamic>[];
  }
}

Widget _wrap(Widget child) => MaterialApp(home: Scaffold(body: child));

// Panel này có sẵn SwitchListTile lồng trong DecoratedBox (Panel) → framework in
// cảnh báo "ListTile background… may be invisible". Đây là cảnh báo thẩm mỹ CÓ
// SẴN, không liên quan advisory. Nuốt đúng cảnh báo đó, giữ mọi lỗi khác fail.
void _ignoreBenignListTileWarning(WidgetTester tester) {
  final orig = FlutterError.onError;
  FlutterError.onError = (FlutterErrorDetails details) {
    if (details.exceptionAsString().contains('ListTile background color')) return;
    orig?.call(details);
  };
  addTearDown(() => FlutterError.onError = orig);
}

Future<void> _pump(WidgetTester tester, Widget child) async {
  _ignoreBenignListTileWarning(tester);
  tester.view.physicalSize = const Size(1400, 1600);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  await tester.pumpWidget(_wrap(child));
  // _load() async (fake trả ngay) → cho microtask + vài frame để rời trạng thái
  // loading và dựng form.
  for (var i = 0; i < 5; i++) {
    await tester.pump(const Duration(milliseconds: 200));
  }
}

void main() {
  testWidgets('section "Lưu ý pháp lý" render LINK từ cấu hình server (không hardcode)',
      (tester) async {
    await _pump(tester, PromotionSettingsPanel(api: _FakeApi()));

    // _SectionTitle uppercase → tiêu đề hiện dạng IN HOA.
    expect(find.textContaining('LƯU Ý PHÁP LÝ'), findsOneWidget);
    // Link + text đến TỪ config, không hardcode trong app.
    expect(find.text('https://vanban.example/khuyen-mai'), findsOneWidget);
    expect(find.textContaining('Tuân thủ Nghị định'), findsOneWidget);
    // Toggle "dùng nội bộ" tồn tại (tách QA/bếp/sản xuất khỏi CTKM tiêu dùng).
    expect(find.textContaining('dùng NỘI BỘ'), findsOneWidget);
  });

  testWidgets('CTKM % vượt ngưỡng → banner CẢNH BÁO, nút Lưu VẪN bật (không chặn)',
      (tester) async {
    await _pump(tester, PromotionSettingsPanel(api: _FakeApi()));

    // Chưa vượt ngưỡng (mặc định 10%) → chưa cảnh báo.
    expect(find.textContaining('mức ưu đãi cao'), findsNothing);

    // Nhập 80% (> ngưỡng 50%) vào ô "Giảm (%)".
    final valueField = find.widgetWithText(TextField, 'Giảm (%)');
    expect(valueField, findsOneWidget);
    await tester.enterText(valueField, '80');
    await tester.pump();

    expect(find.textContaining('mức ưu đãi cao'), findsOneWidget);
    // Nút Lưu KHÔNG bị vô hiệu — advisory chỉ nhắc, không chặn nghiệp vụ.
    final saveBtn = tester.widget<FilledButton>(
        find.widgetWithText(FilledButton, 'Lưu CTKM'));
    expect(saveBtn.onPressed, isNotNull);
  });
}
