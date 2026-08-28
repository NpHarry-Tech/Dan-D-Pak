// ─────────────────────────────────────────────────────────────────────────
// NGUỒN SỰ THẬT DUY NHẤT: KHÁCH QUÉT MÃ NÀO ĐỂ CHUYỂN KHOẢN?
//
// Cửa hàng có nhiều đường nhận chuyển khoản, và chúng LOẠI TRỪ LẪN NHAU:
//   payos        — cổng thanh toán, QR động theo từng bill, tự đối soát
//   vietqr_api   — VietQR có tài khoản API, QR động, tự đối soát
//   sepay        — đọc biến động số dư, QR public + tự đối soát
//   vietqr_public— ảnh QR public dựng từ số tài khoản, KHÔNG tự đối soát
//   static       — ẢNH QR TĨNH cửa hàng tự tải lên, đối soát bằng mắt
//
// VÌ SAO PHẢI LOẠI TRỪ: bật hai đường cùng lúc thì khách quét mã này, hệ thống
// lại chờ tiền về theo mã kia — tiền vào rồi mà bill không tự đóng, hoặc tệ hơn
// là đóng nhầm bill khác. Mỗi thời điểm chỉ ĐÚNG MỘT đường được chạy.
//
// File này KHÔNG tự quyết theo ý mình: nó đọc cấu hình rồi trả về đường đang
// bật, kèm lý do — để màn Cài đặt hiện được "đang dùng cái nào, vì sao".
// ─────────────────────────────────────────────────────────────────────────
import { getOperationsConfig } from './settings/operations.js';
import { getIntegrations } from './settings/integrations.js';

/** Thứ tự ưu tiên khi cấu hình mâu thuẫn — cổng tự đối soát luôn thắng ảnh tĩnh. */
export const QR_PROVIDERS = ['payos', 'vietqr_api', 'sepay', 'vietqr_public', 'static'];

/** Đường nào TỰ ĐỐI SOÁT được (tiền về là bill tự đóng)? */
const TU_DOI_SOAT = new Set(['payos', 'vietqr_api', 'sepay']);

function txt(v, max = 500) {
  return String(v ?? '').trim().slice(0, max);
}

function sanCoNgay(cfg = {}) {
  return !!(txt(cfg.bankCode) && txt(cfg.bankAccount) && txt(cfg.userBankName || cfg.accountName));
}

/**
 * Đường nhận chuyển khoản ĐANG THẬT SỰ CHẠY ĐƯỢC cho chi nhánh này.
 *
 * "Bật" chưa đủ — phải ĐỦ THÔNG TIN mới tính. Cửa hàng tick bật payOS mà chưa
 * dán Client ID thì coi như chưa bật, nếu không khách bấm thanh toán sẽ nhận
 * một lỗi kỹ thuật giữa lúc đang đứng ở quầy.
 */
export function resolveQrProvider(branch_id = 'sala') {
  const ops = getOperationsConfig(branch_id);
  const pay = ops.payment || {};
  const ch = getIntegrations(branch_id).channels || {};

  const vietqr = ch.vietqr || {};
  const nganHang = {
    bankCode: txt(vietqr.bankCode || pay.bankCode, 40).toUpperCase(),
    bankAccount: txt(vietqr.bankAccount || pay.bankAccount, 80),
    userBankName: txt(vietqr.userBankName || pay.accountName, 160),
    bankName: txt(pay.bankName, 80),
  };

  // CÔNG TẮC TƯỜNG MINH CHO QR NGÂN HÀNG.
  //
  // Không thể suy ra "đã tắt" bằng cách xoá trống số tài khoản: cấu hình luôn
  // rơi về giá trị mặc định khi để trống, nên xoá xong vẫn thấy VCB/0123456789
  // và QR ngân hàng vẫn chạy. Cửa hàng bảo "tôi tắt mã ngân hàng" thì phải có
  // đúng một ô để tắt, chứ không phải đi xoá từng trường rồi đoán.
  const bankQrOff = pay.bankQrEnabled === false;

  const staticUrl = txt(pay.staticQrUrl || '', 500);
  const staticNote = txt(pay.staticQrNote || '', 300);

  const sanSang = {
    payos: !!(ch.payos?.enabled && txt(ch.payos.clientId) && txt(ch.payos.apiKey)
      && txt(ch.payos.checksumKey)),
    vietqr_api: !bankQrOff && !!(vietqr.enabled && txt(vietqr.username)
      && txt(vietqr.password) && sanCoNgay(nganHang)),
    sepay: !!(ch.sepay?.enabled && sanCoNgay(nganHang)),
    vietqr_public: !bankQrOff && sanCoNgay(nganHang),
    static: !!staticUrl,
  };

  // Cửa hàng chọn tay thì tôn trọng — miễn là đường đó thật sự dùng được.
  const chon = txt(pay.qrProvider, 40).toLowerCase();
  let provider = QR_PROVIDERS.includes(chon) && sanSang[chon] ? chon : '';

  // Chưa chọn (hoặc chọn một đường chưa đủ thông tin) thì lấy đường khả dụng
  // đứng đầu bảng ưu tiên — cửa hàng tắt SePay là QR tĩnh tự lên thay, không
  // phải vào Cài đặt bấm thêm lần nữa.
  if (!provider) provider = QR_PROVIDERS.find(p => sanSang[p]) || '';

  return {
    provider,                       // '' = chưa có đường nào -> không hiện QR
    sanSang,                        // để màn Cài đặt hiện cái nào bật được
    tuDoiSoat: TU_DOI_SOAT.has(provider),
    bank: nganHang,
    staticQrUrl: staticUrl,
    staticQrNote: staticNote,
    // Cửa hàng chọn tay một đường nhưng đường đó chưa đủ thông tin → nói rõ,
    // đừng im lặng rơi về đường khác rồi để họ tưởng cấu hình đã ăn.
    canhBao: (chon && QR_PROVIDERS.includes(chon) && !sanSang[chon])
      ? `Đang chọn "${chon}" nhưng chưa đủ thông tin, hệ thống tạm dùng "${provider || 'không có'}".`
      : '',
  };
}

/**
 * ÉP LOẠI TRỪ khi lưu cấu hình: bật một đường thì TẮT các đường còn lại.
 *
 * Chốt ở SERVER chứ không chỉ ở giao diện — cửa hàng có nhiều máy, người này
 * bật SePay ở máy A trong khi người kia bật QR tĩnh ở máy B thì giao diện không
 * cản được. Trả về bản `channels` đã dọn để người gọi ghi xuống.
 */
export function epLoaiTruQr(channels = {}, giuLai = '') {
  const giu = txt(giuLai, 40).toLowerCase();
  // Không bật đường nào thì không tắt đường nào — lưu cấu hình MISA hay Haravan
  // không được vô tình tắt cổng thanh toán đang chạy.
  if (!giu) return { ...channels };
  const out = { ...channels };
  for (const key of ['payos', 'vietqr', 'sepay', 'casso']) {
    if (!out[key]) continue;
    const laDuongNay = (key === 'vietqr' && (giu === 'vietqr_api' || giu === 'vietqr_public'))
      || key === giu;
    if (!laDuongNay && out[key].enabled) {
      out[key] = { ...out[key], enabled: false };
    }
  }
  return out;
}
