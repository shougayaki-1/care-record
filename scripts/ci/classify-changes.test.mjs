import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyFiles } from './classify-changes.mjs';

test('documentation-only edits skip heavyweight checks but retain the PR secret scan', () => {
  assert.deepEqual(classifyFiles(['README.md', 'docs/testing.md'], 'pull_request'), {
    core: false,
    database: false,
    databaseUpgrade: false,
    ui: false,
    transport: false,
    e2eCritical: false,
    e2eAll: false,
    e2eFiles: [],
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

test('permissions changes run database checks and E2E infrastructure runs the full suite', () => {
  assert.equal(classifyFiles(['src/utils/permissions.ts'], 'pull_request').database, true);
  assert.equal(classifyFiles(['scripts/e2e/run-local.mjs'], 'pull_request').e2eAll, true);
});

test('Storybook and component changes run UI checks', () => {
  const result = classifyFiles(['src/components/record/RecordMetaForm.tsx'], 'pull_request');
  assert.equal(result.ui, true);
  assert.equal(result.core, true);
});

test('dependency changes run audit, UI, production transport and full E2E', () => {
  const result = classifyFiles(['package-lock.json'], 'pull_request');
  assert.equal(result.dependencies, true);
  assert.equal(result.e2eAll, true);
  assert.equal(result.ui, true);
  assert.equal(result.transport, true);
});

test('E2E test edits run the wider suite without also running the smoke suite', () => {
  const result = classifyFiles(['tests/integration-flow.spec.ts'], 'pull_request');
  assert.equal(result.e2eAll, true);
  assert.equal(result.e2eCritical, false);
});

test('weekly schedule exercises core, DB, browser contracts and full E2E', () => {
  assert.deepEqual(classifyFiles([], 'schedule'), {
    core: true,
    database: true,
    databaseUpgrade: false,
    ui: true,
    transport: true,
    e2eCritical: false,
    e2eAll: true,
    e2eFiles: [],
    dependencies: true,
    secretScan: false,
  });
});

test('shared UI inputs and story dependencies select browser tests', () => {
  for (const path of ['src/theme.ts', 'src/app/globals.css', 'src/hooks/useCalendarSync.ts',
    'src/context/WorkspaceContext.tsx', 'src/app/app/accounts/AccountList.tsx', 'src/utils/date.ts']) {
    assert.equal(classifyFiles([path], 'pull_request').ui, true, path);
  }
});

test('unit-only edits run core tests without provisioning databases or browsers', () => {
  const result = classifyFiles(['src/app/actions/shifts/list.test.ts', 'src/components/ui/Button.test.tsx'], 'pull_request');
  assert.equal(result.core, true);
  for (const key of ['database', 'databaseUpgrade', 'ui', 'transport', 'e2eCritical', 'e2eAll']) {
    assert.equal(result[key], false, key);
  }
});

test('CI infrastructure changes exercise the jobs they control', () => {
  for (const path of ['.github/workflows/ci.yml', '.github/actions/install-chromium/action.yml',
    'scripts/ci/classify-changes.mjs', 'playwright.config.ts']) {
    const result = classifyFiles([path], 'pull_request');
    for (const key of ['core', 'database', 'ui', 'transport', 'e2eAll']) assert.equal(result[key], true, `${path}: ${key}`);
  }
});

test('feature implementation edits retain smoke and add the related regressions', () => {
  for (const [path, expected] of [
    ['src/app/actions/authSecurity.ts', 'tests/password-recovery.spec.ts'],
    ['src/app/app/reports/ReportsClientPage.tsx', 'tests/report-filters.spec.ts'],
    ['src/hooks/useRecordForm.ts', 'tests/record-routing.spec.ts'],
    ['src/app/actions/reports.ts', 'tests/integration-flow.spec.ts'],
    ['src/app/app/accounts/AccountList.tsx', 'tests/admin-features.spec.ts'],
  ]) {
    const result = classifyFiles([path], 'pull_request');
    assert.equal(result.e2eCritical, true, path);
    assert.ok(result.e2eFiles.includes(expected), path);
    assert.ok(result.e2eFiles.includes('tests/tenant-isolation.spec.ts'), path);
    assert.equal(new Set(result.e2eFiles).size, result.e2eFiles.length);
  }
});

test('production transport is selected by its helper, fixture and Next configuration', () => {
  for (const path of ['src/utils/errors.ts', 'src/utils/actionResultServer.ts', 'src/types/actionResult.ts',
    'scripts/testing/action-result-transport.mjs', 'next.config.ts']) {
    assert.equal(classifyFiles([path], 'pull_request').transport, true, path);
  }
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
