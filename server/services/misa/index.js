// MISA meInvoice — CỬA VÀO DUY NHẤT của tích hợp.
//
// Cả hệ thống chỉ import từ file này; các file bên trong thư mục là chi tiết
// cài đặt và có thể đổi mà không ảnh hưởng nơi gọi.
//
//   config.js      địa chỉ API (cấu hình được), điều kiện kích hoạt, trạng thái
//   client.js      HTTP + timeout + PHÂN LOẠI lỗi tạm thời / lỗi dữ liệu
//   auth.js        token: cache, tự gia hạn, single-flight
//   company.js     thông tin doanh nghiệp + danh sách mẫu hóa đơn
//   payload.js     snapshot bill → payload MISA (toán VAT, kiểm cân đối)
//   invoice.js     phát hành / tra trạng thái / hủy
//   connection.js  kiểm tra kết nối 3 bước
//
// Trước đây tất cả nằm trong MỘT file 297 dòng vừa dựng payload vừa gọi mạng
// vừa tự đăng nhập lại ở mỗi thao tác — không chỗ nào test được nếu không có
// mạng, và sửa một chỗ là đụng cả ba việc.

export {
  DEFAULT_ENDPOINTS,
  CONFIG_STATUS,
  baseUrl,
  endpointUrl,
  isProduction,
  environmentMismatch,
  activationBlockers,
  isLive,
  configStatus,
} from './config.js';

export { MisaError, sanitize } from './client.js';
export { getToken, clearToken, withToken } from './auth.js';
export { fetchCompany, fetchTemplates, filterTemplates } from './company.js';
export {
  localInvDate,
  paymentMethodName,
  refId,
  buildInvoiceLines,
  assertBalanced,
  buildPublishPayload,
} from './payload.js';
export { issueInvoice, getInvoiceStatus, cancelInvoice } from './invoice.js';
export { testConnection } from './connection.js';
