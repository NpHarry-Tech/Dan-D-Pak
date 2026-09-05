# Security inventory — AES-256-GCM secret vault

Local verification date: 2026-09-05. No production/review database, credential,
deployment, or live provider was accessed.

## Vault invariants

| Control | Status | Evidence |
|---|---|---|
| AES-256-GCM, random 96-bit nonce, 128-bit tag | VERIFIED | `server/core/crypto.js`; runtime crypto tests |
| Versioned envelope with `key_id` | VERIFIED | new writes are `enc:v2:<base64url-key-id>.<nonce>.<tag>.<ciphertext>` |
| Active + previous key rotation | VERIFIED | `DATA_ENCRYPTION_ACTIVE_KEY_ID`, `DATA_ENCRYPTION_KEY(S)`, `DATA_ENCRYPTION_PREVIOUS_KEYS`; old-key decrypt/re-encrypt test |
| Mandatory AAD | VERIFIED | empty context throws; credential callers bind tenant/provider/record/field/version |
| Missing/wrong key, tamper, malformed/unsupported envelope | VERIFIED | all fail closed; no plaintext return |
| Legacy plaintext handling | VERIFIED | `decryptSecret` rejects it; only the explicit migration path accepts and immediately encrypts it |
| v1 compatibility | VERIFIED | v1 is decrypt-only and may use a configured previous key/legacy AAD; new writes are v2 |
| Binary encrypted backups/files | VERIFIED | `DDPENC02` carries key id; v1 remains decrypt-only |
| Encryption failure fallback | VERIFIED | secret decrypt and audit archive encryption throw; audit no longer returns plaintext after encryption failure |

## Complete caller/storage inventory

| Storage/caller | Secret fields | v2 AAD record identity | Public behavior | Status |
|---|---|---|---|---|
| `marketplace_connections` / `connectionStore.js` | `access_token_enc`, `refresh_token_enc` | branch + provider + shop + token field | `publicConnection` omits both tokens | VERIFIED |
| `app_settings.integrations_config` / `settings/integrations.js` | password, secretKey, apiKey, checksumKey, clientSecret, accessToken, refreshToken, webhookSecret, verifyToken (recursive) | branch + channel + object path + field | masked value only | VERIFIED |
| `app_settings.erp_config` / `settings/erp.js` | Business Central `clientSecret` | branch + provider + config record + field | `********` + configured flag | VERIFIED |
| `app_settings.firebase_service_account` / `settings/firebase.js` | whole service-account JSON | branch + firebase + setting record + field | status/configured only | VERIFIED |
| `haravan_shops` / `haravanConnector.js` | access/refresh token | branch + Haravan + shop domain + token field | connector status never returns raw tokens | VERIFIED (fake provider) |
| compacted audit archive / `db/audit.js` | compressed audit detail | system + audit + archive + detail field | internal decrypt only | VERIFIED |
| `services/integrations.reference.js` | duplicate reference implementation | none at runtime | no imports/callers found by repository-wide search | NOT A RUNTIME CALLER |

Provider secrets supplied only through deployment environment variables are not
database fields. They remain outside API payloads and are covered by central redaction.
`server/diagnostic-redaction.test.mjs` verifies token/secret/password/API-key removal.

## Migration and rollback design

`server/core/secretMigration.js` provides the reusable migration primitive:

1. Inventory rows with stable `id`, `field`, exact AAD `context`, and value.
2. Dry-run validates every encrypted envelope and emits only redacted states
   (`empty`, `legacy-plaintext`, `reencrypt-vN`, `current`) plus key id.
3. A real run decrypts/validates all candidates before writes, then executes all
   writes inside the caller-supplied database transaction.
4. Current active-key v2 rows are skipped, so restart/retry is idempotent and resumable.
5. Keep the previous key configured until a ciphertext-only backup is created,
   restored into an isolated copy, integrity-checked, and all rows report `current`.
6. Rollback restores that encrypted backup and the previous active-key environment;
   never downgrade by writing plaintext or deleting the previous key first.

No real migration was run in this task. Applying it to a production copy and proving
backup/restore is **NEEDS-LIVE-CANARY** and requires explicit database/credential authority.

## Runtime evidence

- `crypto-secret-vault.test.mjs`: 9/9 — round trip/randomness, every AAD dimension,
  wrong/missing key, nonce/tag/ciphertext/key-id tamper, malformed/unsupported/plaintext,
  rotation/previous-key/v1, binary envelope, dry-run/idempotency.
- `secret-vault-callers.test.mjs`: 2/2 — real isolated SQLite writes for integrations,
  ERP and marketplace; no raw value in DB public payload or audit.
- `firebase-settings-regression.test.mjs`: 4/4.
- Haravan fake-provider suites: 3 files, 5/5.
- `diagnostic-redaction.test.mjs`: 6/6.

Production and review must use different random key material. Their example configs use
different key ids, but inspecting or rotating deployed key material is intentionally
**BLOCKED-EXTERNAL** in this local-only task.

## Final production dependency audit (2026-09-05)

| Check | Result | Evidence |
|---|---|---|
| `npm audit --omit=dev` before remediation | **PARTIAL** — 9 moderate, 0 high/critical | `final-npm-audit-before.json` |
| Supported dependency refresh | **VERIFIED (source)** — `firebase-admin` 14.3.0 and `@google-cloud/storage` 7.22.0 | `package-lock.json` |
| Vulnerable transitive ranges | **VERIFIED (source)** — overrides resolve `qs` 6.16.0 and `uuid` 11.1.1 | `package.json`; `npm ls ...` |
| `npm audit --omit=dev` after remediation | **VERIFIED (source)** — 0 vulnerabilities | `final-npm-audit-after.json` |
| Runtime compatibility smoke | **VERIFIED (source)** — Firebase app/messaging, Cloud Storage and teeny-request imports plus CommonJS UUID v4 generation | local command output |
| Focused security/deployment regression | **VERIFIED (source)** — 32/32 pass | Firebase settings, push cache, security, deployment and release-signing suites |

The two high-confidence private-key markers found by the repository scan are explicit
fake fixtures in `diagnostic_redaction_test.dart` and
`firebase-settings-regression.test.mjs` (`FAKEKEYFORTEST`); no deploy credential or
real private key was inspected. The scan also identifies the same tracked Firebase
Android client API key in the phone/tablet `google-services.json` files. Firebase
documents these client identifiers as public-by-design and safe in client configuration
when restricted to Firebase APIs; verifying the live project's API restrictions,
Security Rules and App Check is **BLOCKED-EXTERNAL** because this task has no console or
credential authority. Live Firebase/Storage provider calls remain **BLOCKED-EXTERNAL**.
