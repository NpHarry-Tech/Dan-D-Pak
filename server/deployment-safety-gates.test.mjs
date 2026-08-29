import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const legacyDeploy = fs.readFileSync('deploy/day-server-len-vps.ps1', 'utf8');
const evidenceVerifier = fs.readFileSync('deploy/verify-production-evidence.ps1', 'utf8');
const dockerfile = fs.readFileSync('server/Dockerfile', 'utf8');
const dockerignore = fs.readFileSync('.dockerignore', 'utf8');
const gitignore = fs.readFileSync('.gitignore', 'utf8');
const backupRehearsal = fs.readFileSync('deploy/rehearse-production-backup.ps1', 'utf8');
const manifestWriter = fs.readFileSync('deploy/write-build-manifest.ps1', 'utf8');
const serverImageBuilder = fs.readFileSync('deploy/build-server-image.ps1', 'utf8');
const immutableDeploy = fs.readFileSync('deploy/deploy-production-immutable.ps1', 'utf8');
const liveBackup = fs.readFileSync('deploy/company-server/scripts/backup-db.sh', 'utf8');
const manualAcceptance = fs.readFileSync('docs/production-hardening/13-manual-acceptance-checklist.md', 'utf8');
const legacyInvoiceReader = fs.readFileSync('server/services/invoices.js', 'utf8');
const invoiceRoutes = fs.readFileSync('server/modules/invoices/routes.js', 'utf8');

test('legacy source-overlay production deploy is retired before scp or ssh', () => {
  const retired = legacyDeploy.indexOf('RETIRED_UNSAFE_DEPLOY');
  const scp = legacyDeploy.indexOf('& scp');
  const ssh = legacyDeploy.indexOf('& ssh');
  assert.ok(retired >= 0 && scp > retired && ssh > retired);
  assert.match(legacyDeploy,
    /if \(-not \$ChiGoi -and -not \$EpDeployChiuTrachNhiem\)/);
  assert.match(legacyDeploy, /GetRandomFileName/);
  assert.doesNotMatch(legacyDeploy, /Remove-Item \$tam -Recurse/);
  assert.match(legacyDeploy, /KHONG copy thu muc nay vao production/);

  const run = spawnSync('powershell.exe', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass',
    '-File', 'deploy/day-server-len-vps.ps1',
  ], { cwd: process.cwd(), encoding: 'utf8' });
  assert.notEqual(run.status, 0);
  assert.match(`${run.stdout}\n${run.stderr}`, /RETIRED_UNSAFE_DEPLOY/);
});

test('immutable production deploy verifies evidence and host identity before network mutation', () => {
  const evidence = immutableDeploy.indexOf('verify-production-evidence.ps1');
  const keyscan = immutableDeploy.indexOf('ssh-keyscan');
  const mkdir = immutableDeploy.indexOf('mkdir -p');
  const scp = immutableDeploy.indexOf('& scp');
  assert.ok(evidence >= 0 && evidence < keyscan && keyscan < mkdir && mkdir < scp);
  assert.match(immutableDeploy, /StrictHostKeyChecking=yes/);
  assert.match(immutableDeploy, /fmDCv6ehU4KpbB\+pV7uVvFbC\+M0SM6OF8YINwuAkRZM/);
  assert.match(immutableDeploy, /Get-FileHash/);
});

