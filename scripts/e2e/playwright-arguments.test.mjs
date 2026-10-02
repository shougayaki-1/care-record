import assert from 'node:assert/strict';
import test from 'node:test';
import { playwrightArguments } from './playwright-arguments.mjs';

test('critical stays Chromium-only including file selections', () => {
  assert.deepEqual(playwrightArguments('critical'), ['test', '--project=chromium',
    'tests/auth.spec.ts', 'tests/workspace-routing.spec.ts',
    'tests/staff-features.spec.ts', 'tests/tenant-isolation.spec.ts']);
  assert.deepEqual(playwrightArguments('critical', ['tests/auth.spec.ts']),
    ['test', '--project=chromium', 'tests/auth.spec.ts']);
  assert.throws(() => playwrightArguments('critical', [], 'mobile-chrome'));
});
test('full retains both projects locally and supports isolated CI projects', () => {
  assert.deepEqual(playwrightArguments('all'), ['test']);
  for (const project of ['chromium', 'mobile-chrome']) {
    assert.deepEqual(playwrightArguments('all', [], project), ['test', `--project=${project}`]);
  }
});
test('invalid arguments fail before starting Supabase', () => {
  assert.throws(() => playwrightArguments('unknown'));
  assert.throws(() => playwrightArguments('all', [], 'unknown'));
  assert.throws(() => playwrightArguments('all', [], ''));
  assert.throws(() => playwrightArguments('all', ['--project=unknown']));
});
