import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyFiles } from './classify-changes.mjs';

test('documentation-only edits skip heavyweight checks but retain the PR secret scan', () => {
  assert.deepEqual(classifyFiles(['README.md', 'docs/testing.md'], 'pull_request'), {
    core: false,
    database: false,
    databaseUpgrade: false,
    ui: false,
    e2eCritical: false,
    e2eAll: false,
    dependencies: false,
    secretScan: true,
  });
});

test('application changes run core checks and critical E2E', () => {
  const result = classifyFiles(['src/app/app/record/page.tsx'], 'pull_request');
  assert.equal(result.core, true);
  assert.equal(result.e2eCritical, true);
  assert.equal(result.database, false);
});

test('migration changes run database and critical E2E checks', () => {
  const result = classifyFiles(['supabase/migrations/20260923000000_example.sql'], 'pull_request');
  assert.equal(result.core, true);
  assert.equal(result.database, true);
  assert.equal(result.databaseUpgrade, true);
  assert.equal(result.e2eCritical, true);
});

test('auth and data action changes also run database checks', () => {
  const result = classifyFiles(['src/app/actions/clients.ts'], 'pull_request');
  assert.equal(result.database, true);
  assert.equal(result.e2eCritical, true);
  assert.equal(classifyFiles(['src/proxy.ts'], 'pull_request').database, true);
});

test('permissions changes run database checks and E2E runner changes run smoke tests', () => {
  assert.equal(classifyFiles(['src/utils/permissions.ts'], 'pull_request').database, true);
  assert.equal(classifyFiles(['scripts/e2e/run-local.mjs'], 'pull_request').e2eCritical, true);
});

test('Storybook and component changes run UI checks', () => {
  const result = classifyFiles(['src/components/record/RecordMetaForm.tsx'], 'pull_request');
  assert.equal(result.ui, true);
  assert.equal(result.core, true);
});

test('dependency changes run audit and critical E2E', () => {
  const result = classifyFiles(['package-lock.json'], 'pull_request');
  assert.equal(result.dependencies, true);
  assert.equal(result.e2eCritical, true);
});

test('E2E test edits run the wider suite without also running the smoke suite', () => {
  const result = classifyFiles(['tests/integration-flow.spec.ts'], 'pull_request');
  assert.equal(result.e2eAll, true);
  assert.equal(result.e2eCritical, false);
});

test('weekly schedule runs dependency assurance only', () => {
  assert.deepEqual(classifyFiles([], 'schedule'), {
    core: false,
    database: false,
    databaseUpgrade: false,
    ui: false,
    e2eCritical: false,
    e2eAll: false,
    dependencies: true,
    secretScan: false,
  });
});

test('manual runs exercise all suites', () => {
  const result = classifyFiles([], 'workflow_dispatch');
  assert.equal(result.core, true);
  assert.equal(result.database, true);
  assert.equal(result.databaseUpgrade, true);
  assert.equal(result.ui, true);
  assert.equal(result.e2eAll, true);
  assert.equal(result.dependencies, true);
});
