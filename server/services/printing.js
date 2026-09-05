// Print service: queues jobs, sends real ESC/POS LAN or OS-printer jobs,
// records errors, and keeps a full print history for monitor/reprint.
import { execFile } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import net from 'node:net';
import { promisify } from 'node:util';
import { db, uid, now, audit } from '../db.js';
import { emit } from '../realtime.js';
import { env } from '../config/env.js';
import { getPrintConfig } from './settings.js';
import { moneyToWords } from './history.js';
import { listSystemPrinters, getAgentDevices } from './system.js';
import { logSystem } from './systemLogs.js';
import { receiptTaxNote } from './tax.js';
import { buildReceiptDoc, buildKitchenDoc, buildShippingLabelDoc, buildExpenseVoucherDoc, buildReturnVoucherDoc, sampleReceiptPayload } from './receipt_doc.js';
import { businessDateTime, businessParts, businessTime } from '../core/businessClock.js';

const execFileAsync = promisify(execFile);
const STATION_PRINTER = { kitchen: 'kitchen', salad: 'kitchen', bar: 'bar', beverage: 'bar' };
const ESC_INIT = Buffer.from([0x1b, 0x40, 0x1c, 0x2e]);
const ESC_CUT = Buffer.from([0x1d, 0x56, 0x42, 0x00]);
const ESC_DRAWER = Buffer.from([0x1b, 0x70, 0x00, 0x19, 0xfa]);

// ÉP MÁY IN VỀ TRẠNG THÁI CHUẨN trước mỗi phiếu. `ESC @` trên lý thuyết đã reset
// hết, nhưng rất nhiều máy in nhiệt hàng clone KHÔNG reset cỡ chữ và canh lề —
// máy giữ nguyên trạng thái của job trước (hoặc của phần mềm khác vừa in). Đó là
// lý do phiếu ra một cột hẹp giữa tờ K80: chữ còn kẹt ở chế độ phóng to.
//   ESC ! 0  chế độ in: font A, không đậm, KHÔNG nhân đôi cao/rộng
//   GS  ! 0  cỡ ký tự 1x1 (đây mới là lệnh gỡ phóng to 2x/4x)
//   ESC a 0  canh trái (server tự căn giữa bằng dấu cách, máy canh giữa nữa là lệch)
//   ESC 2    giãn dòng mặc định
// Thêm ba lệnh nữa sau khi đã gặp bản in thật:
//   ESC t 0   ép về BẢNG MÃ GỐC (PC437). Máy in giữ nguyên bảng mã của phần mềm
//             in trước đó; nằm ở bảng mã tiếng Việt thì chữ 'd' in ra thành 'y'
//             (sự cố thật: "Độ đậm: Rất đậm" ra "Yo Yam: Rat yam"). Bảng mã
//             riêng của tuyến (cp1258) gửi SAU lệnh này nên vẫn thắng.
//   GS L 0 0  lề trái = 0
//   GS W …    vùng in = TOÀN BỘ bề ngang giấy (65535 = tối đa, máy tự kẹp về
//             khổ thật của nó). Thiếu hai lệnh này thì máy giữ vùng in hẹp của
//             job trước và bill lệch hẳn sang trái, chừa hơn 10mm bên phải.
const ESC_RESET = Buffer.from([
  0x1b, 0x21, 0x00,
  0x1d, 0x21, 0x00,
  0x1b, 0x61, 0x00,
  0x1b, 0x32,
  0x1b, 0x74, 0x00,
  0x1d, 0x4c, 0x00, 0x00,
  0x1d, 0x57, 0xff, 0xff,
]);

const TYPE_LABEL = {
  kitchen_ticket: 'Lên món / Phiếu bếp',
  receipt: 'Hóa đơn / Tạm tính',
  cup_label: 'Tem ly',
  product_label: 'Tem sản phẩm',
  shipping_label: 'Tem vận đơn',
  runner: 'Phiếu chạy món',
  test: 'In thử',
  cash_drawer: 'Mở két tiền',
  inventory_document: 'Phiếu kho',
  purchase: 'Phiếu mua hàng',
  refund: 'Hoàn / trả hàng',
};

function parsePayload(raw) {
  try { return JSON.parse(raw || '{}') || {}; } catch { return {}; }
}

// Bỏ bớt dữ liệu ảnh nhúng (logo base64, có thể ~250KB/ảnh) khỏi print_config
// TRƯỚC KHI nhúng vào payload job/hóa đơn lưu trữ. renderEl() (bên dưới) chỉ in
// placeholder "[LABEL]" cho phần tử type=image, KHÔNG BAO GIỜ đọc el.src/
// originalSrc — nên giữ nguyên chỉ làm phình to mỗi dòng print_jobs/mỗi hóa đơn
// lưu trữ mà không ích gì. Đây là nguyên nhân sự cố CPU 100% do agent poll mỗi
// 1.5s phải JSON.parse hàng chục dòng, mỗi dòng cõng thêm một bản sao ảnh logo.
function stripTemplateImages(tpl) {
  if (!tpl || typeof tpl !== 'object') return tpl;
  const stripEls = (arr) => Array.isArray(arr)
    ? arr.map(el => (el && el.type === 'image') ? { ...el, src: '', originalSrc: '' } : el)
    : arr;
  return { ...tpl, elements: stripEls(tpl.elements), rows: stripEls(tpl.rows) };
}
export function printConfigForJob(cfg) {
  if (!cfg || typeof cfg !== 'object') return cfg;
  const templates = cfg.templates || {};
  return {
    ...cfg,
    templates: {
      ...templates,
      bill: stripTemplateImages(templates.bill),
      label: stripTemplateImages(templates.label),
    },
  };
}

function printerRows(branch_id = 'sala') {
  const cfg = getPrintConfig(branch_id);
  return Array.isArray(cfg.printers) ? cfg.printers : [];
}

function printerById(printer, branch_id = 'sala') {
  return printerRows(branch_id).find(p => p.id === printer) || null;
}

/**
 * Tuyến in của MỘT JOB — tra cấu hình TRƯỚC, không thấy thì dựng lại tuyến ngầm
 * 'auto:<device>:<tên máy in>'.
 *
 * SỰ CỐ THẬT: nút "In lại" và "In hóa đơn" trên máy POS cầm tay báo lỗi
 * "Chưa cấu hình tuyến máy in auto:dev_sunmi:InnerPrinter" còn IN THỬ thì tốt.
 * Lý do: in thử chọn từ danh sách tuyến ĐÃ KHAI nên không bao giờ chạm tuyến
 * ngầm, còn dispatchJob chỉ tra print_config. Máy in gắn liền của máy cầm tay
 * KHÔNG nằm trong print_config (agent báo lên lúc chạy), nên mọi bill đi qua
 * dispatchJob đều chết ở đây. Ba chỗ khác (pendingAgentJobs, resolveAgentJobFast,
 * rebuildImplicit) đã biết dựng lại tuyến này — thiếu đúng một chỗ.
 */
function printerForJob(printerId, branch_id = 'sala') {
  return printerById(printerId, branch_id)
    || rebuildImplicit(printerId, getAgentDevices(branch_id));
}

function printerTarget(p = {}) {
  if (p.connection === 'lan') return `${p.ip || ''}:${p.port || 9100}`;
  if (p.connection === 'system') return p.systemName || p.name || '';
  return 'browser';
}

// ── Máy in thuộc MÁY NÀO ────────────────────────────────────────────────────
// Máy in cắm THẲNG vào một máy POS (connection 'system') chỉ máy đó in được.
// Hardware Agent trên từng máy báo lên danh sách máy in Windows nó thấy
// (setAgentPrinters), nên ghép theo TÊN máy in là biết tuyến nào cắm ở máy nào.
// Máy in LAN nằm trên mạng, không thuộc riêng máy nào.
function printerKey(p = {}) {
  return String(p.systemName || p.name || '').trim().toLowerCase();
}

/** Tên máy in (chữ thường) mà MỘT máy đang báo là nó thấy. */
function deviceOwnPrinterNames(branch_id, deviceId) {
  const me = String(deviceId || '').trim();
  if (!me) return new Set();
  const device = getAgentDevices(branch_id).find(d => d.device_id === me);
  return new Set((device?.printers || []).map(p => String(p.name || '').trim().toLowerCase()));
}

/** Tuyến in này có cắm thẳng vào máy đang hỏi không? */
/**
 * Tuyến in này có thuộc về MÁY ĐANG HỎI không.
 *
 * ĐỊNH DANH MÁY IN LÀ CẶP (MÃ THIẾT BỊ, TÊN MÁY IN) — KHÔNG PHẢI TÊN.
 *
 * SỰ CỐ THẬT (04/08/2026, Vietfoods): cửa hàng có HAI máy in cùng tên Windows
 * "POS-80C" — một ở laptop DOF-09, một ở máy POS dưới quầy. Bản cũ ghép theo
 * TÊN nên cả hai tuyến đều "khớp" với cả hai máy, tuyến nào đứng trước trong
 * cấu hình thì thắng: bấm in bill ở DOF-09, giấy chui ra dưới quầy. In thử thì
 * đúng vì nó gọi thẳng theo id tuyến, không đi qua bước ghép này — đó là lý do
 * lỗi khó thấy.
 *
 * Tên máy in KHÔNG duy nhất: Windows cho đặt trùng, và mua hai máy cùng model
 * thì mặc định y hệt nhau. Mã thiết bị (x-device-id) mới là thứ duy nhất, và nó
 * đã có sẵn trong sổ đăng ký agent — chỉ tầng định tuyến là chưa dùng tới.
 *
 * Luật:
 *   1. Tuyến CÓ khai máy chủ trì  -> chỉ thuộc về ĐÚNG máy đó, không ai khác.
 *   2. Tuyến CHƯA khai            -> ghép theo tên như cũ, để cửa hàng một máy
 *                                    in không phải khai thêm gì.
 */
function isAttachedTo(printer, deviceId, ownNames) {
  if ((printer?.connection || 'browser') !== 'system') return false;
  const key = printerKey(printer);
  if (!key || !ownNames.has(key)) return false;

  const chu = String(printer.primaryDeviceId || '').trim();
  if (chu && chu !== KHOA_MAY_KHONG_DINH_DANH) {
    return chu === String(deviceId || '').trim();
  }
  return true;
}

/** Tuyến này đã bị GẮN CHẶT vào một máy khác chưa? Dùng để loại thẳng ra khỏi
 *  mọi bước rơi-về, kể cả khi tên máy in trùng nhau. */
function thuocMayKhac(printer, deviceId) {
  const chu = String(printer?.primaryDeviceId || '').trim();
  if (!chu || chu === KHOA_MAY_KHONG_DINH_DANH) return false;
  const me = String(deviceId || '').trim();
  return !!me && chu !== me;
}

/**
 * Tìm tuyến in THẬT cho một loại phiếu.
 *
 * VÌ SAO CẦN: trước đây mọi hook in đều ghi CỨNG id tuyến ('bill', 'kitchen',
 * 'bar', 'label', 'runner'). Cửa hàng tự tạo máy in với id khác (VD 'pos80c')
 * và xoá các tuyến mặc định → job trỏ tới id không còn tồn tại → pendingAgentJobs
 * coi là mồ côi và chuyển 'cancelled'. Triệu chứng thật: thanh toán xong, lịch sử
 * lệnh in hiện "Hóa đơn / Tạm tính — cancelled", máy in im lặng.
 *
 * Thứ tự ưu tiên:
 *   1. (chỉ khi preferDevice) tuyến cắm THẲNG vào máy đang thao tác — để máy POS 2
 *      in ra máy in của chính nó, không phải máy in của POS 1.
 *   2. (chỉ khi preferDevice) tuyến có máy chủ trì là chính máy này.
 *   3. Tuyến mang đúng id cũ (giữ tương thích cấu hình đang chạy).
 *   4. Bất kỳ tuyến nào cùng loại phiếu và đang bật.
 * Không có gì khớp → null (người gọi ghi log rõ ràng thay vì xếp job chết).
 */
export function resolvePrinterForOutput(output, branch_id = 'sala', {
  deviceId = '', legacyId = '', preferDevice = false, printers = null,
} = {}) {
  const rows = Array.isArray(printers) ? printers : printerRows(branch_id);
  const usable = rows.filter(p => p && p.active !== false);
  const sameOutput = usable.filter(p => p.output === output);

  // MÁY IN CẮM VÀO CHÍNH MÁY NÀY ĐƯỢC ƯU TIÊN TRƯỚC MỌI TUYẾN KHÁC.
  //
  // Trước đây máy in cắm sẵn chỉ được xét SAU CÙNG, khi không còn tuyến nào khác.
  // Hậu quả: cửa hàng khai một tuyến hóa đơn ở quầy, rồi nhân viên cầm máy POS
  // cầm tay đi thu tiền tại bàn — bill chạy ra máy in NGOÀI QUẦY thay vì in ngay
  // trên tay khách. Máy in gắn liền của máy cầm tay không bao giờ nằm trong
  // print_config (nó do agent báo lên), nên nó luôn thua.
  //
  // Thứ tự đúng: máy in của CHÍNH MÁY ĐANG THAO TÁC trước, rồi mới tới tuyến
  // chung. Ai muốn ép ra một máy in cụ thể thì khai primaryDeviceId cho tuyến đó.
  if (preferDevice && deviceId) {
    const ownNames = deviceOwnPrinterNames(branch_id, deviceId);

    // 1. Tuyến ĐÃ KHAI mà trỏ đúng máy in cắm vào máy này — tôn trọng cấu hình
    //    của cửa hàng trước, vì nó mang thêm thiết lập (két tiền, độ đậm...).
    const attached = sameOutput.find(p => isAttachedTo(p, deviceId, ownNames));
    if (attached) return attached;

    // 2. Máy in cắm vào máy này nhưng CHƯA AI KHAI TUYẾN. Đây là chỗ máy POS cầm
    //    tay rơi vào: đầu in gắn liền, agent có báo lên, nhưng không nằm trong
    //    print_config.
    const cuaMayNay = implicitDevicePrinter(branch_id, deviceId, output);
    if (cuaMayNay) return cuaMayNay;

    // 3. Tuyến khai đích danh cho máy này.
    const primary = sameOutput.find(p => String(p.primaryDeviceId || '').trim() === String(deviceId).trim());
    if (primary) return primary;
  }

  // Tuyến mang đúng id cũ — nhưng KHÔNG nhận nếu nó đã gắn chặt vào máy khác.
  // Đây từng là đường vòng làm bill của máy này chui ra máy kia: id 'bill' nằm
  // ở quầy, máy nào bấm cũng rơi vào đó.
  if (legacyId) {
    const legacy = usable.find(p => p.id === legacyId && p.connection !== 'browser'
      && !thuocMayKhac(p, deviceId));
    if (legacy) return legacy;
  }

  // Tuyến in được thật (lan/system) đứng trước tuyến 'browser' — tuyến browser
  // cần người bấm trong hộp thoại nên không bao giờ tự ra giấy.
  // KHÔNG VỚI SANG MÁY IN CẮM Ở MÁY KHÁC.
  //
  // Máy in LAN là hạ tầng dùng chung — máy nào in cũng được, giấy ra ở chỗ ai
  // cũng biết. Nhưng máy in cắm USB vào một máy POS khác (connection 'system')
  // thì thuộc về máy đó: đẩy bill sang đấy là tờ giấy chui ra ở quầy khác, thu
  // ngân đứng chờ mà không biết nó ở đâu.
  //
  // Nên: LAN trước, và chỉ nhận máy in 'system' khi nó KHÔNG thuộc về một máy
  // khác đang chạy. Không còn gì hợp lệ thì trả null để báo lỗi rõ ràng, hơn là
  // in bừa sang máy người khác.
  const lan = sameOutput.find(p => p.connection === 'lan');
  if (lan) return lan;

  const systemDungChung = sameOutput.find((p) => {
    if (p.connection !== 'system') return false;
    const chu = String(p.primaryDeviceId || '').trim();
    if (!chu || chu === KHOA_MAY_KHONG_DINH_DANH) return true; // không của riêng ai
    return !deviceId || chu === String(deviceId).trim();
  });
  if (systemDungChung) return systemDungChung;

  // CHƯA AI CẤU HÌNH TUYẾN NÀO → dùng thẳng máy in đang cắm vào máy này.
  //
  // Cấu hình tuyến là tính năng NÂNG CAO, dành cho cửa hàng có nhiều máy in
  // (bill/bếp/bar/tem) cần chia phiếu về đúng chỗ. Cửa hàng bình thường chỉ cắm
  // một máy in vào máy POS và mong nó in ngay. Bắt họ vào Cài đặt khai báo tuyến
  // trước khi in được cái bill đầu tiên là chặn nhầm chỗ — máy đã cắm máy in,
  // agent đã báo tên máy in đó lên, hệ thống thừa thông tin để tự in.
  // CHỈ máy in của CHÍNH máy đang thao tác. KHÔNG vơ máy in của máy khác.
  //
  // Bản trước ở đây rơi về `devices[0]` — máy in của một máy bất kỳ. Hậu quả:
  // thu ngân bấm thanh toán, hệ thống báo in xong, còn tờ bill chui ra ở máy in
  // của người khác trong cửa hàng. In nhầm chỗ tệ hơn không in: không ai biết
  // để đi tìm, và khách đứng chờ một tờ giấy không bao giờ tới.
  //
  // Không có máy in nào của máy này thì TRẢ VỀ NULL, để printReceipt ghi nhật ký
  // và báo lỗi rõ ràng.
  return implicitDevicePrinter(branch_id, deviceId, output);
}

/** Tiền tố của tuyến in ngầm — dùng chung để dựng và để nhận lại. */
const IMPLICIT_PREFIX = 'auto:';

/// Khoá giữ chỗ cho agent bản cũ không gửi định danh máy. PHẢI khớp với
/// system.js — đây không phải một máy thật và không được coi là chủ trì tuyến in.
const KHOA_MAY_KHONG_DINH_DANH = 'agent-khong-dinh-danh';

/**
 * Dựng lại tuyến ngầm từ chính id của nó (`auto:<device_id>:<tên máy in>`).
 * Chỉ chấp nhận khi máy in ĐÓ vẫn đang được máy ĐÓ báo lên — máy POS rút máy in
 * ra hoặc tắt app thì job phải rơi về mồ côi như thường, không in mò.
 */
function rebuildImplicit(printerId, devices = []) {
  const id = String(printerId || '');
  if (!id.startsWith(IMPLICIT_PREFIX)) return null;
  const rest = id.slice(IMPLICIT_PREFIX.length);
  const sep = rest.indexOf(':');
  if (sep < 0) return null;
  const deviceId = rest.slice(0, sep);
  const name = rest.slice(sep + 1);
  const device = devices.find(d => d.device_id === deviceId);
  const hit = (device?.printers || [])
    .find(p => String(p.name || '').trim() === name);
  if (!hit) return null;
  return {
    id, name, systemName: name, label: name,
    output: 'receipt', connection: 'system', active: true, auto: true,
    primaryDeviceId: deviceId, widthMm: Number(hit.widthMm) || null,
    implicit: true,
  };
}

/**
 * Tuyến in NGẦM dựng từ máy in vật lý mà agent của máy này đã báo lên.
 * Không ghi vào print_config — cửa hàng vẫn thấy danh sách tuyến trống, và
 * ngày họ khai tuyến thật thì tuyến đó thắng ngay (nhánh trên chạy trước).
 */
function implicitDevicePrinter(branch_id, deviceId, output) {
  const devices = getAgentDevices(branch_id);
  const me = String(deviceId || '').trim();
  // Chỉ máy in do ĐÚNG thiết bị đang thao tác báo lên mới được dùng. Không có
  // device id hoặc thiết bị đó không online thì trả null; tuyệt đối không lấy
  // máy đầu tiên của thiết bị khác vì bill sẽ chui ra sai quầy.
  const device = me ? devices.find(d => d.device_id === me) : null;
  const first = (device?.printers || [])[0];
  const name = String(first?.name || '').trim();
  if (!name) return null;
  const widthMm = Number(first?.widthMm) || null;
  return {
    id: `${IMPLICIT_PREFIX}${device.device_id}:${name}`,
    name,
    systemName: name,
    label: name,
    output,
    connection: 'system',
    active: true,
    auto: true,
    primaryDeviceId: device.device_id,
    // Bề ngang do CHÍNH MÁY khai (Sunmi V2 = 58mm). Null thì theo chi nhánh.
    widthMm,
    // Đánh dấu để màn Máy in hiện "Tự nhận" thay vì giả vờ đây là tuyến đã khai.
    implicit: true,
  };
}

/** Tuyến in hóa đơn cho máy đang thanh toán. */
export function resolveReceiptPrinter(branch_id = 'sala', { deviceId = '' } = {}) {
  return resolvePrinterForOutput('receipt', branch_id, {
    deviceId, legacyId: 'bill', preferDevice: true,
  });
}

/**
 * CHUỖI ƯU TIÊN cho một loại phiếu — không chỉ MỘT tuyến mà là DANH SÁCH XẾP HẠNG.
 *
 * Vì sao cần: resolvePrinterForOutput chỉ trả về tuyến TỐT NHẤT. Tuyến đó hỏng
 * (hết giấy, rút dây, máy tắt) thì job nằm 'failed' rồi agent thử đi thử lại
 * đúng cái máy in đang hỏng đó — vĩnh viễn. Cửa hàng có 2-3 máy in nhưng bill
 * vẫn không ra.
 *
 * Thứ tự đúng theo yêu cầu vận hành:
 *   1. Máy in cắm THẲNG vào máy đang thao tác (kể cả tuyến ngầm chưa ai khai).
 *   2. Các tuyến đã khai, xếp theo `priority` tăng dần (số nhỏ = ưu tiên cao),
 *      priority bằng nhau thì theo thứ tự trong danh sách Kết nối.
 * Tuyến 'browser' không bao giờ vào chuỗi — nó cần người bấm hộp thoại nên
 * không tự ra giấy được.
 */
export function resolvePrinterChain(output, branch_id = 'sala', { deviceId = '' } = {}) {
  const rows = printerRows(branch_id)
    .filter(p => p && p.active !== false && p.output === output
      && (p.connection === 'lan' || p.connection === 'system'));
  const ownNames = deviceOwnPrinterNames(branch_id, deviceId);

  const xepHang = (p) => {
    if (isAttachedTo(p, deviceId, ownNames)) return 0;             // máy in của chính máy này
    if (String(p.primaryDeviceId || '').trim() === String(deviceId || '').trim()
      && deviceId) return 1;                                       // khai đích danh cho máy này
    if (p.connection === 'lan') return 2;                          // hạ tầng dùng chung
    const chu = String(p.primaryDeviceId || '').trim();
    if (!chu || chu === KHOA_MAY_KHONG_DINH_DANH) return 3;        // system không của riêng ai
    // MÁY IN CỦA MÁY KHÁC vẫn nằm trong chuỗi, nhưng XẾP CUỐI.
    //
    // Đây là bậc chỉ dùng khi mọi máy in của chính máy này đã hỏng: thà giấy ra
    // ở quầy bên cạnh còn hơn khách đứng chờ một tờ bill không bao giờ tới. Nó
    // KHÔNG BAO GIỜ được chọn ở lượt đầu — bậc 0..3 luôn thắng — nên bình
    // thường bill vẫn ra đúng máy in cắm tại chỗ.
    return 8;
  };

  const chain = rows
    .map((p, i) => ({ p, bac: xepHang(p), uu: Number(p.priority) || 0, i }))
    .filter(x => x.bac < 9)
    .sort((a, b) => a.bac - b.bac || a.uu - b.uu || a.i - b.i)
    .map(x => x.p);

  // Tuyến ngầm (máy in gắn liền chưa ai khai) đứng đầu nếu chưa có tuyến nào
  // trỏ đúng máy in đó — máy POS cầm tay rơi vào đây.
  const ngam = implicitDevicePrinter(branch_id, deviceId, output);
  if (ngam && !chain.some(p => printerKey(p) === printerKey(ngam))) chain.unshift(ngam);

  return chain;
}

/** Tuyến KẾ TIẾP trong chuỗi sau khi [printerId] in hỏng. Hết chuỗi → null. */
function nextPrinterInChain(job, branch_id, deviceId = '') {
  const chain = resolvePrinterChain(outputOfJobType(job.type), branch_id, { deviceId });
  const idx = chain.findIndex(p => p.id === job.printer);
  if (idx < 0) return chain[0] || null;
  return chain[idx + 1] || null;
}

/** Loại phiếu (job.type) → loại đầu ra của tuyến in (printer.output). */
function outputOfJobType(type) {
  if (type === 'receipt' || type === 'test' || type === 'cash_drawer') return 'receipt';
  if (type === 'cup_label') return 'cup_label';
  if (type === 'product_label') return 'product_label';
  if (type === 'runner') return 'runner';
  return 'kitchen_ticket';
}

function money(n) {
  return `${Math.round(Number(n) || 0).toLocaleString('vi-VN')}đ`;
}

