/// Barrel NỘI BỘ cho code bên trong package `dandpak_core`.
///
/// Các file lõi (screens/services/providers) trước đây import
/// `package:dandpak_core/dandpak_core.dart` để lấy DanDpakApiClient / DanDpakDefaults
/// / DanDpakRealtimeClient. Khi đã nằm TRONG package, chúng import barrel nội bộ này
/// (đường dẫn tương đối) để tránh vòng phụ thuộc với barrel công khai.
export 'app_defaults.dart';
export 'api_client.dart';
export 'realtime_client.dart';
