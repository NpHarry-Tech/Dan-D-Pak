import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL(
  '../flutter-apps/dandpak_desktop/windows/runner/main.cpp', import.meta.url,
), 'utf8');

test('main instance owns one mutex and duplicate launch activates then exits', () => {
  assert.match(source, /CreateMutexW\(nullptr, TRUE, L"Local\\\\DanDPakPOS_SingleInstance"\)/);
  assert.match(source, /GetLastError\(\) == ERROR_ALREADY_EXISTS/);
  assert.match(source, /FindWindowW\(nullptr, L"Dan-D Pak POS"\)/);
  assert.match(source, /ActivateExistingWindow\(existing\)/);
  const duplicateBranch = source.slice(
    source.indexOf('GetLastError() == ERROR_ALREADY_EXISTS'),
    source.indexOf('project.set_dart_entrypoint_arguments'),
  );
  assert.match(duplicateBranch, /CloseHandle\(single_instance_mutex\)/);
  assert.match(duplicateBranch, /return EXIT_SUCCESS/);
  assert.doesNotMatch(duplicateBranch, /window\.Create/);
});

test('display is exempt and minimized or hung windows get nonblocking feedback', () => {
  assert.match(source, /if \(!customer_display\) \{/);
  assert.match(source, /IsIconic\(existing\).*ShowWindowAsync\(existing, SW_RESTORE\)/s);
  assert.match(source, /IsHungAppWindow\(existing\)/);
  assert.match(source, /SetForegroundWindow\(existing\)/);
  assert.match(source, /FlashWindowEx\(&flash\)/);
  assert.match(source, /FLASHW_TRAY \| FLASHW_TIMERNOFG/);
});

test('mutex and COM are released on normal and create-failure exits', () => {
  const failure = source.slice(source.indexOf('if (!window.Create'));
  assert.match(failure, /CloseHandle\(single_instance_mutex\).*CoUninitialize\(\).*return EXIT_FAILURE/s);
  assert.match(source, /CloseHandle\(single_instance_mutex\).*CoUninitialize\(\).*return EXIT_SUCCESS/s);
});
