// Printer status text (`statusText` in listPrinters()) is built server-side as
// ready-to-display Vietnamese sentences — some plain, some with a printer/device
// name or IP spliced in (e.g. `Máy POS chưa mở app · không thấy "AP-250"`). The
// Flutter client shows this string VERBATIM (see phone_printers_test.dart —
// "hiện NGUYÊN VĂN lý do của server, không tự chế"), so it never goes through
// the app's t()/viToEnMap system and stayed Vietnamese regardless of UI language.
//
// Rather than rebuild every status sentence, this does a plain substring swap of
// the fixed Vietnamese phrase fragments below — the interpolated printer/device
// name or IP address contains no Vietnamese words, so it passes through intact.
export const PRINTER_STATUS_I18N = {
  en: {
    'Tạm tắt': 'Paused',
    'Chưa chọn máy in trên máy POS': 'No printer selected on the POS device',
    'Máy POS chưa mở app': 'POS device app not open',
    'không thấy': 'not found',
    'Máy in tắt / ngoại tuyến': 'Printer off / offline',
    'Đã kết nối': 'Connected',
    'Chưa kiểm tra live': 'Live status not checked',
    'Chưa nhập IP máy in LAN': 'LAN printer IP not entered',
    'Không phản hồi': 'Not responding',
    'Chưa chọn máy in trên máy chủ': 'No printer selected on the server',
    'Không thấy': 'Not found',
    'trên máy chủ': 'on the server',
    'In qua trình duyệt': 'Print via browser',
  },
  zh: {
    'Tạm tắt': '已暂停',
    'Chưa chọn máy in trên máy POS': '尚未在POS设备上选择打印机',
    'Máy POS chưa mở app': 'POS设备未打开应用',
    'không thấy': '未找到',
    'Máy in tắt / ngoại tuyến': '打印机已关闭／离线',
    'Đã kết nối': '已连接',
    'Chưa kiểm tra live': '尚未检查实时状态',
    'Chưa nhập IP máy in LAN': '尚未输入局域网打印机IP',
    'Không phản hồi': '无响应',
    'Chưa chọn máy in trên máy chủ': '尚未在服务器上选择打印机',
    'Không thấy': '未找到',
    'trên máy chủ': '在服务器上',
    'In qua trình duyệt': '通过浏览器打印',
  },
};

export function translatePrinterStatus(text, lang) {
  const dict = PRINTER_STATUS_I18N[lang];
  if (!dict || !text) return text;
  return Object.entries(dict).reduce(
    (acc, [vi, translated]) => acc.split(vi).join(translated),
    text,
  );
}
