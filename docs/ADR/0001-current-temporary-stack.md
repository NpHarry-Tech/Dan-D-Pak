# ADR 0001: Current Temporary Stack

Date: 2026-06-18

## Status

Accepted for short-term demo only.

## Decision

The temporary demo stack may use Vercel for static frontend, Render for Node backend, and Supabase for future hosted database/realtime adapters.

## Consequences

- The code must not hard-code Vercel, Render, or Supabase assumptions.
- Frontend API base URL must be runtime-configurable.
- Backend secrets must stay backend-only.
- VPS migration remains the final target.
