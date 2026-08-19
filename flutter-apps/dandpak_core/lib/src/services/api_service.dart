import '../primitives.dart';
import '../models/app_models.dart';
import '../screens/self_order/self_order_models.dart';

// Mỗi phần nghiệp vụ (POS, Quản lý, Cài đặt, Bán lẻ, Liên hệ, Mua hàng, Chi
// phí, Online, Tài liệu, CSDL, Máy in, Self-Order, Kho, Hoá đơn…) sống ở
// riêng 1 file trong api/ — file này chỉ còn là điểm vào + phần dùng chung
// (login/user không thuộc riêng nghiệp vụ nào). Method vẫn gọi y hệt
// `ApiService().xxx()` vì extension trên cùng 1 class, không đổi API dùng.
part 'api/auth_api.dart';
part 'api/pos_api.dart';
part 'api/management_api.dart';
part 'api/settings_api.dart';
part 'api/retail_api.dart';
part 'api/contacts_api.dart';
part 'api/purchase_api.dart';
part 'api/expenses_api.dart';
part 'api/online_api.dart';
part 'api/omni_api.dart';
part 'api/documents_api.dart';
part 'api/database_api.dart';
part 'api/printing_api.dart';
part 'api/self_order_api.dart';
part 'api/catalogue_api.dart';
part 'api/warehouse_api.dart';
part 'api/invoice_api.dart';

class ApiService extends DanDpakApiClient {
  ApiService({super.baseUrl, super.token, super.branchId});
}
