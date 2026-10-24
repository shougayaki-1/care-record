import assert from 'node:assert/strict';
import test from 'node:test';
import { disableLocalSeed } from './local-config.mjs';

test('disables seeds only in the isolated db.seed section before the first migration', () => {
  const config = '[db.migrations]\nenabled = true\n[db.seed]\n# seed\nenabled = true\nsql_paths = ["./seed.sql"]\n[auth]\nenabled = true\n';
  assert.equal(disableLocalSeed(config), config.replace('# seed\nenabled = true', '# seed\nenabled = false'));
  assert.equal(disableLocalSeed(disableLocalSeed(config)), disableLocalSeed(config));
  assert.equal(disableLocalSeed('[db.seed]\nenabled = true\n'), '[db.seed]\nenabled = false\n');
});

test('refuses to start without an explicit seed setting', () => {
  assert.throws(() => disableLocalSeed('[db]\nport = 54322\n'));
  assert.throws(() => disableLocalSeed('[db.seed]\nsql_paths = []\n'));
});
