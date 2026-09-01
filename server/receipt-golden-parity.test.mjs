import test from 'node:test';
import assert from 'node:assert/strict';
import { renderJobText, markReceiptReprint } from './services/printing.js';
import { moneyToWords } from './services/history.js';

test('Golden Receipt Parity & Formatter Validation', () => {
  // 1. Money to Words validation
  assert.equal(moneyToWords(100000), 'Một trăm nghìn đồng');
  assert.equal(moneyToWords(24545), 'Hai mươi bốn nghìn năm trăm bốn mươi lăm đồng');

  // 2. Sample receipt rendering with Unicode, header & amount in words
  const samplePayload = {
    bill_no: '000123',
    branch: 'SALA',
    company: {
      name: 'CÔNG TY TNHH DỊCH VỤ TIẾP THỊ BCM',
      address: 'Sala Tower, Q.2, TP.HCM',
    },
    table_code: '1',
    items: [
      { name: 'Bia 333 330ml', qty: 1, unit_price: 24545 },
      { name: 'Cà phê sữa đá', qty: 2, unit_price: 34024 },
    ],
    subtotal: 92593,
    vat_amount: 7407,
    total: 100000,
    paid: 100000,
    change: 0,
    reprint: true,
  };

  const job = {
    type: 'receipt',
    branch_id: 'sala',
    payload: samplePayload,
  };

  const receiptText = renderJobText(job, 'sala', { widthMm: 58 });

  // Verify K57 32-col layout
  const lines = receiptText.split('\n');
  for (const l of lines) {
    assert.ok(l.length <= 32, `Line exceeds 32 chars on K57: "${l}" (${l.length} chars)`);
  }

  // TÊN TRÊN BILL LẤY TỪ CÀI ĐẶT CHI NHÁNH, không phải bản chụp trong đơn.
  //
  // `payload.company` được chụp lúc TẠO đơn. Ưu tiên nó thì chủ cửa hàng vào
  // Cài đặt xoá tên công ty hay sửa địa chỉ xong in ra vẫn thấy y như cũ, không
  // hiểu vì sao (sự cố thật 04/08/2026). Cài đặt là thứ người dùng sửa được nên
  // Cài đặt phải thắng; p.company chỉ dùng khi Cài đặt bỏ trống.
  assert.ok(receiptText.includes('Dan'),
      'tên cửa hàng phải lấy từ Cài đặt chi nhánh');

  // Verify (IN LẠI) is on bill title line, NOT attached to company name
  assert.ok(receiptText.includes('HÓA ĐƠN THANH TOÁN (IN LẠI)'));
  assert.ok(!receiptText.includes('TIẾP THỊ (IN LẠI)'));
  assert.ok(!receiptText.includes('BCM (IN LẠI)'));

  // Bố cục thân bill (yêu cầu #4e của chủ cửa hàng): TÊN hàng nằm ở DÒNG RIÊNG,
  // ngay dưới là dòng số liệu ba cột SL / Đơn giá / Thành tiền. Vì tên tách ra
  // dòng riêng nên dòng số liệu ngắn, KHÔNG còn tràn khổ K57 như bố cục cũ (khi
  // tên + đơn giá + thành tiền chen chung một dòng) — xem danhSachHang().
  assert.ok(receiptText.includes('SL'));
  assert.ok(receiptText.includes('Đơn giá'));
  assert.ok(receiptText.includes('T.Tiền'));

  // Cột tiền nhóm nghìn bằng dấu phẩy, KHÔNG kèm "đ" — cột trên khổ K57 chỉ
  // rộng 14 ký tự, thêm ký tự nào cũng đẩy số tiền lệch hàng.
  assert.ok(receiptText.includes('24,545'));
  assert.ok(receiptText.includes('100,000'));

  // Verify Amount in Words line
  assert.ok(receiptText.includes('Bằng chữ:'));
  assert.ok(receiptText.includes('Một trăm nghìn đồng'));

  // Đường kẻ ngăn giữa các khối vẫn còn.
  assert.ok(receiptText.includes('----------------'));
});

test('markReceiptReprint does not append (IN LẠI) to store or company name', () => {
  const input = [
    'CÔNG TY TNHH DỊCH VỤ TIẾP THỊ',
    'BCM',
    '--------------------------------',
    'HÓA ĐƠN THANH TOÁN',
    'Mã HD: #000123',
  ].join('\n');

  const output = markReceiptReprint(input);

  assert.ok(!output.includes('TIẾP THỊ (IN LẠI)'));
  assert.ok(!output.includes('BCM (IN LẠI)'));
  assert.ok(output.includes('HÓA ĐƠN THANH TOÁN (IN LẠI)'));
});
