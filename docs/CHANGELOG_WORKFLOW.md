# Changelog Workflow

Last updated: 2026-06-18

For every meaningful change, append a changelog entry in the PR/commit notes or a future `CHANGELOG.md`.

## Required Entry Fields

- Date
- Summary
- Files changed
- Protected domains touched
- Database or migration impact
- API contract impact
- Realtime event impact
- Deployment impact
- Manual tests performed
- Rollback plan
- Warnings or approvals needed

## Safety Labels

- `docs-only`: documentation or comments only.
- `config-only`: env/deployment/config behavior only.
- `protected-read`: reads protected data but does not mutate it.
- `protected-write`: creates or updates protected data.
- `destructive-risk`: deletes, resets, migrates, or rewrites protected data. Requires explicit warning and approval.

## Current Change Note

This restructuring pass adds docs, config/adapters, frontend API/realtime seams, VPS scaffolding, and protected-zone warnings. It does not intentionally change order/payment/inventory business behavior.
