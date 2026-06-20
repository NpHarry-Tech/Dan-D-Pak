# Payment Offline Policy

Last updated: 2026-06-20

Payments are money. Offline behavior must never fabricate an official success.

## Core rule

A payment is **official only** after it is written to the company server and reaches
an approved status there. A buffered or device-queued payment is **pending**, shown
as pending, and reconciled on sync.

## States

```text
PENDING_LOCAL   captured on device, not sent
PENDING_VPS     buffered (encrypted) on VPS, not in company DB
RECORDED        written to company PostgreSQL
APPROVED        confirmed (e.g. provider/bank confirmation or manager approval)
REVERSED        refund/void applied (never deleted)
CONFLICT        duplicate/ambiguous on sync, needs review
```

## Method-specific guidance

- **Cash**: can be captured offline as `PENDING_*`, becomes `RECORDED` on sync.
  Cash drawer reconciliation happens at shift close (see
  [CASH_IN_OUT_WORKFLOW.md](CASH_IN_OUT_WORKFLOW.md)).
- **Card / terminal**: rely on the terminal/provider result. Do not mark approved
  from the app alone while offline; record the terminal reference and reconcile.
- **Bank transfer / QR**: confirmation comes from the bank/provider webhook
  (SePay/Casso/payOS paths already exist). Offline, mark pending until the
  confirmation event is received and matched.

## Non-destructive rules

- Never delete a payment. Create `refunds` / `voids` / reversal records.
- Every status change writes `payment_status_history` and an audit log.
- Idempotency on sync prevents a re-delivered payment event from double-charging or
  double-recording.

## UI

- The POS/iPad clearly shows pending vs. official payment state.
- No receipt/invoice claims "paid/official" for a still-pending offline payment.

See [OFFLINE_FIRST_ARCHITECTURE.md](OFFLINE_FIRST_ARCHITECTURE.md) and
[BANK_ACCOUNT_LINKING.md](BANK_ACCOUNT_LINKING.md).
