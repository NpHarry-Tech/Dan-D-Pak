import assert from 'node:assert/strict';
import test from 'node:test';

import { paymentWebhookBranch } from './modules/payments/routes.js';

const visibleBranch = (req) => req.query.branch_id || req.headers['x-branch-id'];

test('legacy SePay webhook without branch routes to sala', () => {
  assert.equal(paymentWebhookBranch({ headers: {}, query: {} }, visibleBranch, true), 'sala');
});

test('other webhooks still require explicit branch routing', () => {
  assert.throws(
    () => paymentWebhookBranch({ headers: {}, query: {} }, visibleBranch),
    (error) => error.status === 400,
  );
  assert.equal(
    paymentWebhookBranch({ headers: {}, query: { branch_id: 'hanoi' } }, visibleBranch),
    'hanoi',
  );
});
