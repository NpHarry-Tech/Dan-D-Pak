/// Số hiệu build của bản app ĐANG chạy. Auto-update so con số này với
/// buildNumber trên server (/api/app/version): server lớn hơn → báo cập nhật.
///
/// QUY TRÌNH PHÁT HÀNH: mỗi lần ra bản mới → TĂNG kAppBuildNumber (và đổi
/// kAppVersionName cho dễ đọc) → build .exe → publish lên VPS với ĐÚNG số build
/// này (script deploy/publish-release.ps1 tự đọc 2 hằng số dưới đây).
const int kAppBuildNumber = 53;
const String kAppVersionName = '2026.07.22.6';