function ascii(s) {
  return String(s ?? '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .replace(/[^\x09\x0a\x0d\x20-\x7e]/g, '');
}

function center(text, width = 40) {
  const raw = String(text ?? '').trim();
  // Bề rộng THẬT bỏ đánh dấu [[..]] (không chiếm cột in). Trước đây tính cả
  // marker nên phiếu bếp cỡ to (cột ít) bị center() CẮT CỤT cả [[B1]]…[[B0]] →
  // header vỡ. Chuỗi không có marker giữ hành vi cũ (cắt theo width).
  const vis = stripMarks(raw);
  if (vis.length >= width) return raw === vis ? vis.slice(0, width) : raw;
  const pad = Math.max(0, Math.floor((width - vis.length) / 2));
  return ' '.repeat(pad) + raw;
}

function line(ch = '-', width = 40) {
  return ch.repeat(width);
}
// Căn giữa dòng CHỮ CỠ ĐÔI ([[S2]]): trên máy in mỗi ký tự rộng gấp 2 nên phải
// bù khoảng trắng theo bề rộng THẬT (2×số ký tự nhìn thấy, đã bỏ marker).
function centerBig(text, width = 40) {
  const vis = String(text ?? '').replace(MARK_RE, '');
  const pad = Math.max(0, Math.floor((width - vis.length * 2) / 2));
  return ' '.repeat(pad) + text;
}

function wrap(text, width = 40) {
  const words = String(text ?? '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const rows = [];
  let cur = '';
  for (const w of words) {
    if (!cur) cur = w;
    else if ((cur + ' ' + w).length <= width) cur += ' ' + w;
    else { rows.push(cur); cur = w; }
  }
  if (cur) rows.push(cur);
  return rows.length ? rows : [''];
}

function itemMods(i = {}) {
  // Yêu cầu thêm (Ít đá, Size…) có thể là mảng CHUỖI hoặc mảng OBJECT {group,name}.
  // Luôn quy về CHUỖI TÊN để không in ra "[object Object]".
  const toName = (m) => (m && typeof m === 'object') ? String(m.name || m.group || '') : String(m ?? '');
  if (Array.isArray(i.mods)) return i.mods.map(toName).filter(Boolean);
  try { return JSON.parse(i.mods_json || '[]').map(toName).filter(Boolean); } catch { return []; }
}

function promoText(promo, { thermal = false } = {}) {
  if (!promo || typeof promo !== 'object' || !Object.keys(promo).length) return '';
  const name = promo.name || promo.code || 'Khuyen mai';
  const amount = Math.max(0, Math.round(Number(promo.amount) || 0));
  const freeUnits = Math.max(0, Math.round(Number(promo.free_units) || 0));
  const parts = [];
  if (amount > 0) parts.push(`giảm ${money(amount)}`);
  if (freeUnits > 0) {
    const product = promo.free_product_name || 'sản phẩm';
    parts.push(`tặng ${freeUnits} ${product}`);
  }
  if (!parts.length && promo.description) return String(promo.description);
  return parts.length ? `${name}: ${parts.join(', ')}` : name;
}

function linePromoTotal(items = []) {
  return items.reduce((sum, item) => sum + Math.max(0, Math.round(Number(item?.promo?.amount) || 0)), 0);
}

function orderWideDiscount(p = {}) {
  const discount = Math.max(0, Math.round(Number(p.discount) || 0));
  return Math.max(0, discount - linePromoTotal(Array.isArray(p.items) ? p.items : []));
}

// Tem bếp dạng bill (khổ K80, 42 ký tự). Bố cục: Khu vực / Bàn / Giờ + Ngày /
// Nhân viên / Số thứ tự (= 3 số cuối Số Bill) / Tên món. Khi tách từng món thì
// payload chứa 1 món (p.name); chế độ gộp cũ vẫn render được qua p.items[].
// PHIẾU BẾP theo mẫu dễ đọc kiểu IPOS (yêu cầu chủ cửa hàng): khu vực + bàn CHỮ
// TO ĐẬM (đọc từ xa trong bếp), khối Giờ/Ngày/Nhân viên/Số TT, rồi BẢNG CÓ VIỀN
// "Tên món | SL". Mỗi món: tên (đậm) + số lượng ở cột SL; YÊU CẦU THÊM (Ít đá,
// Size…) in ngay DƯỚI món, GHI CHÚ in DƯỚI yêu cầu thêm.
// Lưu ý DẤU TIẾNG VIỆT: giữ nguyên có dấu ở đây; muốn bill in RA có dấu thì máy
// in bếp phải để "Bảng mã" = CP1258 hoặc UTF-8 (không để "Không dấu").
// BẢNG MÓN của phiếu bếp: viền + tiêu đề (Tên món | SL) + từng món kèm yêu cầu
// thêm/ghi chú. TÁCH RIÊNG để dùng chung cho: (1) renderTicket bản dựng sẵn khi
// KHÔNG có mẫu thiết kế, và (2) phần tử 'items' của mẫu Phiếu bếp do cửa hàng tự
// thiết kế (xem renderEl + templates.kitchen_ticket). Trả về MẢNG dòng đã căn cột
// và đã chèn đánh dấu in đậm — phần tử 'items' đẩy thẳng mảng này ra, KHÔNG cho đi
// qua đường bẻ dòng của renderEl (beRong đếm cả marker [[..]] nên sẽ bẻ vỡ bảng).
// SỐ THỨ TỰ phiếu bếp trong NGÀY: tách phần seq sau tiền tố Dan{ddMMyy} của
// pay_ref (cấp lúc MỞ đơn — luôn có sẵn lúc in bếp) hoặc bill_no. RESET mỗi ngày,
// bắt đầu 01, chỉ số tự nhiên (padStart 2: 1->"01", 12->"12", 123->"123").
function kitchenDailySeq(order = {}) {
  const ref = String(order.pay_ref || order.bill_no || '');
  const m = /^Dan\d{6}(\d+)$/.exec(ref);
  if (m) {
    const n = parseInt(m[1], 10);
    if (n > 0) return String(n).padStart(2, '0');
  }
  // Đơn online không theo định dạng Dan... → hiện mã ngắn cho dễ đối chiếu.
  const alt = String(order.online_ref || '').trim();
  return alt ? alt.slice(-4).toUpperCase() : '';
}

function kitchenTableLines(p = {}, W = 40, opt = {}) {
  const showQty = opt.showQty !== false && opt.showQty !== '0';
  const showMods = opt.showMods !== false && opt.showMods !== '0';
  const showNote = opt.showNote !== false && opt.showNote !== '0';
  const SL_W = 3;
  // Viền chiếm 3 dấu '|' khi có cột SL (| tên | sl |), 2 dấu khi không (| tên |).
  const NAME_W = showQty ? Math.max(8, W - SL_W - 3) : Math.max(8, W - 2);
  const border = showQty
    ? `+${'-'.repeat(NAME_W)}+${'-'.repeat(SL_W)}+`
    : `+${'-'.repeat(NAME_W)}+`;
  // Ô bảng: bù khoảng trắng theo bề rộng THẬT (marker [[..]] không tính). CỠ CHỮ
  // TO do renderTicket bọc [[S3]] quanh CẢ PHIẾU (2x rộng+cao) — ở đây chỉ lo IN
  // ĐẬM. (Đường template tự quản cỡ chữ riêng nên bảng món giữ nguyên khi qua đó.)
  const cell = (name, sl, { bold = false } = {}) => {
    const nmVis = String(name);
    const nm = bold ? `[[B1]]${nmVis}[[B0]]` : nmVis;
    const nmPad = ' '.repeat(Math.max(0, NAME_W - nmVis.length));
    if (!showQty) return `|${nm}${nmPad}|`;
    const slVis = String(sl ?? '');
    const slStr = (bold && slVis) ? `[[B1]]${slVis}[[B0]]` : slVis;
    const slPad = ' '.repeat(Math.max(0, SL_W - slVis.length));
    return `|${nm}${nmPad}|${slPad}${slStr}|`;
  };

  const rows = [border, cell('Tên món', showQty ? 'SL' : '', { bold: true }), border];
  const items = (Array.isArray(p.items) && p.items.length) ? p.items : [{ ...p }];
  for (const i of items) {
    const cancelled = i.cancelled === true
      || String(i.status || '').toLowerCase() === 'cancelled'
      || p.update_kind === 'cancel_item';
    const strike = (value) => cancelled
      ? [...String(value || '')].map(ch => ch === ' ' ? ch : `${ch}\u0336`).join('')
      : String(value || '');
    const nameLines = wrap(strike(i.name || ''), NAME_W - 1);
    (nameLines.length ? nameLines : ['']).forEach((ln, idx) => {
      rows.push(cell(` ${ln}`, idx === 0 ? strike(i.qty || 1) : '', { bold: idx === 0 }));
    });
    // YÊU CẦU THÊM (mods) ngay dưới món.
    if (showMods) {
      const mods = itemMods(i);
      if (mods.length) {
        for (const ln of wrap(`+ ${mods.join(', ')}`, NAME_W - 3)) rows.push(cell(`   ${ln}`, ''));
      }
    }
    // GHI CHÚ dưới yêu cầu thêm.
    if (showNote && i.note) {
      for (const ln of wrap(`Ghi chú: ${i.note}`, NAME_W - 3)) rows.push(cell(`   ${ln}`, ''));
    }
    rows.push(border);
  }
  return rows;
}

// W = số ký tự LÔ-GIC (khoảng NỬA số ký tự thật của giấy). Vì cả phiếu được bọc
// [[S3]] (mỗi ký tự in RỘNG GẤP ĐÔI + CAO GẤP ĐÔI) nên W nửa giấy → in ra vừa khít
// mép giấy mà TẤT CẢ chữ to gấp đôi cả 2 chiều. Cột bảng vẫn thẳng vì phóng đều.
function renderTicket(p = {}, W = 20) {
  const zone = (p.zone || p.station || 'KHU VỰC').toUpperCase();
  const rows = ['', center(`[[B1]]${zone}[[B0]]`, W)];
  // Chữ BÀN: in đậm (ESC E + double-strike) + cỡ to gấp đôi như cả phiếu.
  if (p.table) rows.push(center(`[[B1]]BÀN ${String(p.table).toUpperCase()}[[B0]]`, W));
  rows.push('');
  rows.push(`[[B1]]Giờ:[[B0]] ${p.time || ''}`.trimEnd());
  rows.push(`[[B1]]Ngày:[[B0]] ${p.date || ''}`.trimEnd());
  if (p.staff) rows.push(`[[B1]]NV:[[B0]] ${p.staff}`);
  rows.push(`[[B1]]Số TT:[[B0]] ${p.seq || ''}`);
  if (p.copy) rows.push(`(${p.copy})`);
  rows.push(...kitchenTableLines(p, W));
  // BỌC [[S3]] QUANH CẢ PHIẾU → mọi chữ (kể cả khoảng trắng căn cột) to 2× cả 2
  // chiều. W = 1/2 khổ giấy nên 2× vừa mép. (2× là cỡ lớn nhất mà bảng món có
  // viền + tên/mods/NV dài còn KHÔNG tràn mép K80; muốn to hơn phải bỏ bảng viền.)
  return `[[S3]]${rows.join('\n')}[[S0]]`;
}

// Biến cho mẫu Phiếu bếp do cửa hàng tự thiết kế. __payload giữ nguyên payload để
// phần tử 'items' dựng bảng món; các khoá còn lại là chữ thay {zone}/{table}/...
function kitchenVars(p = {}) {
  return {
    zone: String(p.zone || p.station || '').toUpperCase(),
    table: p.table ? String(p.table).toUpperCase() : '',
    station: String(p.station || '').toUpperCase(),
    time: p.time || '',
    date: p.date || '',
    staff: p.staff || '',
    seq: p.seq != null ? String(p.seq) : '',
    copy: p.copy || '',
    orderNo: String(p.order_no || p.orderNo || p.seq || ''),
    __payload: p,
  };
}

// Mẫu Phiếu bếp CHỈ dùng được khi có phần tử 'items' — phiếu bếp mà không in ra
// món là tai hoạ trong bếp. Mẫu cũ (bản clone của tem, không có 'items') hoặc mẫu
// rỗng đều rơi về renderTicket bản dựng sẵn để món LUÔN được in.
function kitchenTemplateUsable(tpl) {
  if (!tpl || !Array.isArray(tpl.rows) || !tpl.rows.length) return false;
  return tpl.rows.some(r => String(r?.type) === 'items');
}

function renderRunner(p = {}) {
  return [
    center('CHẠY MÓN - BÀN'),
    center(p.table || '-', 20),
    line(),
    ...wrap(p.name || '', 40),
    p.seq ? center(`phần ${p.seq}`) : '',
    ...(Array.isArray(p.mods) && p.mods.length ? wrap(`+ ${p.mods.join(', ')}`) : []),
    ...(p.note ? wrap(`GHI CHÚ: ${p.note}`) : []),
    line(),
    `#${p.order_no || ''} ${p.station || ''} ${p.time || ''}`.trim(),
  ].filter(Boolean).join('\n');
}

function renderLabel(p = {}, cfg = null, printer = null, kind = '') {
  // Cấu hình chi nhánh là NGUỒN CHÍNH; payload chỉ dùng khi job cũ có nhúng sẵn.
  const conf = cfg || p.print_config || {};
  // MẪU THEO ĐÚNG LOẠI TEM. Bản cũ luôn đọc `templates.label`, nên tem sản phẩm
  // thiết kế riêng (`templates.product_label`) không bao giờ được dùng — mọi
  // tem in ra đều là bản dự phòng, mất hết cỡ chữ và in đậm đã đặt.
  const kho = conf.templates || {};
  const tpl = (kind && kho[kind]) || kho.label || p.print_config?.templates?.[kind]
    || p.print_config?.templates?.label;
  const W = Number(printer?.widthMm)
    ? labelWidthCharsFrom({ widthMm: Number(printer.widthMm) })
    : labelWidthCharsFrom(conf.labels || conf.label || {});

  // Tem BẬT đánh dấu kiểu chữ: mẫu tem do cửa hàng thiết kế có in đậm và cỡ chữ
  // riêng cho tên hàng/giá, và tem không căn cột theo ký tự nên chèn đánh dấu
  // vào không phá bố cục (khác bill — xem chú thích ở renderEl).
  if (tpl?.rows?.length) return renderTemplateRows(tpl, labelVars(p), { title: 'TEM NHÃN', widthChars: W, styled: true });
  if (tpl?.elements?.length) return renderTemplateText(tpl, labelVars(p), { title: 'TEM NHÃN', widthChars: W, styled: true });

  // CHƯA THIẾT KẾ MẪU TEM → vẫn phải theo KÍCH THƯỚC TEM đã cài, không cắm cứng
  // 40 ký tự. Tem 35mm mà dựng 40 ký tự thì chữ tràn ra ngoài mép tem.
  return [
    center('TEM', W),
    line('-', W),
    ...wrap(p.itemName || p.name || '', W),
    ...(p.options ? wrap(`+ ${p.options}`, W) : []),
    ...(p.note ? wrap(`GHI CHÚ: ${p.note}`, W) : []),
    line('-', W),
    ...wrap(`${p.order_no || ''} ${p.table || ''} ${p.time || ''}`.trim(), W),
  ].filter(Boolean).join('\n');
}

// Số ký tự/dòng của TEM. Tem hẹp hơn bill nhiều nên có thang riêng: tem dán ly
// hay dùng 35–50mm, tem sản phẩm 50–80mm. Font A 12 dot => 8 dot/mm / 12 ≈
// 0.66 ký tự mỗi mm, trừ hao mép dán.
function labelWidthCharsFrom(labels = {}) {
  const mm = Number(labels.widthMm) || 50;
  if (mm <= 30) return 16;
  if (mm <= 40) return 24;
  if (mm <= 60) return 32;
  return 40;
}

function methodLabel(m) {
  return { cash: 'Tiền mặt', card: 'Máy POS', qrcode: 'QR', qr: 'QR', voucher: 'Voucher', internet_banking: 'Internet Banking', momo: 'MoMo', zalopay: 'ZaloPay', visa: 'Visa' }[m] || m || '-';
}

function replaceVars(text = '', vars = {}) {
  return String(text || '').replace(/\{([a-zA-Z0-9_]+)\}/g, (_, key) => vars[key] ?? '');
}

function isReprintPayload(p = {}, job = {}) {
  return p.reprint === true || !!p.reprint_of || !!job.reprint_of;
}

function reprintMarkFor() {
  return ' (in lại)';
}

export function markReceiptReprint(text = '') {
  const rows = String(text || '').split('\n');
  let marked = false;
  for (let i = 0; i < rows.length; i++) {
    const raw = rows[i];
    const key = ascii(raw).toUpperCase();
    if (key.includes('IN LAI')) {
      marked = true;
      break;
    }
    if (!marked && key.includes('HOA DON') && !key.includes('SO HOA DON') && !key.includes('MA HD') && !key.includes('CONG TY') && !key.includes('CÔNG TY')) {
      const label = (raw.includes('HÓA ĐƠN') || raw.includes('Thanh toán')) ? ' (IN LẠI)' : ' (IN LAI)';
      rows[i] = raw + label;
      marked = true;
      break;
    }
  }
  if (!marked) {
    const dashIdx = rows.findIndex(r => r.includes('---') || r.includes('==='));
    const insertAt = dashIdx >= 0 ? dashIdx + 1 : 1;
    rows.splice(insertAt, 0, center('HÓA ĐƠN THANH TOÁN (IN LẠI)', 40));
  }
  return rows.join('\n');
}

function templateWidthChars(tpl = {}) {
  const widthMm = Number(tpl.widthMm) || 72;
  if (widthMm <= 40) return 24;
  if (widthMm <= 58) return 32;
  return 40;
}

// Số ký tự/dòng THẬT của khổ giấy, theo font A của máy in nhiệt (12 dot/ký tự):
// giấy 58mm in được 48mm → 32 ký tự; giấy 80mm in được 72mm → 48 ký tự.
// Dùng cho phiếu do server tự dựng (in thử, phiếu kho...) để chữ trải đúng bề
// ngang tờ giấy. KHÔNG dùng cho mẫu bill — mẫu đó người dùng tự thiết kế theo
// templateWidthChars/DAN_W, đổi bề ngang sẽ phá bố cục họ đã căn.
// MÃ GIẤY đứng trước số mm, vì hai chỗ ghi `widthMm` theo hai nghĩa khác nhau:
// bộ thiết kế mẫu lưu BỀ NGANG TỜ GIẤY (K80 -> 80, K57 -> 57) còn cấu hình cũ
// lưu BỀ NGANG IN ĐƯỢC (72 / 48). Đọc mã giấy thì không phải đoán.
//
// Trước đây chỉ so mm với ngưỡng 50: chọn K57 -> widthMm 57 -> 57 > 50 -> vẫn
// dựng 48 ký tự rồi tràn giấy. Và mã giấy đem so với 'K58' trong khi bộ thiết kế
// ghi 'K57' nên không bao giờ khớp.
const PAPER_CHARS = { K57: 32, K58: 32, K80: 48 };

function paperWidthCharsFrom(bill = {}) {
  const code = String(bill.paper || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (PAPER_CHARS[code]) return PAPER_CHARS[code];

  const mm = Number(bill.widthMm) || 72;
  if (mm <= 35) return 24;
  // Ngưỡng 60 phủ CẢ HAI cách ghi của khổ nhỏ: 48mm (in được) và 57/58mm (tờ giấy).
  if (mm <= 60) return 32;
  return 48;
}

// Render ONE template element/row into monospace lines pushed onto `out`.
// Shared by renderTemplateText (positioned elements) and renderTemplateRows
// (KiotViet-style ordered rows) so both stay pixel-identical to the printout.
// Cỡ chữ trong bộ thiết kế mẫu ghi theo mm chiều cao (3.5 / 4.5 / 6...). Quy về
// 4 bậc phóng to của máy in nhiệt.
function markScaleOf(fontSize) {
  const mm = Number(fontSize) || 0;
  if (mm >= 7) return 3;
  if (mm >= 5.5) return 2;
  if (mm >= 4.2) return 1;
  return 0;
}

/**
 * [styled] = có chèn đánh dấu kiểu chữ ([[B1]]/[[S2]]) theo `bold`/`fontSize`
 * của phần tử hay không.
 *
 * CHỈ BẬT CHO TEM/PHIẾU, KHÔNG BẬT CHO BILL. Đánh dấu là ký tự nằm trong chuỗi;
 * mẫu bill được căn cột bằng cách đếm ký tự (giá tiền phải kết thúc đúng cột
 * 32/48) nên chèn thêm ký tự vào đó là vỡ toàn bộ bố cục. Bill phóng to chữ
 * bằng lệnh GS ! áp cho CẢ PHIẾU (bill.fontScale) — số cột giữ nguyên.
 */
function renderEl(el = {}, vars = {}, W = 40, out = [], { styled = false } = {}) {
  if (el.hidden) return out;
  const type = String(el.type || 'text');
  if (type === 'line') {
    out.push(line('-', W));
    return out;
  }
  if (type === 'image') {
    out.push(center(`[${el.label || 'IMAGE'}]`, W));
    return out;
  }
  if (type === 'qr') {
    const value = replaceVars(el.qrText || el.text || '{billNo}', vars);
    // Mã QR THẬT (quét được), không phải chữ "[QR ...]".
    if (String(value).trim()) out.push(`[[QR:${String(value).trim()}]]`);
    if (el.qrShowCaption !== false && el.qrCaption) out.push(center(replaceVars(el.qrCaption, vars), W));
    return out;
  }
  if (type === 'barcode') {
    const value = replaceVars(el.barcodeText || el.text || '{billNo}', vars);
    // Mã vạch 1D THẬT (quét được) + số người đọc in dưới vạch, không phải chữ.
    if (String(value).trim()) out.push(`[[BC:${String(value).trim()}]]`);
    return out;
  }
  if (type === 'items') {
    // BẢNG MÓN phiếu bếp: đẩy THẲNG từng dòng đã căn cột, KHÔNG qua đường bẻ dòng
    // bên dưới (các dòng có marker [[B1]], beRong đếm cả marker sẽ tưởng quá khổ
    // rồi bẻ vỡ bảng). vars.__payload do kitchenVars gắn; thiếu thì bỏ qua êm.
    const p = vars.__payload;
    if (p) for (const ln of kitchenTableLines(p, W, el)) out.push(ln);
    return out;
  }
  const text = replaceVars(el.text || '', vars);
  const align = el.align || 'left';
  const scale = styled ? markScaleOf(el.fontSize) : 0;
  const dam = styled && !!el.bold;
  // Cỡ chữ to thì mỗi ký tự chiếm nhiều chỗ hơn — bề ngang phải chia lại, nếu
  // không dòng chữ 2x sẽ dài gấp đôi mép tem.
  const Wt = scale >= 3 ? Math.max(8, Math.floor(W / 2)) : W;
  for (const paragraph of String(text).split('\n')) {
    // GIỮ NGUYÊN KHOẢNG TRẮNG CĂN CỘT. wrap() gom mọi chuỗi khoảng trắng về một
    // dấu cách — các dòng đã được căn sẵn theo cột (dòng số lượng/đơn giá/thành
    // tiền, dòng "NHÃN ....... GIÁ TRỊ") bị bóp thành "1 10.000đ 10.000đ", cột
    // tiền không còn thẳng hàng. Đó là chỗ bill in ra trông nham nhở.
    // Chỉ những dòng THẬT SỰ dài quá khổ giấy mới cần bẻ.
    // Đo bề ngang KHÔNG TÍNH dấu gạch ngang tổ hợp (U+0336 của đơn giá trước
    // khuyến mãi): nó chồng lên ký tự trước, không chiếm thêm chỗ trên giấy.
    const dong = beRong(paragraph) <= Wt ? [paragraph] : wrap(paragraph, Wt);
    for (const row of dong) {
      const canh = align === 'center' ? center(row, Wt)
        : align === 'right' ? rightPad(row, Wt)
        : row;
      // GIỮ NGUYÊN DẤU — bản cũ gọi ascii() ở nhánh căn trái nên phần thân bill
      // mất dấu trong khi tiêu đề (căn giữa) vẫn còn.
      const mo = `${dam ? '[[B1]]' : ''}${scale ? `[[S${scale}]]` : ''}`;
      const dong = `${scale ? '[[S0]]' : ''}${dam ? '[[B0]]' : ''}`;
      out.push(mo || dong ? `${mo}${canh}${dong}` : canh);
    }
  }
  return out;
}

/** Dựng một danh sách phần tử; bỏ phần tử KHÔNG có nội dung, nhưng GIỮ dòng
 *  trống nằm bên trong một phần tử có nội dung (khối "Ghi chú:" chừa chỗ viết
 *  tay dựa vào đúng mấy dòng trống này). */
function renderEls(elements, vars, W, styled) {
  const rows = [];
  for (const el of elements) {
    const cua = renderEl(el, vars, W, [], { styled });
    // Giữ dòng có nội dung NHÌN THẤY, HOẶC có marker mã vạch/QR (stripMarks bỏ
    // marker này thành rỗng nên không được coi là "dòng trống" mà bỏ mất mã).
    if (cua.some(r => stripMarks(String(r)).trim() !== '' || /\[\[(BC|QR):/.test(String(r)))) {
      rows.push(...cua);
    }
  }
  return rows;
}

// Legacy positioned template: sort elements by y then x before rendering.
function renderTemplateText(tpl = {}, vars = {}, { title = 'PRINT', widthChars = 0, styled = false } = {}) {
  // [widthChars] ép bề ngang theo MÁY IN THẬT sẽ in phiếu này. Mẫu bill do cửa
  // hàng thiết kế mang sẵn widthMm của nó (thường 80mm); in mẫu đó ra máy cầm
  // tay 58mm mà không ép lại thì chữ tràn khỏi mép giấy.
  const W = widthChars || templateWidthChars(tpl);
  const elements = [...(Array.isArray(tpl.elements) ? tpl.elements : [])]
    .sort((a, b) => (Number(a.y) || 0) - (Number(b.y) || 0) || (Number(a.x) || 0) - (Number(b.x) || 0));
  const body = renderEls(elements, vars, W, styled).join('\n');
  return body || center(title, W);
}

// New KiotViet-style template: render `rows` in list order (no positioning).
function renderTemplateRows(tpl = {}, vars = {}, { title = 'PRINT', widthChars = 0, styled = false } = {}) {
  // Xem chú thích ở renderTemplateText.
  const W = widthChars || templateWidthChars(tpl);
  const body = renderEls(Array.isArray(tpl.rows) ? tpl.rows : [], vars, W, styled).join('\n');
  return body || center(title, W);
}

// ── THÂN BILL: BA CỘT SL / HÀNG HÓA / THÀNH TIỀN ───────────────────────────
// Bố cục cũ dựng dòng số liệu bằng cách chèn sẵn 23 dấu cách rồi padStart từng
// cột — tổng ra 51 ký tự trên khổ K80 (48 ký tự). Dòng dài quá khổ nên bị bẻ
// dòng và mọi khoảng trắng căn cột bị gom lại thành một dấu cách: bill in ra
// thành "2 50.000đ 100.000đ", cột tiền không thẳng hàng ở bất kỳ dòng nào.
//
// Bố cục mới tính cột theo ĐÚNG bề ngang giấy nên K80 và K57 cùng một nội dung,
// chỉ khác khoảng cách cột.

/** Số tiền trong cột: nhóm nghìn bằng dấu phẩy, KHÔNG kèm "đ" (cột đã đủ hẹp). */
function so(n) {
  return Math.round(Number(n) || 0).toLocaleString('en-US');
}

/** Gạch ngang giữa chữ (U+0336) — dùng cho đơn giá TRƯỚC khuyến mãi. Thêm SAU
 *  khi đã căn cột để không làm lệch bề rộng. */
function gachNgang(s) {
  return String(s).split('').map(c => (c === ' ' ? c : `${c}̶`)).join('');
}

/** Bề ngang THẬT trên giấy: dấu gạch ngang tổ hợp chồng lên ký tự trước nên
 *  không chiếm thêm cột. */
function beRong(s) {
  return String(s ?? '').replace(/̶/g, '').length;
}

const QTY_W = 3;

function fitVisible(value, width, align = 'left') {
  const text = String(value ?? '');
  const missing = Math.max(0, width - beRong(text));
  return align === 'right' ? ' '.repeat(missing) + text : text + ' '.repeat(missing);
}

/** Dòng chuẩn: đơn giá sát trái, SL ở vùng giữa-trái, thành tiền sát phải. */
function dongGiaSlThanhTien(price, qty, amount, W) {
  const priceW = Math.floor(W * .42);
  const qtyW = Math.max(3, Math.floor(W * .18));
  const amountW = W - priceW - qtyW;
  return fitVisible(price, priceW)
    + fitVisible(qty, qtyW, 'right')
    + fitVisible(amount, amountW, 'right');
}

/** Dòng CTKM: giá trước + giá sau cùng ở vùng trái, rồi SL, thành tiền ngoài phải. */
function dongGiaKmSlThanhTien(before, after, qty, amount, W) {
  const beforeW = Math.floor(W * .24);
  const afterW = Math.floor(W * .22);
  const qtyW = Math.max(3, Math.floor(W * .14));
  const amountW = W - beforeW - afterW - qtyW;
  return fitVisible(gachNgang(before), beforeW)
    + fitVisible(after, afterW)
    + fitVisible(qty, qtyW, 'right')
    + fitVisible(amount, amountW, 'right');
}

/** Một dòng số liệu: [SL] rồi các cột tiền chia đều phần còn lại của bề ngang. */
function dongSoLieu(qty, cotTien, W, gachCot = -1) {
  const con = W - QTY_W;
  const rong = Math.floor(con / cotTien.length);
  const o = cotTien.map((v, i) => {
    const w = i === cotTien.length - 1 ? con - rong * (cotTien.length - 1) : rong;
    const canh = String(v).padStart(w);
    return i === gachCot ? gachNgang(canh) : canh;
  });
  return String(qty).padEnd(QTY_W) + o.join('');
}

/** Đơn giá CHƯA VAT. Giá nhập tay ở cửa hàng là giá đã gồm VAT nên phải bóc ra,
 *  đúng cách hóa đơn bán lẻ trình bày. Món không khai thuế suất thì giữ nguyên. */
function giaChuaVat(gia, vatRate) {
  const r = Number(vatRate) || 0;
  return r > 0 ? Math.round(Number(gia || 0) / (1 + r / 100)) : Math.round(Number(gia || 0));
}

/** Nhãn hàng hóa: "Tên (đvt)" hoặc "Tên (01)" khi một món tách thành nhiều dòng. */
function tenHang(i, thuTu = 0) {
  const ten = i.name || '';
  if (thuTu) return `${ten} (${String(thuTu).padStart(2, '0')})`;
  return i.unit ? `${ten} (${i.unit})` : ten;
}

/**
 * MUA X TẶNG Y TÁCH THÀNH HAI DÒNG. Gộp 6 sản phẩm vào một dòng rồi ghi giảm
 * 20.000đ thì khách không đối chiếu được: nhìn dòng đó tưởng mua 6 giá đó. Tách
 * ra "(01) 5 sản phẩm tính tiền" và "(02) 1 sản phẩm được tặng" mới khớp với
 * cách khuyến mãi thực sự chạy.
 */
function tachHang(i) {
  const qty = Number(i.qty) || 1;
  const promo = i.promo || {};
  const tang = Math.max(0, Math.round(Number(promo.free_units) || 0));
  if (!tang || tang >= qty) return [{ i, qty, promo, thuTu: 0 }];
  return [
    { i, qty: qty - tang, promo: { ...promo, amount: 0 }, thuTu: 1 },
    { i, qty: tang, promo: { name: 'Sản phẩm được tặng', amount: 0 }, thuTu: 2, tang: true },
  ];
}

function danhSachHang(items, W) {
  const rows = [
    // Tiêu đề cột 3 phần: SL (trái) · Đơn giá (giữa) · Thành tiền (phải) — canh
    // khớp đúng cột số ở thân bill (dongSoLieu 2 cột tiền), kèm gạch trên/dưới.
    '-'.repeat(W),
    dongGiaSlThanhTien('Đơn giá', 'SL', 'T.Tiền', W),
    '-'.repeat(W),
  ];
  // GOM COMBO: các món cùng một combo (promo.type='combo', cùng tên) in chung
  // dưới TÊN COMBO + liệt kê từng món + dòng THÀNH TIỀN combo. Món thường in như cũ.
  const list = Array.isArray(items) ? items : [];
  const comboGroups = new Map();
  const normal = [];
  for (const i of list) {
    const promo = i.promo || {};
    if (promo.type === 'combo' && (promo.name || promo.code)) {
      const key = promo.name || promo.code;
      if (!comboGroups.has(key)) comboGroups.set(key, []);
      comboGroups.get(key).push(i);
    } else {
      normal.push(i);
    }
  }
  for (const [comboName, groupItems] of comboGroups) {
    rows.push(...wrap(`[[B1]]${comboName}[[B0]]`, W));
    let gross = 0, giam = 0;
    const vat = groupItems[0]?.vat_rate;
    for (const i of groupItems) {
      const qty = Number(i.qty) || 1;
      const goc = Number(i.unit_price ?? i.price) || 0;
      rows.push(...wrap(`  ${tenHang(i, 0)} x${qty}`, W));
      gross += goc * qty;
      giam += Math.max(0, Math.round(Number(i.promo?.amount) || 0));
    }
    const total = Math.max(0, gross - giam);
    // Dòng tổng combo: thành tiền combo (bóc VAT như các dòng khác).
    rows.push(dongGiaSlThanhTien(so(giaChuaVat(total, vat)), '', so(giaChuaVat(total, vat)), W));
  }
  for (const i of normal) {
    for (const phan of tachHang(i)) {
      const { qty, promo, thuTu } = phan;
      rows.push(...wrap(tenHang(i, thuTu), W));
      const ctkm = promo?.name || promo?.code || '';
      if (ctkm) rows.push(...wrap(`CTKM: ${ctkm}`, W));

      // GIÁ NIÊM YẾT (gốc) vs GIÁ BÁN (đã CHỈNH GIÁ dòng nếu có). unit_price là giá
      // thu; orig_price là giá niêm yết. Nếu khác nhau → hiện cả gốc → sau đổi.
      const banGia = phan.tang ? 0 : Number(i.unit_price ?? i.price) || 0;
      const niemYet = phan.tang ? 0 : (Number(i.orig_price) > 0 ? Number(i.orig_price) : banGia);
      const giam = Math.max(0, Math.round(Number(promo?.amount) || 0));
      // Khuyến mãi giảm tiền tính trên giá ĐÃ GỒM VAT (đúng thứ khách trả), rồi
      // mới bóc VAT ra để hiện cột đơn giá.
      const sauKm = giam > 0 ? Math.max(0, banGia - giam / Math.max(1, qty)) : banGia;
      const niemYetChuaVat = giaChuaVat(niemYet, i.vat_rate);
      const sauChuaVat = giaChuaVat(sauKm, i.vat_rate);
      const doiGia = niemYet !== banGia;

      // Có KM HOẶC chỉnh giá: cột tiền in GIÁ THỰC THU + thành tiền (2 cột), còn
      // GIÁ GỐC xuống DÒNG NHÃN riêng bên dưới. Máy in nhiệt K80/K57 KHÔNG vẽ được
      // gạch ngang giữa số (ký tự tổ hợp U+0336 bị bảng mã cp1258/không-dấu nuốt),
      // nên trước đây để giá gốc trơ trong cột tiền khiến khách tưởng bị tính thêm.
      // Nhãn "Giá gốc:" rõ nghĩa với MỌI máy in; máy nào render được U+0336 thì
      // vẫn thấy gạch ngang. THÀNH TIỀN bóc VAT trên TỔNG dòng, không phải đơn giá
      // đã làm tròn nhân SL.
      if (giam > 0 || doiGia) {
        if (giam > 0) {
          rows.push(dongGiaKmSlThanhTien(
            so(giaChuaVat(banGia, i.vat_rate)), so(sauChuaVat), qty,
            so(giaChuaVat(sauKm * qty, i.vat_rate)), W));
        } else {
          rows.push(dongGiaSlThanhTien(so(sauChuaVat), qty, so(giaChuaVat(sauKm * qty, i.vat_rate)), W));
          rows.push(...wrap(`  Giá gốc: ${gachNgang(so(niemYetChuaVat))}`, W));
        }
      } else {
        rows.push(dongGiaSlThanhTien(so(niemYetChuaVat), qty, so(giaChuaVat(banGia * qty, i.vat_rate)), W));
      }

      // GHI CHÚ RIÊNG dòng (thu ngân nhập cho từng món) — in ngay dưới dòng hàng.
      if (i.note && String(i.note).trim()) {
        rows.push(...wrap(`  Ghi chú: ${String(i.note).trim()}`, W));
      }
    }
  }
  return rows.join('\n');
}

function receiptVars(p = {}, widthOverride = 0, cfgChiNhanh = null) {
  const tpl = cfgChiNhanh?.templates?.bill || p.print_config?.templates?.bill || {};
  // widthOverride = bề ngang THẬT của máy in sẽ in phiếu. Trước đây luôn dùng
  // templateWidthChars nên K57 (32 ký tự) vẫn format ở 40 → dòng dài hơn giấy,
  // máy in tự bẻ dòng ở vị trí bất kỳ và nội dung co cụm bên trái ~42mm.
  const W = widthOverride || templateWidthChars(tpl);
  const cfg = cfgChiNhanh?.bill || p.print_config?.bill || {};
  const d = p.paid_at || p.created_at ? new Date(p.paid_at || p.created_at) : new Date();

  const items = danhSachHang(p.items || [], W);

  // CÀI ĐẶT CHI NHÁNH LÀ NGUỒN CHÍNH, không phải bản chụp trong đơn.
  //
  // `p.company` được chụp lại lúc TẠO đơn. Ưu tiên nó thì chủ cửa hàng vào Cài
  // đặt xoá tên công ty hay sửa địa chỉ xong in ra vẫn thấy y như cũ, không
  // hiểu vì sao (sự cố thật 04/08/2026). Chỉ dùng p.company khi Cài đặt bỏ
  // trống — lúc đó bản chụp là thứ duy nhất còn lại.
  const storeName = cfg.storeName || p.company?.name || p.branch || 'DAN D PAK';
  const storeSubtitle = cfg.storeSubtitle || '';
  const footer = cfg.footer || 'Xin cảm ơn và hẹn gặp lại';
  const taxNote = receiptTaxNote(cfg);
  const qrNote = cfg.qrNote || '';
  const showQr = cfg.showQr !== '0' && !p.preview;

  const lines = Array.isArray(p.lines) ? p.lines : [];
  const collectionLines = lines.filter(line => Number(line.amount) > 0);
  const refundLines = lines.filter(line => Number(line.amount) < 0);
  const collectionMethods = [...new Set(collectionLines.map(line => methodLabel(line.method)))];
  const returnMark = String(p.return_status || '').toUpperCase() === 'FULL'
    ? 'ĐÃ HOÀN HÀNG TOÀN BỘ'
    : String(p.return_status || '').toUpperCase() === 'PARTIAL'
      ? 'ĐÃ HOÀN HÀNG MỘT PHẦN'
      : refundLines.length ? 'ĐÃ HOÀN HÀNG' : '';
  const total = Number(p.total) || 0;
  const vatAmount = Number(p.vat_amount ?? p.tax?.vat_amount) || 0;
  const subtotal = Number(p.subtotal) || 0;
  // Tiền hàng chưa VAT: ưu tiên số đơn hàng đã chốt, không có thì suy từ tổng
  // thanh toán trừ VAT (vẫn khớp với cột đơn giá chưa VAT ở thân bill).
  const goodsAmount = Number(p.goods_amount) || Math.max(0, total - vatAmount);
  // Thuế suất hiện trên dòng VAT lấy từ chính các món — bill một mức thuế thì
  // ghi rõ "VAT (8%)", nhiều mức thì để trống cho khỏi ghi sai.
  const mucThue = [...new Set((p.items || [])
    .map(i => Number(i.vat_rate) || 0).filter(r => r > 0))];
  const vatRate = mucThue.length === 1 ? mucThue[0] : 0;
  const orderDiscount = orderWideDiscount(p);
  const orderPromoName = p.voucher?.name || p.voucher_code || 'Giảm giá toàn bill';
  const linesPaid = lines.reduce((s, l) => s + (Number(l.amount) || 0), 0);
  const paid = Number(p.paid ?? (linesPaid || total)) || 0;
  const change = Number(p.change ?? Math.max(0, paid - total)) || 0;
  const reprint = isReprintPayload(p);

  const billNo = p.bill_no || p.number || '';

  const paymentLines = collectionLines.length
    ? collectionLines.map(l => rightPad(`${danMethod(l.method)}(VND) - ${money(l.amount)}`, W)).join('\n')
    : '';

  const customer = p.customer || {};
  const isInvoice = !!(customer.tax_code || customer.invoice_request);
  let customerInfoBlock = '';
  if (isInvoice) {
    const linesArr = [];
    if (customer.name) linesArr.push(`Khách hàng: ${customer.name}`);
    if (customer.company) linesArr.push(`Công ty: ${customer.company}`);
    if (customer.tax_code) linesArr.push(`MST: ${customer.tax_code}`);
    if (customer.address) linesArr.push(`Địa chỉ: ${customer.address}`);
    if (customer.email) linesArr.push(`Email: ${customer.email}`);
    if (customer.phone) linesArr.push(`SĐT: ${customer.phone}`);
    customerInfoBlock = linesArr.join('\n');
  } else {
    const linesArr = [`Khách hàng: ${customer.name || 'Bán cho người tiêu dùng'}`];
    if (customer.phone) linesArr.push(`SĐT: ${customer.phone}`);
    customerInfoBlock = linesArr.join('\n');
  }

  return {
    storeName,
    // TÊN DÀI PHẢI XUỐNG DÒNG, KHÔNG ĐƯỢC CẮT CỤT. center() cắt phần thừa, nên
    // "CÔNG TY TNHH DỊCH VỤ TIẾP THỊ BCM" (33 ký tự) in trên giấy K57 (32 ký
    // tự) mất hẳn chữ cuối — tên pháp nhân trên hóa đơn bị thiếu chữ.
    storeNameC: wrap(storeName, W).map(l => center(l, W)).join('\n'),
    storeSubtitle,
    storeSubtitleC: wrap(storeSubtitle, W).map(l => center(l, W)).join('\n'),
    address: p.company?.address || cfg.address || '',
    addressBlock: wrap(p.company?.address || cfg.address || '', W).join('\n'),
    phone: cfg.phone || '',
    email: cfg.email || '',
    taxCode: cfg.taxCode || '',
    // TẠM TÍNH KHÁC HÓA ĐƠN. Phiếu tạm tính đưa khách xem trước khi trả tiền —
    // in "HÓA ĐƠN THANH TOÁN" lên đó là sai bản chất, và SỐ BILL chưa được cấp
    // nên cũng không được in ra (in số rồi khách huỷ đơn là số đó thành số ma).
    // Nhãn in lại VIẾT HOA cho khớp với nhánh dựng sẵn và với markReceiptReprint
    // — trước đây mẫu ghi "(in lại)" còn phiếu không dùng mẫu ghi "(IN LẠI)",
    // cùng một cửa hàng in ra hai kiểu.
    billTitle: p.preview
      ? 'HÓA ĐƠN TẠM TÍNH'
      : `HÓA ĐƠN THANH TOÁN${reprint ? ' (IN LẠI)' : ''}`,
    billTitleAscii: p.preview
      ? 'HOA DON TAM TINH'
      : `HOA DON THANH TOAN${reprint ? ' (IN LAI)' : ''}`,
    reprintMark: reprint ? '(in lại)' : '',
    reprintMarkAscii: reprint ? '(in lai)' : '',
    billNo: p.preview ? '' : billNo,
    number: p.preview ? '' : billNo,
    place: p.table_code ? `Bàn ${p.table_code}` : (p.channel || 'POS'),
    cashier: p.cashier || '',
    date: vnDate(d),
    timeOnly: vnTime(d),
    time: vnDateTime(d),
    timeIn: p.created_at ? danDateTime(p.created_at) : '',
    timeOut: p.paid_at ? danDateTime(p.paid_at) : '',
    items,
    subtotal: money(subtotal),
    // Tiền hàng là tổng giá CHƯA VAT (goods_amount) — cùng gốc với cột đơn giá
    // ở thân bill. Lấy `subtotal` (đã gồm VAT) thì hai phần không cộng khớp và
    // khách nhìn ra ngay là bill sai.
    subtotalLine: labelValue('Tổng tiền hàng:', so(goodsAmount), W),
    vatAmount: money(vatAmount),
    vatLine: vatAmount > 0
      ? labelValue(`VAT${vatRate ? ` (${vatRate}%)` : ''}:`, so(vatAmount), W)
      : '',
    orderPromoName,
    orderPromoAmount: money(orderDiscount),
    orderPromoLine: orderDiscount > 0 ? labelValue(`${orderPromoName}:`, `-${money(orderDiscount)}`, W) : '',
    total: money(total),
    grandTotal: money(total),
    totalLine: labelValue('TỔNG TIỀN:', so(total), W),
    grandTotalLine: labelValue('Tổng thanh toán:', so(total), W),
    totalWordsLine: `Bằng chữ: ${p.total_words || moneyToWords(total)}`,
    methodLine: collectionMethods.length
      ? `${labelValue('Hình thức thanh toán:', collectionMethods.join(', '), W)}${returnMark ? `\n${center(returnMark, W)}` : ''}`
      : returnMark ? center(returnMark, W) : '',
    paymentLines,
    paidLine: labelValue('Tiền khách đưa:', money(paid), W),
    changeLine: labelValue('Tiền trả khách:', money(change), W),
    method: collectionMethods.join(', '),
    footer,
    footerC: center(footer, W),
    // MẪU BILL MẶC ĐỊNH GỌI {thanksC} VÀ {solidLine} — hai biến này chưa bao giờ
    // được dựng, nên replaceVars thay bằng chuỗi rỗng: chân bill của mọi cửa
    // hàng đã thiết kế mẫu đều TRỐNG, mất hẳn dòng cảm ơn và đường kẻ cuối.
    // Chỉ những cửa hàng chưa có mẫu (đi nhánh dựng sẵn) mới thấy dòng cảm ơn.
    thanksC: wrap(footer, W).map(l => center(l, W)).join('\n'),
    solidLine: line('-', W),
    footerBrandC: center(`${storeSubtitle} ${storeName}`.trim(), W),
    taxNoteC: center(taxNote, W),
    // Nhãn "Ghi chú:" LUÔN in kèm ba dòng trống, kể cả khi chưa nhập gì — bếp
    // và thu ngân viết tay lên đó. Bỏ hẳn khối này khi không có nội dung thì tờ
    // bill không còn chỗ ghi, đúng thứ người dùng vẫn phải viết ra lề giấy.
    noteBlock: `Ghi chú:${p.note ? ` ${p.note}` : ''}\n\n\n`,
    qrNote,
    qrNoteC: showQr ? wrap(qrNote, W).map(l => center(l, W)).join('\n') : '',
    invoiceLookupUrl: p.invoice?.lookup_url || p.invoice?.lookup_code || billNo,
    // KHÔNG chọn khách = bán lẻ cho người tiêu dùng cuối. Hóa đơn/thuế bán lẻ phải
    // ghi rõ người mua là "Bán cho người tiêu dùng" (không được để trống) — trống
    // khiến tờ bill/hóa đơn thiếu thông tin người mua, sai quy định. Khách có khai
    // (xuất hóa đơn) thì customer.name đã có, giữ nguyên.
    customerName: customer.name || 'Bán cho người tiêu dùng',
    customerTaxCode: customer.tax_code || '',
    customerInfoBlock,
  };
}

function labelVars(p = {}) {
  return {
    orderNo: p.order_no || '',
    billNo: p.order_no || '',
    table: p.table || '',
    channel: p.channel || '',
    customer: p.customer || '',
    phone: p.phone || '',
    time: p.time || vnTime(),
    itemName: p.itemName || p.name || '',
    name: p.itemName || p.name || '',
    options: p.options || '',
    note: p.note || '',
    qty: p.qty || '',
    copy: p.copy || '',
    barcode: p.barcode || p.order_no || p.itemName || '',
    price: p.price || '',
    code: p.code || '',
  };
}

// ---- Dan "HÓA ĐƠN THANH TOÁN" thermal receipt (42-col, ESC/POS ASCII) ----
const DAN_W = 42, DAN_NAME = 17, DAN_QTY = 2, DAN_PRICE = 9, DAN_AMT = 10;
function danMethod(m) {
  return { cash: 'TIỀN MẶT', card: 'THẺ', visa: 'THẺ', qrcode: 'CHUYỂN KHOẢN', qr: 'CHUYỂN KHOẢN', bank_transfer: 'CHUYỂN KHOẢN', internet_banking: 'CHUYỂN KHOẢN', momo: 'MOMO', zalopay: 'ZALOPAY', voucher: 'VOUCHER' }[m] || (m ? String(m).toUpperCase() : 'TIỀN MẶT');
}
// GIỮ NGUYÊN DẤU TIẾNG VIỆT. Bản cũ gọi ascii() ở đây nên nửa tờ bill mất dấu
// (dòng tiền, dòng khách hàng) còn nửa kia — chữ lấy thẳng từ mẫu người dùng
// thiết kế — vẫn có dấu. Bề rộng cột không đổi: chữ tiếng Việt dựng sẵn
// (precomposed) vẫn là MỘT ký tự, bỏ dấu hay không cũng cùng độ dài.
function rightPad(s, w = DAN_W) { s = String(s ?? ''); return s.length >= w ? s : ' '.repeat(w - s.length) + s; }
function labelValue(label, value, w = DAN_W) {
  label = String(label ?? ''); value = String(value ?? '');
  const gap = Math.max(1, w - label.length - value.length);
  return label + ' '.repeat(gap) + value;
}
// ── NGÀY GIỜ TRÊN GIẤY LÀ GIỜ CỬA HÀNG, KHÔNG PHẢI GIỜ MÁY CHỦ ─────────────
// Server chạy trong container trên VPS; container không đặt TZ thì chạy UTC.
// `new Date().toLocaleString('vi-VN')` và `getHours()` đều lấy GIỜ CỦA MÁY rồi
// gắn nhãn tiếng Việt lên — phiếu in ra ghi "19:08 2/8" trong khi đồng hồ cửa
// hàng là "02:08 3/8": lệch 7 tiếng và sai luôn NGÀY (sự cố thật 03/08/2026).
//
// Đặt TZ trong docker-compose là cần nhưng chưa đủ — mất biến môi trường hoặc
// chạy ở máy khác là sai lại. Múi giờ phải nằm trong code.
const STORE_TZ = process.env.STORE_TZ || 'Asia/Ho_Chi_Minh';

const VN_FMT = new Intl.DateTimeFormat('en-GB', {
  timeZone: STORE_TZ,
  day: '2-digit', month: '2-digit', year: 'numeric',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});

/** {day, month, year, hour, minute, second} theo giờ cửa hàng — tất cả là chuỗi
 *  đã đệm 0. Dùng THAY CHO mọi getHours()/toLocaleString khi in ngày giờ. */
function vietnamParts(value) {
  const d = value ? new Date(value) : new Date();
  const t = Number.isNaN(d.getTime()) ? new Date() : d;
  return Object.fromEntries(VN_FMT.formatToParts(t).map(x => [x.type, x.value]));
}

function vnDate(value) {
  const p = vietnamParts(value);
  return `${p.day}/${p.month}/${p.year}`;
}

function vnTime(value) {
  const p = vietnamParts(value);
  return `${p.hour}:${p.minute}`;
}

function vnDateTime(value) {
  return `${vnDate(value)} ${vnTime(value)}`;
}

function danDateTime(iso) {
  const p = vietnamParts(iso);
  return `${p.day}.${p.month}.${p.year} ${p.hour}.${p.minute}`;
}
function danItemRow(i = {}) {
  const qty = Number(i.qty) || 1;
  const price = Number(i.unit_price ?? i.price) || 0;
  // Two rows per item (mirrors web/shared/danBill.js): full name on top, then
  // the figures below aligned under the SL / Đ.Giá / T.Tiền columns.
  const nameLines = wrap(i.name || '', DAN_W);
  const figures = ' '.repeat(DAN_NAME)
    + ' ' + String(qty).padStart(DAN_QTY)
    + ' ' + money(price).padStart(DAN_PRICE + 2)
    + ' ' + money(price * qty).padStart(DAN_AMT + 2);
  const promo = promoText(i.promo, { thermal: true });
  const promoLines = promo ? wrap(`  KM: ${promo}`, DAN_W) : [];
  return [...nameLines, figures, ...promoLines].join('\n');
}

// [W] = số ký tự/dòng của ĐÚNG máy in sẽ in phiếu này. Mặc định 40 giữ nguyên
// hành vi cũ. Máy POS cầm tay (Sunmi 58mm) truyền 32 vào, máy để bàn K80 truyền
// 48 — hai máy cùng chi nhánh nhưng khác khổ giấy, không thể dùng chung một số.
function renderReceipt(p = {}, W = 40, cfgChiNhanh = null) {
  const cotPhai = Math.max(12, Math.round(W * 0.45));
  const cotTrai = Math.max(8, W - cotPhai);
  // MẪU BILL LẤY TỪ CÀI ĐẶT HIỆN TẠI, KHÔNG PHẢI BẢN SAO TRONG PAYLOAD.
  //
  // payload.print_config được chụp lại lúc TẠO job. Sửa mẫu bill trong Cài đặt
  // rồi bấm In lại một hóa đơn cũ thì tờ giấy vẫn ra theo mẫu cũ — người dùng
  // sửa mẫu xong không hiểu vì sao không ăn. Cấu hình chi nhánh là nguồn chính;
  // payload chỉ dùng khi gọi trực tiếp không kèm chi nhánh (bản xem trước).
  const tpl = cfgChiNhanh?.templates?.bill || p.print_config?.templates?.bill;
  const opt = { title: 'HÓA ĐƠN THANH TOÁN', widthChars: W };
  if (tpl?.rows?.length) return renderTemplateRows(tpl, receiptVars(p, W, cfgChiNhanh), opt);
  if (tpl?.elements?.length) return renderTemplateText(tpl, receiptVars(p, W, cfgChiNhanh), opt);
  const cfg = cfgChiNhanh?.bill || p.print_config?.bill || {};
  const rows = [];
  
  const storeName = p.company?.name || cfg.storeName || p.branch || 'DAN D PAK';
  if (storeName) {
    for (const lineText of wrap(storeName, W)) {
      rows.push(center(lineText, W));
    }
  }
  
  const address = p.company?.address || cfg.address;
  if (address) {
    for (const lineText of wrap(address, W)) {
      rows.push(center(lineText, W));
    }
  }
  
  rows.push(line('-', W));
  if (p.preview) {
    rows.push(center('HÓA ĐƠN TẠM TÍNH', W));
  } else {
    let titleText = 'HÓA ĐƠN THANH TOÁN';
    if (isReprintPayload(p)) titleText += ' (IN LẠI)';
    rows.push(center(titleText, W));
    const billNo = p.number || p.bill_no;
    if (billNo) {
      rows.push(center(`Mã HD: #${billNo}`, W));
    }
  }
  if (p.table_code) {
    rows.push(center(`Bàn ${p.table_code}`, W));
  }
  rows.push(line('-', W));
  
  const wQty = 4;
  const wPrice = Math.max(10, Math.floor((W - wQty) / 2));
  const wTotal = W - wQty - wPrice;
  rows.push('SL'.padEnd(wQty) + 'ĐƠN GIÁ'.padStart(wPrice) + 'THÀNH TIỀN'.padStart(wTotal));
  
  const items = p.items || [];
  const itemDivider = center('-'.repeat(Math.max(10, Math.floor(W * 0.5))), W);
  for (let idx = 0; idx < items.length; idx++) {
    if (idx > 0) {
      rows.push(itemDivider);
    }
    const i = items[idx];
    const qty = Number(i.qty) || 1;
    const price = Number(i.unit_price ?? i.price) || 0;
    rows.push(...wrap(i.name || '', W));
    rows.push(String(qty).padEnd(wQty) + money(price).padStart(wPrice) + money(price * qty).padStart(wTotal));
    const promo = promoText(i.promo);
    if (promo) rows.push(...wrap(`  KM: ${promo}`, W));
  }
  
  rows.push(line('-', W));
  const subtotal = Number(p.subtotal ?? p.total) || 0;
  const vatAmount = Number(p.vat_amount ?? p.tax?.vat_amount) || 0;
  rows.push('TỔNG CỘNG:'.padEnd(cotTrai) + money(subtotal).padStart(cotPhai));
  if (vatAmount > 0) rows.push('VAT:'.padEnd(cotTrai) + money(vatAmount).padStart(cotPhai));
  const orderDiscount = orderWideDiscount(p);
  if (orderDiscount > 0) {
    const label = p.voucher?.name || p.voucher_code || 'GIẢM GIÁ:';
    rows.push(...wrap(label, Math.max(10, W - 18)).map((x, idx) => idx === 0
      ? x.padEnd(cotTrai) + ('-' + money(orderDiscount)).padStart(cotPhai)
      : x));
  }
  rows.push('TỔNG TIỀN:'.padEnd(cotTrai) + money(p.total || 0).padStart(cotPhai));
  if (Array.isArray(p.lines) && p.lines.length) {
    for (const l of p.lines) {
      rows.push(`${methodLabel(l.method)}:`.padEnd(cotTrai) + money(l.amount).padStart(cotPhai));
    }
  }
  const change = Number(p.change) || 0;
  if (change > 0) {
    rows.push('TIỀN THỪA:'.padEnd(cotTrai) + money(change).padStart(cotPhai));
  }
  
  const totalAmount = Number(p.total) || 0;
  const words = p.total_words || moneyToWords(totalAmount);
  if (words) {
    rows.push(line('-', W));
    rows.push('Bằng chữ:');
    const cleanWords = words.endsWith('.') ? words : `${words}.`;
    for (const wordLine of wrap(cleanWords, W)) {
      rows.push(wordLine);
    }
  }

  rows.push(line('-', W));
  if (p.note) rows.push(...wrap(`Ghi chú: ${p.note}`, W));
  
  const footerText = cfg.footer || 'Cảm ơn quý khách và hẹn gặp lại';
  const wrappedFooter = wrap(footerText, W);
  for (const lineText of wrappedFooter) {
    rows.push(center(lineText, W));
  }
  
  return rows.join('\n');
}

// KHÔNG BAO GIỜ đổ JSON thô ra giấy. Bản cũ in
// `JSON.stringify(payload).slice(0, 1200)` nên phiếu in thử ra nguyên khối
// {"printer":{"id":"POS 2","systemName":"POS-80C",...} — vừa vô nghĩa với thu
// ngân, vừa lộ cấu hình máy in, vừa dài lê thê tốn giấy.
function renderGeneric(job, W = 40) {
  const p = job.payload || {};
  const rows = [
    center(TYPE_LABEL[job.type] || job.type || 'JOB IN', W),
    line('-', W),
  ];
  if (job.title) rows.push(...wrap(job.title, W));
  const fields = [
    ['Bàn', p.table],
    ['Mã', p.ref],
    ['Ghi chú', p.note],
  ];
  for (const [label, value] of fields) {
    if (value) rows.push(...wrap(`${ascii(label)}: ${ascii(value)}`, W));
  }
  return rows.join('\n');
}

/**
 * Phiếu IN THỬ. Mục đích của nó là để người đứng máy nhìn tờ giấy mà biết ngay:
 * khổ giấy có khớp cấu hình không, chữ có đủ đậm không, in từ tuyến nào.
 * Vạch thước dưới cùng trải đúng bề ngang cấu hình — nếu nó bị xuống dòng thì
 * giấy hẹp hơn cài đặt, nếu nó hụt nhiều so với mép giấy thì giấy rộng hơn.
 */
function renderTest(job, W = 48, billCfg = {}) {
  const p = job.payload || {};
  const pr = p.printer || {};
  // Khổ giấy hiển thị phải lấy CÙNG NGUỒN với bề ngang W đang dùng để dựng
  // phiếu. Trước đó chữ đọc từ payload còn W tính từ cấu hình chi nhánh — hai
  // nguồn lệch nhau thì tờ giấy ghi "K80 72mm" trong khi đang in theo khổ K58,
  // tức chính tờ phiếu dùng để kiểm tra khổ giấy lại báo sai khổ giấy.
  const cfg = { ...(p.print_config?.bill || {}), ...billCfg };
  const target = pr.connection === 'lan'
    ? `${pr.ip || ''}:${pr.port || 9100}`
    : (pr.systemName || pr.name || '-');
  const paper = `${cfg.paper || 'K80'} ${cfg.widthMm || 72}mm ${W} ký tự`;
  const density = { light: 'Nhạt', medium: 'Vừa', dark: 'Đậm', max: 'Rất đậm' }[
    String(cfg.printDensity || 'dark').toLowerCase()] || 'Đậm';
  const charset = { utf8: 'UTF-8', auto: 'UTF-8 (tự động)', cp1258: 'CP1258', ascii: 'Không dấu' }[
    String(pr.charset || 'auto').toLowerCase()] || 'UTF-8 (tự động)';
  const coChu = ['1x (như cũ)', '2x cao', '3x cao', '2x cả hai chiều'][
    fontScaleFor('test', cfg)] || '2x cao';

  // Nhãn + giá trị dài hơn bề ngang thì xuống dòng, không để tràn ra ngoài giấy.
  const field = (label, value) => {
    const l = String(label ?? '');
    const v = String(value ?? '');
    return l.length + v.length + 1 <= W ? [labelValue(l, v, W)] : [l, ...wrap(v, W)];
  };

  // PHIẾU IN THỬ LUÔN IN KHÔNG DẤU, bất kể tuyến khai bảng mã nào.
  //
  // Đây là tờ giấy CHẨN ĐOÁN — người đứng máy dùng nó để biết máy in có chạy
  // không, khổ giấy đúng chưa. Nếu chính tờ này cũng ra ký tự lạ vì máy không
  // có phông tiếng Việt thì nó mất hẳn tác dụng. Hai dòng mẫu tiếng Việt ở
  // giữa vẫn GIỮ DẤU — đó mới là phần dùng để thử bảng mã.
  const kd = ascii;
  const rows = [
    center(kd(cfg.storeName || 'DAN D PAK'), W),
    line('=', W),
    center('PHIEU IN THU', W),
    line('=', W),
    ...field('May in:', kd(pr.label || pr.name || pr.id || '-')),
    ...field('Tuyen:', kd(pr.id || '-')),
    ...field('Ket noi:', kd(`${pr.connection || '-'} ${target}`)),
    ...field('Kho giay:', kd(paper)),
    ...field('Do dam:', kd(density)),
    ...field('Bang ma:', kd(charset)),
    ...field('Co chu:', kd(coChu)),
    ...field('Thoi gian:', p.time || vnDateTime()),
    line('-', W),
    // Mọi dòng chữ đều phải cắt theo bề ngang — khổ K58 chỉ có 32 ký tự, để
    // nguyên câu dài thì máy in tự bẻ dòng lung tung, nhìn như in lỗi.
    ...wrap('Kiem tra chu co du dam va ro net khong:', W),
    ...wrap('AaBbCcDd 0123456789 .,:;!?-+*/=', W),
    line('-', W),
    // DÒNG QUYẾT ĐỊNH BẢNG MÃ: người đứng máy nhìn hai dòng này là biết ngay máy
    // in có đọc được tiếng Việt không. Đọc ra ký tự lạ thì vào Kết nối đổi
    // "Bảng mã" của tuyến này sang CP1258, không được nữa thì chọn Không dấu.
    ...wrap('Tiếng Việt: Phở bò, Cà phê sữa đá, Trà đào', W),
    ...wrap('Đủ dấu: ăâđêôơư ÀẢÃÁẠ ỄỆỐỘỰỹ 25.000đ', W),
    line('-', W),
    // Vạch thước: đánh dấu mỗi 10 ký tự để đối chiếu bề ngang giấy.
    ...wrap('Do be ngang giay bang vach duoi day:', W),
    Array.from({ length: W }, (_, i) => ((i + 1) % 10 === 0 ? '|' : '.')).join(''),
    Array.from({ length: Math.floor(W / 10) }, (_, i) => String((i + 1) * 10).padStart(10)).join(''),
    line('=', W),
    ...wrap('Neu doc duoc dong nay la may in DA CHAY', W).map(r => center(r, W)),
  ];
  return rows.filter(r => r !== null && r !== undefined).join('\n');
}

// TEM VẬN ĐƠN (100×150 / 76×130mm) — waybill in tại cửa hàng cho đơn từ sàn.
// Bản dựng bằng CHỮ (ESC/POS/driver), KHÔNG in ảnh ở tầng app theo kiến trúc in.
// Barcode thật cần lệnh TSPL của máy in tem; ở đây mã vận đơn được in to, rõ để
// quét tay/đối chiếu — đủ dùng khi chưa có luồng waybill PDF chính thức từ sàn.
function renderShippingLabel(p = {}, W = 48) {
  const L = [];
  const push = (s = '') => L.push(ascii(String(s)));
  const kv = (k, v) => push(`${k}: ${v ?? ''}`.slice(0, W));
  const provider = String(p.providerLabel || p.provider || 'ONLINE').toUpperCase();
  push(center(provider, W));
  if (p.shopName) push(center(ascii(p.shopName), W));
  push(line('=', W));
  if (p.carrier) push(center(`ĐVVC: ${ascii(p.carrier)}`, W));
  if (p.trackingNumber) {
    push(center('MÃ VẬN ĐƠN', W));
    push(centerBig(String(p.trackingNumber), W));
  }
  if (p.orderCode) kv('Mã đơn', p.orderCode);
  push(line('-', W));
  push('NGƯỜI NHẬN');
  const r = p.receiver || {};
  push(ascii(`${r.name || ''}  ${r.phone || ''}`).trim());
  for (const ln of wrap(ascii(r.address || ''), W)) push(ln);
  push(line('-', W));
  push('NGƯỜI GỬI');
  const s = p.sender || {};
  push(ascii(`${s.name || ''}  ${s.phone || ''}`).trim());
  for (const ln of wrap(ascii(s.address || ''), W)) push(ln);
  push(line('-', W));
  const items = Array.isArray(p.items) ? p.items : [];
  if (items.length) {
    push('SẢN PHẨM');
    for (const it of items) {
      const qty = `x${Number(it.qty || 1)}`;
      const name = ascii(it.name || '');
      const room = W - qty.length - 1;
      push(`${name.slice(0, room).padEnd(room)} ${qty}`);
    }
    push(line('-', W));
  }
  if (Number(p.codAmount || 0) > 0) {
    push(centerBig('COD', W));
    push(centerBig(money(p.codAmount), W));
  } else {
    push(center('ĐÃ THANH TOÁN — KHÔNG THU COD', W));
  }
  if (p.weight) kv('Khối lượng', `${p.weight}g`);
  if (p.note) { push(line('-', W)); for (const ln of wrap(ascii(p.note), W)) push(ln); }
  push(line('=', W));
  push(center('Cảm ơn quý khách', W));
  return L.join('\n');
}

// PHIẾU CHI — giống bill bán hàng nhưng tiêu đề "PHIẾU CHI", KHÔNG hiện VAT.
// Ghi rõ: người chi, ngày giờ, lý do, dòng (item · đơn giá · SL · thành tiền),
// tổng cộng. Bản CHỮ (ESC/POS) — bản driver dựng ở buildExpenseVoucherDoc.
function renderExpenseVoucher(p = {}, W = 48) {
  const L = [];
  const push = (s = '') => L.push(ascii(String(s)));
  if (p.shopName) push(center(ascii(p.shopName), W));
  if (p.address) for (const ln of wrap(ascii(p.address), W)) push(center(ln, W));
  if (p.phone) push(center(`ĐT: ${ascii(p.phone)}`, W));
  push(line('=', W));
  push(centerBig('PHIẾU CHI', W));
  push(line('=', W));
  if (p.code) push(`Số phiếu: ${ascii(p.code)}`);
  if (p.datetime) {
    try { push(`Ngày giờ chi: ${businessDateTime(p.datetime)}`); } catch {}
  }
  if (p.payer) push(`Người chi: ${ascii(p.payer)}`);
  if (p.payee) push(`Bên nhận/NCC: ${ascii(p.payee)}`);
  if (p.reason) for (const ln of wrap(`Lý do: ${ascii(p.reason)}`, W)) push(ln);
  push(line('-', W));
  // Header cột: Tên · ĐG · SL · T.Tiền
  const money$ = (n) => money(n);
  const qty = Number(p.qty || 1);
  const unit = Number(p.unitPrice != null ? p.unitPrice : p.amount || 0);
  const lineTotal = Number(p.amount || unit * qty);
  push('Nội dung');
  push(ascii(p.item || 'Chi phí'));
  const dg = `ĐG ${money$(unit)}`;
  const sl = `SL ${qty}`;
  const tt = money$(lineTotal);
  // dòng số: ĐG (trái) · SL (giữa) · thành tiền (phải)
  const left = `${dg}   ${sl}`;
  push(`${left.slice(0, W - tt.length - 1).padEnd(W - tt.length - 1)} ${tt}`);
  push(line('-', W));
  const total = Number(p.total != null ? p.total : lineTotal);
  const tval = money$(total);
  const tlabel = 'TỔNG CỘNG:';
  push(`${tlabel}${tval.padStart(W - tlabel.length)}`);
  if (p.totalWords) { push(''); for (const ln of wrap(`Bằng chữ: ${ascii(p.totalWords)}`, W)) push(ln); }
  push(line('=', W));
  push('');
  push('Người lập phiếu            Người nhận'.slice(0, W));
  push('');
  push('');
  push(center('(Ký, ghi rõ họ tên)', W));
  return L.join('\n');
}

// PHIẾU TRẢ HÀNG (ESC/POS text) — nhiều dòng món + TỔNG HOÀN.
function renderReturnVoucher(p = {}, W = 48) {
  const L = [];
  const push = (s = '') => L.push(ascii(String(s)));
  if (p.shopName) push(center(ascii(p.shopName), W));
  if (p.address) for (const ln of wrap(ascii(p.address), W)) push(center(ln, W));
  if (p.phone) push(center(`ĐT: ${ascii(p.phone)}`, W));
  push(line('=', W));
  push(centerBig('PHIẾU TRẢ HÀNG', W));
  push(line('=', W));
  if (p.code) push(`Bill gốc: ${ascii(p.code)}`);
  if (p.datetime) {
    try { push(`Ngày giờ trả: ${businessDateTime(p.datetime)}`); } catch {}
  }
  if (p.actor) push(`Người lập: ${ascii(p.actor)}`);
  if (p.approvedBy) push(`Quản lý duyệt: ${ascii(p.approvedBy)}`);
  push(line('-', W));
  for (const it of (Array.isArray(p.items) ? p.items : [])) {
    push(ascii(it.name || ''));
    const dg = `ĐG ${money(it.unitPrice || 0)}`;
    const sl = `SL ${it.qty || 0}`;
    const tt = money(it.amount || 0);
    const left = `${dg}   ${sl}`;
    push(`${left.slice(0, W - tt.length - 1).padEnd(W - tt.length - 1)} ${tt}`);
  }
  push(line('-', W));
  const tval = money(p.total || 0);
  const tlabel = 'TỔNG HOÀN:';
  push(`${tlabel}${tval.padStart(W - tlabel.length)}`);
  if (p.refundMethod) push(`Hoàn qua: ${ascii(p.refundMethod)}`);
  push(line('=', W));
  push('');
  push('Người lập phiếu            Người nhận'.slice(0, W));
  push('');
  push('');
  return L.join('\n');
}

export function renderJobText(job, branch_id = 'sala', printer = null) {
  const p = job.payload || {};
  if (job.type === 'expense_voucher') {
    const W = Number(printer?.widthMm) ? paperWidthCharsFrom({ widthMm: Number(printer.widthMm) }) : 48;
    return renderExpenseVoucher(p, W);
  }
  if (job.type === 'return_voucher') {
    const W = Number(printer?.widthMm) ? paperWidthCharsFrom({ widthMm: Number(printer.widthMm) }) : 48;
    return renderReturnVoucher(p, W);
  }
  if (job.type === 'kitchen_ticket') {
    // Mẫu Phiếu bếp do cửa hàng thiết kế (templates.kitchen_ticket) ĐƯỢC ƯU TIÊN,
    // nhưng chỉ khi mẫu có phần tử bảng món (kitchenTemplateUsable) — nếu không thì
    // dùng bản dựng sẵn renderTicket để món luôn ra giấy. Cấu hình đọc theo CHI
    // NHÁNH (nguồn chính), payload chỉ dùng khi gọi trực tiếp (xem lại renderReceipt).
    const cfg = getPrintConfig(job.branch_id || branch_id);
    const tpl = cfg?.templates?.kitchen_ticket || p.print_config?.templates?.kitchen_ticket;
    if (kitchenTemplateUsable(tpl)) {
      const W = Number(printer?.widthMm)
        ? paperWidthCharsFrom({ widthMm: Number(printer.widthMm) })
        : templateWidthChars(tpl);
      return renderTemplateRows(tpl, kitchenVars(p), { title: 'PHIEU BEP', widthChars: W, styled: true });
    }
    // W = 1/2 số ký tự giấy vì renderTicket bọc [[S3]] (in 2x cả 2 chiều) → vừa giấy.
    const fullChars = Number(printer?.widthMm)
      ? paperWidthCharsFrom({ widthMm: Number(printer.widthMm) })
      : 40;
    return renderTicket(p, Math.max(14, Math.floor(fullChars / 2)));
  }
  if (job.type === 'runner') return renderRunner(p);
  if (job.type === 'receipt') {
    const cfg = getPrintConfig(job.branch_id || branch_id);
    const billCfg = cfg?.bill || {};
    const Wr = Number(printer?.widthMm)
      ? paperWidthCharsFrom({ widthMm: Number(printer.widthMm) })
      : paperWidthCharsFrom(billCfg);
    let text = renderReceipt(p, Wr, cfg);
    if (isReprintPayload(p, job)) text = markReceiptReprint(text);
    return text;
  }
  // Tem phải đọc cấu hình theo CHI NHÁNH, không chờ payload mang sẵn: job tem do
  // printProductLabel/printCupLabels tạo ra KHÔNG nhúng print_config (cố ý — mẫu
  // tem kèm logo base64 làm phình mỗi dòng print_jobs). Trước đây renderLabel chỉ
  // nhận payload nên mẫu tem đã thiết kế và kích thước tem đã cài đều bị bỏ qua,
  // mọi tem in ra đều là bản dự phòng cắm cứng 40 ký tự.
  if (job.type === 'cup_label' || job.type === 'product_label') {
    return renderLabel(p, getPrintConfig(job.branch_id || branch_id), printer, job.type);
  }
  if (job.type === 'shipping_label') {
    const W = Number(printer?.widthMm)
      ? paperWidthCharsFrom({ widthMm: Number(printer.widthMm) })
      : paperWidthCharsFrom({ widthMm: p.paperWidthMm || 100 });
    return renderShippingLabel(p, W);
  }
  // Phiếu do server tự dựng thì trải đúng bề ngang khổ giấy đã cấu hình. Đọc
  // cấu hình ĐÚNG MỘT LẦN rồi dùng chung cho cả bề ngang lẫn phần chữ hiển thị.
  const bill = getPrintConfig(job.branch_id || branch_id)?.bill || {};
  // Máy in TỰ KHAI bề ngang thì tin nó (máy cầm tay Sunmi 58mm nằm cùng chi
  // nhánh với máy để bàn K80). Không khai thì theo cấu hình chi nhánh như cũ.
  const W = Number(printer?.widthMm)
    ? paperWidthCharsFrom({ widthMm: Number(printer.widthMm) })
    : paperWidthCharsFrom(bill);
  if (job.type === 'test') return renderTest(job, W, bill);
  return renderGeneric(job, W);
}

// Độ đậm bản in → lệnh ESC/POS PHỔ BIẾN & AN TOÀN (máy nào không hỗ trợ thì bỏ
// qua, không hỏng): ESC G n = double-strike (in 2 lần/điểm → đậm hơn),
// ESC E n = emphasized/bold. light/medium để mặc định máy; dark bật double-strike;
// max bật cả hai. Khớp 4 mức "sắc tố đen" ở trình thiết kế mẫu in.
function densityPrefix(density) {
  const on = (cmd) => Buffer.from([0x1b, cmd, 0x01]);
  const s = String(density || '').toLowerCase().trim();
  const rat = s === 'max' || s.includes('rat') || s.includes('very') || s.includes('max');
  const dam = rat || s === 'dark' || s.includes('dam') || s.includes('bold');
  if (!dam) return Buffer.alloc(0);

  // ESC G = double-strike, ESC E = emphasized. Hai lệnh này chỉ in ĐÈ THÊM một
  // lượt, KHÔNG tăng nhiệt đầu in — trên giấy nhiệt rẻ tiền bản in vẫn xám nhạt.
  // Đó là lý do cửa hàng để "rất đậm" mà bill vẫn mờ.
  //
  // ESC 7 n1 n2 n3 (max heating dots / heating time / heating interval) mới là
  // lệnh chỉnh NHIỆT thật của dòng máy in nhiệt phổ thông:
  //   n1 = số chấm đốt cùng lúc (đơn vị 8 chấm)  — cao thì đậm, tốn điện hơn
  //   n2 = thời gian đốt (đơn vị 10µs)           — cao thì đậm, in chậm hơn
  //   n3 = quãng nghỉ giữa hai dòng (đơn vị 10µs)— thấp thì in nhanh
  // Máy không hỗ trợ sẽ bỏ qua lệnh, không hỏng gì. Giá trị dưới đây nằm trong
  // ngưỡng an toàn của đầu in (mặc định nhà máy thường là 7 / 80 / 2).
  const nhiet = rat
    ? Buffer.from([0x1b, 0x37, 15, 220, 2])
    : Buffer.from([0x1b, 0x37, 11, 160, 2]);

  return rat
    ? Buffer.concat([nhiet, on(0x47), on(0x45)])
    : Buffer.concat([nhiet, on(0x47)]);
}

// ── TIẾNG VIỆT CÓ DẤU TRÊN MÁY IN NHIỆT ─────────────────────────────────────
// Bản cũ gọi ascii() ngay trong escposBuffer: MỌI dấu tiếng Việt bị bóc sạch
// trước khi ra máy in. Trong khi đó agent chạy trong app (máy POS cầm tay,
// local_print_agent.dart) lại gửi thẳng UTF-8 nên chữ CÓ dấu. Cùng một cửa
// hàng, hai đường in, hai kiểu chữ — đúng triệu chứng "chỗ có dấu chỗ không".
//
// Giờ bộ mã là THUỘC TÍNH CỦA MÁY IN, khai trong Kết nối:
//   auto / utf8 : gửi nguyên UTF-8 (mặc định — máy in gắn liền Sunmi và phần
//                 lớn máy đời mới hiểu được; đây là đường đang chạy tốt).
//   cp1258      : Windows-1258, bộ mã tiếng Việt của ESC/POS. Dấu thanh đi
//                 riêng thành ký tự tổ hợp nên phải tách chữ ra (NFD) trước.
//   ascii       : bỏ dấu — lối thoát cho máy in đời cũ in ra ký tự lạ.
const PRINTER_CHARSETS = new Set(['auto', 'utf8', 'cp1258', 'ascii']);

// ESC t n — chọn bảng mã. 30 là chỉ số tiếng Việt phổ biến nhất trên dòng máy
// in nhiệt tương thích Epson; máy không hiểu thì bỏ qua lệnh, không hỏng gì.
const CP1258_PAGE = 30;

/** Windows-1258: mã ký tự > 0x7F. Khoá là codepoint Unicode (đã tách NFD). */
const CP1258_MAP = new Map(Object.entries({
  '0x20ac': 0x80, '0x201a': 0x82, '0x0192': 0x83, '0x201e': 0x84, '0x2026': 0x85,
  '0x2020': 0x86, '0x2021': 0x87, '0x02c6': 0x88, '0x2030': 0x89, '0x2039': 0x8b,
  '0x0152': 0x8c, '0x2018': 0x91, '0x2019': 0x92, '0x201c': 0x93, '0x201d': 0x94,
  '0x2022': 0x95, '0x2013': 0x96, '0x2014': 0x97, '0x02dc': 0x98, '0x2122': 0x99,
  '0x203a': 0x9b, '0x0153': 0x9c, '0x0178': 0x9f,
  '0x00a0': 0xa0, '0x00a1': 0xa1, '0x00a2': 0xa2, '0x00a3': 0xa3, '0x00a4': 0xa4,
  '0x00a5': 0xa5, '0x00a6': 0xa6, '0x00a7': 0xa7, '0x00a8': 0xa8, '0x00a9': 0xa9,
  '0x00aa': 0xaa, '0x00ab': 0xab, '0x00ac': 0xac, '0x00ad': 0xad, '0x00ae': 0xae,
  '0x00af': 0xaf, '0x00b0': 0xb0, '0x00b1': 0xb1, '0x00b2': 0xb2, '0x00b3': 0xb3,
  '0x00b4': 0xb4, '0x00b5': 0xb5, '0x00b6': 0xb6, '0x00b7': 0xb7, '0x00b8': 0xb8,
  '0x00b9': 0xb9, '0x00ba': 0xba, '0x00bb': 0xbb, '0x00bc': 0xbc, '0x00bd': 0xbd,
  '0x00be': 0xbe, '0x00bf': 0xbf,
  '0x00c0': 0xc0, '0x00c1': 0xc1, '0x00c2': 0xc2, '0x0102': 0xc3, '0x00c4': 0xc4,
  '0x00c5': 0xc5, '0x00c6': 0xc6, '0x00c7': 0xc7, '0x00c8': 0xc8, '0x00c9': 0xc9,
  '0x00ca': 0xca, '0x00cb': 0xcb, '0x0300': 0xcc, '0x00cd': 0xcd, '0x00ce': 0xce,
  '0x00cf': 0xcf,
  '0x0110': 0xd0, '0x00d1': 0xd1, '0x0309': 0xd2, '0x00d3': 0xd3, '0x00d4': 0xd4,
  '0x01a0': 0xd5, '0x00d6': 0xd6, '0x00d7': 0xd7, '0x00d8': 0xd8, '0x00d9': 0xd9,
  '0x00da': 0xda, '0x00db': 0xdb, '0x00dc': 0xdc, '0x01af': 0xdd, '0x0303': 0xde,
  '0x00df': 0xdf,
  '0x00e0': 0xe0, '0x00e1': 0xe1, '0x00e2': 0xe2, '0x0103': 0xe3, '0x00e4': 0xe4,
  '0x00e5': 0xe5, '0x00e6': 0xe6, '0x00e7': 0xe7, '0x00e8': 0xe8, '0x00e9': 0xe9,
  '0x00ea': 0xea, '0x00eb': 0xeb, '0x0301': 0xec, '0x00ed': 0xed, '0x00ee': 0xee,
  '0x00ef': 0xef,
  '0x0111': 0xf0, '0x00f1': 0xf1, '0x0323': 0xf2, '0x00f3': 0xf3, '0x00f4': 0xf4,
  '0x01a1': 0xf5, '0x00f6': 0xf6, '0x00f7': 0xf7, '0x00f8': 0xf8, '0x00f9': 0xf9,
  '0x00fa': 0xfa, '0x00fb': 0xfb, '0x00fc': 0xfc, '0x01b0': 0xfd, '0x20ab': 0xfe,
  '0x00ff': 0xff,
}).map(([k, v]) => [parseInt(k, 16), v]));

function encodeCp1258(text) {
  // NFD tách "ế" thành "ê" + dấu sắc — đúng cách CP1258 biểu diễn tiếng Việt.
  // Riêng Đ/đ, Ơ/ơ, Ư/ư có ô mã riêng nên KHÔNG được tách, phải chặn trước.
  const giuNguyen = /[ĐđƠơƯư]/;
  const out = [];
  for (const ch of String(text ?? '')) {
    if (giuNguyen.test(ch)) {
      out.push(CP1258_MAP.get(ch.codePointAt(0)));
      continue;
    }
    for (const part of ch.normalize('NFD')) {
      const cp = part.codePointAt(0);
      if (cp < 0x80) { out.push(cp); continue; }
      const b = CP1258_MAP.get(cp);
      // Không có trong bảng mã thì bỏ dấu ký tự đó, còn hơn in ra ô vuông.
      if (b != null) out.push(b);
      else for (const c of ascii(part)) out.push(c.charCodeAt(0));
    }
  }
  return Buffer.from(out);
}

/**
 * Bộ mã THẬT của một tuyến in.
 *
 * 'auto' = BỎ DẤU. Nghe ngược đời nhưng đây là lựa chọn đúng cho giá trị mặc
 * định: máy in nhiệt phổ thông KHÔNG có sẵn phông tiếng Việt, gửi UTF-8 xuống
 * là mỗi chữ có dấu in ra một ô hình kim cương — tờ bill hỏng hoàn toàn, tệ hơn
 * hẳn so với chữ không dấu vẫn đọc được.
 *
 * Đã xảy ra thật ngày 04/08/2026: đổi mặc định sang UTF-8 làm bill ở cửa hàng
 * ra đầy ký tự lạ. Máy in gắn liền của máy POS cầm tay (Sunmi) thì đọc được
 * UTF-8, nhưng đó là NGOẠI LỆ chứ không phải mặt bằng chung.
 *
 * Muốn chữ có dấu thì vào Kết nối chọn UTF-8 hoặc CP1258 cho ĐÚNG tuyến in đó,
 * bấm In thử xem hai dòng tiếng Việt mẫu — thấy đọc được mới giữ.
 */
function charsetOf(printer = {}) {
  const raw = String(printer.charset || 'auto').toLowerCase().trim();
  const cs = PRINTER_CHARSETS.has(raw) ? raw : 'auto';
  return cs === 'auto' ? 'ascii' : cs;
}

function encodeForPrinter(text, charset = 'utf8') {
  if (charset === 'ascii') return Buffer.from(ascii(text), 'latin1');
  if (charset === 'cp1258') return encodeCp1258(text);
  return Buffer.from(String(text ?? ''), 'utf8');
}

/** Lệnh chọn bảng mã gửi kèm đầu phiếu (utf8/ascii để máy in tự lo). */
function charsetPrefix(charset) {
  return charset === 'cp1258'
    ? Buffer.from([0x1b, 0x74, CP1258_PAGE])
    : Buffer.alloc(0);
}

// ── CỠ CHỮ ──────────────────────────────────────────────────────────────────
// GS ! n : bit 4-7 = nhân bề NGANG, bit 0-3 = nhân bề CAO (0 = 1x).
//
// Bill phải to hơn mà KHÔNG được đổi số cột: nhân bề ngang lên 2 là khổ K80 chỉ
// còn 24 ký tự/dòng, mọi bố cục cột giá tiền vỡ hết. Nên chỉ nhân BỀ CAO —
// chữ cao gấp đôi, vẫn đúng 48 (hoặc 32) ký tự mỗi dòng.
const FONT_SCALE = {
  0: 0x00, // 1x1  — như cũ
  1: 0x01, // 1x2  — cao gấp đôi (mặc định mới)
  2: 0x02, // 1x3  — cao gấp ba
  3: 0x11, // 2x2  — to cả hai chiều, SỐ CỘT GIẢM MỘT NỬA
};

function fontScalePrefix(scale) {
  const n = FONT_SCALE[Math.max(0, Math.min(3, parseInt(scale) || 0))];
  return n ? Buffer.from([0x1d, 0x21, n]) : Buffer.alloc(0);
}

/**
 * Cỡ chữ cho một loại phiếu.
 *
 * TEM thì KHÔNG phóng to: tem 35–50mm đã chật, chữ cao gấp đôi là tràn khỏi mép
 * tem dán. Các phiếu còn lại (hóa đơn, phiếu bếp, chạy món, in thử) đi theo
 * `bill.fontScale` — chữ cao gấp đôi mà số cột giữ nguyên.
 */
const KHONG_PHONG_TO = new Set(['cup_label', 'product_label']);

function fontScaleFor(type, billCfg = {}) {
  if (KHONG_PHONG_TO.has(type)) return 0;
  const raw = billCfg.fontScale;
  // Mặc định 0 = cỡ chuẩn của máy in. Từng để 1 (cao gấp đôi) cho dễ đọc, nhưng
  // trên giấy thật chữ to quá mức và tốn giấy — cửa hàng yêu cầu giảm về như cũ
  // (04/08/2026, lặp lại cho Sunmi K57). Default phải là 0 để KHỚP với UI Cài đặt
  // (đang hiển thị "Chuẩn"). Ai muốn to hơn thì chỉnh trong Cài đặt → Bill & Tem.
  return Math.max(0, Math.min(3, raw == null ? 0 : (parseInt(raw) || 0)));
}

// ── ĐÁNH DẤU KIỂU CHỮ TRONG NỘI DUNG ────────────────────────────────────────
// Mẫu tem/phiếu do người dùng thiết kế có thuộc tính `bold` và `fontSize` cho
// từng dòng, nhưng bản render chỉ trả chuỗi phẳng nên hai thuộc tính đó bị vứt
// đi — thiết kế thế nào thì tem in ra vẫn một cỡ chữ nhỏ như nhau.
//
// Nay renderer chèn đánh dấu [[B1]]…[[B0]] (đậm) và [[S2]]…[[S0]] (cỡ chữ) vào
// chuỗi; mọi bộ dựng ESC/POS (server, agent.cjs, agent trong app) dịch sang
// lệnh máy in. Đánh dấu KHÔNG tính vào bề ngang dòng — layoutText() bóc chúng
// ra trước khi đo và căn cột.
// Thêm [[BC:dữ liệu]] = MÃ VẠCH 1D (Code128) và [[QR:dữ liệu]] = mã QR THẬT,
// dịch sang lệnh ESC/POS `GS k` / `GS ( k` — trước đây chỉ in chữ "[BARCODE ..]"
// nên tem in ra KHÔNG quét được. Dữ liệu không chứa ']' (mã hàng là số/chữ).
const MARK_RE = /\[\[(B[01]|S[0-3]|BC:[^\]]*|QR:[^\]]*)\]\]/g;

export function stripMarks(text = '') {
  return String(text ?? '').replace(MARK_RE, '');
}

// Mã vạch 1D Code128 (function B) — máy in nhiệt/tem nào cũng hỗ trợ. Canh giữa,
// chữ số người đọc in DƯỚI vạch (HRI below).
function code128Bytes(data) {
  const d = String(data).slice(0, 40);
  const chars = [...d].map(c => c.charCodeAt(0) & 0x7f);
  return [
    0x1b, 0x61, 0x01,          // ESC a 1: canh giữa
    0x1d, 0x48, 0x02,          // GS H 2: chữ số dưới vạch
    0x1d, 0x66, 0x00,          // GS f 0: font chữ số
    0x1d, 0x68, 80,            // GS h 80: cao 80 dots
    0x1d, 0x77, 0x02,          // GS w 2: rộng vạch
    0x1d, 0x6b, 0x49,          // GS k 73: CODE128
    chars.length + 2,          // n = dữ liệu + 2 ({B)
    0x7b, 0x42,                // {B: code set B
    ...chars,
    0x0a,                      // xuống dòng
    0x1b, 0x61, 0x00,          // ESC a 0: canh trái lại
  ];
}

// Mã QR thật (GS ( k, model 2).
function qrBytes(data) {
  const bytes = [...String(data).slice(0, 512)].map(c => c.charCodeAt(0) & 0xff);
  const store = 3 + bytes.length;
  return [
    0x1b, 0x61, 0x01,
    0x1d, 0x28, 0x6b, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00,   // model 2
    0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x43, 0x06,          // module size 6
    0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x45, 0x31,          // sửa lỗi M
    0x1d, 0x28, 0x6b, store & 0xff, (store >> 8) & 0xff, 0x31, 0x50, 0x30, ...bytes, // nạp dữ liệu
    0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30,          // in
    0x0a, 0x1b, 0x61, 0x00,
  ];
}

function markToBytes(tag) {
  // In đậm = ESC E (emphasized) KÈM ESC G (double-strike). Nhiều máy in nhiệt rẻ
  // để ESC E một mình chỉ đậm rất nhẹ, gần như chữ thường; thêm double-strike (in
  // đè 2 lượt) mới rõ là đậm. Máy không hỗ trợ 1 trong 2 lệnh thì bỏ qua, không hỏng.
  if (tag === 'B1') return [0x1b, 0x45, 0x01, 0x1b, 0x47, 0x01];
  if (tag === 'B0') return [0x1b, 0x45, 0x00, 0x1b, 0x47, 0x00];
  if (tag.startsWith('BC:')) return code128Bytes(tag.slice(3));
  if (tag.startsWith('QR:')) return qrBytes(tag.slice(3));
  const n = FONT_SCALE[Number(tag[1]) || 0] ?? 0x00;
  return [0x1d, 0x21, n];
}

/** Chuỗi có đánh dấu → byte, mã hoá phần chữ theo bộ mã của máy in. */
function encodeMarked(text, charset) {
  const parts = [];
  let last = 0;
  const src = String(text ?? '');
  for (const m of src.matchAll(MARK_RE)) {
    if (m.index > last) parts.push(encodeForPrinter(src.slice(last, m.index), charset));
    parts.push(Buffer.from(markToBytes(m[1])));
    last = m.index + m[0].length;
  }
  if (last < src.length) parts.push(encodeForPrinter(src.slice(last), charset));
  return Buffer.concat(parts);
}

// Buzzer máy in: ESC B n t = kêu n tiếng, mỗi tiếng t*100ms. Lệnh phổ biến trên
// máy in nhiệt Trung Quốc (Xprinter/Gprinter...); máy không hỗ trợ thì BỎ QUA,
// không hỏng. "tít tít tít" = 3 tiếng. Đặt trước lệnh cắt để bíp lúc bill ra.
const ESC_BUZZER = Buffer.from([0x1b, 0x42, 0x03, 0x02]);

function escposBuffer(text, {
  cut = true, drawer = false, density = '', charset = 'utf8', fontScale = 0,
  buzzer = false,
} = {}) {
  return Buffer.concat([
    ESC_INIT,
    ESC_RESET,
    charsetPrefix(charset),
    fontScalePrefix(fontScale),
    densityPrefix(density),
    encodeMarked(text, charset),
    Buffer.from('\n\n', 'latin1'),
    buzzer ? ESC_BUZZER : Buffer.alloc(0),
    drawer ? ESC_DRAWER : Buffer.alloc(0),
    cut ? ESC_CUT : Buffer.alloc(0),
  ]);
}

// Real reachability probe: opens a TCP socket to the printer (RAW/JetDirect
// port 9100 by default) and reports whether it actually answers. Cached briefly
// so the live status panel polling every few seconds doesn't hammer the network.
const lanProbeCache = new Map(); // "ip:port" -> { at, reachable }
const LAN_PROBE_TTL = 8000;

function probeLan(host, port, timeoutMs = 1200) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (reachable) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { socket.destroy(); } catch {}
      resolve(reachable);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    const socket = net.createConnection({ host, port: Number(port) || 9100 });
    socket.on('connect', () => finish(true));
    socket.on('error', () => finish(false));
  });
}

