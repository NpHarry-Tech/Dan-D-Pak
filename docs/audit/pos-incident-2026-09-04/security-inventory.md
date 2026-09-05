# Security Inventory — Secret Vault (continuation gate 1/8)

Read-only assessment of the existing secret-at-rest crypto, plus what a full
AES-256-GCM Secret Vault gate still requires. No production/review DB was migrated.

## What exists — `server/core/crypto.js`

A genuine authenticated-encryption vault (not a stub):

| Requirement | Status | Where |
|---|---|---|
| AES-256-GCM | **VERIFIED (source)** | `createCipheriv('aes-256-gcm', …)` — crypto.js:21,44 |
| Random 96-bit nonce per message | **VERIFIED** | `randomBytes(12)` — crypto.js:20,43; test: two encrypts of same value differ |
| 256-bit key from env | **VERIFIED** | `DATA_ENCRYPTION_KEY`, 32 bytes hex/base64 — crypto.js:5-12 |
| Authentication tag (128-bit) | **VERIFIED** | `getAuthTag`/`setAuthTag`; test asserts 16-byte tag |
| Versioned envelope | **VERIFIED** | string `enc:v1:` prefix; bytes `DDPENC01` header |
| AAD binding | **VERIFIED (mechanism)** | `setAAD(context)` — callers pass e.g. `haravan:${shop}:access` |
| Missing key → fail-closed | **VERIFIED** | throws `DATA_ENCRYPTION_KEY is required` |
| Wrong key → fail (no plaintext) | **VERIFIED** | GCM tag verification → `final()` throws |
| Tamper (iv/tag/ct/AAD) → fail | **VERIFIED** | test flips a byte in each part → throws |
| Cross-tenant ciphertext swap → fail | **VERIFIED (when context binds tenant)** | AAD mismatch → throws |
| No silent plaintext fallback on failure | **VERIFIED** | decrypt of a valid-but-corrupt `enc:` throws; only *never-encrypted* legacy values pass through (migration) |

Tests (real crypto round-trips, not source regex):
`server/crypto-secret-vault.test.mjs` — **9/9 pass**.

## Gaps vs the full gate — HONEST status

- **`key_id` / key rotation — NOT DONE.** The envelope carries a *version* (`v1`) but no
  `key_id`. Rotation would need a v2 envelope carrying `key_id`, a key registry (id → key),
  backward-compatible v1 decrypt, and an **idempotent dry-run re-encrypt** migration.
  Not implemented; would touch the envelope format and every stored secret (prod-data
  implications) — must be a dedicated, canaried change. **PARTIAL.**
- **AAD completeness across ALL callers — NOT AUDITED.** The mechanism binds whatever
  `context` the caller passes. Spot-checked: `haravanConnector` binds
  `haravan:${shop}:access|refresh` (shop-scoped → cross-shop swap fails). A full audit that
  *every* secret field (Shopee/Lazada/TikTok/Meta/Zalo/ERP/Firebase in
  `connectionStore.js`, `settings/*`) binds tenant+provider+field+version is **remaining**.
- **prod/review key separation — operational, NOT verified in-session.** Achieved by
  distinct `DATA_ENCRYPTION_KEY` env per deployment; not exercised here (no deploy).
  **NEEDS-LIVE-CANARY.**
- **"No plaintext in DB/API/log" end-to-end — PARTIAL.** Unit level proven (values are
  stored as `enc:v1:` after `encryptSecret`); a full sweep asserting no provider secret is
  ever persisted or logged in the clear is **remaining**.

## Verdict
Secret-at-rest core is **VERIFIED (source)** for AES-256-GCM/AAD/tamper/fail-closed. The
**key_id + rotation + full-caller-AAD audit** portions are **PARTIAL / NOT DONE** and are
the real remaining work for this gate. No production or review DB was touched.
