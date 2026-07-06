# ADR 0001: Retired Temporary Hosted Stack

Date: 2026-06-18

## Status

Superseded by ADR 0002 and the company-server/VPS deployment path.

## Decision

The project should no longer document or depend on the earlier hosted split-demo deployment. The supported paths are local store-server development and the company-server/VPS deployment target.

## Consequences

- The code must not hard-code hosted-demo provider assumptions.
- Frontend API base URL must be runtime-configurable.
- Backend secrets must stay backend-only.
- VPS/company-server deployment is the production target.
