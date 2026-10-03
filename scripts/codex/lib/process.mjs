import { spawn } from 'node:child_process';

export function safeEnvironment(env = process.env, { github = false } = {}) {
  const names = ['PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'TMPDIR', 'LANG', 'LC_ALL', 'CODEX_HOME', 'XDG_CONFIG_HOME', 'SSH_AUTH_SOCK'];
  if (github) names.push('GH_TOKEN', 'GITHUB_TOKEN', 'GH_HOST', 'GH_CONFIG_DIR');
  return { ...Object.fromEntries(names.filter(n => env[n]).map(n => [n, env[n]])), GIT_TERMINAL_PROMPT: '0', GH_PROMPT_DISABLED: '1' };
}

export function command(binary, args, { cwd, input, github = false, timeout = 120_000, signal } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new Error('Worker stopped')); return; }
    const child = spawn(binary, args, { cwd, env: safeEnvironment(process.env, { github }), detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '';
    let size = 0;
    let stopping = false;
    let escalation;
    const kill = sig => {
      try { if (process.platform !== 'win32') process.kill(-child.pid, sig); else child.kill(sig); } catch { /* Already exited. */ }
    };
    const stop = () => {
      if (stopping) return;
      stopping = true;
      kill('SIGTERM');
      escalation = setTimeout(() => kill('SIGKILL'), 30_000);
    };
    const timer = setTimeout(stop, timeout);
    const cleanup = () => { clearTimeout(timer); clearTimeout(escalation); signal?.removeEventListener('abort', stop); };
    signal?.addEventListener('abort', stop, { once: true });
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => { size += chunk.length; if (size > 20_000_000) stop(); else output += chunk; });
    // Do not forward potentially sensitive stderr or command arguments.
    child.stderr.resume();
    child.once('error', () => { cleanup(); reject(new Error(`${binary} could not start`)); });
    child.once('close', code => {
      cleanup();
      if (signal?.aborted) reject(new Error('Worker stopped'));
      else if (code === 0 && !stopping) resolve(output.trim());
      else reject(new Error(`${binary} command failed; inspect locally without publishing credentials`));
    });
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}
