import assert from 'node:assert/strict';
import test from 'node:test';
import { BUSINESS_TIMEZONE, businessDate, businessDateTime, businessDayBoundsUtc,
  businessParts, businessPeriodStartUtc, occurredAtUtc, saleTime } from './businessClock.js';

test('business date đổi đúng tại nửa đêm Việt Nam dù timestamp là UTC', () => {
  assert.equal(businessDate('2026-08-08T16:59:59.000Z'), '2026-08-08');
  assert.equal(businessDate('2026-08-08T17:00:00.000Z'), '2026-08-09');
});

test('ranh giới tháng và năm dùng Asia/Ho_Chi_Minh', () => {
  assert.equal(businessDate('2026-12-31T16:59:59.999Z'), '2026-12-31');
  assert.equal(businessDate('2026-12-31T17:00:00.000Z'), '2027-01-01');
  assert.equal(businessDate('2026-01-31T17:00:00.000Z'), '2026-02-01');
});

test('sale timestamp canonical giữ UTC và timezone nghiệp vụ', () => {
  assert.deepEqual(saleTime('2026-08-08T17:10:00+00:00'), {
    occurred_at_utc: '2026-08-08T17:10:00.000Z',
    business_timezone: BUSINESS_TIMEZONE,
    business_date: '2026-08-09',
  });
  assert.equal(occurredAtUtc('2026-08-09T00:10:00+07:00'), '2026-08-08T17:10:00.000Z');
});

test('timestamp sai bị từ chối thay vì sinh ngày giả', () => {
  assert.throws(() => businessDate('not-a-date'), /không hợp lệ/);
});

test('mọi phần ngày giờ hiển thị dùng đồng hồ cửa hàng, không dùng TZ máy chủ', () => {
  const instant = '2026-08-25T17:10:30.000Z'; // 00:10:30 ngày 26/08 tại VN
  assert.deepEqual(businessParts(instant), {
    year: 2026, month: 8, day: 26, hour: 0, minute: 10, second: 30, weekday: 3,
  });
  assert.equal(businessDateTime(instant), '26/08/2026 00:10');
});

test('ranh giới ngày và kỳ báo cáo là nửa đêm Việt Nam', () => {
  const { start, end } = businessDayBoundsUtc('2026-08-25T18:00:00.000Z');
  assert.equal(start.toISOString(), '2026-08-25T17:00:00.000Z');
  assert.equal(end.toISOString(), '2026-08-26T17:00:00.000Z');
  assert.equal(businessPeriodStartUtc('week', '2026-08-25T18:00:00.000Z').toISOString(),
    '2026-08-23T17:00:00.000Z'); // Thứ Hai 24/08 00:00 VN
  assert.equal(businessPeriodStartUtc('quarter', '2026-08-25T18:00:00.000Z').toISOString(),
    '2026-06-30T17:00:00.000Z');
});