async function probeLanCached(host, port, force = false) {
  const key = `${host}:${Number(port) || 9100}`;
  const cached = lanProbeCache.get(key);
  if (!force && cached && Date.now() - cached.at < LAN_PROBE_TTL) return cached.reachable;
  const reachable = await probeLan(host, port);
  lanProbeCache.set(key, { at: Date.now(), reachable });
  return reachable;
}

function writeLan(host, port, buffer, timeoutMs = 4500) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port: Number(port) || 9100 });
    let done = false;
    const finish = (err) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      socket.destroy();
      err ? reject(err) : resolve();
    };
    const timer = setTimeout(() => finish(new Error(`Không kết nối được máy in LAN ${host}:${port}`)), timeoutMs);
    socket.on('connect', () => socket.write(buffer, (err) => err ? finish(err) : socket.end()));
    socket.on('close', () => finish());
    socket.on('error', finish);
  });
}

// Gửi NGUYÊN BYTE (datatype RAW) xuống spooler Windows.
//
// VÌ SAO PHẢI RAW: Out-Printer đưa văn bản cho DRIVER Windows tự dàn trang và
// vẽ chữ thành ảnh xám có khử răng cưa. Máy in nhiệt chỉ in được đen/trắng nên
// nó phải "rải hạt" ảnh xám đó ra → chữ RẤT MỜ, lem, sai bề ngang, và mọi lệnh
// ESC/POS (độ đậm, cắt giấy, mở két) bị nuốt vì driver coi chúng là văn bản.
// Sự cố thật 2026-07-30: phiếu in thử ra chữ mờ đến mức khó đọc trên POS-80C.
// RAW đi thẳng tới firmware máy in, đúng đường mà máy in nhiệt được thiết kế.
const RAW_PRINT_PS = `
$ErrorActionPreference='Stop'
Add-Type -Namespace DanDPak -Name Spool -MemberDefinition @'
[DllImport("winspool.drv", CharSet=CharSet.Unicode, SetLastError=true)]
public static extern bool OpenPrinter(string src, out IntPtr hPrinter, IntPtr pd);
[DllImport("winspool.drv", SetLastError=true)]
public static extern bool ClosePrinter(IntPtr hPrinter);
[DllImport("winspool.drv", CharSet=CharSet.Unicode, SetLastError=true)]
public static extern bool StartDocPrinter(IntPtr hPrinter, int level, [In] ref DOCINFO di);
[DllImport("winspool.drv", SetLastError=true)]
public static extern bool EndDocPrinter(IntPtr hPrinter);
[DllImport("winspool.drv", SetLastError=true)]
public static extern bool StartPagePrinter(IntPtr hPrinter);
[DllImport("winspool.drv", SetLastError=true)]
public static extern bool EndPagePrinter(IntPtr hPrinter);
[DllImport("winspool.drv", SetLastError=true)]
public static extern bool WritePrinter(IntPtr hPrinter, byte[] buf, int count, out int written);
[StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
public struct DOCINFO { [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
  [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
  [MarshalAs(UnmanagedType.LPWStr)] public string pDataType; }
'@
$bytes = [System.IO.File]::ReadAllBytes($env:DDP_JOB_FILE)
$h = [IntPtr]::Zero
if (-not [DanDPak.Spool]::OpenPrinter($env:DDP_PRINTER, [ref]$h, [IntPtr]::Zero)) {
  throw "Khong mo duoc may in: $env:DDP_PRINTER" }
try {
  $di = New-Object DanDPak.Spool+DOCINFO
  $di.pDocName = 'Dan-D Pak'
  $di.pDataType = 'RAW'
  if (-not [DanDPak.Spool]::StartDocPrinter($h, 1, [ref]$di)) { throw 'StartDocPrinter that bai' }
  try {
    [void][DanDPak.Spool]::StartPagePrinter($h)
    $written = 0
    if (-not [DanDPak.Spool]::WritePrinter($h, $bytes, $bytes.Length, [ref]$written)) {
      throw 'WritePrinter that bai' }
    if ($written -ne $bytes.Length) { throw "Chi gui duoc $written/$($bytes.Length) byte" }
    [void][DanDPak.Spool]::EndPagePrinter($h)
  } finally { [void][DanDPak.Spool]::EndDocPrinter($h) }
} finally { [void][DanDPak.Spool]::ClosePrinter($h) }
`;

