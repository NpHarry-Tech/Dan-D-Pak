import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import { detectImageMime, hasImageSignature, requireImageSignature } from './core/imageValidation.js';

const samples = {
  'image/jpeg': Buffer.from('ffd8ffe000104a464946', 'hex'),
  'image/png': Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex'),
  'image/webp': Buffer.from('524946460400000057454250', 'hex'),
  'image/gif': Buffer.from('4749463839610100', 'hex'),
  'image/bmp': Buffer.from('424d360000000000000036000000', 'hex'),
  'image/tiff': Buffer.from('49492a0008000000', 'hex'),
  'image/heif': Buffer.from('00000018667479706865696300000000', 'hex'),
};

test('accepted upload MIME types require matching binary magic', () => {
  for (const [mime, bytes] of Object.entries(samples)) {
    assert.equal(hasImageSignature(bytes, mime), true, mime);
    assert.doesNotThrow(() => requireImageSignature(bytes, mime));
    assert.equal(detectImageMime(bytes), mime);
  }
});

test('HTML disguised as an image and cross-MIME payloads fail closed', () => {
  const html = Buffer.from('<script>alert(1)</script>');
  for (const mime of Object.keys(samples)) {
    assert.throws(() => requireImageSignature(html, mime), (error) =>
      error.status === 400 && error.code === 'IMAGE_SIGNATURE_MISMATCH');
  }
  assert.throws(() => requireImageSignature(samples['image/png'], 'image/jpeg'));
});

// Bug thật gặp trên tablet: chọn ảnh đuôi .png nhưng picker/nén ảnh của
// Android trả về byte thật là JPEG (hoặc ngược lại) — mime_type client tự
// khai không khớp encoding thật. server/api.js#saveBase64Image ĐÃ ĐƯỢC SỬA để
// chỉ dựa vào detectImageMime(bytes thật) — KHÔNG còn gọi
// requireImageSignature(bytes, mime_type_client_khai) nữa, nên ảnh hợp lệ dù
// nhãn khai sai vẫn phải được CHẤP NHẬN. Test này khóa lại đúng chính sách đó
// ở tầng primitive: bytes thật là JPEG phải detect ra 'image/jpeg' và KHÔNG
// bị requireImageSignature từ chối khi so với chính detectImageMime của nó —
// chỉ từ chối khi so với nhãn SAI do client khai (mô phỏng hành vi CŨ đã bỏ).
test('a real JPEG mislabeled as image/png by the client must still be accepted by content-based detection', async () => {
  const jpegBytes = await sharp({
    create: { width: 4, height: 4, channels: 3, background: { r: 200, g: 30, b: 30 } },
  }).jpeg().toBuffer();

  const detected = detectImageMime(jpegBytes);
  assert.equal(detected, 'image/jpeg', 'nội dung thật phải được nhận đúng là JPEG');
  // Chính sách MỚI (api.js#saveBase64Image): xác thực theo detected, không theo
  // nhãn client khai — nên phải PASS khi so với chính loại đã detect được.
  assert.doesNotThrow(() => requireImageSignature(jpegBytes, detected));
  // Chính sách CŨ (đã bỏ) sẽ từ chối vì nhãn client khai ('image/png') không
  // khớp — đây chính là bug đã gặp thật, giữ lại để ai đó không vô tình thêm
  // lại kiểu kiểm tra theo nhãn khai báo.
  assert.throws(() => requireImageSignature(jpegBytes, 'image/png'));
});
