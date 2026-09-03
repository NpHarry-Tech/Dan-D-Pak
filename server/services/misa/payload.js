// MISA meInvoice — DỰNG PAYLOAD HÓA ĐƠN từ snapshot của bill.
//
// Tách riêng khỏi phần gọi mạng vì đây là chỗ DỄ SAI TIỀN NHẤT và là chỗ phải
// test được mà không cần mạng.
//
// Quy tắc tiền của Dan-D Pak: GIÁ KHÁCH NHÌN THẤY VÀ TRẢ LÀ GIÁ ĐÃ GỒM VAT.
// Nên phải TÁCH thuế ra khỏi giá gồm thuế:
//     VAT = gross × r / (100 + r)
//     net = gross − VAT
// TUYỆT ĐỐI không lấy giá hiển thị trừ đi r% rồi cộng lại r% — hai phép đó
// không nghịch đảo nhau, tổng hóa đơn sẽ lệch tổng bill.
//
// Chênh lệch do khuyến mãi/giảm giá được PHÂN BỔ theo tỷ trọng từng dòng, dòng
// cuối nhận phần dư làm tròn, để tổng các dòng khớp TUYỆT ĐỐI tổng bill.

import { allocateProportion, divideMoney, money, multiplyMoney, netFromGross } from '../../core/money.js';

/// Múi giờ NGHIỆP VỤ. Ngày hóa đơn quyết định kỳ kê khai thuế nên tuyệt đối
/// không được phụ thuộc múi giờ của máy chủ.
const TZ = 'Asia/Ho_Chi_Minh';

