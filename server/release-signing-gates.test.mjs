import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const publish = fs.readFileSync('deploy/publish-release.ps1', 'utf8');
const androidBuild = fs.readFileSync('deploy/build-android-release.ps1', 'utf8');

test('publish verifies signatures before any login or upload', () => {
  const windowsGate = publish.indexOf('Get-AuthenticodeSignature');
  const androidGate = publish.indexOf('Android Debug');
  const login = publish.indexOf('$login = Invoke-RestMethod');
  assert.ok(windowsGate >= 0 && androidGate >= 0, 'missing release signature gates');
  assert.ok(windowsGate < login && androidGate < login,
    'signature verification must run before credentials or network publication');
  assert.match(publish, /Publish blocked/);
});

test('publish requires matching provenance before any login or upload', () => {
  const provenanceGate = publish.indexOf('Missing build provenance manifest');
  const hashGate = publish.indexOf('Get-FileHash');
  const login = publish.indexOf('$login = Invoke-RestMethod');
  assert.ok(provenanceGate >= 0 && hashGate >= 0, 'missing provenance/hash gates');
  assert.ok(provenanceGate < login && hashGate < login,
    'provenance verification must run before credentials or publication');
  assert.match(publish, /targetUserVersion/);
  assert.match(publish, /sourceTreeSha256/);
  assert.match(publish, /worktreeDirty/);
  assert.match(publish, /server\\db\.js/);
});

for (const app of ['dandpak_phone', 'dandpak_tablet']) {
  test(`${app} release build cannot fall back to debug signing`, () => {
    const gradle = fs.readFileSync(`flutter-apps/${app}/android/app/build.gradle.kts`, 'utf8');
    assert.match(gradle, /releaseRequested/);
    assert.match(gradle, /Release signing is not configured/);
    assert.match(gradle, /Debug signing is forbidden/);
    assert.match(gradle, /signingConfig\s*=\s*signingConfigs\.getByName\("release"\)/);
    assert.doesNotMatch(gradle, /signingConfigs\.getByName\("debug"\)/);
  });
}

test('canonical Android build emits only release APK plus provenance', () => {
  assert.match(androidBuild, /ValidateSet\('android', 'android-phone'\)/);
  assert.match(androidBuild, /flutter build apk --release/);
  assert.match(androidBuild, /write-build-manifest\.ps1/);
  assert.doesNotMatch(androidBuild, /--debug|assembleDebug/);
});

test('all canonical app builders embed the same safe runtime fingerprint as their manifest', () => {
  const desktop = fs.readFileSync('deploy/build-desktop.ps1', 'utf8');
  const android = fs.readFileSync('deploy/build-android-release.ps1', 'utf8');
  const helper = fs.readFileSync('deploy/get-app-build-metadata.ps1', 'utf8');
  for (const source of [desktop, android]) {
    for (const define of ['BUILD_GIT_COMMIT', 'BUILD_SOURCE_SHA256', 'BUILD_TIME_UTC', 'SCHEMA_VERSION']) {
      assert.match(source, new RegExp(`--dart-define=${define}`));
    }
    assert.match(source, /-BuiltAtUtc \$buildMetadata\.builtAtUtc/);
    assert.match(source, /-SourceTreeSha256 \$buildMetadata\.sourceTreeSha256/);
    assert.match(source, /-GitCommit \$buildMetadata\.gitCommit/);
  }
  assert.match(helper, /get-source-tree-sha256\.ps1/);
  assert.match(helper, /PRAGMA\\s\+user_version/);
});

for (const app of ['dandpak_phone', 'dandpak_tablet', 'dandpak_desktop']) {
  test(`${app} pubspec and updater version source stay identical`, () => {
    const pubspec = fs.readFileSync(`flutter-apps/${app}/pubspec.yaml`, 'utf8');
    const runtime = fs.readFileSync(`flutter-apps/${app}/lib/app_version.dart`, 'utf8');
    const pubMatch = pubspec.match(/^version:\s*([^+\s]+)\+(\d+)\s*$/m);
    const buildMatch = runtime.match(/kAppBuildNumber\s*=\s*(\d+)/);
    const versionMatch = runtime.match(/kAppVersionName\s*=\s*'([^']+)'/);
    assert.ok(pubMatch && buildMatch && versionMatch, 'version declarations must be parseable');
    const normalize = (value) => value.split('.').map((part) => String(Number(part))).join('.');
    assert.equal(Number(pubMatch[2]), Number(buildMatch[1]), 'build numbers differ');
    const publicParts = normalize(versionMatch[1]).split('.');
    assert.equal(normalize(pubMatch[1]), publicParts.slice(0, 3).join('.'),
      'pub package date version differs from public release date');
    assert.equal(publicParts[3], '1', 'public release sequence must be .01');
  });
}
