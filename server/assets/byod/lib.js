// Pure, framework-free helpers shared by app.js (browser) and the Node test
// suite (server/byod-frontend-lib.test.mjs). No DOM/fetch/socket access here —
// keep this file importable from plain Node so its logic gets real test
// coverage without a browser.

export const LANGS = [
  { code: 'vi', short: 'VI', name: 'Tiếng Việt', flag: '/byod-assets/flags/vi.png' },
  { code: 'en', short: 'EN', name: 'English', flag: '/byod-assets/flags/en.png' },
  { code: 'zh', short: '中', name: '中文', flag: '/byod-assets/flags/zh.png' },
  { code: 'ja', short: 'JA', name: '日本語', flag: '/byod-assets/flags/ja.png' },
  { code: 'ko', short: 'KO', name: '한국어', flag: '/byod-assets/flags/ko.png' },
];
// Phải khớp CHÍNH XÁC server/services/catalog.js:MENU_TRANSLATION_LANGS — đây
// là danh sách ngôn ngữ server thật sự dịch tên/mô tả món.
export const MENU_LANGS = ['vi', 'en', 'zh', 'ja', 'ko'];

export function normalizeLang(lang) {
  const code = String(lang || 'vi').toLowerCase().trim().split(/[-_]/)[0];
  return MENU_LANGS.includes(code) ? code : 'vi';
}

export function byodTokenFromPath(pathname) {
  const match = String(pathname || '').match(/^\/BYOD\/([A-Za-z0-9_-]{32,128})\/?$/i);
  return match ? match[1] : '';
}

export function detectLang(languages = []) {
  const list = Array.isArray(languages) ? languages : [languages];
  for (const language of list) {
    const code = String(language || '').toLowerCase().trim().split(/[-_]/)[0];
    if (MENU_LANGS.includes(code)) return code;
  }
  return 'vi';
}

export function money(n) {
  const v = Math.round(Number(n) || 0);
  return `${v.toLocaleString('vi-VN')} ₫`;
}

export function clampQty(n, max = 50) {
  const v = Number.parseInt(n, 10) || 1;
  return Math.max(1, Math.min(max, v));
}

// ---------------------------------------------------------------------------
// Order-item status → chip style. Real backend values (server/services/orders.js,
// xem docs/BYOD_TABLE_ORDERING.md "Trạng thái món"):
//   pending_confirm -> new -> accepted -> preparing -> ready -> served
//   cancelled (bất kỳ lúc nào trước khi phục vụ)
// Bucket theo đúng 6 trạng thái khách cần thấy (xem yêu cầu tích hợp §5.G):
// chờ xác nhận / đã tiếp nhận / đang chế biến / hoàn tất / đã phục vụ / đã hủy.
export const STATUS_BUCKET = {
  pending_confirm: 'wait',
  new: 'received',
  accepted: 'received',
  preparing: 'preparing',
  ready: 'done',
  served: 'served',
  cancelled: 'cancelled',
};

export const STATUS_STYLE = {
  wait: { bg: 'rgba(8,145,178,.08)', bd: 'rgba(8,145,178,.3)', fg: '#0A6E85', icon: 'clock' },
  received: { bg: 'rgba(247,183,51,.16)', bd: 'rgba(247,183,51,.45)', fg: '#7A5400', icon: 'check' },
  preparing: { bg: 'rgba(234,88,12,.12)', bd: 'rgba(234,88,12,.35)', fg: '#9A3412', icon: 'flame' },
  done: { bg: 'rgba(22,163,74,.1)', bd: 'rgba(22,163,74,.3)', fg: '#15803D', icon: 'check' },
  served: { bg: 'rgba(26,34,48,.07)', bd: 'rgba(26,34,48,.16)', fg: '#1A2230', icon: 'bowl' },
  cancelled: { bg: 'rgba(107,114,128,.1)', bd: 'rgba(107,114,128,.28)', fg: '#4B5563', icon: 'x' },
};

export function statusMeta(code, lang = 'vi') {
  const bucket = STATUS_BUCKET[code] || 'wait';
  const style = STATUS_STYLE[bucket];
  const labelKey = {
    wait: 'statusWait', received: 'statusReceived', preparing: 'statusPreparing',
    done: 'statusDone', served: 'statusServed', cancelled: 'statusCancelled',
  }[bucket];
  return { bucket, ...style, label: t(lang, labelKey) };
}

// ---------------------------------------------------------------------------
// Combo option label resolution — cart/order payloads only carry
// {ref_item_id, note}; the human-readable name lives in the menu item's own
// option_groups (mode:'combo'). Resolve it client-side from the already-loaded
// safe menu instead of asking the server for a name it never sends back.
export function comboOptionLabel(menuItem, refItemId) {
  const groups = Array.isArray(menuItem?.option_groups) ? menuItem.option_groups : [];
  for (const g of groups) {
    if (g.mode !== 'combo') continue;
    const opt = (g.options || []).find(o => o.ref_item_id === refItemId);
    if (opt) return { group: g.name, name: opt.name };
  }
  return null;
}

// mods: [{group,name}] as stored in cart/order rows. group === '__addon__' is
// the technical, non-translated key catalog.js uses for flattened add-ons
// (ADDON_MOD_GROUP) — never render that literal string to a guest.
export function modsLabel(mods) {
  return (Array.isArray(mods) ? mods : []).map(m => m?.name).filter(Boolean);
}

