export const BUSINESS_TIMEZONE = 'Asia/Ho_Chi_Minh';
export const BUSINESS_UTC_OFFSET_MINUTES = 7 * 60;

const businessDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: BUSINESS_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const businessPartsFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: BUSINESS_TIMEZONE,
  year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});

/** Calendar/time fields at the store, independent of host TZ. */
export function businessParts(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error('Timestamp không hợp lệ');
  const raw = Object.fromEntries(businessPartsFormatter.formatToParts(date)
    .filter((part) => part.type !== 'literal')
    .map((part) => [part.type, part.value]));
  const weekday = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[raw.weekday];
  return {
    year: Number(raw.year), month: Number(raw.month), day: Number(raw.day),
    hour: Number(raw.hour), minute: Number(raw.minute), second: Number(raw.second),
    weekday,
  };
}

export function businessDateTime(value = new Date(), separator = '/') {
  const p = businessParts(value);
  const two = (n) => String(n).padStart(2, '0');
  return `${two(p.day)}${separator}${two(p.month)}${separator}${p.year} ${two(p.hour)}:${two(p.minute)}`;
}

export function businessDateTimeSeconds(value = new Date(), separator = '/') {
  const p = businessParts(value);
  const two = (n) => String(n).padStart(2, '0');
  return `${two(p.day)}${separator}${two(p.month)}${separator}${p.year} ${two(p.hour)}:${two(p.minute)}:${two(p.second)}`;
}

/** User-facing date; preserves a machine date-only value without UTC shifting. */
export function businessDisplayDate(value = new Date()) {
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  if (dateOnly) return `${dateOnly[3]}/${dateOnly[2]}/${dateOnly[1]}`;
  const p = businessParts(value);
  return `${String(p.day).padStart(2, '0')}/${String(p.month).padStart(2, '0')}/${p.year}`;
}

export function businessTime(value = new Date()) {
  const p = businessParts(value);
  return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
}

/** UTC instant of a Vietnam calendar boundary. Vietnam has no DST. */
export function businessBoundaryUtc(year, month, day, hour = 0, minute = 0) {
  return new Date(Date.UTC(year, month - 1, day, hour, minute) - BUSINESS_UTC_OFFSET_MINUTES * 60_000);
}

export function businessDateStartUtc(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  if (!match) throw new Error('Ngày không hợp lệ');
  return businessBoundaryUtc(Number(match[1]), Number(match[2]), Number(match[3]));
}

export function businessDateEndUtc(value) {
  return new Date(businessDateStartUtc(value).getTime() + 86_400_000 - 1);
}

export function businessDayBoundsUtc(value = new Date()) {
  const p = businessParts(value);
  const start = businessBoundaryUtc(p.year, p.month, p.day);
  return { start, end: new Date(start.getTime() + 86_400_000) };
}

export function businessPeriodStartUtc(period, value = new Date()) {
  const p = businessParts(value);
  let { year, month, day } = p;
  if (period === 'week') {
    const mondayDelta = p.weekday === 0 ? -6 : 1 - p.weekday;
    const shifted = new Date(Date.UTC(year, month - 1, day + mondayDelta));
    year = shifted.getUTCFullYear(); month = shifted.getUTCMonth() + 1; day = shifted.getUTCDate();
  } else if (period === 'month') day = 1;
  else if (period === 'quarter') { month = Math.floor((month - 1) / 3) * 3 + 1; day = 1; }
  else if (period === 'year') { month = 1; day = 1; }
  return businessBoundaryUtc(year, month, day);
}

/** Canonical persisted timestamp: UTC ISO-8601. */
export function occurredAtUtc(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error('Timestamp không hợp lệ');
  return date.toISOString();
}

/** Business date at Dan D Pak, independent of the host/container timezone. */
export function businessDate(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error('Timestamp không hợp lệ');
  const parts = Object.fromEntries(
    businessDateFormatter.formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function saleTime(paidAt) {
  const occurred_at_utc = occurredAtUtc(paidAt);
  return {
    occurred_at_utc,
    business_timezone: BUSINESS_TIMEZONE,
    business_date: businessDate(occurred_at_utc),
  };
}
