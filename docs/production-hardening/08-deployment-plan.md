# Deployment và rollback plan

The legacy source-overlay command `deploy/day-server-len-vps.ps1` is retired and throws before
any `scp`/`ssh` unless used with local-only `-ChiGoi`. Production unlock evidence is validated by
`deploy/verify-production-evidence.ps1`; false/missing/stale gates, dirty source, wrong commit/host,
unpinned SSH identity, missing hashes or rollback image are all no-go conditions.

Canonical immutable path (implemented but not production-activated):

1. Commit a reviewed clean tree.
2. `deploy/build-server-image.ps1` reruns the full server suite, builds pinned-base linux/amd64,
   labels commit/source SHA, exports an image tar and hashes its manifest.
3. Fill evidence only from actual restore/signing/hardware/WAN/reconciliation/rollback results;
   `deploy/verify-production-evidence.ps1` must return `ok=true` within 24 hours. A boolean
   alone is not test evidence: the file must record at least 69 recursively discovered server
   test files / 393 passing server tests and 109 passing Flutter tests with exactly the one
   documented updater E2E skip.
   Production-copy evidence is likewise quantitative: the encrypted artifact and decrypted DB
   each have their own SHA-256; the decrypted SHA must equal the rehearsal source SHA (encrypted
   and plaintext hashes are not incorrectly compared), at least 63 tables are compared,
   `PRAGMA quick_check` is exactly `ok`, all 31
   critical logical relations are checked with zero orphans, and pending outbox counts are
   identical before and after the rehearsal.
   Generate this DB fragment with `deploy/rehearse-production-backup.ps1`; it derives the
   authenticated encryption context from the canonical backup filename, never prints the key,
   and deletes the decrypted plaintext in `finally` after the isolated-copy rehearsal.
4. `deploy/deploy-production-immutable.ps1` validates identical tar/manifest/evidence bytes, pins
   the SSH host key, uploads to a commit-specific staging directory, takes a live backup, confirms
   the running image equals the rehearsed rollback image, loads the new image, activates with
   `--no-build`, proves the active container image ID equals the loaded image, and requires
   `/health.build` to match manifest commit, source SHA-256, build UTC and schema version exactly.
   Any identity or app+DB health mismatch traps failure back to rollback; a green endpoint from
   an old image is not accepted.
   The immediately preceding live backup must also emit valid encrypted/restored SHA markers;
   deployment records them as mode-600 `live-backup-evidence.txt` beside the immutable staging
   release before it is allowed to inspect or replace the running image.
   Rollback is pinned by immutable Docker image ID as well as its human-readable tag; the verifier
   rejects a missing/non-SHA ID and remote activation rejects any tag drift or running-container
   mismatch against the rehearsed ID. The rollback function itself re-checks the restored
   container image ID plus app/DB health after compose returns; rollback is not reported as
   successful merely because `up --wait` returned.
   Manual evidence is quantitative too: SHA-256 for each signed Windows/phone/tablet artifact,
   all 19 required acceptance cases passing with zero failures, at least three WAN-cut/recovery
   scenarios with zero failures, at least ten payment–inventory–invoice transactions reconciled
   with zero mismatches, and at least one successful rollback rehearsal with zero failed attempts.
   Execute and retain evidence using [13-manual-acceptance-checklist.md](13-manual-acceptance-checklist.md).

The Docker build context is allow-listed by `.dockerignore`; runtime DBs, `.env`, backups,
uploads, releases, archives and product images cannot enter the image context.

## Trước deploy

- Chụp encrypted DB backup + config + image/agent/APK hashes; restore trên máy tách biệt.
- Chạy integrity check, schema checksum và reconciliation baseline chỉ đọc.
- Build immutable từ manifest có commit, dirty-tree hash, build time, schema compatibility.
- Migration chỉ additive; thử trên bản sao production và đo lock/disk.

## Rollout

1. Deploy code đọc schema cũ và mới.
2. Apply additive migration trong maintenance window sau backup verified.
3. Bật snapshot/outbox shadow mode, đối chiếu total trước khi đổi consumer.
4. Canary một thiết bị; kiểm payment–inventory–snapshot–print reconciliation.
5. Chuyển consumer qua snapshot bằng feature flag rồi mở rộng.

## Rollback

- Rollback ứng dụng về image đã xác minh tương thích schema mới.
- Không drop table/cột; worker mới có kill switch.
- Nếu lệch reconciliation: dừng mutation rủi ro, giữ dữ liệu và xuất operation IDs; không tự sửa tiền/kho.

No-go nếu backup chưa restore được, schema hash lạ, concurrency/snapshot fail, còn money rule chưa rõ, hoặc chưa xác minh thiết bị canary.
