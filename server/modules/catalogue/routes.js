// Route ownership: CATALOGUE BÁN LẺ — máy tablet đặt ngoài quầy cho KHÁCH tự
// chọn hàng. Nghiệp vụ ở services/catalogue.js (thiết bị + cấu hình màn khách)
// và services/retailCart.js (giỏ hàng, dùng CHUNG với POS bán lẻ).
//
// PHÂN TẦNG QUYỀN Ở ĐÂY KHÁC MỌI MODULE KHÁC, nên đọc kỹ:
//
//   /catalogue/*  = MÁY KHÁCH gọi. Máy này KHÔNG có phiên đăng nhập nhân viên —
//                   nó nằm ngoài quầy, ai cũng chạm được. Route mở như các
//                   route iPad self-order, và vì thế TUYỆT ĐỐI không được trả
//                   về dữ liệu khách hàng, doanh thu hay danh sách giỏ của máy
//                   khác. Nó chỉ ĐỌC catalogue và GHI vào ô giỏ của chính nó.
//
//   /settings/catalogue/* = QUẢN LÝ gọi, gác quyền như mọi cấu hình khác.
//
// Máy khách cũng KHÔNG nhận realtime 'retail:cart' (event đó chứa PII nên không
// nằm trong IPAD_EVENTS ở realtime.js) — đúng như thiết kế.
import * as Catalogue from '../../services/catalogue.js';
import * as RetailCart from '../../services/retailCart.js';
import * as BookMenu from '../../services/bookMenu.js';
import * as AppSettings from '../../services/settings.js';
import * as Retail from '../../services/retail.js';
import * as Pay from '../../services/payments.js';
import { getOrder } from '../../services/orders.js';
import { emit } from '../../realtime.js';

