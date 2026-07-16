import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const allowlistPath = new URL('./service-role-allowlist.txt', import.meta.url);
const operationsPath = new URL('./service-role-operations.json', import.meta.url);
const allowed = new Set(
  readFileSync(allowlistPath, 'utf8')
    .split(/\r?\n/u)
    .map((line) => line.replace(/#.*$/u, '').trim())
    .filter(Boolean),
);
const operations = JSON.parse(readFileSync(operationsPath, 'utf8'));

const output = execFileSync('rg', [
  '-l',
  'import .*supabaseAdmin',
  'src',
  '--glob',
  '!**/*.test.*',
], { encoding: 'utf8' }).trim();
const actual = new Set(output ? output.split(/\r?\n/u) : []);
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

const keyOutput = execFileSync('rg', [
  '-l', 'SUPABASE_SERVICE_ROLE_KEY', 'src', '--glob', '!**/*.test.*',
], { encoding: 'utf8' }).trim();
const keyUsers = new Set(keyOutput ? keyOutput.split(/\r?\n/u) : []);
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
const usageOutput = execFileSync('rg', ['-l', 'serviceRoleFor[A-Za-z]+', 'src', '--glob', '!src/utils/supabase/serviceRole.ts', '--glob', '!**/*.test.*'], { encoding: 'utf8' }).trim();
for (const consumer of usageOutput.split(/\r?\n/u).filter(Boolean)) {
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
