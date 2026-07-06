# 14 - GPT 5.6 SOURCE REVIEW BRIEF

Use this brief with the full repository attached or mounted.

## Mission

You are reviewing my own POS/ERP codebase for an internal defensive audit. Do not create exploit payloads, offensive playbooks, persistence, evasion, credential theft steps, or real-world abuse instructions. Focus on correctness, data loss, business logic, payment integrity, inventory integrity, privacy, and defensive security.

Score the entire project and produce a concrete fix plan for every confirmed bug and security risk.

## Scope

Review all source under:

- `server/`
- `flutter-apps/dandpak_pos/`
- `flutter-apps/dandpak_tablet/`
- `flutter-apps/dandpak_kds/`
- `flutter-apps/dandpak_backoffice/`
- `flutter-apps/dandpak_core/`
- `web/`
- `docs/audit/`

Treat `server/permanent-storage/`, `backups/`, `scratch/`, build outputs, screenshots, binary assets, and runtime data as evidence/risk surfaces, not application source unless needed.

## Business Context

This is a local-first restaurant/retail POS with:

- Flutter desktop POS, tablet/customer app, KDS, backoffice.
- Node/Express local server.
- SQLite store DB.
- Inventory, lots, purchase, cash drawer, shifts, retail checkout, FnB orders.
- Online channels: GrabFood/ShopeeFood/Be/Website style webhooks.
- Payment/webhook integrations: VietQR, SePay, Casso, payOS.
- E-invoice/MISA integration.
- Printer/receipt/template system.

Money, stock, invoice, shift close, refund/return, webhook, and permission paths are high risk.

## Existing Audit Context

Read these first:

- `docs/audit/00_AUDIT_PROGRESS.md`
- `docs/audit/06_SECURITY_FINDINGS.md`
- `docs/audit/07_BUSINESS_LOGIC_FINDINGS.md`
- `docs/audit/08_THIRD_PARTY_PAYMENT_ONLINE_AUDIT.md`
- `docs/audit/11_FIX_PRIORITY.md`
- `docs/audit/12_FINAL_CHECKLIST.md`
- `docs/audit/13_PONYTAIL_REAUDIT_2026-07-04.md`

Do not blindly trust existing findings. Confirm, reject, downgrade, upgrade, or merge them with source evidence.

## Known High-Risk Areas To Recheck

1. Online webhook idempotency: duplicate partner retries must not double-create orders, revenue, stock deduction, payment rows, or print jobs.
2. Online return/refund: must reverse stock/payment/invoice state in one transaction.
3. Inventory receive routes: every stock/cost-changing route must require the right permission and server-side authorization.
4. Integration secrets: API responses/UI must not expose plaintext secrets; save flow must preserve existing secrets when masked.
5. Webhook auth: enabled channels must fail closed if secret/signature config is missing; comparisons should be constant-time where relevant.
6. Manual transfer confirmation: must not let staff close bank-transfer bills without auditable matched bank transaction or tightly scoped override.
7. Discounts/vouchers: cap, permission, redemption ledger, refund behavior.
8. Shift close: invoice retry/queue logic, forced close audit, post-close edit gates.
9. Receipt/print/reprint: one canonical renderer; reprints clearly marked; no stale config drift.
10. Runtime data inside repo: backups/permanent-storage/scratch should not leak secrets or large private data into source review/deploy bundles.

## Scoring Rubric

Give scores from 0 to 10:

- Security posture
- Payment integrity
- Inventory correctness
- Invoice/compliance safety
- Permission/RBAC correctness
- Data durability and backup safety
- Flutter desktop UX correctness
- Flutter tablet/KDS/backoffice readiness
- Operational maintainability
- Test coverage
- Overall production readiness

For each score, include one short justification and the top 3 reasons it is not higher.

## Required Output Format

### Executive Scorecard

Table with category, score, confidence, top blocker.

### P0/P1/P2/P3 Findings

For each finding:

- ID
- Severity
- Status: confirmed / likely / needs repro / false positive
- Affected files and functions
- Exact risk
- Source evidence
- Minimal fix
- Safer long-term fix only if needed
- Regression test/check to add
- Dependencies between fixes

### Fix Plan

Give an ordered plan:

1. Must fix before real online/payment use
2. Must fix before production deployment
3. Should fix soon
4. Cleanup/deletion only

Each item must name the files to edit and the smallest safe change.

### Test Plan

Include:

- Node syntax/unit/integration checks
- Flutter analyze/build checks
- Payment webhook idempotency simulations
- Stock return/refund simulations
- Permission-negative tests
- Receipt print/reprint snapshot checks

### Do Not Do

- Do not propose a full rewrite.
- Do not invent new services/dependencies unless the existing code cannot safely support the fix.
- Do not provide exploit payloads or attack automation.
- Do not hide uncertainty: mark items that need runtime reproduction.

## Final Decision

End with one of:

- `READY FOR LIMITED LOCAL PILOT`
- `NOT READY FOR ONLINE CHANNELS`
- `NOT READY FOR REAL PAYMENTS`
- `NOT READY FOR PRODUCTION`

Then list the smallest set of fixes needed to advance one level.
