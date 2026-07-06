# 15 - CLAUDE FABLE 5 WORST-CASE SOURCE REVIEW BRIEF

Use this brief with the full repository attached or mounted.

## Mission

Review this POS/ERP source as a defensive internal audit for my own codebase. Your job is to find the worst realistic things that can go wrong: bugs, bad sync, double charging, stock drift, wrong invoices, stuck shifts, wrong receipts, data loss, local-server failure, permission bypass, secret leakage, webhook replay, and hack/security risks.

Do not provide exploit payloads, offensive steps, malware, evasion, persistence, credential theft instructions, or abuse automation. Give defensive evidence, impact, and fixes.

## Scope

Review:

- `server/`
- `flutter-apps/dandpak_pos/`
- `flutter-apps/dandpak_tablet/`
- `flutter-apps/dandpak_kds/`
- `flutter-apps/dandpak_backoffice/`
- `flutter-apps/dandpak_core/`
- `web/`
- `docs/audit/`

Treat `server/permanent-storage/`, `backups/`, `scratch/`, logs, screenshots, binaries, and build outputs as leakage/data-retention risks, not normal source.

## Read First

Read these before judging:

- `docs/audit/00_AUDIT_PROGRESS.md`
- `docs/audit/06_SECURITY_FINDINGS.md`
- `docs/audit/07_BUSINESS_LOGIC_FINDINGS.md`
- `docs/audit/08_THIRD_PARTY_PAYMENT_ONLINE_AUDIT.md`
- `docs/audit/11_FIX_PRIORITY.md`
- `docs/audit/12_FINAL_CHECKLIST.md`
- `docs/audit/13_PONYTAIL_REAUDIT_2026-07-04.md`
- `docs/audit/14_GPT56_SOURCE_REVIEW_BRIEF.md`

Confirm findings from source. Do not repeat old findings unless you can prove them.

## Worst-Case Areas To Hunt

### Money And Payment

- Double payment, partial payment marked paid, payment closed without real bank transaction.
- Webhook replay/retry causing duplicate orders, duplicate revenue, duplicate stock deduction.
- Manual confirm abused or poorly audited.
- payOS/VietQR/SePay/Casso callback verification gaps.
- Payment method normalization breaking reports/shift close/accounting.
- Refund/return leaving payment, stock, voucher, invoice, or cash drawer inconsistent.

### Inventory And Stock

- Selling stock below zero unintentionally.
- Online/retail/FnB using different stock rules.
- Lot/expiry/FEFO bugs.
- Receive/adjust/import routes without permission.
- Return not restoring stock.
- Cost price drift, wrong COGS, wrong margin reports.

### Sync And Data Drift

- Flutter desktop/tablet/KDS/backoffice reading different truth.
- Socket event missed, stale screen, offline state not reconciled.
- Local SQLite, archive, backup, and UI state diverge.
- Multiple terminals race: same bill paid/edited/refunded twice.
- Reprint/receipt template drift from Setting.
- Runtime Node engine restart causing partial writes or duplicate retries.

### Invoice And Compliance

- E-invoice created twice, not created, wrong buyer, wrong tax, wrong total.
- Shift close with failed invoices.
- Refund/return after invoice not cancelling/adjusting invoice.
- Invoice retry queue losing state.
- MISA credentials/token handling risks.

### Auth, RBAC, And Secrets

- Any route that mutates money, stock, settings, users, print config, invoice, or payment without auth/permission.
- Secrets returned plaintext to UI/API/log/backup.
- Weak local token/session handling.
- PIN brute force/rate limits.
- Owner/admin-only operations exposed to manager/cashier.
- CORS/local-network exposure.

### Desktop/Tablet/KDS UX Failure

- App opens into stale session.
- Wrong branch selected.
- Shift state stale after close/open.
- KDS stuck, duplicated tickets, missed tickets.
- Tablet/customer screen order/payment state not matching POS.
- Printer status misleading.
- App looks successful while backend failed.

### Data Loss And Operations

- Backup not restorable.
- Runtime data stored inside repo/deploy bundle.
- Logs leaking customer/payment/secret data.
- Large base64 uploads bloating DB.
- Crash during transaction leaving partial state.
- No recovery path for corrupted DB, failed migration, failed printer, failed webhook.

## Required Output

### 1. Worst-Case Scorecard

Table:

- Area
- Score 0-10
- Worst thing that can happen
- Probability: low/medium/high
- Blast radius
- Confidence

### 2. Findings

For every issue:

- ID
- Severity: P0/P1/P2/P3
- Type: bug / security / sync / data-loss / UX / compliance / maintainability
- Status: confirmed / likely / needs repro / false positive
- Exact file/function/route
- What goes wrong
- Worst realistic outcome
- Why existing code allows it
- Minimal fix
- Regression test/check
- Owner order: fix before/after which item

### 3. Attack/Risk Surface Map

Defensive only. List surfaces, not exploit steps:

- Public endpoints
- Authenticated dangerous endpoints
- Local files that may leak data
- Secrets storage/transport points
- Device/browser/Flutter storage points
- Webhook trust boundaries
- Printer/system command boundaries

### 4. Sync Failure Matrix

Rows must include:

- POS desktop
- Tablet/customer order app
- KDS
- Backoffice/settings
- Node local server
- SQLite DB
- Print jobs
- Payment/webhooks
- E-invoice/MISA

Columns:

- Source of truth
- Cached state
- Event/reload path
- Failure mode
- User-visible symptom
- Data corruption risk
- Minimal fix

### 5. Prioritized Fix Order

Give the smallest safe sequence:

1. Stop catastrophic money/stock/security risks.
2. Stop sync/data-loss risks.
3. Stop compliance/invoice risks.
4. Fix UX/stale-state risks.
5. Delete/ignore bloat and runtime artifacts.

### 6. Tests To Prove It

Include runnable checks or precise test scenarios for:

- Duplicate webhook replay.
- Double-click/parallel checkout.
- Return/refund after shift close.
- Return/refund after e-invoice issued.
- Unauthorized receive stock.
- Secret-masked settings read/save.
- App restart after shift close.
- Receipt print vs reprint vs Setting template.
- KDS missed/replayed socket events.
- Backup restore smoke test.

## Output Rules

- Be blunt and specific.
- Do not say “looks fine” without naming what you checked.
- Prefer minimal fixes over rewrites.
- Mark false positives clearly.
- Mark uncertainty clearly.
- No exploit payloads.
- No full rewrite recommendation unless the existing design cannot be safely patched.

## Final Verdict

End with:

- `NOT READY FOR PRODUCTION`, or
- `NOT READY FOR REAL PAYMENTS`, or
- `NOT READY FOR ONLINE CHANNELS`, or
- `READY FOR LIMITED LOCAL PILOT`

Then list the smallest set of fixes needed to improve the verdict by one level.
