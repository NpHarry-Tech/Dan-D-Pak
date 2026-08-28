/// Gói lõi DÙNG CHUNG cho cả 3 app Dan D Pak (desktop / tablet / phone).
///
/// Toàn bộ models, providers, screens, services, ui, widgets và điểm vào khởi
/// động sống ở đây (thư mục `src/`). Mỗi app chỉ là một "vỏ mỏng" gọi
/// [runDandpakApp] với [AppFlavor] của mình. Xem `src/app_flavor.dart`.
library dandpak_core;

// Điểm vào dùng chung + cấu hình theo thiết bị (thứ 3 app cần).
export 'src/app_flavor.dart';
// Agent in chay trong app — cho may POS cam tay co may in gan lien.
export 'src/services/local_print_agent.dart';
export 'src/services/local_store.dart' show LocalStore;
export 'src/services/api_service.dart' show ApiService;
export 'src/bootstrap.dart' show runDandpakApp;

// Primitive lõi (giữ export để tương thích ngược nếu nơi khác còn dùng barrel).
export 'src/app_defaults.dart';
export 'src/api_client.dart';
export 'src/realtime_client.dart';