async function writeSystemPrinterRaw(name, buffer) {
  const dir = mkdtempSync(join(tmpdir(), 'dandpak-raw-'));
  const file = join(dir, 'job.bin');
  writeFileSync(file, buffer);
  try {
    await execFileAsync('powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', RAW_PRINT_PS],
      {
        timeout: 15000, windowsHide: true,
        env: { ...process.env, DDP_JOB_FILE: file, DDP_PRINTER: String(name || '') },
      });
  } finally {
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  }
}

async function writeSystemPrinter(name, text, {
  raw = false, drawer = false, density = '', charset = 'utf8', fontScale = 0,
  buzzer = false,
} = {}) {
  const safeName = String(name || '').replace(/[^a-zA-Z0-9\s\-_\\]/g, '');

  // Máy in nhiệt (raw): gửi nguyên byte ESC/POS. Tên máy in Windows có thể chứa
  // dấu tiếng Việt nên đường RAW dùng tên GỐC, không đi qua bộ lọc ký tự.
  if (raw) {
    const buffer = escposBuffer(text, { drawer, density, charset, fontScale, buzzer });
    if (process.platform === 'win32') {
      await writeSystemPrinterRaw(name, buffer);
      return;
    }
    const rawDir = mkdtempSync(join(tmpdir(), 'dandpak-raw-'));
    const rawFile = join(rawDir, 'job.bin');
    writeFileSync(rawFile, buffer);
    try {
      // CUPS: -o raw đẩy thẳng byte, không qua bộ lọc dàn trang.
      await execFileAsync('lp', ['-d', safeName, '-o', 'raw', rawFile], { timeout: 12000 });
    } finally {
      try { rmSync(rawDir, { recursive: true, force: true }); } catch {}
    }
    return;
  }

  // Máy in A4 qua driver (báo cáo): giữ nguyên đường cũ. Driver Windows tự lo
  // phông chữ nên giữ NGUYÊN tiếng Việt, chỉ bóc đánh dấu kiểu chữ ESC/POS ra.
  const dir = mkdtempSync(join(tmpdir(), 'dandpak-print-'));
  const file = join(dir, 'job.txt');
  writeFileSync(file, stripMarks(text) + '\n', 'utf8');
  try {
    if (process.platform === 'win32') {
      await execFileAsync('powershell.exe', [
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command',
        `Get-Content -Raw -LiteralPath ${JSON.stringify(file)} | Out-Printer -Name ${JSON.stringify(safeName)}`,
      ], { timeout: 12000, windowsHide: true });
    } else {
      await execFileAsync('lp', ['-d', safeName, file], { timeout: 12000 });
    }
  } finally {
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  }
}

