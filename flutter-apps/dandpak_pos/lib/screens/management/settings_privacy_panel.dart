import '../../utils/translation.dart';
import 'package:flutter/material.dart';
import '../../ui/app_theme.dart';
import 'settings_tab.dart';

class PrivacySettingsPanel extends StatelessWidget {
  const PrivacySettingsPanel({super.key});

  @override
  Widget build(BuildContext context) {
    return SettingsPanelScaffold(
      title: 'Policy Security',
      child: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          Card(
            child: Padding(
              padding: const EdgeInsets.all(20),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      const Icon(Icons.privacy_tip_outlined, color: DanColors.brand, size: 28),
                      const SizedBox(width: 10),
                      Text(
                        t('Cam kết Security & Quyền riêng tư'),
                        style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w900),
                      ),
                    ],
                  ),
                  const SizedBox(height: 14),
                  Text(
                    t('Ứng dụng Dan D Pak POS cam kết tuyệt đối bảo vệ dữ liệu và quyền riêng tư của bạn. Dưới đây là cách chúng tôi xử lý các quyền hạn nhạy cảm trên thiết bị:'),
                    style: const TextStyle(fontSize: 13.5, height: 1.5, fontWeight: FontWeight.w500),
                  ),
                  const Divider(height: 28),
                  
                  _sectionTitle(t('1. Quyền truy cập Camera (Máy ảnh)')),
                  _sectionBody(
                    t('• Mục đích sử dụng: Sử dụng duy nhất cho chức năng quét mã vạch sản phẩm (Retail) và nhập xuất kho (Warehouse) qua camera trên tablet/điện thoại.\n'
                    '• Security tuyệt đối: Mọi quá trình xử lý hình ảnh để nhận diện mã vạch đều được thực hiện cục bộ trên thiết bị của bạn thông qua thư viện Google ML Kit SDK. Ứng dụng KHÔNG chụp ảnh, KHÔNG ghi video, KHÔNG lưu trữ và KHÔNG gửi bất kỳ hình ảnh nào từ camera của bạn lên mạng hay máy chủ bên thứ ba.')
                  ),
                  
                  const SizedBox(height: 18),
                  _sectionTitle(t('2. Connection Network nội bộ & Printternet')),
                  _sectionBody(
                    t('• Mục đích sử dụng: Đảm bảo giao tiếp thời gian thực (realtime) qua Socket.IO và gửi các yêu cầu nghiệp vụ (tạo hóa đơn, cập nhật bàn, gọi món) tới máy chủ POS trung tâm.\n'
                    '• Security: Data giao dịch được mã hóa và truyền trực tiếp trong mạng nội bộ LAN cửa hàng hoặc qua kênh bảo mật VPS doanh nghiệp.')
                  ),
                  
                  const SizedBox(height: 18),
                  _sectionTitle(t('3. No thu thập thông tin cá nhân')),
                  _sectionBody(
                    t('• Ứng dụng không tự động thu thập bất kỳ thông tin cá nhân hay vị trí địa lý của người dùng. Các thông tin cấu hình (URL máy chủ, mã PIN nhân viên, ca làm việc) được lưu trữ an toàn trong vùng nhớ cache bảo mật của ứng dụng trên thiết bị và chỉ được gửi tới máy chủ POS nội bộ được bạn cấu hình để phục vụ xác thực nghiệp vụ.')
                  ),

                  const SizedBox(height: 18),
                  _sectionTitle(t('4. Contacts & Hỗ trợ')),
                  _sectionBody(
                    t('• Nếu bạn có bất kỳ câu hỏi nào về việc phân quyền thiết bị hoặc chính sách bảo mật này, vui lòng liên hệ với Administrator hệ thống hoặc Bộ phận Kỹ thuật Dan D Pak.')
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _sectionTitle(String text) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: Text(
        text,
        style: const TextStyle(
          fontSize: 14.5,
          fontWeight: FontWeight.w800,
          color: DanColors.brand,
        ),
      ),
    );
  }

  Widget _sectionBody(String text) {
    return Text(
      text,
      style: const TextStyle(
        fontSize: 13,
        height: 1.5,
        color: DanColors.text,
      ),
    );
  }
}