export function comboLabels(menuItem, combo) {
  return (Array.isArray(combo) ? combo : []).map(c => {
    const resolved = comboOptionLabel(menuItem, c.ref_item_id);
    return { text: resolved ? resolved.name : c.ref_item_id, note: c.note || null };
  });
}

// ---------------------------------------------------------------------------
// Server error codes (server/services/byod.js `fail(message, status, code)`)
// mapped to localized, guest-facing copy. Falls back to the server's own
// message when a code isn't recognized — never invent a generic message that
// hides a real backend error.
const ERR_KEYS = {
  BYOD_QR_INVALID: 'errQrInvalid',
  BYOD_QR_REVOKED: 'errQrInvalid',
  BYOD_BRANCH_INACTIVE: 'errBranchInactive',
  BYOD_SESSION_CLOSED: 'errSessionClosed',
  BYOD_SESSION_IDLE_TIMEOUT: 'errSessionClosed',
  BYOD_TABLE_NOT_FOUND: 'errQrInvalid',
  BYOD_DEVICE_INVALID: 'errDeviceInvalid',
  BYOD_CART_NOT_FOUND: 'errCartNotFound',
  BYOD_CART_FOREIGN: 'errCartForeign',
  BYOD_ITEM_UNAVAILABLE: 'errItemUnavailable',
  BYOD_OPTION_INVALID: 'errOptionInvalid',
  BYOD_OPTION_COUNT: 'errOptionCount',
  BYOD_COMBO_INVALID: 'errOptionInvalid',
  BYOD_COMBO_COUNT: 'errOptionCount',
  BYOD_IDEMPOTENCY_REQUIRED: 'errGeneric',
  BYOD_SUBMIT_RUNNING: 'errSubmitRunning',
  BYOD_TABLE_CONFIRM_REQUIRED: 'errGeneric',
  BYOD_CART_EMPTY: 'errCartEmpty',
  BYOD_NO_OPEN_ORDER: 'errNoOpenOrder',
  BYOD_SECRET_MISSING: 'errServerConfig',
  BYOD_INVALID: 'errGeneric',
};

export function errorMessage(code, fallbackMessage, lang = 'vi') {
  const key = ERR_KEYS[code];
  const known = key ? t(lang, key) : null;
  return known || String(fallbackMessage || t(lang, 'errGeneric'));
}

export function isFullPageError(code) {
  return code === 'BYOD_QR_INVALID' || code === 'BYOD_QR_REVOKED'
    || code === 'BYOD_BRANCH_INACTIVE' || code === 'BYOD_TABLE_NOT_FOUND'
    || code === 'BYOD_SESSION_IDLE_TIMEOUT';
}

