import { createServer } from 'node:net';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertLocalSupabaseEnvironment } from './local-environment.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const sourceSupabaseDir = resolve(repoRoot, 'supabase');
const requestedSuite = process.argv[2] ?? 'critical';
const requestedFiles = process.argv.slice(3);

if (!['critical', 'all'].includes(requestedSuite)) {
  throw new Error(`Unknown E2E suite "${requestedSuite}". Use "critical" or "all".`);
}
if (requestedFiles.some(file => !/^tests\/[A-Za-z0-9-]+\.spec\.ts$/.test(file))) {
  throw new Error('Optional E2E test files must be paths such as tests/auth.spec.ts.');
}

assertLocalSupabaseEnvironment(process.env, { requireApi: false });

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    env: options.env ?? process.env,
    stdio: options.inherit ? 'inherit' : 'pipe',
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    const details = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
    throw new Error(`${command} ${args.join(' ')} failed${result.status === null ? '' : ` with exit code ${result.status}`}.${details ? `\n${details}` : ''}`);
  }
  return result.stdout ?? '';
}

async function freePort(usedPorts) {
  const server = createServer();
  await new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : undefined;
  await new Promise((resolveClose, reject) => server.close(error => error ? reject(error) : resolveClose()));
  if (!port || usedPorts.has(port)) return freePort(usedPorts);
  usedPorts.add(port);
  return port;
}

async function writeIsolatedConfig(workdir) {
  const usedPorts = new Set();
  const configPath = resolve(sourceSupabaseDir, 'config.toml');
  let config = readFileSync(configPath, 'utf8');
  const projectId = `care-record-e2e-${randomUUID().replaceAll('-', '').slice(0, 10)}`;
  config = config.replace(/^project_id\s*=\s*"[^"]+"/m, `project_id = "${projectId}"`);

  const portMatches = [...config.matchAll(/^(\s*(?:port|shadow_port|inspector_port)\s*=\s*)(\d+)(\s*(?:#.*)?)$/gm)];
  const ports = new Map();
  for (const [, , oldPort] of portMatches) {
    if (!ports.has(oldPort)) ports.set(oldPort, await freePort(usedPorts));
  }
  config = config.replace(/^(\s*(?:port|shadow_port|inspector_port)\s*=\s*)(\d+)(\s*(?:#.*)?)$/gm, (_line, prefix, oldPort, suffix) => `${prefix}${ports.get(oldPort)}${suffix}`);

  const supabaseDir = resolve(workdir, 'supabase');
  const migrationsDir = resolve(supabaseDir, 'migrations');
  mkdirSync(migrationsDir, { recursive: true });
  writeFileSync(resolve(supabaseDir, 'config.toml'), config);
  for (const entry of readdirSync(resolve(sourceSupabaseDir, 'migrations'), { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.sql')) {
      copyFileSync(resolve(sourceSupabaseDir, 'migrations', entry.name), resolve(migrationsDir, entry.name));
    }
  }
  return projectId;
}

function parseSupabaseEnv(output) {
  const values = {};
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^(?:export\s+)?([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if (value.startsWith('"') && value.endsWith('"')) {
      try {
        value = JSON.parse(value);
      } catch {
        value = value.slice(1, -1);
      }
    } else if (value.startsWith("'") && value.endsWith("'")) {
      value = value.slice(1, -1);
    }
    values[match[1]] = value;
  }
  return values;
}

let workdir;
let projectId;
let exitCode = 1;
let stackStartAttempted = false;

try {
  workdir = mkdtempSync(resolve(tmpdir(), 'care-record-e2e-'));
  projectId = await writeIsolatedConfig(workdir);

  stackStartAttempted = true;
  run('supabase', ['start', '--workdir', workdir]);
  run('supabase', ['db', 'reset', '--local', '--no-seed', '--workdir', workdir]);

  const localConfig = parseSupabaseEnv(run('supabase', ['status', '-o', 'env', '--workdir', workdir]));
  const supabaseEnv = {
    ...process.env,
    APP_ENV: 'test',
    CI: 'true',
    AI_IMPORT_ENABLED: 'false',
    EXTERNAL_INTEGRATIONS_ENABLED: 'false',
    E2E_TEST_ENV: 'true',
    NEXT_PUBLIC_SUPABASE_URL: localConfig.API_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: localConfig.ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: localConfig.SERVICE_ROLE_KEY,
    SUPABASE_DB_URL: localConfig.DB_URL,
  };
  assertLocalSupabaseEnvironment(supabaseEnv);
  if (!supabaseEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY || !supabaseEnv.SUPABASE_SERVICE_ROLE_KEY || !supabaseEnv.SUPABASE_DB_URL) {
    throw new Error('Supabase CLI did not return the local API keys and database URL required for E2E tests.');
  }

  const playwrightArgs = ['test'];
  if (requestedFiles.length > 0) {
    playwrightArgs.push(...requestedFiles);
  } else if (requestedSuite === 'critical') {
    playwrightArgs.push(
      '--project=chromium',
      'tests/auth.spec.ts',
      'tests/workspace-routing.spec.ts',
      'tests/staff-features.spec.ts',
      'tests/tenant-isolation.spec.ts',
    );
  }

  const result = spawnSync('npx', ['--no-install', 'playwright', ...playwrightArgs], {
    cwd: repoRoot,
    env: supabaseEnv,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  exitCode = result.status ?? 1;
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  exitCode = 1;
} finally {
  if (stackStartAttempted && workdir && projectId) {
    try {
      run('supabase', ['stop', '--no-backup', '--workdir', workdir]);
    } catch (error) {
      process.stderr.write(`Supabase cleanup failed for ${projectId}: ${error instanceof Error ? error.message : String(error)}\n`);
      exitCode = exitCode === 0 ? 1 : exitCode;
    }
  }
  if (workdir) rmSync(workdir, { recursive: true, force: true });
}

process.exitCode = exitCode;
