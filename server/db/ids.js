import crypto from 'node:crypto';

export const now = () => new Date().toISOString();

// BẢO MẬT: id phải KHÔNG ĐOÁN ĐƯỢC.
//
// Bản cũ dùng `Math.random().toString(36).slice(2,8) + Date.now().toString(36).slice(-4)`.
// Hai vấn đề: Math.random() của V8 là xorshift128+ (không phải PRNG mật mã) — lấy
// được vài giá trị liên tiếp là suy ra được state rồi đoán tiếp; còn phần thời gian
// chỉ có 4 ký tự base36 nên gần như đã biết trước. Kẻ tấn công tạo vài bản ghi của
// chính mình là đoán được id bản ghi của người khác.
//
// Điều đó quan trọng vì có endpoint chỉ dựa vào id để cho phép thao tác (luồng
// khách tự nhập thông tin xuất hoá đơn). Nay dùng 9 byte ngẫu nhiên mật mã
// (72 bit) — không đoán được, và không còn rò thời điểm tạo bản ghi.
//
// Id CŨ trong DB vẫn dùng bình thường: đây chỉ là chuỗi định danh, không nơi nào
// suy ngược thời gian hay thứ tự từ nó.
export const uid = (p = '') => p + crypto.randomBytes(9).toString('hex');