export function registerCatalogueRoutes(api, {
  wrap, guardAny, branch, visibleBranch, saveBase64Image, CATALOGUE_UPLOADS_DIR,
}) {
  // Định danh máy: app gửi x-device-id trong MỌI request (xem api_client.dart).
  const deviceOf = (req) => String(req.headers['x-device-id'] || req.body?.device || '').trim();

  // ── MÀN KHÁCH ─────────────────────────────────────────────────────────────

  /** Máy báo danh + nhận ô giỏ hàng của nó. Gọi lúc mở màn và lặp theo nhịp. */
  api.post('/catalogue/register', wrap((req) => {
    const b = visibleBranch(req);
    const may = Catalogue.registerCatalogueDevice(b, {
      device: deviceOf(req), name: req.body?.name,
    });
    const o = RetailCart.claimCatalogueSlot(b, {
      device: may.device_id, deviceName: may.name,
    });
    return { ...may, slot: o.slot, config: Catalogue.getPublicCatalogueConfig(b) };
  }));

  api.get('/catalogue/config', wrap((req) => Catalogue.getPublicCatalogueConfig(visibleBranch(req))));
  api.get('/catalogue/book', wrap((req) => BookMenu.getPublicRetailCatalogue(visibleBranch(req))));

  /**
   * Khách thêm/bớt hàng → ghi vào ô giỏ của CHÍNH MÁY NÀY.
   *
   * Ô giỏ do server cấp lại mỗi lần chứ KHÔNG tin số ô máy khách gửi lên: máy
   * đặt ngoài quầy mà tự khai ô là ai chạm vào cũng ghi đè được giỏ của thu
   * ngân đang thu tiền dở.
   */
  api.post('/catalogue/cart', wrap((req) => {
    const b = visibleBranch(req);
    const may = Catalogue.registerCatalogueDevice(b, { device: deviceOf(req) });
    const o = RetailCart.claimCatalogueSlot(b, { device: may.device_id, deviceName: may.name });
    const snap = req.body?.snapshot ?? req.body ?? {};
    return RetailCart.saveCart(b, o.slot, {
      ...snap,
      origin: 'catalogue',
      device_name: may.name,
      // Khách sửa giỏ sau khi đã đòi thanh toán → gỡ cờ đỏ, vì đơn đã đổi.
      pay_requested: false,
      pay_method: '',
    }, { actor: 'catalogue', device: may.device_id });
  }));

  /** Khách bấm Thanh toán → tab bên POS chuyển đỏ. Không tạo đơn, không thu tiền. */
  api.post('/catalogue/request-payment', wrap((req) => {
    const b = visibleBranch(req);
    const may = Catalogue.registerCatalogueDevice(b, { device: deviceOf(req) });
    const o = RetailCart.claimCatalogueSlot(b, { device: may.device_id, deviceName: may.name });
    return RetailCart.requestCataloguePayment(b, o.slot, {
      method: req.body?.method, device: may.device_id,
    });
  }));

  /**
   * Khách bấm "Chuyển khoản" ở catalogue → TỰ ĐỐI SOÁT như POS/self-order.
   *
   * Máy khách KHÔNG tự tạo đơn (không có quyền 'pay') — SERVER tạo giúp: dựng
   * đơn nháp MỞ từ giỏ của ô này (đúng hàm POS bán lẻ dùng), bật cờ đỏ báo POS,
   * rồi sinh QR động theo bill để webhook SePay/payOS tự khớp và đóng bill.
   * Trả về order_id + qr để máy khách hiện QR và poll trạng thái.
   */
  api.post('/catalogue/checkout', wrap(async (req) => {
    const b = visibleBranch(req);
    const may = Catalogue.registerCatalogueDevice(b, { device: deviceOf(req) });
    const o = RetailCart.claimCatalogueSlot(b, { device: may.device_id, deviceName: may.name });
    const cart = RetailCart.getCart(b, o.slot);
    const rawLines = Array.isArray(cart.lines) ? cart.lines
      : (Array.isArray(cart.items) ? cart.items : []);
    const items = rawLines
      .map((it) => ({
        sku_id: it?.sku?.id ?? it?.sku_id ?? it?.id,
        qty: Number(it?.qty) || 0,
        lot_id: it?.lot_id ?? null,
        voucher_id: it?.voucher_id ?? null,
      }))
      .filter((it) => it.sku_id && it.qty > 0);
    if (!items.length) throw new Error('Giỏ hàng trống');

    const draft = Retail.createDraftOrder({
      items,
      voucher_id: cart.order_voucher_id || cart.voucher_id || null,
      customer: cart.customer || null,
      manual_discount: Number(cart.manual_discount) || 0,
      branch_id: b,
      cashier: 'catalogue',
      device_id: may.device_id,
      client_request_id: String(req.body?.client_request_id || '').trim() || undefined,
    });

    // Vẫn báo nhân viên: tab POS chuyển đỏ y như luồng cũ.
    try {
      RetailCart.requestCataloguePayment(b, o.slot, { method: 'qr', device: may.device_id });
    } catch { /* không chặn thanh toán nếu cờ đỏ lỗi */ }

    const qr = await Pay.generateCustomerPaymentQr(draft.id, { method: 'qrcode' }, b);
    return { ok: true, order_id: draft.id, bill_no: draft.bill_no || '', qr };
  }));

  /**
   * Poll trạng thái đơn cho MÀN KHÁCH (mở, không phiên nhân viên). CHỈ trả
   * trạng thái + số tiền còn lại — KHÔNG trả PII/khách/dòng hàng. Khóa theo chi
   * nhánh để không dò được đơn chi nhánh khác.
   */
  api.get('/catalogue/order-status/:id', wrap((req) => {
    const b = visibleBranch(req);
    const order = getOrder(req.params.id);
    if (!order || (order.branch_id && order.branch_id !== b)) {
      return { found: false, status: '', paid: false };
    }
    return { found: true, status: order.status, paid: order.status === 'paid' };
  }));

  /**
   * Thoát màn khách (bấm logo 3 lần rồi nhập mật khẩu).
   *
   * DÙNG CHUNG mật khẩu với màn iPad khách (Cài đặt → Thiết bị khách). Trước đây
   * catalogue có mật khẩu thoát riêng — cửa hàng phải nhớ hai mã cho cùng một
   * việc "mở khoá máy đưa khách", và quên mã riêng là kẹt luôn máy đó.
   */
  api.post('/catalogue/exit', wrap((req) => {
    const b = visibleBranch(req);
    if (!AppSettings.verifyIpadStaffPin(req.body?.pin, b)) {
      throw new Error('Mật khẩu không đúng');
    }
    return { ok: true };
  }));

  // ── CÀI ĐẶT (quản lý) ─────────────────────────────────────────────────────
  const gac = guardAny('settings.bookmenu', 'settings.manage');

  api.get('/settings/catalogue', gac, wrap((req) => Catalogue.getCatalogueConfig(branch(req))));
  api.post('/settings/catalogue', gac, wrap((req) => Catalogue.saveCatalogueConfig(req.body, branch(req))));

  api.get('/settings/catalogue/devices', gac,
    wrap((req) => ({ devices: Catalogue.listCatalogueDevices(branch(req)) })));
  api.post('/settings/catalogue/devices/rename', gac,
    wrap((req) => Catalogue.renameCatalogueDevice(branch(req), req.body)));

  /**
   * Ảnh QR tĩnh dùng tạm khi chưa đấu nối cổng thanh toán theo pháp nhân.
   *
   * LƯU VÀO CẤU HÌNH THANH TOÁN, KHÔNG PHẢI CẤU HÌNH CATALOGUE.
   *
   * Đây là một PHƯƠNG THỨC THANH TOÁN của cửa hàng: bật lên là nó hiện ở màn
   * phụ, iPad self-order, catalogue, POS — mọi chỗ có bước chuyển khoản. Cất
   * riêng trong catalogue thì ba màn kia không thấy, và người đi tìm chỗ cấu
   * hình thanh toán cũng không nghĩ tới đó.
   */
  api.post('/settings/catalogue/qr-upload', gac, wrap((req) => {
    const b = branch(req);
    const { url } = saveBase64Image(req, {
      dir: CATALOGUE_UPLOADS_DIR, urlBase: '/uploads/catalogue',
      prefix: 'qr_', auditAction: 'catalogue.qr_upload',
    });
    const ops = AppSettings.getOperationsConfig(b);
    AppSettings.updateSettings({
      operations_config: {
        ...ops,
        payment: { ...(ops.payment || {}), staticQrUrl: url },
      },
    }, b);
    emit('payment:config', { staticQr: true }, b);
    return { ok: true, url };
  }));

  /**
   * THÊM MỘT TRANG catalogue — mỗi lần một tấm ảnh.
   * Xem chú thích ở BookMenu.addBookPage() về việc vì sao không import cả thư mục.
   */
  api.post('/settings/book-menu/page', gac, wrap((req) => {
    const b = branch(req);
    const out = BookMenu.addBookPage(req.body, b, () => saveBase64Image(req, {
      dir: CATALOGUE_UPLOADS_DIR, urlBase: '/uploads/catalogue',
      prefix: 'page_', auditAction: 'book_menu.page_upload',
    }));
    emit('book-menu:updated', { activeBookId: out.activeBookId }, b);
    return out;
  }));

  api.post('/settings/book-menu/page/remove', gac, wrap((req) => {
    const b = branch(req);
    const out = BookMenu.removeBookPage(req.body, b);
    emit('book-menu:updated', { activeBookId: out.activeBookId }, b);
    return out;
  }));
}
