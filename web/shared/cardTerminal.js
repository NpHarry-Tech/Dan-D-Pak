// Cầu nối thanh toán THẺ qua máy POS Android (VCB SmartPOS, PAX, Sunmi...).
//
// Triết lý: KHÔNG phụ thuộc cứng vào việc app ngân hàng có cho tích hợp hay không.
// Có 4 chế độ, tự rớt xuống chế độ an toàn khi máy/app không hỗ trợ:
//
//   auto   – Gọi app thanh toán trên máy qua native bridge (window.NativeCardTerminal).
//            Máy tự nổ màn quẹt thẻ → trả kết quả → ta tự đóng bill + in. (Cần VCB cấp Intent/SDK.)
//   manual – Thu ngân tự quẹt thẻ trên app ngân hàng (app riêng), rồi nhập approval code
//            vào POS để đóng bill + in. LUÔN chạy được, không cần tích hợp gì từ VCB.  ← lưới an toàn
//   mock   – Demo trên trình duyệt: trả giao dịch GIẢ để test toàn luồng (không có máy thật).
//   off    – Coi thẻ như phương thức nhập tay thuần (chỉ ghi reference), không hiện nút quẹt.
//
// Cấu hình ở Settings → operationsConfig.payment.cardTerminal.mode.
// Khi đặt 'auto' nhưng máy KHÔNG có native bridge, ta tự hạ xuống 'manual'.

// Native (lớp Android) phải expose object này khi chạy trong app wrapper:
//   window.NativeCardTerminal.charge(payloadJsonString, token)
// và gọi lại khi xong:
//   window.__cardTerminalResult(token, resultJsonString)
// resultJson: { approved:bool, txnId, rrn, approval, mask, scheme, terminal, error }
export function nativeAvailable() {
  return !!(typeof window !== 'undefined'
    && window.NativeCardTerminal
    && typeof window.NativeCardTerminal.charge === 'function');
}

// Quy đổi chế độ cấu hình → chế độ thực thi (tính cả việc có native bridge hay không).
export function effectiveCardMode(configMode) {
  const m = String(configMode || 'auto').toLowerCase();
  if (m === 'auto') return nativeAvailable() ? 'auto' : 'manual';
  if (['manual', 'mock', 'off'].includes(m)) return m;
  return 'manual';
}

// Nhãn hiển thị cho thu ngân biết đang ở chế độ nào.
export function cardModeBadge(effMode) {
  return ({
    auto: '⚡ Tự động (máy POS)',
    manual: '✍️ Thủ công (nhập approval)',
    mock: '🧪 Demo',
    off: '',
  })[effMode] || '';
}

let _seq = 0;
const _pending = {};

if (typeof window !== 'undefined' && !window.__cardTerminalResult) {
  // Native gọi về đây khi giao dịch xong (thành công/thất bại/hủy).
  window.__cardTerminalResult = (token, payload) => {
    const resolve = _pending[token];
    if (!resolve) return;
    delete _pending[token];
    let data;
    try { data = typeof payload === 'string' ? JSON.parse(payload) : (payload || {}); }
    catch (e) { data = { approved: false, error: 'Payload không hợp lệ từ máy POS' }; }
    resolve(data);
  };
}

// Gọi quẹt thẻ. Trả về Promise<{approved, txnId, rrn, approval, mask, scheme, terminal, mode, error}>.
// - auto: đẩy lệnh xuống native, chờ callback (timeout 3 phút).
// - mock: trả giao dịch giả sau ~1s.
// - manual/off: KHÔNG tự charge (đặt approved=false, manual=true) — UI sẽ thu approval code tay.
export function chargeCard({ amount, reference, billNo, terminalName } = {}, effMode = 'auto') {
  if (effMode === 'mock') {
    return new Promise(resolve => setTimeout(() => resolve({
      approved: true,
      mode: 'mock',
      txnId: 'MOCK' + Date.now(),
      rrn: String(Date.now()).slice(-12),
      approval: String(100000 + Math.floor(Math.random() * 900000)),
      mask: '**** **** **** ' + String(1000 + Math.floor(Math.random() * 9000)),
      scheme: 'VISA',
      terminal: terminalName || 'MOCK-POS',
    }), 1000));
  }

  if (effMode === 'auto') {
    if (!nativeAvailable()) {
      return Promise.reject(new Error('Máy chưa có cầu nối thanh toán (native bridge).'));
    }
    return new Promise((resolve, reject) => {
      const token = 'ct' + (++_seq) + '_' + Date.now().toString(36);
      _pending[token] = (data) => resolve({ ...data, mode: 'auto' });
      try {
        window.NativeCardTerminal.charge(
          JSON.stringify({ amount, reference, billNo, terminalName, token }),
          token,
        );
      } catch (e) {
        delete _pending[token];
        return reject(e);
      }
      setTimeout(() => {
        if (_pending[token]) {
          delete _pending[token];
          reject(new Error('Hết thời gian chờ máy POS phản hồi.'));
        }
      }, 180000);
    });
  }

  // manual / off
  return Promise.resolve({ approved: false, manual: true, mode: effMode });
}
