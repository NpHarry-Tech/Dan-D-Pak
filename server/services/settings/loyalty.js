// Cấu hình TÍCH ĐIỂM & HẠNG THÀNH VIÊN — màn "Cài đặt → Tích điểm & Khuyến mại".
import { now } from '../../db.js';
import {
  LOYALTY_CONFIG_KEY, bool, str, plainObject,
  nonNegativeInt, nonNegativeNumber, readJsonSetting,
} from './shared.js';

const DEFAULT_LOYALTY_CONFIG = {
  version: 1,
  enabled: false,
  phoneRequired: true,
  earn: {
    amount: { enabled: true, spend: 10000, points: 1, rounding: 'floor', minSpend: 0 },
    order: { enabled: false, points: 1, minSpend: 0 },
    birthday: { enabled: false, multiplier: 2 },
    productBonus: [],
  },
  redeem: { enabled: false, pointValue: 1000, minPoints: 10, maxPercent: 50 },
  cashback: { enabled: false, percent: 0, as: 'points', minSpend: 0 },
  tiers: [
    { name: 'Silver', fromPoints: 0, earnMultiplier: 1, discountPct: 0 },
    { name: 'Gold', fromPoints: 200, earnMultiplier: 1.1, discountPct: 3 },
    { name: 'Platinum', fromPoints: 600, earnMultiplier: 1.25, discountPct: 5 },
  ],
  actions: [
    { key: 'signup', label: 'Đăng ký số điện thoại', points: 10, enabled: true },
    { key: 'referral', label: 'Giới thiệu bạn bè', points: 30, enabled: false },
    { key: 'review', label: 'Đánh giá trải nghiệm', points: 5, enabled: false },
    { key: 'birthday', label: 'Quà sinh nhật', points: 20, enabled: false },
  ],
};

export function sanitizeLoyaltyConfig(input = {}) {
  const src = plainObject(input);
  const earn = plainObject(src.earn);
  const amount = plainObject(earn.amount);
  const order = plainObject(earn.order);
  const birthday = plainObject(earn.birthday);
  const redeem = plainObject(src.redeem);
  const cashback = plainObject(src.cashback);
  const tiers = (Array.isArray(src.tiers) ? src.tiers : DEFAULT_LOYALTY_CONFIG.tiers)
    .map((t, i) => ({
      name: str(t?.name || DEFAULT_LOYALTY_CONFIG.tiers[i]?.name || `Tier ${i + 1}`, 60),
      fromPoints: nonNegativeInt(t?.fromPoints, 0),
      earnMultiplier: Math.max(0.1, Math.min(20, nonNegativeNumber(t?.earnMultiplier, 1))),
      discountPct: Math.min(100, nonNegativeNumber(t?.discountPct, 0)),
    }))
    .filter(t => t.name)
    .sort((a, b) => a.fromPoints - b.fromPoints)
    .slice(0, 12);
  const actions = (Array.isArray(src.actions) ? src.actions : DEFAULT_LOYALTY_CONFIG.actions)
    .map((a, i) => ({
      key: str(a?.key || `action_${i + 1}`, 60).replace(/\s+/g, '_').toLowerCase(),
      label: str(a?.label || `Hành vi ${i + 1}`, 120),
      points: nonNegativeInt(a?.points, 0),
      enabled: bool(a?.enabled, false),
    }))
    .filter(a => a.key && a.label)
    .slice(0, 30);
  const productBonus = (Array.isArray(earn.productBonus) ? earn.productBonus : [])
    .map((p, i) => ({
      key: str(p?.key || `product_${i + 1}`, 60).replace(/\s+/g, '_').toLowerCase(),
      match: ['sku', 'category', 'name', 'brand'].includes(p?.match) ? p.match : 'sku',
      value: str(p?.value || '', 160),
      multiplier: Math.max(1, Math.min(20, nonNegativeNumber(p?.multiplier, 1))),
      extraPoints: nonNegativeInt(p?.extraPoints, 0),
      enabled: bool(p?.enabled, true),
    }))
    .filter(p => p.value)
    .slice(0, 50);
  return {
    version: 1,
    enabled: bool(src.enabled, DEFAULT_LOYALTY_CONFIG.enabled),
    phoneRequired: bool(src.phoneRequired, DEFAULT_LOYALTY_CONFIG.phoneRequired),
    earn: {
      amount: {
        enabled: bool(amount.enabled, true),
        spend: Math.max(1, nonNegativeInt(amount.spend, DEFAULT_LOYALTY_CONFIG.earn.amount.spend)),
        points: nonNegativeInt(amount.points, DEFAULT_LOYALTY_CONFIG.earn.amount.points),
        rounding: ['floor', 'round', 'ceil'].includes(amount.rounding) ? amount.rounding : 'floor',
        minSpend: nonNegativeInt(amount.minSpend, 0),
      },
      order: {
        enabled: bool(order.enabled, false),
        points: nonNegativeInt(order.points, DEFAULT_LOYALTY_CONFIG.earn.order.points),
        minSpend: nonNegativeInt(order.minSpend, 0),
      },
      birthday: {
        enabled: bool(birthday.enabled, false),
        multiplier: Math.max(1, Math.min(20, nonNegativeNumber(birthday.multiplier, 2))),
      },
      productBonus,
    },
    redeem: {
      enabled: bool(redeem.enabled, false),
      pointValue: nonNegativeInt(redeem.pointValue, DEFAULT_LOYALTY_CONFIG.redeem.pointValue),
      minPoints: nonNegativeInt(redeem.minPoints, DEFAULT_LOYALTY_CONFIG.redeem.minPoints),
      maxPercent: Math.min(100, nonNegativeNumber(redeem.maxPercent, DEFAULT_LOYALTY_CONFIG.redeem.maxPercent)),
    },
    cashback: {
      enabled: bool(cashback.enabled, false),
      percent: Math.min(100, nonNegativeNumber(cashback.percent, 0)),
      as: cashback.as === 'voucher' ? 'voucher' : 'points',
      minSpend: nonNegativeInt(cashback.minSpend, 0),
    },
    tiers: tiers.length ? tiers : DEFAULT_LOYALTY_CONFIG.tiers,
    actions,
    updated_at: src.updated_at || now(),
  };
}

export function getLoyaltyConfig(branch_id = 'br1') {
  return readJsonSetting(branch_id, LOYALTY_CONFIG_KEY, sanitizeLoyaltyConfig, DEFAULT_LOYALTY_CONFIG);
}
