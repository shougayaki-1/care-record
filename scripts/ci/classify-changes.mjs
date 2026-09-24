import { execFileSync } from 'node:child_process';
import { readFileSync, appendFileSync } from 'node:fs';

const codePath = /^(src|tests|scripts|supabase|public|\.github\/workflows|\.storybook)\//;
const appConfigPath = /^(\.env\.example|package\.json|package-lock\.json|next\.config\.[^/]+|tsconfig\.json|eslint\.config\.[^/]+|postcss\.config\.[^/]+|tailwind\.config\.[^/]+|vitest\.config\.[^/]+|playwright\.config\.[^/]+|next-env\.d\.ts|\.nvmrc|AGENTS\.md)$/;
const docsPath = /^(docs\/|[^/]+\.md$)/i;
const dbPath = /^(supabase\/|scripts\/db\/|src\/types\/database\.generated\.ts$)/;
const authAndDataPath = /^(src\/app\/auth\/|src\/app\/actions\/|src\/lib\/supabase\.[^/]+$|src\/utils\/supabase\/|src\/utils\/permissions\.ts$|src\/context\/WorkspaceContext\.[^/]+$|src\/proxy\.ts$)/;
const migrationPath = /^supabase\/migrations\/[^/]+\.sql$/;
const uiPath = /^(\.storybook\/|src\/components\/|src\/.*\.(stories|story)\.[^/]+$|vitest\.config\.[^/]+$)/;
const testPath = /^tests\//;
const dependencyPath = /^(package\.json|package-lock\.json)$/;

export function classifyFiles(paths, eventName) {
  if (eventName === 'schedule') {
    return {
      core: false,
      database: false,
      databaseUpgrade: false,
      ui: false,
      e2eCritical: false,
      e2eAll: false,
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
      e2eCritical: false,
      e2eAll: true,
      dependencies: true,
      secretScan: false,
    };
  }

  const changedPaths = paths.map(path => path.replace(/^\.\//, ''));
  const docsOnly = changedPaths.length > 0 && changedPaths.every(path => docsPath.test(path));
  const hasCodeChanges = changedPaths.some(path => codePath.test(path) || appConfigPath.test(path));
  const database = changedPaths.some(path => dbPath.test(path) || authAndDataPath.test(path));
  const databaseUpgrade = changedPaths.some(path => migrationPath.test(path));
  const ui = changedPaths.some(path => uiPath.test(path));
  const e2eAll = changedPaths.some(path => testPath.test(path));
  const e2eRunner = changedPaths.some(path => path.startsWith('scripts/e2e/'));
  const dependencies = changedPaths.some(path => dependencyPath.test(path));

  return {
    core: hasCodeChanges && !docsOnly,
    database,
    databaseUpgrade,
    ui,
    e2eCritical: !e2eAll && (e2eRunner || changedPaths.some(path => (
      path.startsWith('src/')
      || path.startsWith('supabase/')
      || path.startsWith('package.')
      || path === 'package-lock.json'
      || path === '.env.example'
      || path.startsWith('next.config.')
      || path === 'playwright.config.ts'
    ))),
    e2eAll,
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

if (process.env.GITHUB_OUTPUT) {
  const result = classifyFiles(changedPathsForEvent(), process.env.GITHUB_EVENT_NAME);
  appendFileSync(process.env.GITHUB_OUTPUT, `${Object.entries(result).map(([key, value]) => `${key}=${value}`).join('\n')}\n`);
  process.stdout.write(`${Object.entries(result).map(([key, value]) => `${key}=${value}`).join('\n')}\n`);
}
