/// Số hiệu build của bản app tablet ĐANG chạy. Cơ chế báo cập nhật so con số
/// này với buildNumber trên server (/api/app/version?platform=android):
/// server lớn hơn → hiện hộp thoại mời tải bản mới.
///
/// QUY TRÌNH PHÁT HÀNH: mỗi lần ra bản mới → TĂNG kAppBuildNumber (và đổi
/// kAppVersionName) → build APK → publish lên server với ĐÚNG số build này.
const int kAppBuildNumber = 1;
const String kAppVersionName = '2026.07.09';