// ---------------------------------------------------------------------------
// UI chrome strings (dialogs, CTAs, empty/error states). Menu item names,
// descriptions and modifier/combo/addon labels always come from the server —
// this table only covers interface copy that has no backend source.
export const STR = {
  vi: {
    area: 'Khu vực', tableWord: 'Bàn', serving: 'Đang phục vụ', tableFree: 'Bàn trống',
    welcome: 'Chào mừng đến Dan D Pak', viewMenu: 'Xem menu', viewCart: 'Xem giỏ hàng / đơn hàng',
    shareNote: 'Các thiết bị cùng bàn có thể cùng chọn món. Món của bạn sẽ vào giỏ chung của {table}.',
    all: 'Tất cả', soldOut: 'Hết món', addToCart: 'Thêm vào giỏ hàng', total: 'Tổng tiền',
    vatIncluded: 'Giá đã gồm thuế', poweredBy: 'Được phát triển bởi Harry (Deron)', items: 'món', cart: 'Giỏ hàng', ordered: 'Đơn đã đặt',
    viewMembers: 'Giỏ hàng cả bàn', viewMine: 'Giỏ hàng của tôi',
    empty: 'Giỏ hàng đang trống', emptyHint: 'Quay lại menu để chọn món cho {table}.',
    addItems: 'Thêm món', placeOrder: 'Đặt món', requestPayment: 'Yêu cầu thanh toán',
    subtotal: 'Tạm tính', discount: 'Giảm giá', surcharge: 'Phụ thu', beforeTax: 'Giá chưa thuế',
    tax: 'Thuế', grandTotal: 'Tổng cộng',
    confirmTitle: 'Gửi toàn bộ món tới nhà hàng?',
    confirmBody: 'Tất cả món trong giỏ chung của {table} — kể cả món do thành viên khác thêm — sẽ được gửi tới bếp và không thể tự sửa sau đó.',
    backCheck: 'Kiểm tra lại', confirmSend: 'Đặt tất cả món',
    successTitle: 'Đã gửi món tới bếp', successBody: 'Bếp đã nhận yêu cầu. Bạn có thể theo dõi trạng thái từng món trong tab Đơn đã đặt.',
    viewOrdered: 'Xem đơn đã đặt',
    statusWait: 'Chờ xác nhận', statusReceived: 'Đã tiếp nhận', statusPreparing: 'Đang chế biến',
    statusDone: 'Hoàn tất', statusServed: 'Đã phục vụ', statusCancelled: 'Đã hủy',
    payTitle: 'Yêu cầu thanh toán', payBody: 'Nhân viên sẽ mang hóa đơn tới {table} và thu tiền trực tiếp. Đây chỉ là thông báo — chưa xác nhận đã thanh toán.',
    payConfirm: 'Gửi yêu cầu', paySent: 'Đã gửi yêu cầu thanh toán', payAcknowledged: 'Nhân viên đã tiếp nhận yêu cầu thanh toán.',
    payPaid: 'Bàn đã thanh toán. Cảm ơn quý khách!', payAlready: 'Yêu cầu thanh toán đang chờ nhân viên xử lý.',
    langTitle: 'Chọn ngôn ngữ', edit: 'Sửa', remove: 'Xóa',
    noteItem: 'Ghi chú cho món', noteComp: 'Ghi chú cho thành phần',
    noteCompSub: 'Ghi chú này chỉ áp dụng cho thành phần đang chọn, không áp dụng cho cả combo.',
    noteItemSub: 'Ghi chú áp dụng cho toàn bộ món này.',
    notePlaceholder: 'VD: ít cay, không hành…', saveNote: 'Lưu ghi chú', back: 'Quay lại',
    searchPlaceholder: 'Bạn muốn tìm món gì?', searchResult: 'Kết quả', searchHint: 'Nhập từ khoá để tìm món',
    searchEmpty: 'Không tìm thấy món phù hợp',
    comboNoteHint: 'Ghi chú ở từng thành phần chỉ áp dụng cho thành phần đó. Ghi chú cho cả combo nhập ở thanh dưới cùng.',
    optional: 'Tùy chọn', required: 'Bắt buộc', chooseOne: 'chọn 1', chooseUpTo: 'chọn tối đa {n}', chooseExact: 'chọn {n}',
    itemNoteEmpty: 'Ghi chú cho món (tùy chọn)',
    addedToCart: 'Đã thêm vào giỏ hàng của tôi', device: 'Thiết bị', orderTurn: 'Lượt gửi',
    offlineBanner: 'Mất kết nối · Giỏ nháp vẫn được giữ trên thiết bị', reconnecting: 'Đang kết nối lại…',
    retry: 'Thử lại', reload: 'Tải lại trang',
    errQrInvalidTitle: 'Mã QR không hợp lệ', errQrInvalidBody: 'Mã này không thuộc bàn nào đang mở. Vui lòng quét lại mã dán trên bàn hoặc nhờ nhân viên hỗ trợ.',
    errSessionClosedTitle: 'Phiên gọi món đã kết thúc', errSessionClosedBody: 'Bàn này đã được đóng phiên gọi món. Nếu bạn vẫn đang dùng bữa, vui lòng nhờ nhân viên mở lại bàn giúp bạn.',
    errBranchInactiveTitle: 'Chi nhánh hiện không hoạt động', errBranchInactiveBody: 'Chi nhánh tạm ngưng phục vụ. Vui lòng quay lại sau.',
    errGeneric: 'Không thể thực hiện yêu cầu. Vui lòng thử lại.',
    errQrInvalid: 'Mã QR không hợp lệ hoặc đã bị thu hồi.', errBranchInactive: 'Chi nhánh hiện không hoạt động.',
    errSessionClosed: 'Phiên gọi món của bàn đã kết thúc.', errDeviceInvalid: 'Thiết bị không hợp lệ, vui lòng tải lại trang.',
    errCartNotFound: 'Món nháp không còn tồn tại.', errCartForeign: 'Không thể sửa món của thiết bị khác.',
    errItemUnavailable: 'Món vừa hết hoặc hiện không phục vụ.', errOptionInvalid: 'Tùy chọn không còn hợp lệ trong thực đơn.',
    errOptionCount: 'Chưa chọn đúng số lượng bắt buộc.', errSubmitRunning: 'Yêu cầu trước đang được xử lý, vui lòng đợi.',
    errCartEmpty: 'Giỏ hàng đang trống.', errNoOpenOrder: 'Bàn chưa có món để thanh toán.',
    errServerConfig: 'Hệ thống đang bảo trì, vui lòng thử lại sau.',
    errNetwork: 'Không thể kết nối máy chủ. Món đã chọn vẫn được giữ trên thiết bị.',
    submitFailedKeep: 'Gửi món thất bại, giỏ hàng của bạn vẫn được giữ nguyên để thử lại.',
    someItemsSkipped: 'Một số món không thể gửi và vẫn còn trong giỏ hàng:',
    priceOrAvailabilityChanged: 'Giá hoặc tình trạng món vừa được cập nhật.',
    loadingMenu: 'Đang tải thực đơn…', loadingApp: 'Đang mở bàn…',
    memberAddedGeneric: 'Có món mới vừa được thêm vào giỏ chung của bàn.',
    callStaff: 'Gọi nhân viên', callStaffSent: 'Đã gọi nhân viên tới bàn', callStaffAlready: 'Đã gọi nhân viên, đang chờ hỗ trợ',
    sessionExpiredTitle: 'Phiên gọi món đã kết thúc',
    sessionExpiredBody: 'Bàn của bạn đã ngừng hoạt động một thời gian nên phiên gọi món đã tự đóng. Vui lòng quét lại mã QR trên bàn để tiếp tục.',
    rescanQr: 'Quét lại mã QR',
    qrScanTitle: 'Quét mã QR trên bàn của bạn',
    qrScanFrameHint: 'Đưa mã QR vào giữa khung',
    qrScanHint: 'Mã QR dán trên bàn hoặc trên kẹp menu. Vui lòng cho phép truy cập camera khi trình duyệt hỏi.',
    cameraDeniedTitle: 'Không thể truy cập camera',
    cameraDenied: 'Vui lòng cho phép quyền camera trong phần cài đặt của trình duyệt, sau đó thử lại.',
  },
  en: {
    area: 'Area', tableWord: 'Table', serving: 'Serving', tableFree: 'Table free',
    welcome: 'Welcome to Dan D Pak', viewMenu: 'View menu', viewCart: 'View cart / orders',
    shareNote: 'Everyone at this table can order from their own phone. Your items go to {table}’s shared cart.',
    all: 'All', soldOut: 'Sold out', addToCart: 'Add to cart', total: 'Total',
    vatIncluded: 'Tax included', poweredBy: 'Powered by Harry (Deron)', items: 'items', cart: 'Cart', ordered: 'Placed orders',
    viewMembers: 'Table cart', viewMine: 'My cart',
    empty: 'Your cart is empty', emptyHint: 'Go back to the menu to pick something for {table}.',
    addItems: 'Add items', placeOrder: 'Place order', requestPayment: 'Request payment',
    subtotal: 'Subtotal', discount: 'Discount', surcharge: 'Surcharge', beforeTax: 'Before tax',
    tax: 'Tax', grandTotal: 'Grand total',
    confirmTitle: 'Send all items to the kitchen?',
    confirmBody: 'Every item in {table}’s shared cart — including items added by other members — will be sent to the kitchen and can no longer be edited.',
    backCheck: 'Check again', confirmSend: 'Place all items',
    successTitle: 'Sent to the kitchen', successBody: 'The kitchen received your order. Track each item under Placed orders.',
    viewOrdered: 'View placed orders',
    statusWait: 'Awaiting confirmation', statusReceived: 'Received', statusPreparing: 'Preparing',
    statusDone: 'Ready', statusServed: 'Served', statusCancelled: 'Cancelled',
    payTitle: 'Request payment', payBody: 'A staff member will bring the bill to {table} and take payment there. This only sends a notice — it does not confirm payment.',
    payConfirm: 'Send request', paySent: 'Payment request sent', payAcknowledged: 'Staff acknowledged your payment request.',
    payPaid: 'This table has been paid. Thank you!', payAlready: 'Your payment request is waiting on staff.',
    langTitle: 'Choose language', edit: 'Edit', remove: 'Remove',
    noteItem: 'Note for this item', noteComp: 'Note for this component',
    noteCompSub: 'This note applies only to the selected component, not the whole combo.',
    noteItemSub: 'This note applies to the whole item.',
    notePlaceholder: 'e.g. less spicy, no onion…', saveNote: 'Save note', back: 'Back',
    searchPlaceholder: 'What are you looking for?', searchResult: 'Results', searchHint: 'Type to search the menu',
    searchEmpty: 'No matching dish',
    comboNoteHint: 'A note on one component applies to that component only. Use the bar below for a note on the whole combo.',
    optional: 'Optional', required: 'Required', chooseOne: 'pick 1', chooseUpTo: 'pick up to {n}', chooseExact: 'pick {n}',
    itemNoteEmpty: 'Note for this item (optional)',
    addedToCart: 'Added to my cart', device: 'Device', orderTurn: 'Order turn',
    offlineBanner: 'Offline · your draft is kept on this device', reconnecting: 'Reconnecting…',
    retry: 'Try again', reload: 'Reload page',
    errQrInvalidTitle: 'Invalid QR code', errQrInvalidBody: 'This code doesn’t match any open table. Please rescan the code on your table or ask staff for help.',
    errSessionClosedTitle: 'Ordering session ended', errSessionClosedBody: 'This table’s ordering session was closed. If you’re still dining, please ask a staff member to reopen it.',
    errBranchInactiveTitle: 'Branch currently closed', errBranchInactiveBody: 'This branch is temporarily not serving. Please check back later.',
    errGeneric: 'Couldn’t complete that request. Please try again.',
    errQrInvalid: 'Invalid or revoked QR code.', errBranchInactive: 'This branch is currently inactive.',
    errSessionClosed: 'This table’s ordering session has ended.', errDeviceInvalid: 'Invalid device, please reload the page.',
    errCartNotFound: 'This draft item no longer exists.', errCartForeign: 'You can’t edit another device’s item.',
    errItemUnavailable: 'This item just sold out or is unavailable.', errOptionInvalid: 'This option is no longer valid on the menu.',
    errOptionCount: 'Please pick the required number of options.', errSubmitRunning: 'A previous request is still processing, please wait.',
    errCartEmpty: 'Your cart is empty.', errNoOpenOrder: 'This table has no order to pay yet.',
    errServerConfig: 'The system is under maintenance, please try again later.',
    errNetwork: 'Couldn’t reach the server. Your selections are still kept on this device.',
    submitFailedKeep: 'Sending failed — your cart was kept so you can try again.',
    someItemsSkipped: 'Some items couldn’t be sent and remain in your cart:',
    priceOrAvailabilityChanged: 'Price or availability was just updated.',
    loadingMenu: 'Loading menu…', loadingApp: 'Opening your table…',
    memberAddedGeneric: 'A new item was just added to the table’s shared cart.',
    callStaff: 'Call staff', callStaffSent: 'Staff has been called to your table', callStaffAlready: 'Staff already called, waiting for help',
    sessionExpiredTitle: 'Ordering session ended',
    sessionExpiredBody: 'Your table has been inactive for a while, so the ordering session closed automatically. Please scan the QR code on your table to continue.',
    rescanQr: 'Scan QR again',
    qrScanTitle: 'Scan the QR code on your table',
    qrScanFrameHint: 'Center the QR code in the frame',
    qrScanHint: 'The code is on your table or the menu clip. Please allow camera access when your browser asks.',
    cameraDeniedTitle: 'Can’t access the camera',
    cameraDenied: 'Please allow camera access in your browser settings, then try again.',
  },
  zh: {
    area: '区域', tableWord: '桌号', serving: '服务中', tableFree: '空桌',
    welcome: '欢迎来到 Dan D Pak', viewMenu: '查看菜单', viewCart: '查看购物车 / 订单',
    shareNote: '同桌的所有设备都可以一起点餐。您选的菜会进入{table}的共享购物车。',
    all: '全部', soldOut: '已售完', addToCart: '加入购物车', total: '总计',
    vatIncluded: '价格已含税', poweredBy: '由 Harry（Deron）提供技术支持', items: '项', cart: '购物车', ordered: '已下单',
    viewMembers: '全桌购物车', viewMine: '我的购物车',
    empty: '购物车是空的', emptyHint: '返回菜单为{table}选购菜品。',
    addItems: '加菜', placeOrder: '下单', requestPayment: '请求结账',
    subtotal: '小计', discount: '折扣', surcharge: '附加费', beforeTax: '税前金额',
    tax: '税费', grandTotal: '总计',
    confirmTitle: '将全部菜品送到后厨？',
    confirmBody: '{table}共享购物车中的所有菜品——包括其他成员添加的——都将送到后厨，之后无法自行修改。',
    backCheck: '再检查一下', confirmSend: '全部下单',
    successTitle: '已送到后厨', successBody: '后厨已收到订单。您可以在"已下单"中查看每道菜的状态。',
    viewOrdered: '查看已下单',
    statusWait: '待确认', statusReceived: '已接单', statusPreparing: '制作中',
    statusDone: '已完成', statusServed: '已上菜', statusCancelled: '已取消',
    payTitle: '请求结账', payBody: '服务员会将账单送到{table}并当面收款。这只是发送通知，并不代表已完成付款。',
    payConfirm: '发送请求', paySent: '已发送结账请求', payAcknowledged: '服务员已收到您的结账请求。',
    payPaid: '本桌已完成结账，谢谢惠顾！', payAlready: '结账请求正在等待服务员处理。',
    langTitle: '选择语言', edit: '修改', remove: '删除',
    noteItem: '菜品备注', noteComp: '该组成部分的备注',
    noteCompSub: '此备注仅适用于所选的组成部分，不适用于整个套餐。',
    noteItemSub: '此备注适用于整道菜品。',
    notePlaceholder: '例如：少辣、不要葱……', saveNote: '保存备注', back: '返回',
    searchPlaceholder: '您想找什么菜？', searchResult: '搜索结果', searchHint: '输入关键字搜索菜品',
    searchEmpty: '没有找到相关菜品',
    comboNoteHint: '组成部分的备注只对该部分生效。整个套餐的备注请在底部输入。',
    optional: '可选', required: '必选', chooseOne: '选1项', chooseUpTo: '最多选{n}项', chooseExact: '选{n}项',
    itemNoteEmpty: '菜品备注（可选）',
    addedToCart: '已加入我的购物车', device: '设备', orderTurn: '批次',
    offlineBanner: '已断线 · 草稿仍保存在本设备', reconnecting: '正在重新连接…',
    retry: '重试', reload: '重新加载页面',
    errQrInvalidTitle: '二维码无效', errQrInvalidBody: '此码不属于任何开放中的桌台。请重新扫描桌上的二维码，或请服务员协助。',
    errSessionClosedTitle: '点餐会话已结束', errSessionClosedBody: '该桌的点餐会话已关闭。如仍在用餐，请请服务员重新开桌。',
    errBranchInactiveTitle: '门店暂未营业', errBranchInactiveBody: '该门店暂停服务，请稍后再试。',
    errGeneric: '操作未能完成，请重试。',
    errQrInvalid: '二维码无效或已被吊销。', errBranchInactive: '该门店当前未启用。',
    errSessionClosed: '该桌的点餐会话已结束。', errDeviceInvalid: '设备无效，请重新加载页面。',
    errCartNotFound: '该草稿项已不存在。', errCartForeign: '无法修改其他设备添加的菜品。',
    errItemUnavailable: '该菜品刚售完或暂不可点。', errOptionInvalid: '该选项在菜单中已失效。',
    errOptionCount: '请选择所需的数量。', errSubmitRunning: '上一个请求仍在处理，请稍候。',
    errCartEmpty: '购物车是空的。', errNoOpenOrder: '该桌尚无可结账的订单。',
    errServerConfig: '系统维护中，请稍后再试。',
    errNetwork: '无法连接服务器，您的选择仍保存在本设备。',
    submitFailedKeep: '发送失败——购物车内容已保留，可重试。',
    someItemsSkipped: '以下菜品未能送出，仍保留在购物车中：',
    priceOrAvailabilityChanged: '价格或库存状态刚刚更新。',
    loadingMenu: '菜单加载中…', loadingApp: '正在打开桌台…',
    memberAddedGeneric: '有新菜品刚被加入本桌的共享购物车。',
    callStaff: '呼叫服务员', callStaffSent: '已呼叫服务员到您的桌台', callStaffAlready: '已呼叫服务员，正在等待处理',
    sessionExpiredTitle: '点餐会话已结束',
    sessionExpiredBody: '您的桌台已闲置一段时间，点餐会话已自动关闭。请重新扫描桌上的二维码以继续点餐。',
    rescanQr: '重新扫码',
    qrScanTitle: '扫描您桌上的二维码',
    qrScanFrameHint: '将二维码对准取景框中间',
    qrScanHint: '二维码贴在桌上或菜单夹上。浏览器询问时请允许使用摄像头。',
    cameraDeniedTitle: '无法访问摄像头',
    cameraDenied: '请在浏览器设置中允许摄像头权限，然后重试。',
  },
  ja: {
    area: 'エリア', tableWord: 'テーブル', serving: 'サービス中', tableFree: '空席',
    welcome: 'Dan D Pak へようこそ', viewMenu: 'メニューを見る', viewCart: 'カート / 注文を見る',
    shareNote: '同じテーブルの端末は一緒に注文できます。選んだ商品は{table}の共有カートに入ります。',
    all: 'すべて', soldOut: '売り切れ', addToCart: 'カートに追加', total: '合計',
    vatIncluded: '税込価格', poweredBy: 'Harry（Deron）によって開発', items: '点', cart: 'カート', ordered: '注文済み',
    viewMembers: 'テーブル全体のカート', viewMine: '自分のカート',
    empty: 'カートは空です', emptyHint: 'メニューに戻って{table}の商品を選んでください。',
    addItems: '追加注文', placeOrder: '注文する', requestPayment: '会計を依頼',
    subtotal: '小計', discount: '割引', surcharge: '追加料金', beforeTax: '税抜金額',
    tax: '税', grandTotal: '合計金額',
    confirmTitle: 'すべての商品を厨房に送りますか？',
    confirmBody: '{table}の共有カート内のすべての商品（他のメンバーが追加したものを含む）が厨房に送られ、その後は変更できません。',
    backCheck: 'もう一度確認', confirmSend: 'すべて注文する',
    successTitle: '厨房に送信しました', successBody: '厨房が注文を受け付けました。各商品の状況は「注文済み」タブで確認できます。',
    viewOrdered: '注文済みを見る',
    statusWait: '確認待ち', statusReceived: '受付済み', statusPreparing: '調理中',
    statusDone: '完成', statusServed: '提供済み', statusCancelled: 'キャンセル済み',
    payTitle: '会計を依頼', payBody: 'スタッフが伝票を{table}にお持ちし、その場でお会計します。これは通知のみで、支払い完了を意味しません。',
    payConfirm: '依頼を送る', paySent: '会計依頼を送信しました', payAcknowledged: 'スタッフが会計依頼を受け付けました。',
    payPaid: 'このテーブルはお会計済みです。ありがとうございました！', payAlready: '会計依頼はスタッフの対応待ちです。',
    langTitle: '言語を選択', edit: '編集', remove: '削除',
    noteItem: 'この商品のメモ', noteComp: 'この構成品のメモ',
    noteCompSub: 'このメモは選択した構成品のみに適用され、セット全体には適用されません。',
    noteItemSub: 'このメモは商品全体に適用されます。',
    notePlaceholder: '例：辛さ控えめ、ネギ抜き…', saveNote: 'メモを保存', back: '戻る',
    searchPlaceholder: '何をお探しですか？', searchResult: '検索結果', searchHint: 'キーワードを入力して検索',
    searchEmpty: '該当する商品が見つかりません',
    comboNoteHint: '構成品ごとのメモはその構成品にのみ適用されます。セット全体のメモは下のバーに入力してください。',
    optional: '任意', required: '必須', chooseOne: '1つ選択', chooseUpTo: '最大{n}つ選択', chooseExact: '{n}つ選択',
    itemNoteEmpty: 'この商品のメモ（任意）',
    addedToCart: '自分のカートに追加しました', device: '端末', orderTurn: '送信回',
    offlineBanner: 'オフライン · 下書きはこの端末に保存されます', reconnecting: '再接続中…',
    retry: '再試行', reload: 'ページを再読み込み',
    errQrInvalidTitle: 'QRコードが無効です', errQrInvalidBody: 'このコードは現在開いているテーブルと一致しません。テーブルのコードを再スキャンするか、スタッフにお尋ねください。',
    errSessionClosedTitle: '注文セッションが終了しました', errSessionClosedBody: 'このテーブルの注文セッションは終了しました。まだお食事中の場合は、スタッフに再開をご依頼ください。',
    errBranchInactiveTitle: '現在営業していません', errBranchInactiveBody: 'この店舗は一時的に営業しておりません。しばらくしてから再度お試しください。',
    errGeneric: '処理を完了できませんでした。もう一度お試しください。',
    errQrInvalid: 'QRコードが無効か、失効しています。', errBranchInactive: 'この店舗は現在無効です。',
    errSessionClosed: 'このテーブルの注文セッションは終了しました。', errDeviceInvalid: '端末が無効です。ページを再読み込みしてください。',
    errCartNotFound: 'この下書き商品はもう存在しません。', errCartForeign: '他の端末の商品は編集できません。',
    errItemUnavailable: 'この商品は売り切れか、現在ご注文いただけません。', errOptionInvalid: 'このオプションはメニュー上で無効になりました。',
    errOptionCount: '必要な数を選択してください。', errSubmitRunning: '前のリクエストを処理中です。しばらくお待ちください。',
    errCartEmpty: 'カートは空です。', errNoOpenOrder: 'このテーブルにはまだお会計できる注文がありません。',
    errServerConfig: 'システムメンテナンス中です。しばらくしてから再度お試しください。',
    errNetwork: 'サーバーに接続できません。選択内容はこの端末に保存されています。',
    submitFailedKeep: '送信に失敗しました。カートの内容は保持されているので、再度お試しください。',
    someItemsSkipped: '一部の商品は送信できず、カートに残っています：',
    priceOrAvailabilityChanged: '価格または在庫状況が更新されました。',
    loadingMenu: 'メニューを読み込み中…', loadingApp: 'テーブルを開いています…',
    memberAddedGeneric: 'テーブルの共有カートに新しい商品が追加されました。',
    callStaff: 'スタッフを呼ぶ', callStaffSent: 'テーブルにスタッフを呼びました', callStaffAlready: 'すでにスタッフを呼んでいます。対応をお待ちください',
    sessionExpiredTitle: '注文セッションが終了しました',
    sessionExpiredBody: 'テーブルが一定時間操作されなかったため、注文セッションが自動的に終了しました。続けるにはテーブルのQRコードを再スキャンしてください。',
    rescanQr: 'QRコードを再スキャン',
    qrScanTitle: 'テーブルのQRコードをスキャン',
    qrScanFrameHint: 'QRコードを枠の中央に合わせてください',
    qrScanHint: 'QRコードはテーブルまたはメニュークリップに貼ってあります。ブラウザが確認したらカメラへのアクセスを許可してください。',
    cameraDeniedTitle: 'カメラにアクセスできません',
    cameraDenied: 'ブラウザの設定でカメラへのアクセスを許可してから、もう一度お試しください。',
  },
  ko: {
    area: '구역', tableWord: '테이블', serving: '이용 중', tableFree: '빈 테이블',
    welcome: 'Dan D Pak에 오신 것을 환영합니다', viewMenu: '메뉴 보기', viewCart: '장바구니 / 주문 보기',
    shareNote: '같은 테이블의 모든 기기가 함께 주문할 수 있습니다. 선택한 메뉴는 {table}의 공용 장바구니에 담깁니다.',
    all: '전체', soldOut: '품절', addToCart: '장바구니에 담기', total: '합계',
    vatIncluded: '세금 포함 가격', poweredBy: 'Harry(Deron)가 개발', items: '개', cart: '장바구니', ordered: '주문 완료',
    viewMembers: '테이블 전체 장바구니', viewMine: '내 장바구니',
    empty: '장바구니가 비어 있습니다', emptyHint: '메뉴로 돌아가 {table}의 메뉴를 선택하세요.',
    addItems: '메뉴 추가', placeOrder: '주문하기', requestPayment: '결제 요청',
    subtotal: '소계', discount: '할인', surcharge: '추가 요금', beforeTax: '세전 금액',
    tax: '세금', grandTotal: '총 합계',
    confirmTitle: '모든 메뉴를 주방으로 보낼까요?',
    confirmBody: '{table} 공용 장바구니의 모든 메뉴가 — 다른 사람이 추가한 것을 포함해 — 주방으로 전송되며 이후 수정할 수 없습니다.',
    backCheck: '다시 확인', confirmSend: '전체 주문',
    successTitle: '주방으로 전송됨', successBody: '주방이 주문을 받았습니다. 각 메뉴 상태는 주문 완료 탭에서 확인하세요.',
    viewOrdered: '주문 완료 보기',
    statusWait: '확인 대기', statusReceived: '접수됨', statusPreparing: '조리 중',
    statusDone: '완료', statusServed: '서빙 완료', statusCancelled: '취소됨',
    payTitle: '결제 요청', payBody: '직원이 {table}로 계산서를 가져와 직접 결제를 진행합니다. 이 요청은 알림일 뿐이며 결제 완료를 의미하지 않습니다.',
    payConfirm: '요청 보내기', paySent: '결제 요청을 보냈습니다', payAcknowledged: '직원이 결제 요청을 확인했습니다.',
    payPaid: '이 테이블은 결제가 완료되었습니다. 감사합니다!', payAlready: '결제 요청이 직원 처리를 기다리고 있습니다.',
    langTitle: '언어 선택', edit: '수정', remove: '삭제',
    noteItem: '메뉴 요청사항', noteComp: '구성 메뉴 요청사항',
    noteCompSub: '이 요청사항은 선택한 구성 메뉴에만 적용되며 세트 전체에는 적용되지 않습니다.',
    noteItemSub: '이 요청사항은 메뉴 전체에 적용됩니다.',
    notePlaceholder: '예: 덜 맵게, 파 빼고…', saveNote: '요청사항 저장', back: '뒤로',
    searchPlaceholder: '무엇을 찾으시나요?', searchResult: '검색 결과', searchHint: '검색어를 입력하세요',
    searchEmpty: '해당하는 메뉴가 없습니다',
    comboNoteHint: '구성 메뉴별 요청사항은 해당 구성에만 적용됩니다. 세트 전체 요청사항은 하단 입력창을 이용하세요.',
    optional: '선택', required: '필수', chooseOne: '1개 선택', chooseUpTo: '최대 {n}개 선택', chooseExact: '{n}개 선택',
    itemNoteEmpty: '메뉴 요청사항 (선택)',
    addedToCart: '내 장바구니에 담았습니다', device: '기기', orderTurn: '전송 회차',
    offlineBanner: '오프라인 · 임시 저장은 이 기기에 유지됩니다', reconnecting: '다시 연결 중…',
    retry: '다시 시도', reload: '페이지 새로고침',
    errQrInvalidTitle: '유효하지 않은 QR 코드', errQrInvalidBody: '이 코드는 열려 있는 테이블과 일치하지 않습니다. 테이블의 코드를 다시 스캔하거나 직원에게 문의하세요.',
    errSessionClosedTitle: '주문 세션이 종료되었습니다', errSessionClosedBody: '이 테이블의 주문 세션이 종료되었습니다. 아직 식사 중이시라면 직원에게 다시 열어 달라고 요청하세요.',
    errBranchInactiveTitle: '현재 영업하지 않습니다', errBranchInactiveBody: '이 지점은 일시적으로 서비스를 제공하지 않습니다. 나중에 다시 확인해 주세요.',
    errGeneric: '요청을 완료할 수 없습니다. 다시 시도해 주세요.',
    errQrInvalid: 'QR 코드가 유효하지 않거나 취소되었습니다.', errBranchInactive: '현재 이 지점은 비활성 상태입니다.',
    errSessionClosed: '이 테이블의 주문 세션이 종료되었습니다.', errDeviceInvalid: '기기가 유효하지 않습니다. 페이지를 새로고침해 주세요.',
    errCartNotFound: '이 임시 항목은 더 이상 존재하지 않습니다.', errCartForeign: '다른 기기의 메뉴는 수정할 수 없습니다.',
    errItemUnavailable: '이 메뉴는 방금 품절되었거나 주문할 수 없습니다.', errOptionInvalid: '이 옵션은 더 이상 메뉴에 유효하지 않습니다.',
    errOptionCount: '필요한 개수만큼 선택해 주세요.', errSubmitRunning: '이전 요청이 아직 처리 중입니다. 잠시만 기다려 주세요.',
    errCartEmpty: '장바구니가 비어 있습니다.', errNoOpenOrder: '이 테이블에는 아직 결제할 주문이 없습니다.',
    errServerConfig: '시스템 점검 중입니다. 나중에 다시 시도해 주세요.',
    errNetwork: '서버에 연결할 수 없습니다. 선택한 내용은 이 기기에 유지됩니다.',
    submitFailedKeep: '전송에 실패했습니다 — 장바구니 내용은 그대로 유지되어 다시 시도할 수 있습니다.',
    someItemsSkipped: '일부 메뉴를 전송하지 못해 장바구니에 남아 있습니다:',
    priceOrAvailabilityChanged: '가격 또는 재고 상태가 방금 업데이트되었습니다.',
    loadingMenu: '메뉴를 불러오는 중…', loadingApp: '테이블을 여는 중…',
    memberAddedGeneric: '테이블 공용 장바구니에 새 메뉴가 추가되었습니다.',
    callStaff: '직원 호출', callStaffSent: '테이블로 직원을 호출했습니다', callStaffAlready: '이미 직원을 호출했습니다. 곧 도와드리겠습니다',
    sessionExpiredTitle: '주문 세션이 종료되었습니다',
    sessionExpiredBody: '테이블이 한동안 사용되지 않아 주문 세션이 자동으로 종료되었습니다. 계속하려면 테이블의 QR 코드를 다시 스캔해 주세요.',
    rescanQr: 'QR 코드 다시 스캔',
    qrScanTitle: '테이블의 QR 코드를 스캔하세요',
    qrScanFrameHint: 'QR 코드를 프레임 중앙에 맞춰주세요',
    qrScanHint: 'QR 코드는 테이블이나 메뉴 클립에 붙어 있습니다. 브라우저에서 물어보면 카메라 접근을 허용해 주세요.',
    cameraDeniedTitle: '카메라에 접근할 수 없습니다',
    cameraDenied: '브라우저 설정에서 카메라 권한을 허용한 후 다시 시도해 주세요.',
  },
};

export function t(lang, key, vars) {
  const table = STR[normalizeLang(lang)] || STR.vi;
  let s = table[key] != null ? table[key] : (STR.vi[key] != null ? STR.vi[key] : key);
  if (vars) for (const k of Object.keys(vars)) s = s.split(`{${k}}`).join(String(vars[k]));
  return s;
}

// Every language must define the same key set — a missing key silently falls
// back to Vietnamese in the UI, which reads as a translation bug to a guest.
export function missingKeysByLang() {
  const base = Object.keys(STR.vi);
  const out = {};
  for (const lang of Object.keys(STR)) {
    if (lang === 'vi') continue;
    const keys = new Set(Object.keys(STR[lang]));
    const missing = base.filter(k => !keys.has(k));
    if (missing.length) out[lang] = missing;
  }
  return out;
}