/** Tuyến này in máy in nhiệt (ESC/POS) hay máy in A4 qua driver? */
function isThermal(printer = {}) {
  return String(printer.output || '') !== 'report';
}

function patchJob(id, fields = {}) {
  const keys = Object.keys(fields);
  if (!keys.length) return getJob(id);
  const sets = keys.map(k => `${k}=?`).join(',');
  db.prepare(`UPDATE print_jobs SET ${sets} WHERE id=?`).run(...keys.map(k => fields[k]), id);
  return getJob(id);
}

function publicJob(j) {
  if (!j) return null;
  const payload = j.payload || parsePayload(j.payload_json);
  const meta = jobMeta({ ...j, payload });
  return { ...j, payload, meta };
}

export function getJob(id) {
  return publicJob(db.prepare(`SELECT * FROM print_jobs WHERE id=?`).get(id));
}

export function getJobForBranch(id, branch_id = 'sala') {
  const job = getJob(id);
  if (!job) return null;
  if (job.branch_id !== branch_id) throw new Error('Print job không thuộc chi nhánh hiện tại');
  return job;
}

export function createJob({ printer, type, title, payload, branch_id = 'sala', reprint_of = null, idempotency_key = null }) {
  const semanticKey = String(idempotency_key || '').trim() || null;
  if (semanticKey) {
    const existing = db.prepare(`SELECT id FROM print_jobs WHERE idempotency_key=?`).get(semanticKey);
    if (existing) return getJob(existing.id);
  }
  const id = uid('pj_');
  db.prepare(`
    INSERT INTO print_jobs (id,branch_id,printer,type,title,payload_json,status,created_at,reprint_of,attempts,idempotency_key)
    VALUES (?,?,?,?,?,?,'queued',?,?,0,?)
  `).run(id, branch_id, printer, type, title || '', JSON.stringify(payload || {}), now(), reprint_of, semanticKey);
  const job = getJob(id);
  emit('print:new', job, branch_id);
  const p = printerById(printer, branch_id);
  // Ở chế độ 'agent', server (trên VPS) KHÔNG tự in — chỉ xếp hàng + emit;
  // Hardware Agent tại cửa hàng nhận job và in trên máy in LAN/USB tại chỗ.
  if (env.PRINT_DISPATCH !== 'agent' &&
      p?.active !== false && p?.auto && p?.connection && p.connection !== 'browser') {
    setTimeout(() => dispatchJob(id, branch_id).catch((e) => {
      // Trước đây nuốt lỗi hoàn toàn — 1 job kẹt do lỗi dispatch (không phải lỗi
      // in vật lý, cái đó đã có nhánh catch riêng ghi log/emit print:failed) sẽ
      // không để lại dấu vết nào để biết mà kiểm tra.
      logSystem({
        level: 'warn', source: 'printer', eventType: 'print_dispatch_error',
        title: `Không tự động gửi job in được: ${id}`,
        message: e?.message || String(e), branchId: branch_id,
        action: 'print:dispatch', extra: { job: id, printer },
      });
    }), 25);
  }
  return job;
}

