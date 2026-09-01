// Ép kiểu giá trị đọc từ JSON của API Cài đặt.
//
// Server trả cùng một field khi thì số, khi thì chuỗi (SQLite + JSON không giữ
// kiểu chặt), nên mọi panel Cài đặt đều phải ép kiểu trước khi hiển thị. Ba
// hàm này trước đây là helper private dùng chung qua `part of`; tách ra thành
// thư viện riêng để mỗi panel là một file độc lập, import được bình thường.

/// Chuỗi hiển thị; null → ''.
String asText(dynamic v) => v?.toString() ?? '';

/// Cờ bật/tắt — chấp nhận cả true, 1 và '1' như server gửi về.
bool asFlag(dynamic v) => v == true || v == 1 || v == '1';

/// Số; parse được thì lấy, không thì 0.
num asNum(dynamic v) => v is num ? v : num.tryParse(asText(v)) ?? 0;

/// Số nguyên (đếm thiết bị, cổng, số bản ghi…); parse hỏng thì 0.
int asInt(dynamic v) => v is num ? v.toInt() : int.tryParse(asText(v)) ?? 0;
