# Realtime Adapters

Current live mode is Socket.IO through `server/realtime.js`. Client code should not depend on a specific backend provider beyond the shared realtime client contract.

Target provider options:

- `socketio` for current local/VPS-compatible realtime.
- `websocket` for a minimal VPS backend realtime option.
- `supabase` for temporary hosted demo realtime.

AI/Agent Safety:
Realtime events drive orders, KDS, payment state, devices, and dashboards. Do not rename or remove events without documenting client/backend impact.
