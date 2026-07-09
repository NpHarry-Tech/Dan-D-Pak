import '../utils/translation.dart';
import 'package:flutter/material.dart';
import '../ui/app_theme.dart';

void showPrivacyPolicyDialog(BuildContext context) {
  showDialog(
    context: context,
    builder: (context) => const PrivacyPolicyDialog(),
  );
}

class PrivacyPolicyDialog extends StatelessWidget {
  const PrivacyPolicyDialog({super.key});

  @override
  Widget build(BuildContext context) {
    return Dialog(
      backgroundColor: DanColors.surface,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(DanRadius.lg),
        side: const BorderSide(color: DanColors.border),
      ),
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 620, maxHeight: 520),
        child: Padding(
          padding: const EdgeInsets.all(22),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(
                children: [
                  const Icon(Icons.privacy_tip_outlined, color: DanColors.brand, size: 24),
                  const SizedBox(width: 8),
                  const Expanded(
                    child: Text(
                      'Policy Security (Privacy Policy)',
                      style: TextStyle(
                        fontSize: 18,
                        fontWeight: FontWeight.w900,
                        color: DanColors.text,
                      ),
                    ),
                  ),
                  IconButton(
                    onPressed: () => Navigator.of(context).pop(),
                    icon: const Icon(Icons.close),
                    visualDensity: VisualDensity.compact,
                  ),
                ],
              ),
              const SizedBox(height: 12),
              Expanded(
                child: SingleChildScrollView(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        t('Ứng dụng Dan D Pak POS cam kết bảo vệ thông tin riêng tư của người dùng. Dưới đây là chính sách thu thập và xử lý dữ liệu chi tiết:'),
                        style: const TextStyle(fontSize: 13, height: 1.45, fontWeight: FontWeight.w500),
                      ),
                      const SizedBox(height: 12),
                      Text(
                        t('1. Quyền truy cập thiết bị'),
                        style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w800, color: DanColors.brand),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        t('• Camera: Ứng dụng chỉ sử dụng Camera để quét mã vạch/QR của sản phẩm phục vụ nghiệp vụ bán hàng (Retail) và nhập xuất kho (Warehouse). Chúng tôi cam kết KHÔNG lưu trữ hình ảnh, KHÔNG thu thập dữ liệu cá nhân hay gửi bất cứ hình ảnh/video nào từ camera lên máy chủ bên ngoài. Mọi quá trình xử lý hình ảnh mã vạch đều được diễn ra hoàn toàn cục bộ trên thiết bị của bạn thông qua Google ML Kit SDK.\n'
                        '• Printternet & Network nội bộ (Local Network): Cần mạng để kết nối, truyền tải dữ liệu và đồng bộ hóa trạng thái đơn hàng thời gian thực giữa máy khách POS và máy chủ POS trung tâm (cục bộ hoặc Cloud/VPS).'),
                        style: const TextStyle(fontSize: 13, height: 1.45),
                      ),
                      const SizedBox(height: 12),
                      Text(
                        t('2. Thu thập thông tin cá nhân'),
                        style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w800, color: DanColors.brand),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        t('• Ứng dụng Dan D Pak POS hoạt động như một công cụ quản trị nguồn lực doanh nghiệp nội bộ. Chúng tôi KHÔNG thu thập thông tin cá nhân của khách hàng vãng lai sử dụng tablet tự phục vụ (Self-order) hay dữ liệu riêng tư của nhân viên ngoại trừ các thông tin đăng nhập nghiệp vụ (mã PIN nhân viên, thông tin chi nhánh cửa hàng) được lưu trữ an toàn trong vùng nhớ ứng dụng.'),
                        style: const TextStyle(fontSize: 13, height: 1.45),
                      ),
                      const SizedBox(height: 12),
                      Text(
                        t('3. Chia sẻ thông tin với bên thứ ba'),
                        style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w800, color: DanColors.brand),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        t('• Chúng tôi tuyệt đối không mua bán, trao đổi hoặc tiết lộ bất kỳ thông tin nào từ ứng dụng này cho bên thứ ba ngoại trừ trường hợp có yêu cầu chính thức từ cơ quan pháp luật có thẩm quyền.'),
                        style: const TextStyle(fontSize: 13, height: 1.45),
                      ),
                      const SizedBox(height: 12),
                      Text(
                        t('4. Contacts hỗ trợ'),
                        style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w800, color: DanColors.brand),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        t('• Nếu có bất kỳ thắc mắc nào liên quan đến chính sách bảo mật này, xin vui lòng liên hệ với ban quản trị hệ thống Dan D Pak để được hỗ trợ giải đáp nhanh chóng nhất.'),
                        style: const TextStyle(fontSize: 13, height: 1.45),
                      ),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 14),
              Row(
                mainAxisAlignment: MainAxisAlignment.end,
                children: [
                  OutlinedButton(
                    onPressed: () => Navigator.of(context).pop(),
                    child: const Text('Close'),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}
