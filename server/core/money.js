// Exact fixed-point helpers for VND. Money is stored as whole đồng (INTEGER);
// quantities/rates are parsed as decimal strings and calculated with BigInt.
// Number is used only at API/SQLite boundaries after a safe-integer check.
function decimal(value) {
  const raw = String(value ?? 0).trim().replace(',', '.');
  const match = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(raw);
  if (!match) throw new Error(`Số thập phân không hợp lệ: ${raw}`);
  const fraction = match[3] || '';
  const scale = 10n ** BigInt(fraction.length);
  const units = BigInt(match[2]) * scale + BigInt(fraction || 0);
  return { units: match[1] === '-' ? -units : units, scale };
}

function roundedDivide(numerator, denominator) {
  if (denominator <= 0n) throw new Error('Mẫu số phải lớn hơn 0');
  const sign = numerator < 0n ? -1n : 1n;
  const abs = numerator < 0n ? -numerator : numerator;
  return sign * ((abs + denominator / 2n) / denominator);
}

function safeNumber(value) {
  const result = Number(value);
  if (!Number.isSafeInteger(result)) throw new Error('Số tiền vượt giới hạn an toàn');
  return result;
}

export function money(value) {
  const parsed = decimal(value);
  return safeNumber(roundedDivide(parsed.units, parsed.scale));
}

export function multiplyMoney(unitAmount, quantity) {
  const q = decimal(quantity);
  return safeNumber(roundedDivide(BigInt(money(unitAmount)) * q.units, q.scale));
}

export function applyPercent(amount, rate) {
  const r = decimal(rate);
  return safeNumber(roundedDivide(BigInt(money(amount)) * r.units, r.scale * 100n));
}

export function grossFromNet(amount, rate) {
  return money(amount) + applyPercent(amount, rate);
}

export function netFromGross(amount, rate) {
  const gross = BigInt(money(amount));
  const r = decimal(rate);
  return safeNumber(roundedDivide(gross * r.scale * 100n, r.scale * 100n + r.units));
}

export function allocateProportion(amount, weight, totalWeight) {
  const w = decimal(weight);
  const total = decimal(totalWeight);
  if (total.units <= 0n) return 0;
  return safeNumber(roundedDivide(BigInt(money(amount)) * w.units * total.scale, w.scale * total.units));
}

export function divideMoney(amount, quantity, decimals = 2) {
  const q = decimal(quantity);
  if (q.units <= 0n) return money(amount);
  const factor = 10n ** BigInt(decimals);
  const scaled = roundedDivide(BigInt(money(amount)) * q.scale * factor, q.units);
  return Number(scaled) / Number(factor);
}
