# Print Workflow

Last updated: 2026-07-30

Every print and reprint is logged. Printing never loses its audit trail.

## Printer route resolution (never hard-code route ids)

A print hook must **never** target a fixed route id. Stores rename or delete the
default routes (`bill`, `kitchen`, `bar`, `label`, `runner`), and a job pointing at
a route that no longer exists is treated as orphaned by `pendingAgentJobs` and set
to `cancelled` — the printer simply stays silent. This caused a real outage on
2026-07-30 where every receipt was cancelled right after payment.

Resolve by **output type** instead, via `resolvePrinterForOutput(output, branch, opts)`:

1. `preferDevice` only — a `system` route physically plugged into the calling
   device (matched against the printer names its Hardware Agent reports).
2. `preferDevice` only — a route whose `primaryDeviceId` is the calling device.
3. The legacy route id, when it still exists (keeps running configs working).
4. Any active route with that output, preferring `lan`/`system` over `browser`.
5. `null` → the caller logs a specific `*_printer_missing` system-log entry and
   creates no job, rather than queueing one that can never print.

`resolveReceiptPrinter(branch, { deviceId })` wraps this with `preferDevice: true`,
so each POS prints its bill on the printer attached to itself.

## Printer status is agent liveness, not a config flag

`printers[].active` is the "Đang sử dụng" checkbox — configuration, not reality.
Real status for a `system` route is whether the POS holding it has reported within
`AGENT_PRINTERS_TTL` (60s; the agent reports every 20s). `listPrinters()` computes
this from an in-memory map with no I/O, so it is correct even without `live=1`.
Never render "Sẵn sàng" from `active`.

## Thermal printers must receive RAW ESC/POS, never driver text

A thermal printer installed as a Windows printer must be driven with **raw bytes**
(`StartDocPrinter` with `pDataType = "RAW"`, then `WritePrinter`). Printing through
`Out-Printer` hands the text to the Windows driver, which rasterises it as an
anti-aliased greyscale bitmap; the thermal head can only fire dots, so it dithers
that bitmap into very faint, smeared output — and every ESC/POS command (density,
cut, drawer pulse) is swallowed as literal text. This produced an unreadable test
slip on the store's POS-80C on 2026-07-30.

The server sets `raw` on each agent job from the printer's `output` — everything
except `report` is treated as thermal. A4/report routes keep the driver path,
because raw ESC/POS on a laser printer prints garbage.

Rebuild the agent binary with `deploy/build-agent.ps1` after any `agent.cjs`
change, then rebuild the desktop installer so CMake copies it in. A backend-only
deploy cannot change agent behaviour.

## Never print raw payload JSON

`renderGeneric()` once ended with `JSON.stringify(payload).slice(0, 1200)`, so the
test slip printed the entire printer configuration onto the customer-facing roll.
Print named fields only, wrapped to `paperWidthCharsFrom(bill)` — 24/32/48 columns
for 40/58/80mm paper. Any fixed string in a slip must go through `wrap()`; a
hard-coded line that fits 80mm will overflow 58mm.

## Who may see and touch which printer

`listPrinters({ scope: 'device' })` and `assertPrinterUsableBy()` must stay in
exact agreement: a route that is usable must be visible, and a route that is
visible must be usable. Non-privileged staff get routes attached to their own
device plus shared `lan` routes; another POS's directly-attached printer is both
hidden and refused (403).

## Tables

- `printers`
- `print_jobs`
- `print_job_items`
- `print_templates`
- `print_attempts`
- `reprint_logs`

## Print types

- Bill / receipt print
- Kitchen print
- Bar print
- Salad / cold station print
- Label print

## Workflow

1. An action (order sent, bill closed, label requested) creates a `print_job`.
2. The job is dispatched to a printer (LAN/IP ESC-POS, OS printer, or browser
   dialog).
3. Each dispatch attempt writes a `print_attempts` row (success/failure + reason).
4. On failure the job can be retried; failures are visible in the UI.
5. A **reprint** creates a `reprint_logs` row capturing who reprinted, why, and
   when — the original job is never silently replaced.

## Logged for every print/reprint

- printer + status
- job type and items
- attempt result (success / failed) and error reason
- who triggered it
- why (for reprints)
- when

## Hardware notes

- LAN/IP printers use the printer's local IP and ESC/POS port (usually `9100`).
- OS printers use the driver on the backend host.
- Browser printers open the system print dialog for review/reprint.
- Cash drawers usually open via an ESC/POS drawer pulse on the bill printer.

See [DEVICE_WORKFLOWS.md](DEVICE_WORKFLOWS.md) and
[AUDIT_LOGGING.md](AUDIT_LOGGING.md).
