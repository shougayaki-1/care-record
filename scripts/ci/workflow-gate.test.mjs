import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const workflow = readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8');
const gate = workflow.match(/jq -e '([\s\S]*?)'/)[1];
const jobs = workflow.match(/needs: \[scope, ([^\]]+)\]/)[1].split(', ').concat('scope');
function result(overrides = {}, outputs = {}) {
  const needs = Object.fromEntries(jobs.map(job => [job, { result: 'success' }]));
  needs.scope.outputs = { core: 'true', database: 'true', databaseUpgrade: 'true',
    ui: 'true', e2eCritical: 'false', e2eAll: 'true', dependencies: 'true', secretScan: 'true', ...outputs };
  for (const [job, value] of Object.entries(overrides)) needs[job].result = value;
  const process = spawnSync('jq', ['-e', gate], { input: JSON.stringify(needs), encoding: 'utf8' });
  if (process.error) throw process.error;
  assert.ok([0, 1].includes(process.status), process.stderr);
  return process.status === 0;
}

test('required CI gate accepts successful checks and rejects failures and cancellations', () => {
  assert.equal(result(), true);
  for (const job of jobs) {
    for (const status of ['failure', 'cancelled']) assert.equal(result({ [job]: status }), false, `${job}: ${status}`);
  }
});
test('selected jobs cannot be silently skipped', () => {
  for (const job of jobs) assert.equal(result({ [job]: 'skipped' }), false, job);
});
test('documentation-only runs accept unselected skipped jobs', () => {
  const overrides = Object.fromEntries(jobs.filter(job => !['scope', 'secret-scan'].includes(job)).map(job => [job, 'skipped']));
  const outputs = Object.fromEntries(['core', 'database', 'databaseUpgrade', 'ui', 'e2eCritical', 'e2eAll', 'dependencies'].map(key => [key, 'false']));
  assert.equal(result(overrides, outputs), true);
});
test('critical E2E remains required when full E2E is not selected', () => {
  assert.equal(result({ e2e: 'skipped' }, { e2eAll: 'false', e2eCritical: 'true' }), false);
});
