# Overnight Core Completion — 2026-08-25

## Kết quả điều hành

| Workstream | Trạng thái | Bằng chứng / blocker |
|---|---|---|
| Phone/Tablet release | BLOCKED | Static routing, version gate, analyze và Flutter tests GREEN. Không có ADB device (`REAL_DEVICE_BLOCKED`). Phone release build không tạo artifact sau timeout 10 phút; không publish. |
| Inc3b isolation | GREEN_LOCAL | 26/26 targeted tenant/branch/RBAC/device tests pass. Chưa deploy tree hiện tại. |
| Inc3c Windows lifecycle | GREEN_LOCAL / RUNTIME_NOT_RETESTED | AppId cố định `{DANDPAK-POS-DESKTOP-APP}`; signing/provenance/version consistency gates 9/9 pass. Installer lifecycle thực trên Windows chưa chạy lại trong phiên này. |
| Shopee | INTERNAL_READY_AWAITING_SHOPEE | Omni/Shopee targeted tests 14/14 pass; credential placeholder/empty fail closed. Cần Shopee cấp Sandbox/Test Partner ID/Key. |
| Promotion Policy | GREEN_LOCAL | Voucher/combo matrix nằm trong nhóm 55/55 pass, gồm ma trận 1.200 case. |
| MISA Phase C | MISA_INTERNAL_READY_AWAITING_TEST_CREDENTIAL | MISA end-to-end/worker/idempotency/cancel/reconcile/promotion tests nằm trong nhóm 55/55 pass. Cần credential MISA TEST và exact contract được MISA xác nhận trước live. |
| Review runtime | GREEN_EXISTING | `/health` ok lúc 2026-08-26T02:30:58Z, schema 7. Chưa deploy source hiện tại. |
| Production runtime | GREEN_EXISTING / NOT_DEPLOYED | `/health` ok lúc 2026-08-26T02:30:58Z, schema 7. Không deploy vì release/full-regression gate chưa đủ. |

## A. Starting state

- Repo: `D:\Dan D Pak`; branch `fix/universal-print-validation`.
- Source of truth: dirty local working tree. Khi tiếp quản có 223 tracked files thay đổi (khoảng +20.254/-4.634) và nhiều untracked files. Không reset/checkout/xóa thay đổi của owner.
- Versions khi audit:
  - Phone runtime: `2026.08.25.01` b80; applicationId `com.dandpak.dandpak_phone`; updater platform `android-phone`.
  - Tablet runtime: `2026.08.21.12` b119; applicationId `com.dandpak.dandpak_tablet`; updater platform `android`.
  - Windows runtime: `2026.08.23.02` b163; fixed Inno AppId `{DANDPAK-POS-DESKTOP-APP}`.
- Existing Windows artifact: `artifacts/releases/dan-d-pak-pos-setup-b163.exe`, 45.298.715 bytes, SHA256 `FBF106B1298998D4679D96DD2FE94EA3421041E212CEDA6543A66AE2C5387919`.
- Existing b163 provenance says dirty source SHA `d3c534faae5f8baf725c56bc04ef8f94b62612bf9c07b11994e8c720c632bc7f`; it predates this audit and was not rebuilt.
- Checked-in `server/releases/manifest.json` is stale (Windows b38/Android b25) and must not be treated as runtime truth.

## B. Root causes found and fixed

1. `migrate()` was not rerunnable after a paid order existed. On the second boot, `trg_paid_order_items_facts_immutable` blocked the startup-only legacy fact backfill (`paid order item facts are immutable`). Migration now drops that exact trigger only during the pre-traffic backfill; the canonical migration recreates it later in the same startup. WAN-cut/restart test passes.
2. Catalogue queue-dedupe test asserted on `app_settings`, but Edge intentionally excludes settings because they can contain secrets and because payload-less rows are not transportable. Test now configures a hub and checks dedupe on the complete `tables` payload.
3. Permission smoke fixture used the obsolete `roles: {role: perms}` contract, leaving no role card and failing with `Bad state: No element`. Fixture now matches the server's role-object list contract.
4. Release version sources diverged: Phone pubspec lacked the `.01` component; Tablet pubspec said b103 while runtime said b119; Desktop pubspec said b115 while runtime said b163. All are synchronized and a permanent three-app regression gate was added.

## C. Architecture decisions

- Settings with possible secrets remain outside Edge payload replication.
- Sync queue dedupe is validated only after a real hub identity exists and on a complete, allow-listed payload.
- Paid transactional facts remain immutable during runtime; only the single-threaded startup migration window can backfill legacy facts.
- Phone and Tablet retain separate update slots. `android` remains Tablet; `android-phone` remains Phone.
- No production/review deploy from a dirty, not-fully-regressed tree; existing healthy runtimes are preserved.

## D. Files changed in this completion pass

- `server/db.js`
- `server/catalogue-retail.test.mjs`
- `server/offline-edge-wan-cut.test.mjs`
- `server/release-signing-gates.test.mjs`
- `flutter-apps/dandpak_core/test/settings_permissions_smoke_test.dart`
- `flutter-apps/dandpak_phone/pubspec.yaml`
- `flutter-apps/dandpak_tablet/pubspec.yaml`
- `flutter-apps/dandpak_desktop/pubspec.yaml`
- `docs/OVERNIGHT_CORE_COMPLETION_2026-08-25.md`

