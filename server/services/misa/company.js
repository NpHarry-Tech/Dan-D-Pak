// MISA meInvoice — THÔNG TIN DOANH NGHIỆP và DANH SÁCH MẪU HÓA ĐƠN.
//
// Hai thao tác này TRƯỚC ĐÂY KHÔNG HỀ TỒN TẠI trong code. Hậu quả dây chuyền:
// điều kiện kích hoạt đòi `templateId` nhưng không có đường nào lấy mẫu về, nên
// cấu hình không bao giờ hoàn tất và không một hóa đơn nào được gửi đi.
//
// Tên trường trong response khác nhau giữa các gói dịch vụ MISA, nên chỗ này
// đọc theo NHIỀU TÊN GỌI thay vì bám cứng một cái. Đọc trượt hết thì báo rõ là
// "không đọc được", chứ không im lặng trả rỗng làm người dùng tưởng chưa khai
// mẫu nào trên MISA.

import { callJson, authHeaders } from './client.js';
import { endpointUrl } from './config.js';
import { withToken } from './auth.js';

function pick(obj, ...names) {
  for (const n of names) {
    if (obj?.[n] !== undefined && obj[n] !== null && obj[n] !== '') return obj[n];
  }
  return undefined;
}

/// MISA bọc dữ liệu theo nhiều kiểu: {data}, {Data}, {data:{items}}, mảng thô…
function unwrap(body) {
  const d = body?.data ?? body?.Data ?? body;
  return d ?? {};
}

function asList(value) {
  if (Array.isArray(value)) return value;
  for (const key of ['items', 'Items', 'list', 'List', 'templates', 'Templates', 'data', 'Data']) {
    if (Array.isArray(value?.[key])) return value[key];
  }
  return [];
}

/// Thông tin doanh nghiệp theo mã số thuế.
///
/// `IsInvoiceWithCode` là trường MISA dùng để nói doanh nghiệp phát hành hóa
/// đơn CÓ MÃ hay KHÔNG CÓ MÃ của cơ quan thuế. Lấy từ đây rồi KHÓA lại, không
/// để người dùng tự chọn — chọn sai là hóa đơn bị cơ quan thuế từ chối.
export async function fetchCompany(cfg) {
  const taxCode = String(cfg.taxCode || '').trim();
  if (!taxCode) throw new Error('Thiếu mã số thuế để tra cứu doanh nghiệp');

  const url = `${endpointUrl(cfg, 'company')}?taxcode=${encodeURIComponent(taxCode)}`;
  const body = await withToken(cfg, (token) => callJson(url, {
    method: 'GET',
    headers: authHeaders(token, taxCode),
  }, 15000));

  const d = unwrap(body);
  const traVeMst = String(
    pick(d, 'TaxCode', 'taxCode', 'taxcode', 'CompanyTaxCode') || '',
  ).trim();

  // MISA trả về doanh nghiệp KHÁC với mã số thuế đã nhập → dừng ngay. Đây
  // chính là tình huống "đúng tài khoản nhưng sai MST": để lọt là hóa đơn xuất
  // dưới tên pháp nhân khác.
  if (traVeMst && traVeMst.replace(/\s/g, '') !== taxCode.replace(/\s/g, '')) {
    throw new Error(
      `Mã số thuế không khớp: đã nhập ${taxCode}, tài khoản MISA thuộc về ${traVeMst}.`,
    );
  }

  const coMa = pick(d, 'IsInvoiceWithCode', 'isInvoiceWithCode', 'invoiceWithCode');
  return {
    taxCode: traVeMst || taxCode,
    name: String(pick(d, 'CompanyName', 'companyName', 'Name', 'name') || '').trim(),
    address: String(pick(d, 'Address', 'address') || '').trim(),
    // undefined = MISA không nói gì; giữ null để màn Cài đặt biết là "chưa rõ"
    // thay vì mặc định bừa thành "có mã".
    invoiceWithCode: coMa === undefined ? null : !!coMa,
    active: pick(d, 'IsActive', 'isActive', 'Status', 'status') !== false,
    raw: d,
  };
}

/// Chuẩn hóa một mẫu hóa đơn về đúng những gì hệ thống cần.
function normalizeTemplate(row) {
  const id = String(
    pick(row, 'TemplateID', 'TemplateId', 'templateId', 'Id', 'id', 'InvTemplateNo') || '',
  ).trim();
  const series = String(
    pick(row, 'InvSeries', 'invSeries', 'Series', 'series', 'Symbol', 'InvoiceSymbol') || '',
  ).trim();
  return {
    id,
    // Ký hiệu hóa đơn LẤY TỪ MẪU, không cho gõ tay: gõ sai là hóa đơn phát
    // hành dưới ký hiệu chưa đăng ký với cơ quan thuế.
    series,
    name: String(
      pick(row, 'TemplateName', 'templateName', 'Name', 'name', 'InvTemplateName') || '',
    ).trim() || series || id,
    invoiceType: String(
      pick(row, 'InvoiceType', 'invoiceType', 'InvTypeID', 'TypeId') || '',
    ).trim(),
    withCode: (() => {
      const v = pick(row, 'IsInvoiceWithCode', 'isInvoiceWithCode', 'InvoiceWithCode');
      return v === undefined ? null : !!v;
    })(),
    fromCashRegister: !!pick(row, 'IsInvoiceCalculatingMachine', 'isInvoiceCalculatingMachine'),
    active: pick(row, 'IsActive', 'isActive', 'Inactive') !== false
      && !pick(row, 'Inactive', 'inactive'),
    raw: row,
  };
}

/// Danh sách mẫu hóa đơn CÒN HIỆU LỰC của doanh nghiệp.
export async function fetchTemplates(cfg) {
  const taxCode = String(cfg.taxCode || '').trim();
  const url = endpointUrl(cfg, 'templates');
  const body = await withToken(cfg, (token) => callJson(url, {
    method: 'GET',
    headers: authHeaders(token, taxCode),
  }, 15000));

  const rows = asList(unwrap(body));
  return rows
    .map(normalizeTemplate)
    // Mẫu không có ký hiệu thì không phát hành được — bày ra chỉ để người dùng
    // chọn rồi hỏng lúc xuất hóa đơn.
    .filter((tpl) => tpl.id && tpl.series && tpl.active);
}

/// Lọc mẫu phù hợp với doanh nghiệp và loại nghiệp vụ đang cấu hình.
/// Mẫu không khai rõ thuộc tính (null) thì KHÔNG loại — MISA có gói không trả
/// mấy cờ này, loại đi là danh sách rỗng oan.
export function filterTemplates(templates, { invoiceWithCode = null, fromCashRegister = null } = {}) {
  return templates.filter((tpl) => {
    if (invoiceWithCode !== null && tpl.withCode !== null && tpl.withCode !== invoiceWithCode) {
      return false;
    }
    if (fromCashRegister === true && tpl.fromCashRegister === false) return false;
    return true;
  });
}
