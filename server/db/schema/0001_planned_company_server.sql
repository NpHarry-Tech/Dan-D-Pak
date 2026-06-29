-- Dan-D-Pak company server — PLANNED additive schema (PostgreSQL target)
-- Source of truth: the company server. See docs/DATABASE_SCHEMA.md.
--
-- SAFETY: This file is ADDITIVE and IDEMPOTENT. It contains no DROP/TRUNCATE of
-- business tables. It is NOT auto-run against production; apply only through a
-- reviewed migration runner during the SQLite -> PostgreSQL phase.
--
-- Naming uses *_history / *_versions / ledger tables so the database remembers
-- the history of important changes, not only the latest state.

BEGIN;

-- ===========================================================================
-- A. Restaurant settings versioning (history, never silent overwrite)
-- ===========================================================================
CREATE TABLE IF NOT EXISTS restaurant_setting_versions (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  branch_id       TEXT NOT NULL,
  setting_key     TEXT NOT NULL,
  value_json      JSONB NOT NULL,
  changed_by      TEXT,
  reason          TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_setting_versions_branch_key
  ON restaurant_setting_versions (branch_id, setting_key, created_at DESC);

CREATE TABLE IF NOT EXISTS table_layout_versions (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  branch_id       TEXT NOT NULL,
  layout_json     JSONB NOT NULL,
  changed_by      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ===========================================================================
-- C. Devices / App linking
-- ===========================================================================
CREATE TABLE IF NOT EXISTS devices (
  id              TEXT PRIMARY KEY,
  branch_id       TEXT,
  device_role     TEXT,                 -- ipad | pos | kds | printer_agent | warehouse
  label           TEXT,
  status          TEXT DEFAULT 'offline',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS device_pairing_requests (
  id              TEXT PRIMARY KEY,
  device_id       TEXT,
  branch_id       TEXT,
  requested_role  TEXT,
  pairing_code    TEXT,
  status          TEXT DEFAULT 'pending', -- pending | approved | rejected | expired
  requested_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_by     TEXT,
  resolved_at     TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS device_heartbeats (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  device_id       TEXT NOT NULL,
  seen_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  status          TEXT
);
CREATE INDEX IF NOT EXISTS idx_device_heartbeats_device
  ON device_heartbeats (device_id, seen_at DESC);

CREATE TABLE IF NOT EXISTS device_app_links (
  id              TEXT PRIMARY KEY,
  device_id       TEXT,
  branch_id       TEXT,
  status          TEXT DEFAULT 'active', -- active | revoked
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at      TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS device_app_link_tokens (
  id              TEXT PRIMARY KEY,
  link_id         TEXT NOT NULL,
  token_hash      TEXT NOT NULL,        -- store hash/opaque, never raw token
  expires_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at      TIMESTAMPTZ
);

-- ===========================================================================
-- E. Pricing versions (old orders keep old price)
-- ===========================================================================
CREATE TABLE IF NOT EXISTS price_versions (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  price_book_id   TEXT,
  menu_item_id    TEXT NOT NULL,
  price           NUMERIC(14,2) NOT NULL,
  effective_from  TIMESTAMPTZ NOT NULL DEFAULT now(),
  effective_to    TIMESTAMPTZ,
  changed_by      TEXT,
  reason          TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_price_versions_item
  ON price_versions (menu_item_id, effective_from DESC);

CREATE TABLE IF NOT EXISTS price_change_logs (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  menu_item_id    TEXT NOT NULL,
  old_price       NUMERIC(14,2),
  new_price       NUMERIC(14,2),
  changed_by      TEXT,
  reason          TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ===========================================================================
-- F/G. Order + KDS status history and timing
-- ===========================================================================
CREATE TABLE IF NOT EXISTS order_status_history (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id        TEXT NOT NULL,
  status          TEXT NOT NULL,
  changed_by      TEXT,
  device_id       TEXT,
  reason          TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_order_status_history_order
  ON order_status_history (order_id, created_at);

CREATE TABLE IF NOT EXISTS order_item_status_history (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_item_id   TEXT NOT NULL,
  status          TEXT NOT NULL,
  station         TEXT,
  changed_by      TEXT,
  device_id       TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS preparation_timing_logs (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kitchen_ticket_id TEXT,
  station         TEXT,
  accepted_at     TIMESTAMPTZ,
  preparing_at    TIMESTAMPTZ,
  ready_at        TIMESTAMPTZ,
  served_at       TIMESTAMPTZ,
  sla_seconds     INTEGER
);

-- ===========================================================================
-- H. Printing / reprint logs
-- ===========================================================================
CREATE TABLE IF NOT EXISTS print_attempts (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  print_job_id    TEXT NOT NULL,
  printer_id      TEXT,
  result          TEXT NOT NULL,        -- success | failed
  error           TEXT,
  attempted_by    TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS reprint_logs (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  print_job_id    TEXT NOT NULL,
  reprinted_by    TEXT,
  reason          TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ===========================================================================
-- I. Payments / cash / bank account config (secure, history-aware)
-- ===========================================================================
CREATE TABLE IF NOT EXISTS payment_status_history (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  payment_id      TEXT NOT NULL,
  status          TEXT NOT NULL,        -- pending | recorded | approved | reversed
  changed_by      TEXT,
  reason          TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bank_accounts (
  id              TEXT PRIMARY KEY,
  branch_id       TEXT,
  bank_name       TEXT,
  account_name    TEXT,
  account_masked  TEXT,                 -- e.g. ****1234, never the full number
  provider        TEXT,
  status          TEXT DEFAULT 'active',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Secret material is stored encrypted (or in a secret manager), never plaintext.
CREATE TABLE IF NOT EXISTS payment_provider_tokens (
  id              TEXT PRIMARY KEY,
  provider        TEXT NOT NULL,
  token_encrypted BYTEA,                -- encrypted; never log full value
  metadata_json   JSONB,
  status          TEXT DEFAULT 'active',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  rotated_at      TIMESTAMPTZ,
  revoked_at      TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS bank_config_history (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  bank_account_id TEXT,
  action          TEXT,                 -- link | update | rotate | revoke
  changed_by      TEXT,
  summary         TEXT,                 -- masked summary, never secrets
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ===========================================================================
-- N. Sync — company-server side (idempotency + conflicts)
-- ===========================================================================
CREATE TABLE IF NOT EXISTS sync_events (
  event_id        TEXT PRIMARY KEY,
  branch_id       TEXT,
  device_id       TEXT,
  event_type      TEXT NOT NULL,
  payload_hash    TEXT,
  sync_status     TEXT NOT NULL DEFAULT 'VPS_PENDING',
  retry_count     INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_sync_attempt_at TIMESTAMPTZ,
  acknowledged_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS processed_event_ids (
  event_id        TEXT PRIMARY KEY,
  processed_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sync_conflicts (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_id        TEXT,
  reason          TEXT,
  detail_json     JSONB,
  status          TEXT DEFAULT 'open',  -- open | resolved
  resolved_by     TEXT,
  resolved_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ===========================================================================
-- O. Expanded audit / logs
-- ===========================================================================
CREATE TABLE IF NOT EXISTS audit_logs (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor           TEXT,
  action          TEXT NOT NULL,
  entity          TEXT,
  device_id       TEXT,
  ip              TEXT,
  old_summary     TEXT,
  new_summary     TEXT,
  reason          TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity
  ON audit_logs (entity, created_at DESC);

CREATE TABLE IF NOT EXISTS config_change_logs (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  scope           TEXT,
  changed_by      TEXT,
  summary         TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS permission_change_logs (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  target_user     TEXT,
  changed_by      TEXT,
  summary         TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMIT;
