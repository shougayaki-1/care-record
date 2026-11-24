import { execFileSync } from 'node:child_process';
import { readFileSync, appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { criticalFiles } from '../e2e/playwright-arguments.mjs';

const codePath = /^(src|tests|scripts|supabase|public|\.github\/workflows|\.github\/actions|\.storybook)\//;
const appConfigPath = /^(\.env\.example|package\.json|package-lock\.json|next\.config\.[^/]+|tsconfig\.json|eslint\.config\.[^/]+|postcss\.config\.[^/]+|tailwind\.config\.[^/]+|vitest\.config\.[^/]+|playwright\.config\.[^/]+|next-env\.d\.ts|\.nvmrc|AGENTS\.md)$/;
const docsPath = /^(docs\/|[^/]+\.md$)/i;
const dbPath = /^(supabase\/|scripts\/db\/|src\/types\/database\.generated\.ts$)/;
const authAndDataPath = /^(src\/app\/auth\/|src\/app\/actions\/|src\/lib\/supabase\.[^/]+$|src\/utils\/supabase\/|src\/utils\/permissions\.ts$|src\/context\/WorkspaceContext\.[^/]+$|src\/proxy\.ts$)/;
const migrationPath = /^supabase\/migrations\/[^/]+\.sql$/;
const uiPath = /^(\.storybook\/|src\/components\/|src\/.*\.(stories|story)\.[^/]+$|vitest\.config\.[^/]+$)/;
const testPath = /^tests\//;
const dependencyPath = /^(package\.json|package-lock\.json)$/;
const unitTestPath = /\.(test|spec)\.[cm]?[jt]sx?$/;
const ciInfrastructurePath = /^(\.github\/(workflows\/ci\.yml|actions\/)|scripts\/ci\/|scripts\/e2e\/|playwright\.config\.[^/]+$)/;
const browserDependencyPath = /^(src\/(app\/|components\/|hooks\/|context\/|features\/|theme[^/]*|lib\/|utils\/)|\.storybook\/|vitest\.config\.[^/]+$|postcss\.config\.[^/]+$|tailwind\.config\.[^/]+$)/;
const transportPath = /^(src\/(utils\/(errors|log|actionResult[^/]*)\.[^/]+|types\/actionResult\.ts)|scripts\/testing\/action-result-transport\.mjs$|next\.config\.[^/]+$)/;

// Add feature regressions to smoke tests without running every unrelated scenario.
const featureSuites = [
  [/^src\/(app\/(auth\/|api\/auth\/|setup\/|actions\/(auth|authSecurity|account|invitation|organization))|components\/auth\/|context\/WorkspaceContext|utils\/supabase\/(auth|middleware|stepup|reauth)|proxy\.)/,
    ['tests/setup.spec.ts', 'tests/password-recovery.spec.ts', 'tests/recovery.spec.ts', 'tests/integration-flow.spec.ts']],
  [/^src\/(app\/(app\/(record|reports|history|ai-import)|actions\/(reports|internalWork|aiImport))|components\/(record|ai-import|internal-work)\/|hooks\/(useRecord|useReport|useAiImport|aiImport\/))/,
    ['tests/record-feed.spec.ts', 'tests/record-routing.spec.ts', 'tests/record-ui.spec.ts', 'tests/report-filters.spec.ts', 'tests/integration-flow.spec.ts']],
  [/^src\/app\/(app\/(accounts|clients|staffs)|actions\/(clients|staffs|roles))/,
    ['tests/admin-features.spec.ts', 'tests/integration-flow.spec.ts']],
];

export function classifyFiles(paths, eventName) {
  if (eventName === 'schedule') {
    return {
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
    };
  }

  if (eventName === 'workflow_dispatch') {
    return {
      core: true,
      database: true,
      databaseUpgrade: true,
      ui: true,
      transport: true,
      e2eCritical: false,
      e2eAll: true,
      e2eFiles: [],
      dependencies: true,
      secretScan: false,
    };
  }

  const changedPaths = paths.map(path => path.replace(/^\.\//, ''));
  const docsOnly = changedPaths.length > 0 && changedPaths.every(path => docsPath.test(path));
  const hasCodeChanges = changedPaths.some(path => codePath.test(path) || appConfigPath.test(path));
  const runtimePaths = changedPaths.filter(path => !unitTestPath.test(path) && !/\.(stories|story)\.[^/]+$/.test(path));
  const infrastructure = runtimePaths.some(path => ciInfrastructurePath.test(path));
  const database = infrastructure || runtimePaths.some(path => dbPath.test(path) || authAndDataPath.test(path));
  const databaseUpgrade = infrastructure || runtimePaths.some(path => migrationPath.test(path) || /^scripts\/db\/(check-upgrade-fixture\.mjs|upgrade-fixture-.*\.sql)$/.test(path));
  const dependencies = changedPaths.some(path => dependencyPath.test(path));
  const ui = infrastructure || dependencies || runtimePaths.some(path => browserDependencyPath.test(path))
    || changedPaths.some(path => uiPath.test(path) && !unitTestPath.test(path));
  const transport = infrastructure || dependencies || runtimePaths.some(path => transportPath.test(path));
  const e2eAll = infrastructure || dependencies || changedPaths.some(path => testPath.test(path));
  const e2eRunner = changedPaths.some(path => path.startsWith('scripts/e2e/'));
  const e2eCritical = !e2eAll && (e2eRunner || runtimePaths.some(path => (
    path.startsWith('src/') || path.startsWith('supabase/') || path === '.env.example'
    || path.startsWith('next.config.')
  )));
  const e2eFiles = e2eCritical ? [...new Set([
    ...criticalFiles,
    ...featureSuites.flatMap(([pattern, files]) => runtimePaths.some(path => pattern.test(path)) ? files : []),
  ])].sort() : [];

  return {
    core: hasCodeChanges && !docsOnly,
    database,
    databaseUpgrade,
    ui,
    transport,
    e2eCritical,
    e2eAll,
    e2eFiles,
    dependencies,
    secretScan: eventName === 'pull_request',
  };
}

function changedPathsForEvent() {
  const eventName = process.env.GITHUB_EVENT_NAME;
  if (eventName === 'schedule') return [];
  if (eventName === 'workflow_dispatch') return [];

  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  const baseSha = eventName === 'pull_request'
    ? event.pull_request?.base?.sha
    : event.before;

  if (!baseSha || /^0+$/.test(baseSha)) {
    return execFileSync('git', ['ls-tree', '-r', '--name-only', 'HEAD'], { encoding: 'utf8' })
      .split(/\r?\n/)
      .filter(Boolean);
  }

  return execFileSync('git', ['diff', '--name-only', baseSha, 'HEAD'], { encoding: 'utf8' })
    .split(/\r?\n/)
    .filter(Boolean);
}

if (process.env.GITHUB_OUTPUT && process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = classifyFiles(changedPathsForEvent(), process.env.GITHUB_EVENT_NAME);
  const output = Object.entries(result).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join('\n');
  appendFileSync(process.env.GITHUB_OUTPUT, `${output}\n`);
  process.stdout.write(`${output}\n`);
}
