// BAO MAT (XSS phan chieu): /auth/{haravan,shopee,lazada}/callback tung chen
// thang shop_id/shop_domain (gia tri tu provider hoac tu client, khong dang
// tin tuyet doi) vao HTML tra ve — KHONG escape. Ke tan cong tu shop that cua
// minh, ky code hop le, roi che shop=<script>...</script> de chay JS tren
// chinh domain server. escapeHtml() la lop chan duy nhat cho lop loi nay.
import assert from 'node:assert/strict';
import test from 'node:test';
import { escapeHtml } from './core/util.js';

test('escapeHtml trung hoa the script/attribute-breakout', () => {
  assert.equal(escapeHtml('<script>alert(1)</script>'),
    '&lt;script&gt;alert(1)&lt;/script&gt;');
  assert.equal(escapeHtml(`" onmouseover="alert(1)`),
    '&quot; onmouseover=&quot;alert(1)');
  assert.equal(escapeHtml(`'-alert(1)-'`), '&#39;-alert(1)-&#39;');
});

test('escapeHtml an toan voi null/undefined/so', () => {
  assert.equal(escapeHtml(null), '');
  assert.equal(escapeHtml(undefined), '');
  assert.equal(escapeHtml(123), '123');
});

test('escapeHtml khong dong lai tag som (chan & rieng)', () => {
  assert.equal(escapeHtml('Cong ty A & B'), 'Cong ty A &amp; B');
});
