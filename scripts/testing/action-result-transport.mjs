// DB/ログインを使わず、実際の Next production Server Action transport を検証する。
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const fixture = await mkdtemp(path.join(tmpdir(), 'care-record-action-transport-'));
const next = path.join(root, 'node_modules/next/dist/bin/next');
let server;
let browser;
let logs = '';
const env = { ...process.env, NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1' };
// This fixture never loads a Supabase/Google client or the application's environment.
for (const key of Object.keys(env)) {
  if (/^(NEXT_PUBLIC_|SUPABASE_|GOOGLE_|GCS_|GAS_|CRON_|AUDIT_)/.test(key)) delete env[key];
}

function run(args) {
  const child = spawn(process.execPath, [next, ...args], { cwd: fixture, env, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', data => { logs += data; });
  child.stderr.on('data', data => { logs += data; });
  return child;
}

async function waitForExit(child) {
  await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`Next exited with ${code}`)));
  });
}

try {
  await mkdir(path.join(fixture, 'app'));
  await mkdir(path.join(fixture, 'src/utils'), { recursive: true });
  await mkdir(path.join(fixture, 'src/types'), { recursive: true });
  // Copy the actual helper, including strict error disclosure and real structured logging.
  for (const name of ['utils/errors.ts', 'utils/log.ts', 'types/actionResult.ts']) {
    await copyFile(path.join(root, 'src', name), path.join(fixture, 'src', name));
  }
  await symlink(path.join(root, 'node_modules'), path.join(fixture, 'node_modules'), 'dir');
  await writeFile(path.join(fixture, 'package.json'), JSON.stringify({ private: true, dependencies: {
    next: JSON.parse(await readFile(path.join(root, 'node_modules/next/package.json'), 'utf8')).version,
    react: JSON.parse(await readFile(path.join(root, 'node_modules/react/package.json'), 'utf8')).version,
    'react-dom': JSON.parse(await readFile(path.join(root, 'node_modules/react-dom/package.json'), 'utf8')).version,
  } }));
  await writeFile(path.join(fixture, 'tsconfig.json'), JSON.stringify({ compilerOptions: {
    target: 'ES2017', lib: ['dom', 'esnext'], strict: true, noEmit: true, esModuleInterop: true,
    module: 'esnext', moduleResolution: 'bundler', resolveJsonModule: true, isolatedModules: true,
    jsx: 'react-jsx', paths: { '@/*': ['./src/*'] }, plugins: [{ name: 'next' }], skipLibCheck: true,
  } }));
  await writeFile(path.join(fixture, 'app/layout.tsx'), `export default function Layout({ children }: { children: React.ReactNode }) { return <html><body>{children}</body></html>; }`);
  await writeFile(path.join(fixture, 'app/actions.ts'), `
'use server';
import { ExpectedActionError, withActionResult } from '@/utils/errors';
export async function outcome(kind: string) {
  return withActionResult('transport-fixture', async () => {
    if (kind === 'empty') return [];
    if (kind === 'forbidden') throw new ExpectedActionError('FORBIDDEN', 'この操作を行う権限がありません');
    if (kind === 'expired') throw new ExpectedActionError('SESSION_EXPIRED', 'セッションの有効期限が切れています');
    throw new Error('synthetic_private_column 権限 detail');
  });
}
export async function unexpectedThrow() { throw new Error('synthetic_raw_throw_secret'); }
`);
  await writeFile(path.join(fixture, 'app/page.tsx'), `
'use client';
import { useState } from 'react';
import { outcome, unexpectedThrow } from './actions';
export default function Page() {
  const [result, setResult] = useState('');
  return <><output data-testid="result">{result}</output>
    {['empty', 'forbidden', 'expired', 'unexpected'].map(kind => <button key={kind} onClick={async () => setResult(JSON.stringify(await outcome(kind)))}>{kind}</button>)}
    <button onClick={async () => { try { await unexpectedThrow(); } catch (error) { setResult(JSON.stringify({ message: (error as Error).message, digest: (error as Error & { digest?: string }).digest })); } }}>throw</button>
  </>;
}
`);
  await waitForExit(run(['build', '--webpack']));
  const port = await new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const assigned = probe.address().port;
      probe.close(() => resolve(assigned));
    });
  });
  const base = `http://127.0.0.1:${port}`;
  server = run(['start', '--hostname', '127.0.0.1', '--port', String(port)]);
  for (let attempt = 0; attempt < 100; attempt++) {
    try { if ((await fetch(base)).ok) break; } catch { /* server is starting */ }
    if (attempt === 99) throw new Error('Next start did not become ready');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const responses = [];
  page.on('response', response => { if (response.request().headers()['next-action']) responses.push(response); });
  await page.goto(base);
  const cases = {
    empty: { ok: true, data: [] },
    forbidden: { ok: false, error: { code: 'FORBIDDEN', message: 'この操作を行う権限がありません' } },
    expired: { ok: false, error: { code: 'SESSION_EXPIRED', message: 'セッションの有効期限が切れています' } },
    unexpected: { ok: false, error: { code: 'UNEXPECTED_ERROR', message: '処理に失敗しました。時間をおいて再度お試しください。' } },
  };
  for (const [kind, expected] of Object.entries(cases)) {
    await page.getByRole('button', { name: kind, exact: true }).click();
    await page.waitForFunction(value => document.querySelector('output')?.textContent === value, JSON.stringify(expected));
    assert.deepEqual(JSON.parse(await page.getByTestId('result').innerText()), expected);
  }
  await page.getByRole('button', { name: 'throw', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('output')?.textContent?.includes('digest'));
  const thrown = JSON.parse(await page.getByTestId('result').innerText());
  assert.equal(typeof thrown.digest, 'string');
  assert.doesNotMatch(thrown.message, /synthetic_raw_throw_secret/);
  assert.equal(responses.length, 5);
  for (const response of responses) {
    assert.match(response.headers()['content-type'], /text\/x-component/);
    assert.doesNotMatch(await response.text(), /synthetic_private_column|synthetic_raw_throw_secret/);
  }
  assert.match(logs, /synthetic_private_column/);
  console.log('PASS: production next build/start, 5 HTTP Server Action responses, typed codes/messages, empty success, internal-error redaction and server logging');
} catch (error) {
  console.error(logs);
  throw error;
} finally {
  await browser?.close();
  if (server && server.exitCode === null) {
    const stopped = new Promise(resolve => server.once('exit', resolve));
    server.kill('SIGTERM');
    await stopped;
  }
  await rm(fixture, { recursive: true, force: true });
}
