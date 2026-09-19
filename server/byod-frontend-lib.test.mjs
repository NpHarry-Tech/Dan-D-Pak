import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import * as Lib from './assets/byod/lib.js';

test('money() dùng đúng định dạng tiền Việt Nam hiện có trên toàn hệ thống', () => {
  assert.equal(Lib.money(150000), '150.000 ₫');
  assert.equal(Lib.money(0), '0 ₫');
  assert.equal(Lib.money('12000.9'), '12.001 ₫');
});

test('clampQty() giữ đúng biên [1,50] khớp giới hạn addCartItem() ở server', () => {
  assert.equal(Lib.clampQty(0), 1);
  assert.equal(Lib.clampQty(-3), 1);
  assert.equal(Lib.clampQty(999), 50);
  assert.equal(Lib.clampQty(7), 7);
});

test('mỗi ngôn ngữ UI phải có ĐỦ cùng bộ khoá — thiếu khoá sẽ âm thầm rơi về tiếng Việt', () => {
  const missing = Lib.missingKeysByLang();
  assert.deepEqual(missing, {}, `Thiếu khoá dịch: ${JSON.stringify(missing)}`);
});

test('5 ngôn ngữ UI khớp đúng MENU_TRANSLATION_LANGS mà server thật sự dịch (catalog.js)', () => {
  assert.deepEqual(Lib.MENU_LANGS, ['vi', 'en', 'zh', 'ja', 'ko']);
  assert.deepEqual(Lib.LANGS.map(l => l.code).sort(), [...Lib.MENU_LANGS].sort());
});

test('normalizeLang() chặn mã ngôn ngữ lạ, không làm vỡ bootstrap ?lang=', () => {
  assert.equal(Lib.normalizeLang('fr'), 'vi');
  assert.equal(Lib.normalizeLang(''), 'vi');
  assert.equal(Lib.normalizeLang('EN'), 'en');
  assert.equal(Lib.normalizeLang('vi-VN'), 'vi');
  assert.equal(Lib.normalizeLang('zh-CN'), 'zh');
  assert.equal(Lib.normalizeLang('zh-Hant-TW'), 'zh');
  assert.equal(Lib.normalizeLang(undefined), 'vi');
});

test('detectLang() lấy ngôn ngữ hệ thống được hỗ trợ ở lần truy cập đầu', () => {
  assert.equal(Lib.detectLang(['vi-VN', 'en-US']), 'vi');
  assert.equal(Lib.detectLang(['zh-CN', 'en-US']), 'zh');
  assert.equal(Lib.detectLang(['fr-FR', 'ja-JP']), 'ja');
  assert.equal(Lib.detectLang(['fr-FR']), 'vi');
});

test('dòng chủ quyền dùng hoàn toàn tiếng Trung và không dùng tên Tây Sa/Nam Sa', () => {
  const line = Lib.t('zh', 'sovereignty');
  assert.equal(line, '黄沙群岛和长沙群岛属于越南。');
  assert.ok(!/西沙|南沙/.test(line));
});

test('statusMeta() bao phủ đủ 7 trạng thái order_item thật (server/services/orders.js)', () => {
  const real = ['pending_confirm', 'new', 'accepted', 'preparing', 'ready', 'served', 'cancelled'];
  for (const code of real) {
    const meta = Lib.statusMeta(code, 'vi');
    assert.ok(meta.label && meta.bg && meta.fg, `status "${code}" thiếu style`);
  }
  // Không được gộp lẫn hai trạng thái người dùng cần phân biệt rõ theo yêu cầu
  // tích hợp: "Đang chế biến" khác "Đã tiếp nhận" khác "Hoàn tất".
  const labels = new Set(real.map(c => Lib.statusMeta(c, 'vi').label));
  assert.ok(labels.has('Đang chế biến'));
  assert.ok(labels.has('Hoàn tất'));
  assert.ok(labels.has('Đã phục vụ'));
  assert.ok(labels.has('Đã hủy'));
});

test('errorMessage() có bản dịch cho MỌI mã lỗi BYOD_* mà server/services/byod.js thực sự throw', () => {
  const src = readFileSync(new URL('./services/byod.js', import.meta.url), 'utf8');
  const codes = [...src.matchAll(/'(BYOD_[A-Z_]+)'/g)].map(m => m[1]);
  assert.ok(codes.length > 5, 'Không tìm thấy mã lỗi BYOD_* nào trong byod.js — kiểm tra lại regex/đường dẫn');
  for (const code of new Set(codes)) {
    for (const lang of Lib.MENU_LANGS) {
      const msg = Lib.errorMessage(code, `server-message-for-${code}`, lang);
      assert.notEqual(msg, `server-message-for-${code}`,
        `Mã lỗi ${code} chưa có bản dịch client cho ngôn ngữ "${lang}" — sẽ hiện nguyên câu tiếng Việt của server bất kể ngôn ngữ khách chọn`);
    }
  }
});

test('isFullPageError() chỉ chặn toàn trang đúng 5 mã QR/chi nhánh/hết phiên do rời quán — không chặn nhầm lỗi giỏ hàng', () => {
  assert.ok(Lib.isFullPageError('BYOD_QR_INVALID'));
  assert.ok(Lib.isFullPageError('BYOD_QR_REVOKED'));
  assert.ok(Lib.isFullPageError('BYOD_BRANCH_INACTIVE'));
  assert.ok(Lib.isFullPageError('BYOD_TABLE_NOT_FOUND'));
  assert.ok(Lib.isFullPageError('BYOD_SESSION_IDLE_TIMEOUT'));
  assert.ok(!Lib.isFullPageError('BYOD_ITEM_UNAVAILABLE'));
  assert.ok(!Lib.isFullPageError('BYOD_SESSION_CLOSED'));
  assert.ok(!Lib.isFullPageError(undefined));
});

test('comboOptionLabel() resolve đúng tên từ option_groups mode:combo theo ref_item_id', () => {
  const item = {
    option_groups: [
      { mode: 'price', name: 'Size', options: [{ name: 'Lớn' }] },
      { mode: 'combo', name: 'Khai vị', options: [{ ref_item_id: 'a1', name: 'Hoành thánh chiên' }, { ref_item_id: 'a2', name: 'Chả tôm' }] },
    ],
  };
  assert.deepEqual(Lib.comboOptionLabel(item, 'a2'), { group: 'Khai vị', name: 'Chả tôm' });
  assert.equal(Lib.comboOptionLabel(item, 'missing'), null);
  assert.equal(Lib.comboOptionLabel({}, 'a1'), null);
});

test('comboLabels() và modsLabel() không bao giờ lộ group kỹ thuật __addon__ ra tên hiển thị', () => {
  const mods = [{ group: '__addon__', name: 'Salad' }, { group: 'Size', name: 'Lớn' }];
  assert.deepEqual(Lib.modsLabel(mods), ['Salad', 'Lớn']);
  assert.ok(!Lib.modsLabel(mods).some(n => n.includes('__addon__')));
});

test('t() thay thế biến {var} và fallback về tiếng Việt khi khoá không tồn tại', () => {
  assert.equal(Lib.t('vi', 'tableWord'), 'Bàn');
  assert.equal(Lib.t('en', 'empty'), 'Your cart is empty');
  assert.match(Lib.t('vi', 'shareNote', { table: 'Bàn 5' }), /Bàn 5/);
  assert.equal(Lib.t('vi', 'not_a_real_key'), 'not_a_real_key');
});