test('immutable production activation backs up, preserves rollback image and health-rolls back', () => {
  const backup = immutableDeploy.indexOf('./scripts/backup-db.sh');
  const tag = immutableDeploy.indexOf('docker tag');
  const load = immutableDeploy.indexOf('docker load');
  const activate = immutableDeploy.indexOf("APP_IMAGE='$imageTag'");
  assert.ok(backup >= 0 && backup < tag && tag < load && load < activate);
  assert.match(immutableDeploy, /trap rollback ERR/);
  assert.match(immutableDeploy, /b\.database&&b\.database\.ok/);
  assert.match(immutableDeploy, /Activated container image ID mismatch/);
  assert.match(immutableDeploy, /BACKUP_SHA256/);
  assert.match(immutableDeploy, /RESTORED_DB_SHA256/);
  assert.match(immutableDeploy, /Live backup did not emit verified encrypted\/restored SHA evidence/);
  assert.match(immutableDeploy, /live-backup-evidence\.txt/);
  assert.match(immutableDeploy, /x\.gitCommit==='\$commit'/);
  assert.match(immutableDeploy, /x\.sourceTreeSha256==='\$expectedSourceHash'/);
  assert.match(immutableDeploy, /x\.buildTimeUtc==='\$expectedBuiltAt'/);
  assert.match(immutableDeploy, /x\.schemaVersion===\$expectedSchemaVersion/);
  assert.match(immutableDeploy, /Running image does not match rehearsed rollback image/);
  assert.match(immutableDeploy, /Rollback tag no longer matches rehearsed immutable image ID/);
  assert.match(immutableDeploy, /expectedRollbackImageId/);
  assert.match(immutableDeploy, /APP_IMAGE='\$expectedRollbackImage'/);
  assert.match(immutableDeploy, /rollback container does not match rehearsed immutable image ID/);
  assert.match(immutableDeploy, /rollback_image/);
  assert.match(immutableDeploy, /--no-build --wait app/);
});

test('live backup is decrypt-restored, integrity-checked and hash-verified before activation', () => {
  const create = liveBackup.indexOf('.backup $PLAIN');
  const encrypt = liveBackup.indexOf('encrypt-file.js');
  const decrypt = liveBackup.indexOf('decrypt-file.js');
  const quick = liveBackup.indexOf('PRAGMA quick_check;');
  const copy = liveBackup.indexOf('docker compose cp');
  assert.ok(create >= 0 && create < encrypt && encrypt < decrypt && decrypt < quick && quick < copy);
  assert.match(liveBackup, /PLAIN_SHA/);
  assert.match(liveBackup, /VERIFY_SHA/);
  assert.match(liveBackup, /CONTAINER_ENCRYPTED_SHA/);
  assert.match(liveBackup, /HOST_ENCRYPTED_SHA/);
  assert.match(liveBackup, /trap cleanup EXIT/);
  assert.match(liveBackup, /rm -f "\$HOST_BACKUP"/);
});

test('immutable server image builder gates source, tests, labels and exported hash', () => {
  const dirtyGate = serverImageBuilder.indexOf('clean committed worktree');
  const audit = serverImageBuilder.indexOf('npm audit --omit=dev --audit-level=high');
  const tests = serverImageBuilder.indexOf('node --test @serverTests');
  const dockerBuild = serverImageBuilder.indexOf('docker build');
  const dockerSave = serverImageBuilder.indexOf('docker save');
  assert.ok(dirtyGate >= 0 && dirtyGate < audit && audit < tests && tests < dockerBuild && dockerBuild < dockerSave);
  assert.match(serverImageBuilder, /--platform linux\/amd64/);
  assert.match(serverImageBuilder, /BUILD_GIT_COMMIT/);
  assert.match(serverImageBuilder, /BUILD_SOURCE_SHA256/);
  assert.match(serverImageBuilder, /schemaVersion = \$schemaVersion/);
  assert.match(serverImageBuilder, /Get-ChildItem[^\n]+server[^\n]+-Recurse[^\n]+\*\.test\.mjs/);
  assert.match(serverImageBuilder, /node --test @serverTests/);
  assert.match(serverImageBuilder, /Get-FileHash/);
  assert.match(serverImageBuilder, /imageId/);
});

test('artifact provenance and server image use one canonical source-tree hash helper', () => {
  assert.match(manifestWriter, /get-source-tree-sha256\.ps1/);
  const helper = fs.readFileSync('deploy/get-source-tree-sha256.ps1', 'utf8');
  assert.match(helper, /SHA256/);
  assert.match(helper, /ls-files --cached --others --exclude-standard/);
  assert.match(helper, /\.codex-test-temp/);
  assert.match(helper, /artifacts/);
});