/// In TEM MÃ sản phẩm (nút "In tem mã" trong Kho hàng): tìm máy in tem đã
/// cấu hình (output product_label, fallback cup_label/tên có "tem"), tạo
/// [copies] job type 'product_label' — Hardware Agent/máy in local sẽ in.
export function printProductLabel(branch_id = 'sala', { sku_id = '', sku = {}, copies = 1 } = {}) {
  if (sku_id && !sku.name) {
    sku = db.prepare(`SELECT id, name, code, barcode, price FROM skus WHERE id=?`).get(String(sku_id)) || {};
    if (!sku.id) {
      const e = new Error('Không tìm thấy sản phẩm để in tem');
      e.status = 404;
      throw e;
    }
  }
  const printers = printerRows(branch_id);
  const byOutput = (out) => printers.find(p => p.active !== false && p.output === out);
  const printer = byOutput('product_label') ||
      byOutput('cup_label') ||
      printers.find(p => p.active !== false &&
          /tem|label/i.test(`${p.id} ${p.name} ${p.type}`));
  if (!printer) {
    const e = new Error('Chưa cấu hình máy in tem — thêm máy in loại "Tem nhãn" trong Cài đặt');
    e.status = 400;
    throw e;
  }
  const n = Math.max(1, Math.min(30, parseInt(copies) || 1));
  const name = String(sku.name || '');
  const payload = {
    itemName: name,
    code: String(sku.code || ''),
    barcode: String(sku.barcode || sku.code || ''),
    price: sku.price ? `${Math.round(Number(sku.price) || 0).toLocaleString('vi-VN')}d` : '',
    qty: 1,
  };
  const jobs = [];
  for (let i = 0; i < n; i++) {
    jobs.push(createJob({
      printer: printer.id,
      type: 'product_label',
      title: `Tem: ${name}`.slice(0, 120),
      payload: { ...payload, copy: n > 1 ? `${i + 1}/${n}` : '' },
      branch_id,
    }));
  }
  return { ok: true, printer: printer.id, jobs: jobs.length };
}

// Chọn máy in TEM cho tem vận đơn: ưu tiên máy khai output tem, rồi tên có
// "tem/label", cuối cùng máy in cắm thẳng máy đang bấm. KHÔNG rơi về máy in hóa
// đơn để tránh nhả waybill ra máy in bill.
function resolveLabelPrinter(branch_id, deviceId = '') {
  const printers = printerRows(branch_id).filter(p => p.active !== false);
  const byOutput = (out) => printers.find(p => p.output === out);
  return byOutput('shipping_label') || byOutput('product_label') || byOutput('cup_label')
    || printers.find(p => /tem|label|van don|vận đơn|waybill/i.test(`${p.id} ${p.name} ${p.type}`))
    || (deviceId ? printers.find(p => isAttachedTo(p, deviceId, deviceOwnPrinterNames(branch_id, deviceId))) : null)
    || null;
}

/// In TEM VẬN ĐƠN cho một đơn Retail Online. size: '100x150' (mặc định) hoặc
/// '76x130'. Dựng payload waybill từ orders + external_orders + order_items,
/// KHÔNG import online.js (tránh vòng phụ thuộc: online.js đã import printing.js).
export function printShippingLabel(branch_id = 'sala', { order_id = '', size = '100x150', copies = 1, deviceId = '' } = {}) {
  const order = db.prepare(`SELECT * FROM orders WHERE id=? AND branch_id=? AND channel='online'`).get(String(order_id), branch_id);
  if (!order) { const e = new Error('Không tìm thấy đơn Retail Online để in tem.'); e.status = 404; throw e; }
  const ext = db.prepare(`SELECT * FROM external_orders WHERE internal_order_id=? ORDER BY updated_at DESC, created_at DESC LIMIT 1`).get(order.id) || {};
  let raw = {}; try { raw = ext.raw_payload ? JSON.parse(ext.raw_payload) : {}; } catch { raw = {}; }
  let customer = {}; try { customer = order.customer_json ? JSON.parse(order.customer_json) : {}; } catch { customer = {}; }
  const items = db.prepare(`SELECT name, qty FROM order_items WHERE order_id=? ORDER BY created_at, id`).all(order.id);
  const cfg = getPrintConfig(branch_id) || {};
  const header = cfg.bill || {};
  const shipping = raw.shipping_address || {};
  const fulfillments = Array.isArray(raw.fulfillments) ? raw.fulfillments : [];
  const tracking = fulfillments.flatMap(x => x.tracking_numbers || (x.tracking_number ? [x.tracking_number] : []))
    .filter(Boolean).map(String);
  const providerName = {
    haravan: 'HARAVAN', shopee: 'SHOPEE', tiktokshop: 'TIKTOK SHOP', lazada: 'LAZADA', tiki: 'TIKI', website: 'WEBSITE',
  }[String(ext.provider || order.online_channel || '').toLowerCase()] || String(ext.provider || order.online_channel || 'ONLINE');
  const paid = order.status === 'paid';
  const paperWidthMm = String(size).startsWith('76') ? 76 : 100;
  const payload = {
    paperWidthMm,
    provider: ext.provider || order.online_channel || 'online',
    providerLabel: providerName,
    shopName: header.shopName || header.name || '',
    carrier: fulfillments[0]?.tracking_company || raw.shipping_lines?.[0]?.title || '',
    trackingNumber: tracking[0] || ext.external_order_code || order.online_ref || '',
    orderCode: ext.external_order_code || order.online_ref || order.bill_no || '',
    receiver: {
      name: customer.name || raw.customer?.name || shipping.name || '',
      phone: customer.phone || raw.phone || shipping.phone || '',
      address: customer.address || [shipping.address1, shipping.ward, shipping.district, shipping.city]
        .filter(Boolean).join(', '),
    },
    sender: {
      name: header.shopName || header.name || 'Dan-D Pak',
      phone: header.phone || header.hotline || '',
      address: header.address || '',
    },
    items: items.map(it => ({ name: it.name, qty: it.qty })),
    codAmount: paid ? 0 : Number(order.total || 0),
    weight: raw.total_weight || raw.weight || '',
    note: customer.note || raw.note || '',
  };
  const printer = resolveLabelPrinter(branch_id, deviceId);
  if (!printer) {
    const e = new Error('Chưa cấu hình máy in tem — thêm máy in loại "Tem nhãn" trong Cài đặt máy in.');
    e.status = 400; throw e;
  }
  const n = Math.max(1, Math.min(10, parseInt(copies) || 1));
  const jobs = [];
  for (let i = 0; i < n; i++) {
    jobs.push(createJob({
      printer: printer.id,
      type: 'shipping_label',
      title: `Tem VĐ: ${payload.orderCode}`.slice(0, 120),
      payload: { ...payload, copy: n > 1 ? `${i + 1}/${n}` : '' },
      branch_id,
    }));
  }
  audit('online.shipping_label.print', { order_id: order.id, size, copies: n, printer: printer.id }, branch_id);
  return { ok: true, printer: printer.id, jobs: jobs.length, size };
}

// IN PHIẾU CHI — in trên máy in hóa đơn (như bill). Nhận expense_id thật hoặc
// 'drawer:<id>' (chi tiền mặt tạo từ POS).
export function printExpenseVoucher(branch_id = 'sala', { expense_id = '', deviceId = '', copies = 1 } = {}) {
  const sid = String(expense_id);
  let e;
  if (sid.startsWith('drawer:')) {
    const de = db.prepare(`SELECT * FROM cash_drawer_entries WHERE id=? AND branch_id=? AND kind='expense'`).get(sid.slice(7), branch_id);
    if (!de) { const err = new Error('Không tìm thấy khoản chi.'); err.status = 404; throw err; }
    e = { code: '', actor_name: de.actor_name, expense_date: de.occurred_at,
      category_name: 'Chi từ két', payee_name: de.counterparty, note: de.reason || de.product, amount: de.amount };
  } else {
    e = db.prepare(`SELECT * FROM expenses WHERE id=? AND branch_id=?`).get(sid, branch_id);
    if (!e) { const err = new Error('Không tìm thấy khoản chi.'); err.status = 404; throw err; }
  }
  const cfg = getPrintConfig(branch_id) || {};
  const header = cfg.bill || {};
  const payload = {
    shopName: header.shopName || header.name || 'Dan-D Pak',
    address: header.address || '', phone: header.phone || header.hotline || '',
    code: e.code || '', payer: e.actor_name || '', datetime: e.expense_date,
    reason: e.note || e.category_name || 'Chi phí', payee: e.payee_name || '',
    item: e.category_name || e.note || 'Chi phí',
    unitPrice: Number(e.amount || 0), qty: 1,
    amount: Number(e.amount || 0), total: Number(e.amount || 0),
  };
  const printer = resolveReceiptPrinter(branch_id, { deviceId });
  if (!printer) { const err = new Error('Chưa cấu hình máy in hóa đơn để in phiếu chi.'); err.status = 400; throw err; }
  const n = Math.max(1, Math.min(5, parseInt(copies) || 1));
  const jobs = [];
  for (let i = 0; i < n; i++) {
    jobs.push(createJob({ printer: printer.id, type: 'expense_voucher',
      title: `Phiếu chi ${payload.code || ''}`.trim().slice(0, 120), payload, branch_id }));
  }
  audit('expense.voucher.print', { expense_id: sid, printer: printer.id, copies: n }, branch_id);
  return { ok: true, printer: printer.id, jobs: jobs.length };
}

// In PHIẾU TRẢ HÀNG cho một return (order_returns) — nhiều dòng món + tổng hoàn.
export function printReturnVoucher(branch_id = 'sala', { return_id = '', deviceId = '', copies = 1 } = {}) {
  const rid = String(return_id);
  const ret = db.prepare(`SELECT * FROM order_returns WHERE id=? AND branch_id=?`).get(rid, branch_id);
  if (!ret) { const err = new Error('Không tìm thấy phiếu trả hàng.'); err.status = 404; throw err; }
  const items = db.prepare(`SELECT name,qty,unit_price,amount FROM order_return_items WHERE return_id=?`).all(rid);
  const order = db.prepare(`SELECT bill_no FROM orders WHERE id=?`).get(ret.original_order_id);
  const cfg = getPrintConfig(branch_id) || {};
  const header = cfg.bill || {};
  const payload = {
    shopName: header.shopName || header.name || 'Dan-D Pak',
    address: header.address || '', phone: header.phone || header.hotline || '',
    code: order?.bill_no || ret.original_order_id,
    datetime: ret.created_at, actor: ret.created_by || '', approvedBy: ret.approved_by || '',
    items: items.map(it => ({ name: it.name, qty: it.qty, unitPrice: it.unit_price, amount: it.amount })),
    total: Number(ret.refund_total || 0),
    refundMethod: ret.refund_method === 'original' ? 'Theo phương thức gốc' : ret.refund_method,
  };
  const printer = resolveReceiptPrinter(branch_id, { deviceId });
  if (!printer) { const err = new Error('Chưa cấu hình máy in hóa đơn để in phiếu trả hàng.'); err.status = 400; throw err; }
  const n = Math.max(1, Math.min(5, parseInt(copies) || 1));
  const jobs = [];
  for (let i = 0; i < n; i++) {
    jobs.push(createJob({ printer: printer.id, type: 'return_voucher',
      title: `Phiếu trả hàng ${payload.code || ''}`.trim().slice(0, 120), payload, branch_id }));
  }
  audit('retail.return.voucher.print', { return_id: rid, printer: printer.id, copies: n }, branch_id);
  return { ok: true, printer: printer.id, jobs: jobs.length };
}

export function listJobs(branch_id = 'sala', query = {}) {
  const limit = Math.max(1, Math.min(300, parseInt(query.limit || query) || 120));
  return db.prepare(`SELECT * FROM print_jobs WHERE branch_id=? ORDER BY created_at DESC LIMIT ?`).all(branch_id, limit).map(publicJob);
}

// print_jobs tăng vô hạn (mỗi lần in = 1 dòng, payload_json to). Dọn định kỳ để
// bảng không phình → truy vấn danh sách/agent-poll luôn nhanh. Job >30 ngày là rác
// (kể cả còn 'queued' thì máy in đã offline cả tháng). Mirror maintainSystemLogs.
export function maintainPrintJobs({ days = 30, maxRows = 50_000 } = {}) {
  try {
    const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
    const byAge = db.prepare(`DELETE FROM print_jobs WHERE created_at < ?`).run(cutoff).changes;
    let byCount = 0;
    const total = db.prepare(`SELECT COUNT(*) n FROM print_jobs`).get().n;
    if (total > maxRows) {
      byCount = db.prepare(
        `DELETE FROM print_jobs WHERE id IN (
           SELECT id FROM print_jobs ORDER BY created_at ASC LIMIT ?)`
      ).run(total - maxRows).changes;
    }
    return { removedByAge: byAge, removedByCount: byCount };
  } catch {
    return { removedByAge: 0, removedByCount: 0 };
  }
}

export async function listPrinters(branch_id = 'sala', {
  live = false, force = false, deviceId = '', scope = 'all',
} = {}) {
  const configured = printerRows(branch_id);
  const agentMode = env.PRINT_DISPATCH === 'agent';

  // Máy in cắm thẳng: TRẠNG THÁI LẤY TỪ AGENT, không cần `live`.
  // Trước đây khi thiếu live=1 thì mọi tuyến trả về 'ready'/online:true vô điều
  // kiện — nên tablet luôn thấy "Sẵn sàng" dù máy POS còn chưa mở app, bấm In thử
  // thì lệnh nằm chờ tới lúc mở máy in mới ra giấy. getAgentDevices() đọc Map
  // trong RAM (không I/O) nên soi được thật mà vẫn nhẹ như cũ.
  const devices = agentMode ? getAgentDevices(branch_id) : [];
  const ownerByName = new Map(); // tên máy in (lower) -> { device, printer }
  for (const d of devices) {
    for (const sp of d.printers || []) {
      const key = String(sp.name || '').trim().toLowerCase();
      if (!key || ownerByName.has(key)) continue;
      ownerByName.set(key, { device: d, printer: sp });
    }
  }
  const me = String(deviceId || '').trim();
  const myNames = me ? deviceOwnPrinterNames(branch_id, me) : new Set();

  const system = !agentMode && live && configured.some(p => (p.connection || 'browser') === 'system')
    ? await listSystemPrinters({ force, branch: branch_id }).catch(() => [])
    : [];
  const systemMap = new Map(system.map(p => [String(p.name || '').toLowerCase(), p]));

  const rows = await Promise.all(configured.map(async p => {
    const connection = p.connection || 'browser';
    const key = printerKey(p);
    const owner = connection === 'system' ? ownerByName.get(key) : null;
    const match = systemMap.get(key) || owner?.printer || null;
    const target = printerTarget(p);
    const attachedToMe = isAttachedTo(p, deviceId, myNames);

    // status: machine-readable (kept backward compatible with Printer Monitor).
    // state: pill colour for the live panel. statusText: human label, real-data.
    let status = 'ready', state = 'ok', statusText = '';
    let online = false;

    if (p.active === false) {
      status = 'disabled'; state = 'warn'; statusText = 'Tạm tắt'; online = false;
    } else if (connection === 'system' && agentMode) {
      // Nguồn sự thật duy nhất: máy POS đang cắm máy in này có đang chạy app/agent?
      const name = p.systemName || p.name || '';
      if (!name) {
        status = 'not_configured'; state = 'bad'; statusText = 'Chưa chọn máy in trên máy POS'; online = false;
      } else if (!owner) {
        status = 'offline'; state = 'bad'; online = false;
        statusText = `Máy POS chưa mở app · không thấy "${name}"`;
      } else if (owner.printer.online === false) {
        status = 'offline'; state = 'bad'; online = false;
        statusText = `Máy in tắt / ngoại tuyến · ${owner.device.device_name}`;
      } else {
        status = 'ready'; state = 'ok'; online = true;
        statusText = `Đã kết nối · ${owner.device.device_name}`;
      }
    } else if (!live) {
      status = 'ready'; state = 'ok'; statusText = 'Chưa kiểm tra live'; online = true;
    } else if (connection === 'lan') {
      if (!p.ip) {
        status = 'not_configured'; state = 'bad'; statusText = 'Chưa nhập IP máy in LAN'; online = false;
      } else {
        const reachable = await probeLanCached(p.ip, p.port, force);
        online = reachable;
        status = reachable ? 'ready' : 'offline';
        state = reachable ? 'ok' : 'bad';
        statusText = reachable
          ? `Đã kết nối · ${p.ip}:${p.port || 9100}`
          : `Không phản hồi · ${p.ip}:${p.port || 9100}`;
      }
    } else if (connection === 'system') {
      const name = p.systemName || p.name || '';
      if (!name) {
        status = 'not_configured'; state = 'bad'; statusText = 'Chưa chọn máy in trên máy chủ'; online = false;
      } else if (!match) {
        status = 'offline'; state = 'bad'; statusText = `Không thấy "${name}" trên máy chủ`; online = false;
      } else if (match.online === false) {
        status = 'offline'; state = 'bad'; statusText = `Máy in tắt / ngoại tuyến · ${name}`; online = false;
      } else {
        status = 'ready'; state = 'ok'; statusText = `Đã kết nối · ${name}`; online = true;
      }
    } else {
      // browser: printing happens through the operator's print dialog.
      status = 'ready'; state = 'ok'; statusText = 'In qua trình duyệt'; online = true;
    }

    return {
      ...p, connection, target, online, status, state, statusText,
      system: match || null,
      // MÁY NÀO đang cắm tuyến này — để app hiện đúng "của máy nào" và để
      // chặn máy khác thao tác (xem assertPrinterUsableBy).
      owner_device_id: owner?.device.device_id || '',
      owner_device_name: owner?.device.device_name || '',
      attached_to_me: attachedToMe,
    };
  }));

  // Phạm vi 'device' — dùng cho người KHÔNG có quyền quản lý máy in (VD thu ngân
  // chỉ có quyền 'pay'). Chỉ thấy đúng những tuyến họ ĐƯỢC PHÉP thao tác:
  //   - máy in cắm THẲNG vào máy của họ, và
  //   - máy in LAN (thiết bị dùng chung trên mạng, không thuộc riêng máy nào).
  // Chốt này phải khớp CHÍNH XÁC với assertPrinterUsableBy — nếu danh sách hẹp
  // hơn quyền thao tác thì sinh ra tuyến "dùng được mà không thấy"; nếu rộng hơn
  // thì lại lộ máy in của máy khác (đúng lỗi đang phải sửa).
  if (scope === 'device') {
    return rows.filter(r => r.attached_to_me || r.connection === 'lan');
  }
  return rows;
}

/** Ai được coi là người QUẢN LÝ máy in (thấy hết + thao tác mọi tuyến). */
export function canManagePrinters(user, canUser) {
  if (!user) return false;
  if (user.role === 'owner') return true;
  return ['settings.manage', 'settings.printers', 'settings.connections', 'settings.print']
    .some(perm => canUser(user, perm));
}

/**
 * Chặn thao tác chéo máy: người KHÔNG quản lý máy in chỉ được bấm In thử / mở két
 * trên tuyến cắm thẳng vào máy của chính họ. Trước đây ai vào được danh mục "Máy in"
 * (kể cả chỉ có quyền 'pay') cũng in thử được lên máy in của máy POS khác.
 */
export function assertPrinterUsableBy(printerId, branch_id, { privileged = false, deviceId = '' } = {}) {
  const printer = printerById(printerId, branch_id);
  if (!printer) {
    const e = new Error('Máy in chưa được cấu hình');
    e.status = 404;
    throw e;
  }
  if (privileged) return printer;
  const connection = printer.connection || 'browser';
  // Tuyến LAN dùng chung trên mạng → không thuộc riêng máy nào, vẫn cho dùng.
  if (connection !== 'system') return printer;
  const me = String(deviceId || '').trim();
  if (me && isAttachedTo(printer, me, deviceOwnPrinterNames(branch_id, me))) return printer;
  const e = new Error('Máy in này không cắm vào máy bạn đang dùng — chỉ Quản lý/Admin thao tác được từ máy khác.');
  e.status = 403;
  throw e;
}

export function jobMeta(job) {
  const p = job.payload || {};
  const items = Array.isArray(p.items) ? p.items : [];
  const first = items[0] || {};
  const table = p.table || p.table_code || p.tableCode || '';
  const ref = p.order_no || p.number || p.order_id || p.ref || '';
  return {
    action: TYPE_LABEL[job.type] || job.type || 'Job in',
    table,
    ref,
    station: p.station || job.printer || '',
    item_count: items.length || (p.itemName || p.name ? 1 : 0),
    item_preview: items.length ? `${first.qty || 1}x ${first.name || ''}` : (p.itemName || p.name || job.title || ''),
    amount: p.total || p.amount || null,
  };
}

