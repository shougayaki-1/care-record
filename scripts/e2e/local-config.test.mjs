import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { configureLocalE2E, disableLocalSeed } from './local-config.mjs';

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

test('isolated E2E disables developer services without changing application services or audit', () => {
  const config = readFileSync(new URL('../../supabase/config.toml', import.meta.url), 'utf8');
  const actual = configureLocalE2E(config);
  const sections = text => Object.fromEntries([...text.matchAll(/^\[([^\]]+)\]\s*\n([\s\S]*?)(?=^\[|$(?![\s\S]))/gm)]
    .map(([, name, body]) => [name, body]));
  const before = sections(config);
  const after = sections(actual);
  for (const name of Object.keys(before)) {
    if (['db.seed', 'studio', 'edge_runtime', 'analytics'].includes(name)) {
      assert.match(after[name], /^enabled = false$/m, name);
      assert.equal(after[name], before[name].replace(/^enabled = true$/m, 'enabled = false'), name);
    } else assert.equal(after[name], before[name], name);
  }
  assert.equal(configureLocalE2E(actual), actual);
  assert.throws(() => configureLocalE2E(config.replace('[analytics]', '[missing_analytics]')), /analytics section/);
});