test('server image build context excludes production/runtime data and pins its base', () => {
  assert.match(dockerfile, /^FROM node:22-bookworm-slim@sha256:[0-9a-f]{64}$/m);
  assert.match(dockerfile, /org\.opencontainers\.image\.revision/);
  assert.match(dockerfile, /org\.opencontainers\.image\.created=\$BUILD_TIME_UTC/);
  assert.match(dockerfile, /ENV BUILD_GIT_COMMIT=\$BUILD_GIT_COMMIT/);
  assert.match(dockerfile, /ENV BUILD_SOURCE_SHA256=\$BUILD_SOURCE_SHA256/);
  assert.match(dockerfile, /ENV BUILD_TIME_UTC=\$BUILD_TIME_UTC/);
  for (const path of [
    'server/releases/', 'server/backups/', 'server/permanent-storage/',
    'server/enterprise-storage/',
    'server/uploads/', 'server/assets/product-images/', 'server/scripts/*',
    'server/**/*.test.mjs', 'server/**/*.db', 'server/**/.env*',
    'server/**/*.pem', 'server/**/*.key', 'server/**/*.p12',
    'server/**/*.pfx', 'server/**/*.jks', 'server/**/*.keystore',
  ]) assert.ok(dockerignore.includes(path), `missing dockerignore rule: ${path}`);
  assert.match(dockerignore, /^\*\*$/m);
  assert.match(dockerignore, /^!server\/\*\*$/m);
  assert.match(dockerignore, /^!server\/scripts\/encrypt-file\.js$/m);
  assert.match(dockerignore, /^!server\/scripts\/decrypt-file\.js$/m);
  assert.match(fs.readFileSync('deploy/company-server/scripts/backup-db.sh', 'utf8'),
    /node server\/scripts\/encrypt-file\.js/);
});

test('git cannot accidentally stage runtime archives or generated import reports', () => {
  for (const rule of [
    'server/permanent-storage/**/*.json',
    'server/permanent-storage/**/*.json.gz',
    'server/enterprise-storage/**/*.json',
    'server/scripts/*.json', 'server/scripts/*.txt', 'server/scripts/*.sql',
  ]) assert.ok(gitignore.includes(rule), `missing gitignore rule: ${rule}`);
});

test('production evidence verifier is fail-closed on every external gate', () => {
  for (const gate of [
    'productionCopyRestoreTested', 'databaseQuickCheckOk', 'logicalOrphansZero',
    'pendingOutboxPreserved', 'serverTestsPassed', 'flutterTestsPassed',
    'phoneArtifactSigned', 'tabletArtifactSigned',
    'hardwareCanaryPassed', 'storeEdgeWanCanaryPassed',
    'paymentInventoryInvoiceReconciled', 'rollbackRehearsed',
  ]) assert.match(evidenceVerifier, new RegExp(`Require-True '${gate}'`));

  // Windows policy is intentionally dual-mode:
  // Authenticode signed OR explicit audited owner override for NotSigned.
  assert.match(evidenceVerifier, /windowsArtifactSigned/);
  assert.match(evidenceVerifier, /windowsUnsignedOwnerOverride/);
  assert.match(evidenceVerifier, /windowsArtifactSignatureStatus/);
  assert.match(evidenceVerifier, /NotSigned/);
  assert.match(evidenceVerifier, /windowsUnsignedOwnerOverrideActor/);
  assert.match(evidenceVerifier, /windowsUnsignedOwnerOverrideReason/);
  assert.match(evidenceVerifier, /Require-Minimum 'serverTestFiles' \$gate\.serverTestFiles 69/);
  assert.match(evidenceVerifier, /Require-Minimum 'serverTestsPassedCount' \$gate\.serverTestsPassedCount 393/);
  assert.match(evidenceVerifier, /Require-Minimum 'flutterTestsPassedCount' \$gate\.flutterTestsPassedCount 109/);
  assert.match(evidenceVerifier, /flutterTestsSkippedCount -ne 1/);
  assert.match(evidenceVerifier, /Require-True 'backupDecryptionVerified'/);
  assert.match(evidenceVerifier, /restoredBackupSha256[^\n]+rehearsalSourceBackupSha256/);
  assert.match(evidenceVerifier, /Require-Minimum 'databaseTablesCompared' \$gate\.databaseTablesCompared 63/);
  assert.match(evidenceVerifier, /databaseQuickCheckResult -ne 'ok'/);
  assert.match(evidenceVerifier, /Require-Minimum 'logicalRelationsChecked' \$gate\.logicalRelationsChecked 31/);
  assert.match(evidenceVerifier, /logicalOrphanCount -ne 0/);
  assert.match(evidenceVerifier, /pendingBefore -ne \$pendingAfter/);
  for (const artifact of ['windows', 'phone', 'tablet']) {
    assert.match(evidenceVerifier, new RegExp(`Require-Sha '${artifact}ArtifactSha256'`));
  }
  assert.match(evidenceVerifier, /Require-Minimum 'manualAcceptanceCasesPassed' \$gate\.manualAcceptanceCasesPassed 19/);
  assert.match(evidenceVerifier, /manualAcceptanceCasesFailed -ne 0/);
  assert.match(evidenceVerifier, /Require-Minimum 'storeEdgeWanScenariosPassed' \$gate\.storeEdgeWanScenariosPassed 3/);
  assert.match(evidenceVerifier, /storeEdgeWanScenariosFailed -ne 0/);
  assert.match(evidenceVerifier, /Require-Minimum 'reconciliationTransactionsChecked' \$gate\.reconciliationTransactionsChecked 10/);
  assert.match(evidenceVerifier, /reconciliationMismatchCount -ne 0/);
  assert.match(evidenceVerifier, /Require-Minimum 'rollbackRehearsalAttemptsPassed' \$gate\.rollbackRehearsalAttemptsPassed 1/);
  assert.match(evidenceVerifier, /rollbackRehearsalAttemptsFailed -ne 0/);
  assert.match(evidenceVerifier, /clean committed worktree/);
  assert.match(evidenceVerifier, /pinned SSH host-key fingerprint mismatch/);
  assert.match(evidenceVerifier, /rollbackImageId must pin the rehearsed immutable Docker image ID/);
  assert.match(evidenceVerifier, /productionBackupSha256/);
  assert.match(evidenceVerifier, /serverImageSha256/);
});

