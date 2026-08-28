// CHỐNG TRÙNG ĐƠN KHI MẠNG LAG.
//
// SỰ CỐ THẬT: khách bấm "Gửi đơn" trên màn tự chọn, wifi cửa hàng lag nên app
// chờ 10 giây rồi báo lỗi. Khách bấm lại, lần này vào được → BẾP NHẬN HAI ĐƠN.
//
// Điểm mấu chốt: HẾT GIỜ CHỜ KHÔNG CÓ NGHĨA LÀ SERVER CHƯA CHẠY. Rất thường là
// server đã tạo đơn xong, chỉ là câu trả lời về không kịp. Client không phân
// biệt được "chưa chạy" với "chạy rồi mà chậm", nên chống trùng phải nằm ở
// SERVER, không thể trông vào client tự giữ.
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const temp = mkdtempSync(join(tmpdir(), 'dandpak-idem-'));
process.env.SQLITE_PATH = join(temp, 'store.db');
process.env.STORAGE_PATH = join(temp, 'storage');
process.env.DATA_ENCRYPTION_KEY = process.env.DATA_ENCRYPTION_KEY
  || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

const { migrate } = await import('./db.js');
const Idem = await import('./services/idempotency.js');

migrate();
const BR = 'sala';

test('cung mot ma -> chi chay MOT lan, lan sau tra lai ket qua cu', async () => {
  let soLanChay = 0;
  const chay = () => Idem.withIdempotency('test.scope', 'ma-abc', BR, async () => {
    soLanChay++;
    return { order_id: 'don_1', so: soLanChay };
  });

  const lan1 = await chay();
  const lan2 = await chay();
  const lan3 = await chay();

  assert.equal(soLanChay, 1, 'chi duoc chay dung mot lan');
  assert.deepEqual(lan2, lan1, 'lan sau phai tra ve DUNG ket qua cu');
  assert.deepEqual(lan3, lan1);
});

test('ma khac nhau = lan bam khac nhau -> tao don moi', async () => {
  let n = 0;
  const chay = (ma) => Idem.withIdempotency('test.scope', ma, BR, async () => {
    n++;
    return { order_id: `don_${n}` };
  });
  const a = await chay('ma-1');
  const b = await chay('ma-2');
  assert.notDeepEqual(a, b, 'hai lan bam khac nhau phai ra hai don khac nhau');
});

test('KHONG co ma thi chay nhu cu (client ban cu van dung duoc)', async () => {
  let n = 0;
  const chay = () => Idem.withIdempotency('test.scope', null, BR, async () => {
    n++;
    return { lan: n };
  });
  await chay();
  await chay();
  assert.equal(n, 2, 'khong co ma thi khong chan gi ca');
});

test('LOI NGHIEP VU thi xoa cho dat -> sua roi gui lai bang chinh ma do', async () => {
  let lan = 0;
  const chay = () => Idem.withIdempotency('test.scope', 'ma-loi', BR, async () => {
    lan++;
    if (lan === 1) throw new Error('Het hang');
    return { ok: true, lan };
  });

  await assert.rejects(chay, /Het hang/);
  // Cua hang bo bot mon roi gui lai — phai chay duoc, khong bi ket vinh vien.
  const sau = await chay();
  assert.deepEqual(sau, { ok: true, lan: 2 });
});

test('hai request cung ma toi CUNG LUC: mot chay, mot bi chan 409', async () => {
  let dangChay = 0;
  let toiDaSongSong = 0;
  const chay = () => Idem.withIdempotency('test.scope', 'ma-dua', BR, async () => {
    dangChay++;
    toiDaSongSong = Math.max(toiDaSongSong, dangChay);
    await new Promise(r => setTimeout(r, 40));
    dangChay--;
    return { ok: true };
  });

  const ketQua = await Promise.allSettled([chay(), chay()]);
  assert.equal(toiDaSongSong, 1,
    'khong duoc chay song song — day chinh la thu dang muon chan');
  const biChan = ketQua.filter(r => r.status === 'rejected');
  assert.equal(biChan.length, 1, 'dung mot cai bi chan');
  assert.equal(biChan[0].reason.status, 409);
});

test('ket qua cu duoc giu nguyen hinh dang, khong bi bop meo', async () => {
  const goc = {
    id: 'don_9', items: [{ name: 'Trà đào', qty: 2 }],
    total: 90000, customer: null, nested: { a: [1, 2, 3] },
  };
  await Idem.withIdempotency('test.scope', 'ma-hinh', BR, async () => goc);
  const lai = await Idem.withIdempotency('test.scope', 'ma-hinh', BR,
    async () => ({ khac: true }));
  assert.deepEqual(lai, goc);
});

test('don dep khoa cu khong dung toi khoa vua tao', () => {
  const bo = Idem.maintainIdempotencyKeys({ hours: 24 });
  assert.equal(bo, 0, 'khoa vua tao trong phien test khong duoc xoa');
});