export async function dispatchJob(id, branch_id = 'sala', { force = false } = {}) {
  let job = getJob(id);
  if (!job) throw new Error('Print job không tồn tại');
  if (job.branch_id !== branch_id) throw new Error('Print job không thuộc chi nhánh hiện tại');
  if (!force && job.status === 'printed') return job;
  const printer = printerForJob(job.printer, branch_id);
  if (!printer) throw new Error(`Chưa cấu hình tuyến máy in ${job.printer}`);
  if (printer.active === false) throw new Error(`Tuyến máy in ${printer.label || printer.id} đang tắt`);
  const connection = printer.connection || 'browser';
  const target = printerTarget(printer);

  // Chế độ agent: server nằm trên VPS, KHÔNG với tới máy in trong cửa hàng. Nút
  // "In ngay" (retail gọi sau thanh toán qua /print/jobs/:id/print) mà cứ in từ
  // server thì luôn thất bại → job bị đánh 'failed' oan rồi agent mới thử lại,
  // nên bill ra chậm và lịch sử in đầy lỗi giả. Đúng việc phải làm là ĐẨY LẠI
  // HÀNG ĐỢI và bỏ giữ chỗ để agent tại chỗ nhận ngay nhịp poll kế tiếp (1.5s).
  if (env.PRINT_DISPATCH === 'agent' && (connection === 'lan' || connection === 'system')) {
    job = patchJob(id, {
      status: 'queued', error: null, transport: connection, target,
      claimed_by: null, claimed_at: null,
    });
    emit('print:new', job, branch_id);
    return job;
  }

  const text = renderJobText(job);
  patchJob(id, {
    status: 'printing',
    attempts: Number(job.attempts || 0) + 1,
    last_attempt_at: now(),
    error: null,
    transport: connection,
    target,
  });
  try {
    const billCfg = getPrintConfig(branch_id)?.bill || {};
    // Buzzer: máy in KÊU khi nhả hóa đơn (yêu cầu cửa hàng). Chỉ cho phiếu bán
    // hàng (receipt), và cho tắt bằng cấu hình bill.buzzer=false. Máy in không có
    // loa thì lệnh ESC B bị bỏ qua, không hỏng.
    const kieuChu = {
      charset: charsetOf(printer),
      fontScale: fontScaleFor(job.type, billCfg),
      buzzer: job.type === 'receipt' && billCfg.buzzer !== false && billCfg.buzzer !== '0',
    };
    if (connection === 'lan') {
      if (!printer.ip) throw new Error('Thiếu IP máy in LAN');
      await writeLan(printer.ip, printer.port || 9100, escposBuffer(text, {
        drawer: printer.openDrawerOnPrint && job.type === 'receipt',
        density: billCfg.printDensity,
        ...kieuChu,
      }));
    } else if (connection === 'system') {
      const name = printer.systemName || printer.name;
      if (!name) throw new Error('Thiếu tên máy in hệ điều hành');
      await writeSystemPrinter(name, text, {
        raw: isThermal(printer),
        drawer: printer.openDrawerOnPrint && job.type === 'receipt',
        density: billCfg.printDensity,
        ...kieuChu,
      });
    } else {
      throw new Error('Tuyến này đang để chế độ Trình duyệt, cần mở chi tiết để in bằng hộp thoại hệ thống');
    }
    job = patchJob(id, { status: 'printed', printed_at: now(), printed_by: 'server', error: null });
    emit('print:done', job, branch_id);
    audit('print.printed', { job: id, printer: job.printer, type: job.type, transport: connection, target }, branch_id);
    return job;
  } catch (e) {
    job = patchJob(id, { status: 'failed', error: e.message || String(e) });
    emit('print:failed', job, branch_id);
    logSystem({
      level: 'error', source: 'printer', eventType: 'print_failed',
      title: `In thất bại trên tuyến ${printer?.label || job.printer || '?'}`,
      message: job.error, branchId: branch_id,
      action: `print:${job.type}`, extra: { job: id, transport: connection, target },
    });
    throw e;
  }
}

// ── Hardware Agent (mô hình VPS trung tâm) ─────────────────────────────────
// Agent chạy tại cửa hàng: hỏi job đang chờ, in vật lý, báo lại kết quả.

// Các job cần agent in (tuyến lan/system, chưa in xong). Bao gồm cả 'failed'
// gần đây để agent tự thử lại sau khi máy in bị kẹt/tắt rồi bật lại.
// Hàng đợi agent TỪNG BỊ TẮC VĨNH VIỄN: quét cũ-nhất-trước rồi mới lọc, nên job
// trỏ tới tuyến in ĐÃ BỊ XOÁ khỏi cấu hình không giải được nhưng vẫn nằm
// 'queued' và chiếm hết cửa sổ quét. Gặp thật: 96 job cũ trỏ tuyến kitchen/bill/
// bar/runner (đã xoá khi cửa hàng đổi sang 1 tuyến "POS 2") che mất 2 job in thử
// mới nhất → thu ngân bấm "In thử" thấy báo đã gửi mà máy in im lặng cả tháng.
//
// Hai lớp chống tắc:
//   1. Quét rộng hơn số job cần trả, để vài job hỏng không bịt được đường.
//   2. Job có tuyến in KHÔNG CÒN trong cấu hình → chuyển 'cancelled' (trạng thái
//      cuối) vì nó không bao giờ in được nữa. Tuyến còn nhưng đang TẮT thì giữ
//      nguyên 'queued' — bật lại là in tiếp.
const AGENT_SCAN_WINDOW = 300;
// Giữ chỗ hết hạn sau 60s: agent chết giữa chừng thì job phải quay lại hàng đợi
// cho máy khác, chứ không kẹt vĩnh viễn.
const AGENT_CLAIM_TTL_MS = 60_000;

// Báo hỏng bao nhiêu lần thì đổi sang máy in kế tiếp trong chuỗi ưu tiên.
// Agent tại chỗ đã tự thử lại (kèm cooldown) trước khi báo về, nên 2 lần báo
// hỏng là đủ kết luận máy in đó đang không dùng được.
const AGENT_FAILOVER_AFTER = 2;

// ── PHIẾU QUÁ HẠN THÌ KHÔNG TỰ IN NỮA ───────────────────────────────────────
// SỰ CỐ THẬT (03/08/2026 12:52 → sáng 04/08): thu ngân kéo bill trên máy POS
// cầm tay lúc nửa đêm, máy in không ra giấy (app đóng / máy in tắt). Job nằm
// nguyên 'queued'. Sáng hôm sau vừa bật máy in và mở app là agent lấy đúng job
// đó ra in — một tờ hóa đơn của ca hôm trước tự chui ra, không ai gọi.
//
// Phiếu bán hàng có TÍNH THỜI ĐIỂM: khách đã về từ lâu, tờ giấy in ra lúc này
// vô nghĩa và còn gây nhầm lẫn sổ sách. Quá hạn thì đánh dấu 'expired' (trạng
// thái cuối) và để người dùng chủ động bấm In lại nếu thật sự cần.
//
// Ngưỡng theo loại phiếu: phiếu bếp/chạy món hết giá trị sau vài phút, hóa đơn
// thì rộng tay hơn để một lần kẹt giấy 20-30 phút vẫn in được.
const JOB_TTL_MIN = {
  kitchen_ticket: 20,
  runner: 20,
  cup_label: 30,
  product_label: 60,
  shipping_label: 120,
  receipt: 45,
  cash_drawer: 5,
};
// In thử phải in được BẤT KỂ tạo lúc nào — nó là công cụ để soi máy in, người
// đứng máy vừa bấm xong là chờ giấy ra.
const JOB_TTL_MIEN_TRU = new Set(['test']);

function jobQuaHan(type, createdAt) {
  if (JOB_TTL_MIEN_TRU.has(type)) return false;
  const phut = JOB_TTL_MIN[type];
  if (!phut) return false;
  const t = Date.parse(createdAt || '');
  if (!Number.isFinite(t)) return false;
  return Date.now() - t > phut * 60_000;
}

export function pendingAgentJobs(branch_id = 'sala', { limit = 40, deviceId = '' } = {}) {
  const want = Math.max(1, Math.min(100, limit));
  const me = String(deviceId || '').trim().slice(0, 120);
  const claimCutoff = new Date(Date.now() - AGENT_CLAIM_TTL_MS).toISOString();

  // CHỈ LẤY CỘT ĐỦ ĐỂ LỌC. Agent hỏi mỗi 1.5s và cửa sổ quét là 300 dòng — nếu
  // dựng job đầy đủ cho cả cửa sổ (JSON.parse payload + jobMeta cho từng dòng)
  // thì mỗi máy agent ngốn 300 lần phân tích JSON mỗi 1.5 giây. Trên VPS 1 nhân,
  // đó là chặn vòng lặp sự kiện đủ lâu để Socket.IO trượt nhịp ping → app rớt
  // kết nối liên tục. Job đầy đủ chỉ dựng cho những job THỰC SỰ trả về (tối đa
  // `want`). Cùng bài học với sự cố CPU 100% do getPrintConfig() gọi trong vòng lặp.
  const rows = db.prepare(
    `SELECT id, printer, type, created_at FROM print_jobs
      WHERE branch_id=? AND status IN ('queued','failed')
        AND (claimed_by IS NULL OR claimed_by='' OR claimed_by=? OR COALESCE(claimed_at,'') < ?)
      ORDER BY created_at ASC LIMIT ?`,
  ).all(branch_id, me, claimCutoff, AGENT_SCAN_WINDOW);

  // Nạp cấu hình in ĐÚNG 1 LẦN cho cả loạt job — trước đây resolveAgentJob() gọi
  // lại getPrintConfig() (đọc DB + JSON.parse + sanitize) cho TỪNG job, nên agent
  // hỏi hàng đợi mỗi 1.5s làm server lặp lại việc này tới ~40 lần/lần hỏi, tốn
  // gần 2 giây CPU liên tục 24/7 → nghẽn cứng cả server (đã gây sự cố thật).
  const printCfg = getPrintConfig(branch_id);
  const printers = Array.isArray(printCfg.printers) ? printCfg.printers : [];
  const printerById = new Map(printers.map(p => [p.id, p]));

  // Trạng thái các máy chạy agent cũng lấy ĐÚNG 1 LẦN, không hỏi lại theo từng job.
  const devices = getAgentDevices(branch_id);
  const onlineDeviceIds = new Set(devices.map(d => d.device_id));
  const myPrinterNames = new Set(
    (devices.find(d => d.device_id === me)?.printers || [])
      .map(p => String(p.name || '').trim().toLowerCase()));
  const meIsKnown = !!me && onlineDeviceIds.has(me);

  const out = [];
  const orphans = [];
  const quaHan = [];
  for (const row of rows) {
    // Phiếu để quá lâu thì KHÔNG in nữa — xem chú thích JOB_TTL_MIN. Chốt này
    // đứng TRƯỚC mọi bước phân giải tuyến: job quá hạn không đáng để tra cấu
    // hình, và quan trọng hơn là không được lọt qua bất kỳ nhánh nào bên dưới.
    if (jobQuaHan(row.type, row.created_at)) {
      quaHan.push(row.id);
      continue;
    }
    // Tuyến 'auto:<device>:<tên máy in>' là tuyến NGẦM do hệ thống tự dựng từ
    // máy in cắm sẵn ở máy POS (xem implicitDevicePrinter). Nó không nằm trong
    // print_config nên phải dựng lại ở đây, nếu không job vừa tạo đã bị coi là
    // mồ côi và huỷ ngay — đúng lỗi cũ, chỉ khác nguyên nhân.
    const printer = printerById.get(row.printer) || rebuildImplicit(row.printer, devices);
    if (!printer) {
      orphans.push(row.id); // tuyến in đã bị xoá → job này không bao giờ in được
      continue;
    }
    if (printer.active === false) continue;
    const connection = printer.connection || 'browser';
    if (connection !== 'lan' && connection !== 'system') continue;

    // Máy in cắm THẲNG vào một máy (connection 'system') thì chỉ máy ĐÓ in được.
    // Máy khác nhận sẽ in lỗi rồi kéo job đã in thành công về 'failed' → in trùng.
    // Máy in LAN thì máy nào trong mạng cũng in được nên không lọc.
    if (connection === 'system' && meIsKnown) {
      const canName = String(printer.systemName || printer.name || '').trim().toLowerCase();
      if (canName && !myPrinterNames.has(canName)) continue;
    }

    // MÁY CHỦ TRÌ: nhiều máy POS cùng với tới một máy in thì phiếu phải luôn ra ở
    // ĐÚNG MỘT chỗ, không để "máy nào hỏi trước máy đó in". Chủ trì offline thì
    // nhường cho máy khác để không tắc bán hàng.
    // 'agent-khong-dinh-danh' KHÔNG PHẢI một máy thật.
    //
    // Agent bản cũ không gửi định danh máy, server gom hết vào khoá giữ chỗ này
    // (xem system.js). Nếu coi nó là chủ trì thì luật "phiếu chỉ ra ở đúng một
    // chỗ" khoá tuyến vào một cái máy không tồn tại: mọi máy khác bị chặn không
    // nhận được phiếu, còn chính agent cũ thì in hỏng. Cửa hàng thấy "đã thanh
    // toán" mà giấy không ra.
    //
    // Đây đúng là tình huống ở chi nhánh sala ngày 2026-08-01: cả hai tuyến hóa
    // đơn đều mang primaryDeviceId = 'agent-khong-dinh-danh'.
    const primary = String(printer.primaryDeviceId || '').trim();
    const chuTriThat = primary && primary !== KHOA_MAY_KHONG_DINH_DANH;
    if ((row.printer || '').startsWith('auto:')) {
      const parts = row.printer.split(':');
      const targetDevice = parts[1] || '';
      if (targetDevice && me && targetDevice !== me) continue;
    }
    if (chuTriThat && me && primary !== me) {
      if (connection === 'system' || (printer.id || '').startsWith('auto:')) continue;
      if (onlineDeviceIds.has(primary)) continue;
    }

    if (me && !claimJob(row.id, me, claimCutoff)) continue; // máy khác vừa giữ chỗ

    // Tới đây job chắc chắn được trả về — giờ mới dựng đầy đủ (parse payload,
    // render text). Tối đa `want` lần thay vì cả cửa sổ quét.
    const resolved = resolveAgentJobFast(getJob(row.id), printers, printCfg, devices);
    if (!resolved) continue;
    out.push(resolved);
    if (out.length >= want) break;
  }

  if (orphans.length) {
    const upd = db.prepare(
      `UPDATE print_jobs SET status='cancelled', error=? WHERE id=? AND status IN ('queued','failed')`);
    for (const id of orphans) {
      upd.run('Tuyến in không còn trong cấu hình — job đã huỷ tự động', id);
    }
    audit('print.jobs_cancelled_orphan', { count: orphans.length }, branch_id, 'system');
  }

  if (quaHan.length) {
    const upd = db.prepare(
      `UPDATE print_jobs SET status='expired', error=? WHERE id=? AND status IN ('queued','failed')`);
    for (const id of quaHan) {
      upd.run('Phiếu quá hạn chờ in — không tự in nữa, bấm In lại nếu vẫn cần', id);
    }
    audit('print.jobs_expired', { count: quaHan.length }, branch_id, 'system');
    logSystem({
      level: 'warn', source: 'printer', eventType: 'print_jobs_expired',
      title: `${quaHan.length} phiếu quá hạn chờ in đã được gỡ khỏi hàng đợi`,
      message: 'Máy in tắt hoặc app đóng lúc tạo phiếu. Không tự in để tránh phiếu của ca cũ chui ra vào hôm sau.',
      branchId: branch_id, username: 'system', action: 'print:expire',
    });
  }

  return out;
}


/** Giữ chỗ job cho đúng một máy. Trả false nếu máy khác vừa giữ trước. */
function claimJob(id, deviceId, claimCutoff) {
  const r = db.prepare(
    `UPDATE print_jobs SET claimed_by=?, claimed_at=?
      WHERE id=? AND status IN ('queued','failed')
        AND (claimed_by IS NULL OR claimed_by='' OR claimed_by=? OR COALESCE(claimed_at,'') < ?)`,
  ).run(deviceId, now(), id, deviceId, claimCutoff);
  return r.changes > 0;
}

// WindowsDriverBackend: với máy in đặt renderMode='driver', dựng semantic
// document (font TrueType) để agent Windows in qua GDI — hoá đơn VÀ phiếu bếp
// (font lớn). Lỗi dựng doc → trả rỗng, agent rơi về in ESC/POS (phiếu vẫn ra).
function driverFieldsFor(job, printer, printCfg) {
  if (!printer || printer.renderMode !== 'driver') return null;
  if ((printer.connection || 'browser') !== 'system') return null;
  // receipt = payload thật; test = bill mẫu (so font); kitchen_ticket = phiếu bếp
  // font LỚN qua GDI (không giới hạn 2x của ESC/POS).
  if (job.type !== 'receipt' && job.type !== 'test' && job.type !== 'kitchen_ticket'
    && job.type !== 'shipping_label' && job.type !== 'expense_voucher' && job.type !== 'return_voucher') return null;
  try {
    let doc;
    if (job.type === 'kitchen_ticket') doc = buildKitchenDoc(job.payload || {}, printCfg || {}, { font: printer.driverFont });
    else if (job.type === 'shipping_label') doc = buildShippingLabelDoc(job.payload || {}, printCfg || {}, { font: printer.driverFont });
    else if (job.type === 'expense_voucher') doc = buildExpenseVoucherDoc(job.payload || {}, printCfg || {}, { font: printer.driverFont });
    else if (job.type === 'return_voucher') doc = buildReturnVoucherDoc(job.payload || {}, printCfg || {}, { font: printer.driverFont });
    else {
      const payload = job.type === 'test' ? sampleReceiptPayload() : (job.payload || {});
      const width = Number(printer?.widthMm)
        ? paperWidthCharsFrom({ widthMm: Number(printer.widthMm) })
        : paperWidthCharsFrom(printCfg?.bill || {});
      const vars = receiptVars(payload, width, printCfg || {});
      // Các biến *C của ESC/POS đã được đệm khoảng trắng để tự căn giữa. GDI
      // có align thật nên phải dùng chữ thô, nếu không sẽ căn giữa hai lần và
      // đẩy nội dung lệch/phần cuối ra khỏi giấy.
      Object.assign(vars, {
        storeNameC: vars.storeName,
        storeSubtitleC: vars.storeSubtitle,
        addressBlock: vars.address,
        thanksC: vars.footer,
        footerC: vars.footer,
      });
      doc = buildReceiptDoc(payload, printCfg || {}, {
        font: printer.driverFont,
        vars,
      });
    }
    if (!doc || !Array.isArray(doc.blocks) || !doc.blocks.length) return null;
    return { renderMode: 'driver', driverFont: printer.driverFont || 'Segoe UI', driverDoc: JSON.stringify(doc) };
  } catch (e) {
    logSystem({
      level: 'warn', source: 'printer', eventType: 'driver_doc_error',
      title: `Dựng bill driver-mode lỗi (job ${job.id}) — in ESC/POS thay thế`,
      message: e?.message || String(e), branchId: job.branch_id,
      action: 'print:driver', extra: { job: job.id },
    });
    return null;
  }
}

function resolveAgentJobFast(job, printers, printCfg, devices = []) {
  if (!job) return null;
  // Tuyến ngầm (máy in cắm sẵn, chưa ai khai tuyến) không nằm trong print_config
  // nên phải dựng lại ở ĐÂY NỮA — vòng quét ngoài đã nhận nó, tới bước dựng job
  // mà tra lại danh sách cấu hình thì lại rơi về null và job im lặng biến mất.
  const printer = printers.find(p => p.id === job.printer)
    || rebuildImplicit(job.printer, devices);
  if (!printer || printer.active === false) return null;
  const connection = printer.connection || 'browser';
  return {
    id: job.id,
    type: job.type,
    connection,
    ip: printer.ip || '',
    port: printer.port || 9100,
    systemName: printer.systemName || printer.name || '',
    drawer: !!(printer.openDrawerOnPrint && job.type === 'receipt') || job.type === 'cash_drawer',
    ...(driverFieldsFor(job, printer, printCfg) || {}),
    text: renderJobText(job, job.branch_id, printer),
    density: printCfg?.bill?.printDensity || 'dark',
    // Máy in nhiệt cắm USB phải nhận NGUYÊN BYTE ESC/POS, không đi qua driver
    // Windows (driver vẽ chữ thành ảnh xám → bản in rất mờ, mất lệnh cắt giấy).
    // Agent bản cũ không đọc cờ này thì giữ nguyên hành vi cũ — không vỡ gì.
    raw: isThermal(printer),
    // Bộ mã và cỡ chữ do SERVER quyết, agent chỉ thi hành — nhờ vậy máy in
    // Windows, máy in LAN và máy in gắn liền trên máy cầm tay ra cùng một kiểu
    // chữ. Trước đây mỗi đường tự quyết nên chỗ có dấu chỗ không.
    charset: charsetOf(printer),
    fontScale: fontScaleFor(job.type, printCfg?.bill),
    // Buzzer máy in kêu khi nhả hóa đơn (xem escposBuffer). Chỉ phiếu bán hàng.
    buzzer: job.type === 'receipt' && printCfg?.bill?.buzzer !== false && printCfg?.bill?.buzzer !== '0',
    created_at: job.created_at,
  };
}

// Gói mọi thứ agent cần để in 1 job: text đã render + đích + có mở két không.
function resolveAgentJob(job, branch_id) {
  if (!job) return null;
  const printer = printerForJob(job.printer, branch_id);
  if (!printer || printer.active === false) return null;
  const connection = printer.connection || 'browser';
  return {
    id: job.id,
    type: job.type,
    connection,
    ip: printer.ip || '',
    port: printer.port || 9100,
    systemName: printer.systemName || printer.name || '',
    drawer: !!(printer.openDrawerOnPrint && job.type === 'receipt') || job.type === 'cash_drawer',
    ...(driverFieldsFor(job, printer, getPrintConfig(branch_id)) || {}),
    // Truyền máy in vào để phiếu dựng theo ĐÚNG khổ giấy của nó (máy cầm tay
    // 58mm khác máy để bàn K80 dù cùng chi nhánh).
    text: renderJobText(job, branch_id, printer),
    density: getPrintConfig(branch_id)?.bill?.printDensity || 'dark',
    raw: isThermal(printer),
    charset: charsetOf(printer),
    fontScale: fontScaleFor(job.type, getPrintConfig(branch_id)?.bill),
    buzzer: job.type === 'receipt'
      && getPrintConfig(branch_id)?.bill?.buzzer !== false
      && getPrintConfig(branch_id)?.bill?.buzzer !== '0',
    created_at: job.created_at,
  };
}

export function agentJob(id, branch_id = 'sala', { deviceId = '' } = {}) {
  const job = getJobForBranch(id, branch_id);
  if (!job) return null;
  const dev = String(deviceId || '').trim();
  if (dev && job.claimed_by && String(job.claimed_by).trim() !== dev) {
    throw new Error('Lệnh in không thuộc về thiết bị này');
  }
  return resolveAgentJob(job, branch_id);
}

// Agent gọi khi đã in xong / in lỗi trên máy in vật lý tại cửa hàng.
export function agentReportResult(id, branch_id, { ok, error, deviceId = '' } = {}) {
  const existing = getJob(id);
  if (!existing) throw new Error('Print job không tồn tại');
  if (existing.branch_id !== branch_id) throw new Error('Print job không thuộc chi nhánh hiện tại');
  const dev = String(deviceId || '').trim();
  if (dev && existing.claimed_by && String(existing.claimed_by).trim() !== dev) {
    throw new Error('Thiết bị không giữ chỗ lệnh in này');
  }
  if (ok) {
    const job = patchJob(id, { status: 'printed', printed_at: now(), printed_by: 'agent', error: null });
    emit('print:done', job, branch_id);
    audit('print.agent.printed', { job: id, printer: job?.printer, type: job?.type }, branch_id, 'agent');
    return job;
  }
  // KHÔNG lật ngược job đã in xong. Trước đây ghi 'failed' vô điều kiện, nên khi
  // hai máy cùng chạy agent: máy A in xong (printed) → máy B không có máy in đó
  // in lỗi → job bị kéo về 'failed' → vào lại hàng đợi → máy A in lần nữa → lặp
  // vô hạn, giấy ra chồng chất. Báo lỗi đến muộn chỉ được ghi log.
  if (existing.status === 'printed') {
    logSystem({
      level: 'warn', source: 'printer', eventType: 'print_late_failure',
      title: `Bỏ qua báo lỗi muộn cho job đã in xong (tuyến ${existing.printer || '?'})`,
      message: String(error || ''), branchId: branch_id, username: 'agent',
      action: `print:${existing.type}`, extra: { job: id },
    });
    return existing;
  }
  const lanThu = Number(existing.attempts || 0) + 1;
  let job = patchJob(id, {
    status: 'failed', error: String(error || 'Agent in lỗi'), attempts: lanThu,
    last_attempt_at: now(),
  });

  // CHUYỂN SANG MÁY IN KẾ TIẾP thay vì đấm mãi vào cái máy đang hỏng.
  //
  // Agent tại chỗ đã tự thử lại vài lần rồi mới báo về. Còn thất bại nghĩa là
  // máy in đó thật sự không dùng được lúc này (hết giấy, rút dây, tắt nguồn).
  // Trước đây job cứ nằm 'failed' rồi quay lại hàng đợi cho ĐÚNG tuyến đó —
  // cửa hàng có 2-3 máy in mà bill vẫn không ra tờ nào.
  if (lanThu >= AGENT_FAILOVER_AFTER) {
    const ke = nextPrinterInChain(job, branch_id, dev);
    if (ke && ke.id !== job.printer) {
      job = patchJob(id, {
        printer: ke.id, status: 'queued', error: null, attempts: 0,
        claimed_by: null, claimed_at: null,
      });
      logSystem({
        level: 'warn', source: 'printer', eventType: 'print_failover',
        title: `Chuyển phiếu sang máy in kế tiếp: ${ke.label || ke.id}`,
        message: `Tuyến ${existing.printer} in hỏng ${lanThu} lần (${error || '?'}) — đẩy sang tuyến ưu tiên kế tiếp.`,
        branchId: branch_id, username: 'agent',
        action: `print:${job?.type}`, extra: { job: id, tu: existing.printer, sang: ke.id },
      });
      emit('print:new', job, branch_id);
      return job;
    }
  }

  emit('print:failed', job, branch_id);
  logSystem({
    level: 'error', source: 'printer', eventType: 'print_failed',
    title: `Hardware Agent báo in lỗi (tuyến ${job?.printer || '?'})`,
    message: job?.error, branchId: branch_id, username: 'agent',
    action: `print:${job?.type}`, extra: { job: id, lan_thu: lanThu },
  });
  return job;
}