test('encrypted production backup rehearsal keeps plaintext ephemeral and emits quantitative DB evidence', () => {
  assert.match(backupRehearsal, /store_\(\\d\{8\}_\\d\{6\}\)\\\.db\\\.enc/);
  assert.match(backupRehearsal, /database-backup:/);
  assert.match(backupRehearsal, /production-copy-rehearsal\.mjs/);
  assert.match(backupRehearsal, /sourceBackupSha256[^\n]+plainSha/);
  assert.match(backupRehearsal, /productionBackupSha256 = \$encryptedSha/);
  assert.match(backupRehearsal, /restoredBackupSha256 = \$plainSha/);
  assert.match(backupRehearsal, /pendingOutboxBefore/);
  assert.match(backupRehearsal, /Remove-Item -LiteralPath \$plain/);
});

test('manual acceptance runbook maps all 19 required cases to auditable evidence', () => {
  const ids = [...manualAcceptance.matchAll(/\| ACC-(\d{2})\b/g)].map((match) => Number(match[1]));
  assert.deepEqual(ids, Array.from({ length: 19 }, (_, index) => index + 1));
  for (const column of ['Setup', 'Device', 'Steps', 'Expected', 'Observed', 'Pass/Fail', 'Logs', 'Screenshot / artifact']) {
    assert.ok(manualAcceptance.includes(column), `missing manual evidence column: ${column}`);
  }
  assert.match(manualAcceptance, /reconciliationTransactionsChecked >= 10/);
  assert.match(manualAcceptance, /reconciliationMismatchCount = 0/);
  assert.match(manualAcceptance, /manualAcceptanceCasesFailed > 0/);
});

test('new invoice issuance has exactly one durable implementation', () => {
  assert.doesNotMatch(legacyInvoiceReader, /export\s+async\s+function\s+issue\s*\(/);
  assert.doesNotMatch(legacyInvoiceReader, /export\s+async\s+function\s+customerRequest\s*\(/);
  assert.doesNotMatch(legacyInvoiceReader, /export\s+function\s+cancel\s*\(/);
  assert.doesNotMatch(legacyInvoiceReader, /COUNT\(\*\)\s+c\s+FROM\s+invoices/);
  assert.match(legacyInvoiceReader, /All NEW issuance goes through services\/einvoice\.js/);
  assert.doesNotMatch(invoiceRoutes, /api\.post\('\/invoices\/:id\/cancel'/);
  assert.match(invoiceRoutes, /api\.post\('\/einvoice\/:id\/cancel'/);
});
