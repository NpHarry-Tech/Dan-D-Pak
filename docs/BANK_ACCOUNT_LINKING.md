# Bank Account Linking

Last updated: 2026-06-20

How bank accounts and payment providers are linked, stored, and audited.

## Tables

- `bank_accounts`
- `bank_account_links`
- `bank_transfer_records`
- `payment_terminal_configs`
- `payment_reconciliation_logs`
- `payment_provider_tokens`
- plus history rows for secure config changes

## Workflow

1. Admin opens bank / payment provider linking (permission required).
2. Admin enters provider config / authorizes via the provider flow.
3. Credentials / tokens are **encrypted at rest** (or held in a secret manager).
4. The bank account number is **masked** in the UI (e.g. `****1234`).
5. An audit log records who linked what and when (no secret values in the log).
6. Linking can be **revoked / rotated**; rotation is logged, not silently
   overwritten.

## Security rules

- Never store bank passwords.
- Never store raw card data or CVV.
- Bank credentials / provider secrets must be encrypted or in a secret manager.
- Do not log full tokens or secrets.
- Display only masked account numbers.
- Audit every change to bank / payment config (append-only history).

## Reconciliation

- Incoming transfers/QR confirmations are matched to orders/payments via
  `bank_transfer_records` and `payment_reconciliation_logs`.
- Existing SePay/Casso/payOS/VietQR confirmation paths feed this reconciliation.

See [SECURITY_BOUNDARIES.md](SECURITY_BOUNDARIES.md) and
[PAYMENT_OFFLINE_POLICY.md](PAYMENT_OFFLINE_POLICY.md).