/// Ngày lập hóa đơn theo giờ Việt Nam.
///
/// KHÔNG dùng `getFullYear()/getHours()` (giờ máy) và KHÔNG dùng `toISOString()`
/// (UTC). Container trên VPS chạy UTC: bill thanh toán 00:10 giờ VN là 17:10
/// UTC NGÀY HÔM TRƯỚC — ghi theo giờ máy thì hóa đơn rơi sai ngày, sai luôn kỳ
/// kê khai. `Intl` với timeZone cố định cho ra đúng ngày giờ cửa hàng dù máy
/// chủ đặt múi giờ nào.
export function localInvDate(value) {
  const d = value ? new Date(value) : new Date();
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: TZ,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(d).map((x) => [x.type, x.value]),
  );
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`;
}

/// Hình thức thanh toán ghi trên hóa đơn, suy từ các dòng thanh toán thật.
export function paymentMethodName(payments = []) {
  const methods = [...new Set(payments.map((p) => String(p?.method || '')))].filter(Boolean);
  if (!methods.length) return 'TM/CK';
  const coTienMat = methods.includes('cash');
  const coKhac = methods.some((m) => m !== 'cash');
  if (coTienMat && coKhac) return 'TM/CK';
  return coTienMat ? 'TM' : 'CK';
}

/// Khóa chống trùng gửi lên MISA. Gắn với PHÁP NHÂN + CHI NHÁNH + BILL nên hai
/// máy cùng xử lý một bill vẫn ra CÙNG một khóa → MISA từ chối bản thứ hai.
export function refId({ taxCode, branchId, orderId, version = 1 }) {
  return `einv:${taxCode}:${branchId || 'sala'}:${orderId}:v${version}`;
}

/// Dựng các dòng hàng của hóa đơn.
///
/// [items] lấy từ snapshot (KHÔNG đọc lại giá hiện tại của sản phẩm — sửa giá
/// sau khi bán không được phép làm đổi hóa đơn đã chốt).
/// [totalAmount] là tổng khách thật sự trả, đã gồm VAT.
export function buildInvoiceLines(items, totalAmount, defaultVatRate = 8) {
  const qtyOf = (it) => {
    const q = Number(it?.quantity ?? it?.qty ?? 1);
    return Number.isFinite(q) && q > 0 ? q : 1;
  };
  // Giá dòng khách thật sự trả: đơn giá + topping/mods, nhân số lượng.
  const grossOf = (it) => {
    const mods = Array.isArray(it?.mods)
      ? it.mods.reduce((s, m) => s + money(m?.price), 0)
      : 0;
    const finalUnitGross = it?.final_price_after_vat
      ?? it?.final_price
      ?? it?.unit_price;
    return multiplyMoney(money(finalUnitGross) + mods, qtyOf(it));
  };

  const lineGross = items.map(grossOf);
  const grossSum = lineGross.reduce((a, b) => a + b, 0);
  const total = money(totalAmount);

  let allocated = 0;
  const productLines = items.map((it, i) => {
    const qty = qtyOf(it);
    const isLast = i === items.length - 1;
    // Dòng cuối nhận phần dư → tổng các dòng LUÔN bằng tổng bill.
    const lineTotal = isLast
      ? total - allocated
      : allocateProportion(total, lineGross[i], grossSum);
    if (!isLast) allocated += lineTotal;

    const vatRate = it?.vat_rate !== undefined && it.vat_rate !== null
      ? Number(it.vat_rate)
      : Number(defaultVatRate);
    const amountWithoutVAT = netFromGross(lineTotal, vatRate);
    const vatAmount = lineTotal - amountWithoutVAT;

    return {
      ItemType: 1,
      SortOrder: i + 1,
      ItemCode: String(it?.product_code ?? it?.sku_id ?? it?.code ?? '').slice(0, 100),
      ItemName: String(it?.product_name ?? it?.name ?? '').slice(0, 500),
      UnitName: String(it?.unit_name ?? it?.unit ?? 'cái').slice(0, 50),
      Quantity: qty,
      UnitPrice: qty > 0 ? divideMoney(amountWithoutVAT, qty, 2) : amountWithoutVAT,
      Amount: amountWithoutVAT,
      VATRateName: `${vatRate}%`,
      VATRate: vatRate,
      VATAmount: vatAmount,
    };
  });

  // MISA meInvoice Open API v3: ItemType 1 = HHDV; ItemType 4 = ghi chú/diễn
  // giải. Dòng CTKM đứng ngay sau sản phẩm và không được mang số lượng/tiền/thuế.
  const lines = [];
  let lineNumber = 0;
  for (let i = 0; i < items.length; i += 1) {
    lines.push({ ...productLines[i], LineNumber: ++lineNumber });
    const promotion = items[i]?.promotion;
    if (promotion?.is_applied !== true) continue;
    const promoName = String(promotion?.promo_name || '').trim();
    if (!promoName) continue;
    lines.push({
      ItemType: 4,
      SortOrder: null,
      LineNumber: ++lineNumber,
      ItemCode: null,
      ItemName: promoName.slice(0, 500),
      UnitName: null,
      Quantity: null,
      UnitPrice: null,
      Amount: null,
      VATRateName: null,
      VATRate: null,
      VATAmount: null,
    });
  }

  const totalAmountWithoutVAT = productLines.reduce((s, l) => s + l.Amount, 0);
  const totalVATAmount = productLines.reduce((s, l) => s + l.VATAmount, 0);
  return { lines, totalAmountWithoutVAT, totalVATAmount, grandTotal: total };
}

/// Kiểm tra cân đối TRƯỚC KHI GỬI. Hóa đơn lệch tiền mà vẫn gửi đi là sai sổ
/// sách thật, sửa lại phải làm hóa đơn điều chỉnh — chặn ngay ở đây rẻ hơn
/// nhiều.
export function assertBalanced({ lines, totalAmountWithoutVAT, totalVATAmount, grandTotal }) {
  const tongDong = lines
    .filter((line) => line.ItemType !== 4)
    .reduce((s, l) => s + money(l.Amount) + money(l.VATAmount), 0);
  if (tongDong !== grandTotal) {
    throw new Error(
      `Hóa đơn lệch tiền: tổng các dòng ${tongDong} ≠ tổng bill ${grandTotal}`,
    );
  }
  if (totalAmountWithoutVAT + totalVATAmount !== grandTotal) {
    throw new Error(
      `Hóa đơn lệch tiền: tiền hàng ${totalAmountWithoutVAT} + thuế ${totalVATAmount} ≠ ${grandTotal}`,
    );
  }
}

/// Payload đầy đủ gửi MISA.
///
/// [snapshot] là bản ghi bất biến đã chốt lúc đóng bill.
export function buildPublishPayload({ snapshot, cfg, company = {} }) {
  const bill = snapshot?.bill || {};
  const buyer = snapshot?.buyer || {};
  const items = Array.isArray(snapshot?.items) ? snapshot.items : [];
  if (!items.length) throw new Error('Hóa đơn không có dòng hàng nào');

  const totals = buildInvoiceLines(
    items,
    snapshot?.total ?? bill.total,
    cfg?.defaultTaxRate || 8,
  );
  assertBalanced(totals);

  const coMa = company.invoiceWithCode !== null && company.invoiceWithCode !== undefined
    ? !!company.invoiceWithCode
    : String(cfg?.invoiceCodeType || '') !== 'WITHOUT_CODE';

  return {
    RefID: refId({
      taxCode: cfg?.taxCode,
      branchId: bill.branch_id || snapshot?.branch_id,
      orderId: snapshot?.order_id,
      version: snapshot?.schema_version || 1,
    }),
    OrgInvoiceData: {
      IsInvoiceCalculatingMachine: String(cfg?.invoiceType || '') === 'CASH_REGISTER',
      IsInvoiceWithCode: coMa,
      // Mẫu và ký hiệu LẤY TỪ CẤU HÌNH ĐÃ CHỌN (đồng bộ từ MISA), không đặt
      // giá trị dự phòng cứng trong code.
      TemplateID: cfg?.templateId || '',
      InvSeries: cfg?.series || '',
      InvDate: localInvDate(bill.paid_at || snapshot?.payment_success_at),
      BuyerLegalName: buyer.name || 'Bán cho người tiêu dùng',
      BuyerTaxCode: buyer.tax_code || '',
      BuyerAddress: buyer.address || '',
      BuyerEmail: buyer.email || '',
      BuyerPhone: buyer.phone || '',
      PaymentMethodName: paymentMethodName(snapshot?.payments),
      OriginalInvoiceDetail: totals.lines,
      TotalAmountWithoutVAT: totals.totalAmountWithoutVAT,
      TotalVATAmount: totals.totalVATAmount,
      TotalAmount: totals.grandTotal,
    },
  };
}
