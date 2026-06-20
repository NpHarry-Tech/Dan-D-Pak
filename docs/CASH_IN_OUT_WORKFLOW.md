# Cash In / Out Workflow

Last updated: 2026-06-20

Cash handling is tracked per shift and per drawer, with reasons and approvals.

## Tables

- `cash_drawers`
- `cash_shifts`
- `cash_in_out`
- `cash_count_logs`
- (linked) `shift_reports`

## Workflow

1. **Open shift**: staff opens the cash drawer; opening cash (float) is recorded.
2. **Cash in**: money added to the drawer with a required reason.
3. **Cash out**: money removed (e.g. petty cash, supplier pay-out) with a required
   reason; manager approval if policy requires.
4. **Cash count**: drawer counted during/at end of shift (`cash_count_logs`).
5. **Close shift**: closing count vs. expected is computed; variance recorded.
6. The shift report is updated; every action is audited.

## Rules

- Opening cash, cash in, cash out, and counts are all recorded — never silently
  adjusted.
- Reasons are required for cash in/out.
- Manager approval where configured.
- Variance at close is captured, not hidden.
- All cash actions write audit logs.

## Current implementation

`server/services/cashDrawer.js` and `server/services/shifts.js` with
`cash_drawer_entries`, `cash_drawer_reimbursement_allocations`, and `shifts`
already implement opening cash, cash entries, and shift open/close. The planned
schema generalizes naming (`cash_shifts`, `cash_in_out`, `cash_count_logs`)
additively. See [DATABASE_SCHEMA.md](DATABASE_SCHEMA.md).