export function markPrinted(id, branch_id = 'sala', actor = 'manual') {
  const existing = getJob(id);
  if (!existing) throw new Error('Print job không tồn tại');
  if (existing.branch_id !== branch_id) throw new Error('Print job không thuộc chi nhánh hiện tại');
  const job = patchJob(id, { status: 'printed', printed_at: now(), printed_by: actor, error: null });
  emit('print:done', job, branch_id);
  audit('print.mark_printed', { job: id, printer: job?.printer, type: job?.type }, branch_id, actor);
  return job;
}

export function reprint(id, branch_id = 'sala', { deviceId = '', actor = '' } = {}) {
  const j = getJob(id);
  if (!j) throw new Error('Print job không tồn tại');
  if (j.branch_id !== branch_id) throw new Error('Print job không thuộc chi nhánh hiện tại');
  audit('print.reprint', { job: id, device: deviceId || '' }, branch_id, actor);
  const payload = { ...(j.payload || {}), reprint: true };
  if (j.type === 'receipt') payload.print_config = printConfigForJob(getPrintConfig(branch_id));

  // IN LẠI PHẢI RA Ở MÁY ĐANG BẤM, không phải máy đã in bản gốc.
  //
  // Bản cũ sao chép nguyên `j.printer`. Bill gốc in ở máy POS cầm tay (tuyến
  // ngầm 'auto:dev_sunmi:...'), thu ngân đứng ở quầy bấm In lại thì job lại
  // được gửi về đúng cái máy cầm tay đang nằm trong túi ai đó — hoặc tệ hơn,
  // máy đó đã tắt app nên tuyến ngầm không dựng lại được và job bị huỷ mồ côi.
  // Người bấm đứng nhìn máy in của mình im lặng, đúng lỗi đang phải sửa.
  //
  // Phân giải lại theo THIẾT BỊ ĐANG BẤM; không ra được tuyến nào thì mới giữ
  // tuyến cũ (thà thử chỗ cũ còn hơn không tạo được lệnh in nào).
  const chain = deviceId
    ? resolvePrinterChain(outputOfJobType(j.type), branch_id, { deviceId })
    : [];
  const printer = chain[0]?.id || j.printer;

  return createJob({ printer, type: j.type, title: `${j.title || ''} (in lại)`.trim(), payload, branch_id, reprint_of: id });
}

export async function testPrinter(printerId, branch_id = 'sala') {
  const p = printerById(printerId, branch_id);
  if (!p) throw new Error('Máy in chưa được cấu hình');
  if ((p.connection || 'browser') === 'system' && (!p.primaryDeviceId || p.primaryDeviceId === KHOA_MAY_KHONG_DINH_DANH)) {
    throw new Error('Tuyến máy in chưa gắn với thiết bị cụ thể');
  }
  const bill = getPrintConfig(branch_id)?.bill || {};
  const job = createJob({
    printer: printerId,
    type: 'test',
    title: `In thử ${p.label || p.id}`,
    payload: {
      ref: uid('test_'),
      time: vnDateTime(),
      printer: p,
      // CHỈ mấy trường phiếu in thử cần — không nhét cả print_config (có mẫu
      // bill + logo base64) vào payload, đó là nguyên nhân job in phình to.
      print_config: {
        bill: {
          storeName: bill.storeName || '',
          paper: bill.paper || 'K80',
          widthMm: bill.widthMm || 72,
          printDensity: bill.printDensity || 'dark',
        },
      },
    },
    branch_id,
  });
  // Chế độ agent: server không in trực tiếp — chỉ xếp hàng để agent cửa hàng in.
  if (env.PRINT_DISPATCH === 'agent') return getJob(job.id);
  return dispatchJob(job.id, branch_id, { force: true });
}

export async function openCashDrawer(branch_id = 'sala', printerId = '', { deviceId = '' } = {}) {
  const rows = printerRows(branch_id);
  // Két tiền cắm sau máy in bill của CHÍNH máy đang bấm — không mở két của máy khác.
  const myNames = deviceId ? deviceOwnPrinterNames(branch_id, deviceId) : new Set();
  const p = rows.find(x => x.id === printerId)
    || rows.find(x => x.cashDrawer && x.active !== false && isAttachedTo(x, deviceId, myNames))
    || rows.find(x => x.cashDrawer)
    || resolveReceiptPrinter(branch_id, { deviceId })
    || rows.find(x => x.id === 'bill');
  if (!p) throw new Error('Chưa cấu hình máy in/két tiền');
  if (p.connection !== 'lan') throw new Error('Mở két tự động cần máy in bill kết nối LAN/IP ESC/POS');
  if (!p.ip) throw new Error('Thiếu IP máy in bill nối két tiền');
  // Chế độ agent: server (VPS) không với tới két trong cửa hàng → xếp job
  // cash_drawer để Hardware Agent gửi xung mở két trên máy in LAN tại chỗ.
  if (env.PRINT_DISPATCH === 'agent') {
    const job = createJob({
      printer: p.id,
      type: 'cash_drawer',
      title: 'Mở két tiền',
      payload: { ref: uid('drawer_'), note: 'Mở két thủ công từ Printer Monitor' },
      branch_id,
    });
    audit('cash_drawer.open_agent', { printer: p.id, target: printerTarget(p) }, branch_id);
    return { ok: true, printer: p.id, target: printerTarget(p), queued: true, job: getJob(job.id) };
  }
  await writeLan(p.ip, p.port || 9100, Buffer.concat([ESC_INIT, ESC_DRAWER]), 4500);
  const job = createJob({
    printer: p.id,
    type: 'cash_drawer',
    title: 'Mở két tiền',
    payload: { ref: uid('drawer_'), note: 'Mở két thủ công từ Printer Monitor' },
    branch_id,
  });
  markPrinted(job.id, branch_id, 'server');
  audit('cash_drawer.open_printer', { printer: p.id, target: printerTarget(p) }, branch_id);
  return { ok: true, printer: p.id, target: printerTarget(p), job: getJob(job.id) };
}

// ---- Hooks used by order/payment flows ----
export function printKitchenTickets(order, items, branch_id = 'sala', staff = '', {
  deviceId = '', updateKind = '', updateSeq = 0, tableDisplay = '',
} = {}) {
  const kitchenItems = items.filter(it => it && it.station !== 'retail');
  if (!kitchenItems.length) return;

  // BÁO TRƯỚC KHI IN (yêu cầu chủ cửa hàng): máy bếp NHÁY ĐÈN + kêu "tít tít tít"
  // để nhân viên biết có phiếu sắp ra, rồi phiếu mới chạy ra. Gửi realtime tới
  // chi nhánh; lỗi realtime KHÔNG được chặn việc in.
  try {
    emit('kds:alert', {
      table_code: order?.table_code || order?.table || '',
      station: kitchenItems[0]?.station || 'kitchen',
      count: kitchenItems.length,
    }, branch_id);
  } catch { /* realtime lỗi không chặn in */ }

  const k = getPrintConfig(branch_id).kitchen || {};
  const split = k.splitPerItem !== '0' && k.splitPerItem !== false;
  const perUnit = k.perUnit !== '0' && k.perUnit !== false;
  const showStaff = k.showStaff !== '0' && k.showStaff !== false;

  // Trạm (kitchen/bar) → tuyến in THẬT. Tôn trọng máy in cắm tại thiết bị trước (preferDevice).
  const rows = printerRows(branch_id);
  const resolvedStation = new Map();
  const stationPrinterId = (station) => {
    const legacyId = STATION_PRINTER[station] || 'kitchen';
    if (!resolvedStation.has(legacyId)) {
      const found = resolvePrinterForOutput('kitchen_ticket', branch_id, {
        deviceId: deviceId || order.linked_pos_device || '',
        legacyId,
        preferDevice: true,
        printers: rows,
      });
      resolvedStation.set(legacyId, found ? found.id : '');
    }
    return resolvedStation.get(legacyId);
  };
  const warnNoStation = (station) => logSystem({
    level: 'error', source: 'printer', eventType: 'station_printer_missing',
    title: `Không tìm được máy in cho trạm "${station || 'kitchen'}" — phiếu bếp không in`,
    message: 'Chưa có máy in nào đặt loại phiếu "Phiếu bếp"/"Phiếu bar" và đang bật.',
    branchId: branch_id, action: 'print:kitchen_ticket',
    extra: { station: station || '', order: order?.id || '' },
  });

  const now = new Date();
  const storeNow = businessParts(now);
  const base = {
    order_id: order.id || '',
    zone: order.zone || '',
    table: tableDisplay || order.table_code || (order.online_channel ? 'ONLINE' : '—'),
    staff: showStaff ? (staff || '') : '',
    // Số thứ tự = 3 số cuối của Số Bill (Dan{ddMMyy}{seq}). VD Dan2106260001 -> 001.
    // SỐ THỨ TỰ trong NGÀY: lấy từ pay_ref (cấp lúc mở đơn = Dan{ddMMyy}{seq}) hoặc
    // bill_no — RESET MỖI NGÀY, bắt đầu 01, số tự nhiên. Trước đây slice(-3) của
    // bill_no/id cho ra rác (vd "69c" từ id) khi đơn chưa có bill_no lúc in bếp.
    seq: updateSeq > 0 ? `${kitchenDailySeq(order)}-${updateSeq}` : kitchenDailySeq(order),
    update_seq: updateSeq || 0,
    update_kind: updateKind || '',
    time: businessTime(now),
    date: `${String(storeNow.day).padStart(2, '0')}/${String(storeNow.month).padStart(2, '0')}/${storeNow.year}`,
  };

  // Chế độ gộp cũ: 1 phiếu / trạm in.
  if (!split) {
    const byPrinter = {};
    for (const it of kitchenItems) {
      const p = stationPrinterId(it.station);
      if (!p) { warnNoStation(it.station); continue; }
      (byPrinter[p] ||= []).push(it);
    }
    for (const [printer, list] of Object.entries(byPrinter)) {
      createJob({
        printer, type: 'kitchen_ticket',
        title: `Bàn ${base.table} · #${base.seq}`,
        payload: {
          ...base, station: printer.toUpperCase(),
          items: list.map(i => ({
            qty: i.qty, name: i.name, note: i.note, mods: itemMods(i),
            cancelled: i.cancelled === true,
          })),
        }, branch_id,
      });
    }
    return;
  }

  // Tách từng món: mỗi món (mỗi phần nếu perUnit) ra 1 tem riêng.
  for (const it of kitchenItems) {
    const printer = stationPrinterId(it.station);
    if (!printer) { warnNoStation(it.station); continue; }
    const copies = perUnit ? Math.min(Math.max(1, parseInt(it.qty) || 1), 30) : 1;
    for (let i = 0; i < copies; i++) {
      createJob({
        printer, type: 'kitchen_ticket',
        title: `Bàn ${base.table} · ${it.name}`,
        payload: {
          ...base, station: printer.toUpperCase(),
          name: it.name, qty: it.qty, mods: itemMods(it), note: it.note || '',
          cancelled: it.cancelled === true,
          copy: copies > 1 ? `${i + 1}/${copies}` : '',
        }, branch_id,
      });
    }
  }
}

function nextKitchenUpdateSeq(orderId) {
  if (!orderId) return 1;
  const row = db.prepare(`SELECT COALESCE(MAX(CAST(json_extract(payload_json,'$.update_seq') AS INTEGER)),0) n FROM print_jobs
    WHERE json_extract(payload_json,'$.order_id')=?
      AND COALESCE(json_extract(payload_json,'$.update_kind'),'')!=''`).get(orderId);
  return (Number(row?.n) || 0) + 1;
}

/** In phiên bản cập nhật X-Y cho một bill bếp; Y tăng riêng trong bill đó. */
export function printKitchenUpdate(order, items, branch_id = 'sala', staff = '', kind = '', options = {}) {
  if (!order?.id || !Array.isArray(items) || !items.length) return 0;
  const y = nextKitchenUpdateSeq(order.id);
  printKitchenTickets(order, items, branch_id, staff, {
    deviceId: options.deviceId || '', updateKind: kind, updateSeq: y,
    tableDisplay: options.tableDisplay || '',
  });
  return y;
}

export function printReceipt(receipt, branch_id = 'sala', { deviceId = '' } = {}) {
  const cfg = getPrintConfig(branch_id);
  // Cấu hình tại Bill & Tem nhãn là nguồn duy nhất quyết định số bản.
  // Không cho payload cũ/tuỳ ý ghi đè, nếu không cùng một nút in có thể tạo số bản khác nhau.
  const copies = Math.max(1, Math.min(9, parseInt(cfg?.bill?.copies || 1) || 1));
  const jobs = [];
  const reprint = isReprintPayload(receipt);

  // Tuyến in phải PHÂN GIẢI THẬT, không ghi cứng 'bill'. Đơn có tuyến gắn sẵn
  // (linked_printer_id) thì tôn trọng — nhưng chỉ khi tuyến đó CÒN tồn tại,
  // nếu không job sẽ mồ côi rồi bị huỷ y như lỗi cũ.
  const linked = receipt.linked_printer_id
    ? printerById(receipt.linked_printer_id, branch_id)
    : null;
  const localPrinter = deviceId ? resolveReceiptPrinter(branch_id, { deviceId }) : null;
  const linkedIsUsableHardware = linked && linked.active !== false && linked.connection !== 'browser';
  let printer = (linkedIsUsableHardware ? linked : null) || localPrinter || linked || resolveReceiptPrinter(branch_id, { deviceId });
  // THIẾT BỊ KHÔNG CẮM MÁY IN NÀO (thiết bị C): không có máy in riêng để "in nhầm
  // chỗ", nên TRẢ BILL VỀ MÁY IN ƯU TIÊN của tuyến 'receipt' (đầu chuỗi failover)
  // thay vì báo lỗi. Máy A khỏe → bill ra A; A hỏng → chuỗi tự nhảy máy kế. Thiết
  // bị CÓ máy in riêng mà thiếu tuyến thì GIỮ NGUYÊN (không giành máy của máy khác).
  if (!printer && deviceOwnPrinterNames(branch_id, deviceId).size === 0) {
    const chain = resolvePrinterChain('receipt', branch_id, { deviceId });
    if (chain.length) printer = chain[0];
  }
  if (!printer) {
    // Không có tuyến in hóa đơn nào → nói rõ ra thay vì xếp job chết im lặng.
    logSystem({
      level: 'error', source: 'printer', eventType: 'receipt_printer_missing',
      title: 'Không tìm được máy in hóa đơn — bill KHÔNG tự in',
      message: [
        'Đã tìm: tuyến in đã khai cho máy này, máy in cắm sẵn của máy này, rồi tuyến chung.',
        `Máy in mà máy này (${deviceId || 'không rõ định danh'}) đang báo lên: `
          + (deviceOwnPrinterNames(branch_id, deviceId).size
              ? [...deviceOwnPrinterNames(branch_id, deviceId)].join(', ')
              : 'KHÔNG CÓ máy in nào'),
        'Bill KHÔNG được in ra máy in của máy khác — in nhầm chỗ thì không ai biết để đi tìm.',
      ].join(' | '),
      branchId: branch_id, action: 'print:receipt',
      extra: {
        bill_no: receipt.bill_no || receipt.number || '',
        device: deviceId || '',
        may_in_cua_may_nay: [...deviceOwnPrinterNames(branch_id, deviceId)],
      },
    });
    return jobs;
  }

  for (let i = 0; i < copies; i++) {
    jobs.push(createJob({
      printer: printer.id,
      type: 'receipt',
      title: `Receipt #${receipt.number}${copies > 1 ? ` (${i + 1}/${copies})` : ''}${reprint ? ' (in lại)' : ''}`,
      payload: { ...receipt, print_config: printConfigForJob(cfg), reprint, copy_index: i + 1, copy_total: copies },
      branch_id,
      idempotency_key: !reprint && receipt.payment_id
        ? `receipt:${branch_id}:${receipt.payment_id}:${i + 1}`
        : null,
    }));
  }
  return jobs;
}

/** Ghi ý định in trong cùng transaction payment. Worker có thể replay an toàn. */
export function enqueueReceiptPrint(receipt, branch_id = 'sala', { deviceId = '' } = {}) {
  if (!receipt?.payment_id) throw new Error('Thiếu payment_id cho receipt print outbox');
  const existing = db.prepare(`SELECT id FROM receipt_print_outbox WHERE payment_id=?`).get(receipt.payment_id);
  if (existing) return existing.id;
  const id = uid('rpo_');
  db.prepare(`INSERT INTO receipt_print_outbox
    (id,branch_id,payment_id,payload_json,device_id,status,attempts,created_at)
    VALUES (?,?,?,?,?,'queued',0,?)`)
    .run(id, branch_id, receipt.payment_id, JSON.stringify(receipt), String(deviceId || ''), now());
  return id;
}

/** Drain durable receipt intents. A failed attempt remains queued for retry. */
export function processReceiptPrintOutbox({ id = null, limit = 20 } = {}) {
  const rows = id
    ? db.prepare(`SELECT * FROM receipt_print_outbox WHERE id=? AND status!='done'`).all(id)
    : db.prepare(`SELECT * FROM receipt_print_outbox WHERE status IN ('queued','retrying') ORDER BY created_at LIMIT ?`)
        .all(Math.max(1, Math.min(100, Number(limit) || 20)));
  const result = { processed: 0, done: 0, failed: 0, job_ids: [], print_status: 'pending' };
  for (const row of rows) {
    const claimed = db.prepare(`UPDATE receipt_print_outbox
      SET status='processing',attempts=attempts+1,last_error=NULL
      WHERE id=? AND status IN ('queued','retrying')`).run(row.id);
    if (!claimed.changes) continue;
    result.processed++;
    try {
      const receipt = JSON.parse(row.payload_json);
      const jobs = printReceipt(receipt, row.branch_id, { deviceId: row.device_id || '' });
      if (!jobs.length) throw new Error(receipt.print_error || 'Chưa có tuyến máy in hóa đơn khả dụng');
      result.job_ids.push(...jobs.map(job => job.id));
      result.print_status = jobs.every(job => job.status === 'printed')
        ? 'printed'
        : jobs.some(job => job.status === 'printing' || job.claimed_by)
          ? 'claimed'
          : 'queued';
      db.prepare(`UPDATE receipt_print_outbox SET status='done',completed_at=?,last_error=NULL WHERE id=?`)
        .run(now(), row.id);
      result.done++;
    } catch (error) {
      db.prepare(`UPDATE receipt_print_outbox SET status='retrying',last_error=? WHERE id=?`)
        .run(String(error?.message || error).slice(0, 500), row.id);
      result.failed++;
    }
  }
  return result;
}

/** Canonical physical-print state for one committed payment. */
export function receiptPrintStatus(paymentId, branch_id = 'sala') {
  const payment = db.prepare(`SELECT p.id FROM payments p JOIN orders o ON o.id=p.order_id
    WHERE p.id=? AND o.branch_id=?`).get(paymentId, branch_id);
  if (!payment) throw Object.assign(new Error('Không tìm thấy khoản thanh toán'), { status: 404 });
  const jobs = db.prepare(`SELECT id,status,printer,claimed_by,claimed_at,printed_at,error
    FROM print_jobs WHERE branch_id=? AND type='receipt' AND idempotency_key LIKE ?
    ORDER BY created_at,id`).all(branch_id, `receipt:${branch_id}:${paymentId}:%`);
  if (!jobs.length) {
    const outbox = db.prepare(`SELECT status,last_error FROM receipt_print_outbox
      WHERE branch_id=? AND payment_id=?`).get(branch_id, paymentId);
    return {
      payment_id: paymentId,
      status: outbox?.status === 'retrying' ? 'failed' : 'queued',
      error: outbox?.last_error || null,
      jobs: [],
    };
  }
  const terminalFailure = new Set(['failed', 'cancelled', 'expired']);
  const status = jobs.every(job => job.status === 'printed')
    ? 'printed'
    : jobs.every(job => terminalFailure.has(job.status))
      ? 'failed'
      : jobs.some(job => job.status === 'printing' || job.claimed_by)
        ? 'claimed'
        : 'queued';
  return {
    payment_id: paymentId,
    status,
    error: status === 'failed' ? jobs.map(job => job.error).filter(Boolean).join(' | ') || null : null,
    jobs,
  };
}

function shouldPrintCupLabels(order, cfg) {
  if (!cfg?.labels || cfg.labels.autoPrint === '0' || cfg.labels.autoPrint === false) return false;
  return ['takeaway', 'delivery'].includes(order?.channel) || !!order?.online_channel;
}

export function printCupLabels(order, items = [], branch_id = 'sala', { deviceId = '' } = {}) {
  const cfg = getPrintConfig(branch_id);
  if (!shouldPrintCupLabels(order, cfg)) return;
  const printable = items.filter(i => i && i.station !== 'retail' && i.status !== 'cancelled');
  if (!printable.length) return;
  // Ưu tiên máy in gắn tại thiết bị hiện tại (preferDevice).
  const labelPrinter = resolvePrinterForOutput('cup_label', branch_id, {
    deviceId: deviceId || order.linked_pos_device || '',
    legacyId: 'label',
    preferDevice: true,
  });
  if (!labelPrinter) {
    logSystem({
      level: 'warn', source: 'printer', eventType: 'label_printer_missing',
      title: 'Không tìm được máy in tem ly — bỏ qua in tem',
      message: 'Chưa có máy in nào đặt loại phiếu "Tem nhãn" và đang bật.',
      branchId: branch_id, action: 'print:cup_label',
      extra: { order: order?.id || '' },
    });
    return;
  }
  for (const item of printable) {
    const copies = Math.min(Math.max(1, parseInt(item.qty) || 1), 30);
    const mods = itemMods(item).map(m => m.name || m).filter(Boolean);
    for (let i = 0; i < copies; i++) {
      createJob({
        printer: labelPrinter.id,
        type: 'cup_label',
        title: `Tem ly · ${item.name}`,
        payload: {
          order_no: (order?.online_ref || order?.id || item.order_id || '').slice(-10).toUpperCase(),
          table: order?.table_code || (order?.online_channel ? 'ONLINE' : 'Mang đi'),
          channel: order?.online_channel || order?.channel || 'takeaway',
          customer: order?.customer?.name || '',
          phone: order?.customer?.phone || '',
          time: vnTime(),
          itemName: item.name,
          options: mods.join(' · '),
          note: item.note || '',
          qty: item.qty,
          copy: copies > 1 ? `${i + 1}/${copies}` : '',
          print_config: printConfigForJob(cfg),
        },
        branch_id,
      });
    }
  }
}

export function printRunnerSlip(item, order, branch_id = 'sala', { deviceId = '' } = {}) {
  if (!item || item.station === 'retail') return;
  // Ưu tiên máy in gắn tại thiết bị hiện tại (preferDevice).
  const runnerPrinter = resolvePrinterForOutput('runner', branch_id, {
    deviceId: deviceId || order?.linked_pos_device || '',
    legacyId: 'runner',
    preferDevice: true,
  });
  if (!runnerPrinter) {
    logSystem({
      level: 'warn', source: 'printer', eventType: 'runner_printer_missing',
      title: 'Không tìm được máy in phiếu chạy món — bỏ qua',
      message: 'Chưa có máy in nào đặt loại phiếu "Phiếu chạy món" và đang bật.',
      branchId: branch_id, action: 'print:runner',
      extra: { order: order?.id || '' },
    });
    return;
  }
  const table = order?.table_code || (order?.online_channel ? 'ONLINE' : '—');
  const copies = Math.min(Math.max(1, parseInt(item.qty) || 1), 30);
  const mods = itemMods(item).map(m => m.name || m);
  for (let i = 0; i < copies; i++) {
    createJob({
      printer: runnerPrinter.id, type: 'runner',
      title: `Chạy món · Bàn ${table}`,
      payload: {
        table,
        order_no: (order?.id || item.order_id || '').slice(-5).toUpperCase(),
        station: (item.station || 'kitchen').toUpperCase(),
        time: vnTime(),
        seq: copies > 1 ? `${i + 1}/${copies}` : '',
        name: item.name,
        mods, note: item.note || '',
      }, branch_id,
    });
  }
}