All other pre-existing dirty/untracked files were preserved.

## E. DB schema/migrations

- No new table/column/user_version in this pass.
- Migration ordering fix described above. Verified by a real two-server Edge/VPS restart/replication test and SQLite `quick_check` inside that test.
- Rollback: revert only the new trigger-drop line if necessary. Do not manually edit a live DB. Restore a verified pre-deploy backup before rolling back binaries across incompatible schema changes.

## F. Security and isolation

- Secret-bearing `app_settings` was not added to Edge sync to satisfy a stale test.
- Shopee empty/placeholder credentials fail closed (`SHOPEE_SANDBOX_NOT_CONFIGURED`).
- Targeted RBAC tests cover host allow-list, tenant-admin boundary, review branch access and per-device job isolation.
- Release publication gates verify signature, provenance, SHA, platform and now three-app version consistency before network publication.

## G. Test evidence

| Command / suite | Result |
|---|---|
| `node --test server/phase2-rbac-tenant.test.mjs server/review-tenant-isolation.test.mjs server/branch-isolation-regression.test.mjs server/handy-device-routing-isolation.test.mjs` | 26/26 pass |
| `node --test server/omni-core.test.mjs server/shopee-sandbox-guard.test.mjs server/online-omni-operations.test.mjs server/payment-webhook-routing.test.mjs` | 14/14 pass |
| MISA + voucher/combo + release/app-slot group | 55/55 pass |
| Sync/ERP/idempotency/WAN group | Initial 26/27; after migration fix, failing WAN test passes individually in 61.98s. Other 26 remained pass. |
| `node --test server/catalogue-retail.test.mjs` | 21/21 pass after fixture correction |
| `node --test server/release-signing-gates.test.mjs` | 9/9 pass after version sync |
| `flutter analyze` in `dandpak_core` | No issues (127.3s) |
| `flutter test` in `dandpak_core` | 127 pass, 1 E2E skip; repeat after fix GREEN |
| Full `node --test server/*.test.mjs` | INCOMPLETE: exceeded 300s. It exposed the catalogue failure subsequently fixed; full suite was not rerun to completion. Do not report full regression GREEN. |

Unique targeted backend assertions evidenced GREEN: 143. Repeated focused gates are not added to that count.

## H. Runtime and artifacts

- ADB: daemon started, device list empty. No upgrade/session/orientation/device smoke was possible.
- Phone b80 release build: attempted with canonical `deploy/build-android-release.ps1 -Platform android-phone`; timed out after 10 minutes with no APK/provenance output. Child Flutter/Gradle processes remained unresponsive. No artifact published.
- Tablet b119: not built after Phone build environment stalled. No artifact published.
- Windows b163: existing artifact only; no rebuild/install/uninstall lifecycle in this pass.
- Review and Production health were read-only verified and both returned `ok=true`, SQLite database `ok=true`, schema version 7. Both expose unknown build fingerprint fields, which is a deployment observability risk.

## I. Deployment

- Deployed in this pass: nothing.
- Reason: canonical Android artifact gate incomplete, full backend regression incomplete, working tree very large/dirty, and no production backup/deploy evidence was produced. Publishing under those conditions would violate the handoff gates.
- Existing Review and Production were left untouched and healthy.

## J. External / environment blockers

1. No physical Phone/Tablet connected: real-device upgrade and workflow smoke blocked.
2. Shopee has not supplied Sandbox/Test Partner ID/Key.
3. MISA TEST credential and provider-confirmed exact contract are unavailable.
4. Local Android build environment stalled during release build; investigate Gradle/JDK child processes, signing configuration and daemon logs before retry.

## K. Remaining required work

- Environment/hardware/third-party only: resolve the four blockers above.
- Internal verification still required before deploy: complete full backend suite after splitting slow tests, build both signed APKs with provenance, verify package identity with `apkanalyzer`, run Windows clean/upgrade/channel-switch/uninstall matrix, produce backup rehearsal, then deploy Review first and run runtime isolation/money smoke.
- Because these gates are not complete, the honest status is not “TODO zero” and production was intentionally not changed.

## L. Rollback procedures

- Source: revert only the files listed in section D after reviewing overlap; never reset the whole dirty tree.
- Review/Production backend: take/verify DB backup before any future schema deploy, deploy immutable previous image/source fingerprint, check `/health`, tenant/branch canonical data and critical payment/invoice smoke; restore DB only when migration compatibility requires it.
- App release: never overwrite a platform slot with another app. Republish the last verified signed artifact plus matching provenance/manifest. Installer/update failure must leave current install and local business data intact.

## M. Three-pass audit / risk register

- Functional: targeted Phone flows, Omni/Shopee, promotion, MISA, sync restart and release routing are automated GREEN; physical-device and installer lifecycle remain blocked.
- Security/isolation: targeted negative isolation and fail-closed connector tests GREEN. Full repository hardcoded-branch/diagnostic audit cannot be certified from the incomplete full suite.
- Money/data: combo 1.200-case matrix, MISA worker/cancel/reconcile/idempotency, cash offline Edge replication and SQLite quick-check GREEN.
- Morning reviewers must scrutinize: very large inherited dirty tree; migration trigger ordering; Edge allow-list completeness; stale checked-in release manifest; unknown runtime build fingerprints; Android Gradle stall; missing full-suite final result; absence of Review deployment of current source.
