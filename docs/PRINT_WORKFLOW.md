# Print Workflow

Last updated: 2026-06-20

Every print and reprint is logged. Printing never loses its audit trail.

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
2. The job is dispatched to a printer (LAN/IP ESC-POS, OS printer, agent, or manual
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
