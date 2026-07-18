import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const allowlistPath = new URL('./service-role-allowlist.txt', import.meta.url);
const operationsPath = new URL('./service-role-operations.json', import.meta.url);
const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));
const sourceRoot = join(repositoryRoot, 'src');

function listSourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = join(directory, entry.name);
    if (entry.isDirectory()) return listSourceFiles(absolutePath);
    if (!entry.isFile()) return [];

    const repositoryPath = relative(repositoryRoot, absolutePath).split(sep).join('/');
    return repositoryPath.includes('.test.') ? [] : [repositoryPath];
  });
}

const sourceFiles = listSourceFiles(sourceRoot);
const sourceByPath = new Map(
  sourceFiles.map((file) => [file, readFileSync(join(repositoryRoot, file), 'utf8')]),
);
const filesMatching = (pattern) => sourceFiles.filter((file) => pattern.test(sourceByPath.get(file)));
const allowed = new Set(
  readFileSync(allowlistPath, 'utf8')
    .split(/\r?\n/u)
    .map((line) => line.replace(/#.*$/u, '').trim())
    .filter(Boolean),
);
const operations = JSON.parse(readFileSync(operationsPath, 'utf8'));

const actual = new Set(filesMatching(/import .*supabaseAdmin/u));
const unregistered = [...actual].filter((file) => !allowed.has(file)).sort();
const stale = [...allowed].filter((file) => !actual.has(file)).sort();

if (unregistered.length > 0 || stale.length > 0) {
  if (unregistered.length > 0) {
    process.stderr.write(`Unregistered service-role usage:\n${unregistered.join('\n')}\n`);
  }
  if (stale.length > 0) {
    process.stderr.write(`Remove migrated paths from the service-role allowlist:\n${stale.join('\n')}\n`);
  }
  process.exit(1);
}

const keyUsers = new Set(filesMatching(/SUPABASE_SERVICE_ROLE_KEY/u));
const allowedKeyUsers = new Set([
  'src/lib/env/schema.ts',
  'src/utils/supabase/auth.ts',
  'src/utils/supabase/middleware.ts',
]);
const unexpectedKeyUsers = [...keyUsers].filter((file) => !allowedKeyUsers.has(file)).sort();
if (unexpectedKeyUsers.length > 0 || keyUsers.size !== allowedKeyUsers.size) {
  process.stderr.write(`Unexpected service-role key boundary:\n${unexpectedKeyUsers.join('\n')}\n`);
  process.exit(1);
}

const wrapperSource = readFileSync(new URL('../../src/utils/supabase/serviceRole.ts', import.meta.url), 'utf8');
const definedAccessors = new Set([...wrapperSource.matchAll(/export const (serviceRoleFor[A-Za-z]+) =/gu)].map((match) => match[1]));
const registeredAccessors = new Set(operations.map((entry) => entry.accessor));
const ledgerErrors = [];
for (const accessor of definedAccessors) {
  if (!registeredAccessors.has(accessor)) ledgerErrors.push(`unregistered accessor ${accessor}`);
}
for (const entry of operations) {
  if (!definedAccessors.has(entry.accessor)) ledgerErrors.push(`stale accessor ${entry.accessor}`);
  for (const field of ['purpose', 'authorization', 'audit']) {
    if (typeof entry[field] !== 'string' || entry[field].trim().length < 10) ledgerErrors.push(`${entry.accessor} missing ${field}`);
  }
  if (!Array.isArray(entry.targets) || entry.targets.length === 0) ledgerErrors.push(`${entry.accessor} missing targets`);
  if (!Array.isArray(entry.consumers) || entry.consumers.length === 0) ledgerErrors.push(`${entry.accessor} missing consumers`);
  for (const consumer of entry.consumers ?? []) {
    const source = readFileSync(new URL(`../../${consumer}`, import.meta.url), 'utf8');
    if (!source.includes(entry.accessor)) ledgerErrors.push(`${entry.accessor} is stale for ${consumer}`);
  }
}
const registeredConsumers = new Map(operations.flatMap((entry) => entry.consumers.map((consumer) => [`${entry.accessor}:${consumer}`, true])));
const wrapperPath = 'src/utils/supabase/serviceRole.ts';
const usageFiles = filesMatching(/serviceRoleFor[A-Za-z]+/u).filter((file) => file !== wrapperPath);
for (const consumer of usageFiles) {
  const source = readFileSync(new URL(`../../${consumer}`, import.meta.url), 'utf8');
  for (const match of source.matchAll(/serviceRoleFor[A-Za-z]+/gu)) {
    if (!registeredConsumers.has(`${match[0]}:${consumer}`)) ledgerErrors.push(`unregistered consumer ${match[0]} in ${consumer}`);
  }
}
if (ledgerErrors.length > 0) {
  process.stderr.write(`Invalid service-role operation ledger:\n${ledgerErrors.join('\n')}\n`);
  process.exit(1);
}

process.stdout.write(`Direct import is isolated and ${operations.length} service-role purposes match the operation ledger.\n`);
