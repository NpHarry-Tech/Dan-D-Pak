// Sự cố: cmd /c start "" url cắt URL tại ký tự & đầu tiên (cmd.exe tự parse
// dòng lệnh, coi & là toán tử nối lệnh) → OAuth Lazada/TikTok/Shopee/Haravan
// báo "Missing parameter" vì chỉ nhận được phần trước & đầu tiên. Test này
// khoá lại: windowsOpenUrlArgs() phải trả nguyên vẹn URL thật (nhiều query
// param, %-encode, state/redirect_uri lồng nhau) làm MỘT argv element duy
// nhất, không qua cmd.exe (rundll32 gọi thẳng Win32).
import 'package:dandpak_core/src/ui/open_url.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  const fixtures = {
    'Lazada': 'https://auth.lazada.com/oauth/authorize?response_type=code&force_auth=true'
        '&redirect_uri=https%3A%2F%2Fapi.dandpakpos.io.vn%2Fauth%2Flazada%2Fcallback'
        '&client_id=132700&state=abc123XYZ',
    'TikTok Shop': 'https://services.tiktokshop.com/open/authorize'
        '?service_id=7685256855535421205&state=eyJicmFuY2hfaWQiOiJzYWxhIn0%3D',
    'Shopee': 'https://partner.shopeemobile.com/api/v2/shop/auth_partner'
        '?partner_id=1234567&timestamp=1700000000'
        '&sign=abcdef0123456789abcdef0123456789abcdef0123456789abcdef01234567'
        '&redirect=https%3A%2F%2Fapi.dandpakpos.io.vn%2Fauth%2Fshopee%2Fcallback',
    'Haravan': 'https://accounts.haravan.com/connect/authorize'
        '?response_mode=form_post&response_type=code+id_token'
        '&scope=openid+profile+email+org+userinfo+offline_access'
        '&client_id=abc-client-id'
        '&redirect_uri=https%3A%2F%2Fapi.dandpakpos.io.vn%2Fauth%2Fharavan%2Fcallback'
        '&state=stateTokenValue&nonce=nonceValue123',
  };

  for (final entry in fixtures.entries) {
    test('${entry.key}: URL nhiều query param + %-encode không bị cắt/biến dạng',
        () {
      final url = entry.value;
      // Fixture phải thật sự có nhiều & để test có ý nghĩa (không phải URL đơn giản).
      expect(url.split('&').length, greaterThan(1),
          reason: 'fixture ${entry.key} phải có nhiều query param');

      final args = windowsOpenUrlArgs(url);

      expect(args, hasLength(2));
      expect(args[0], 'url.dll,FileProtocolHandler');
      expect(args[1], url,
          reason: 'URL phải nguyên vẹn 100%, không tách/cắt ở bất kỳ &/%/state/redirect_uri nào');
    });
  }

  test('URL rỗng vẫn tạo được args (caller openExternalUrl mới là nơi chặn rỗng)',
      () {
    expect(windowsOpenUrlArgs(''), ['url.dll,FileProtocolHandler', '']);
  });
}
