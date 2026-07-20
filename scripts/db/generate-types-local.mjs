import { execFileSync } from 'node:child_process';

const generated = execFileSync(
  'npx',
  ['--yes', 'supabase@2.108.0', 'gen', 'types', '--local', '--schema', 'public'],
  { encoding: 'utf8' },
);

// The Supabase CLI may emit extra terminal blank lines depending on its runtime.
// Keep exactly one final newline so the checked-in output reflects schema changes only.
process.stdout.write(`${generated.replace(/(?:\r?\n)+$/, '')}\n`);
