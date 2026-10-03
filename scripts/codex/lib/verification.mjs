const unit = 'vitest run --project unit';
const ui = 'vitest run --project storybook';
const standard = 'npm run test:unit && npm run test:ui';

function assertLocalTests(scripts, names) {
  const allowed = { test: standard, 'test:unit': unit, 'test:ui': ui };
  for (const name of names) {
    if (scripts[name] !== allowed[name] || scripts[`pre${name}`] || scripts[`post${name}`]) {
      throw new Error('Test script requires human verification: only local unit/UI without lifecycle hooks is allowed');
    }
  }
}

// This is also the exact set of sandbox-limited tests the prompt may delegate.
export function verificationTests(changed, scripts) {
  const checks = [];
  const packageChanged = changed.some(line => /\s+package(?:-lock)?\.json$/.test(line));
  if (packageChanged && scripts.test !== undefined) {
    assertLocalTests(scripts, ['test', 'test:unit', 'test:ui']);
    checks.push('test');
  } else {
    if (changed.some(line => /\s+src\/(?:app\/actions|utils)\//.test(line))) {
      assertLocalTests(scripts, ['test:unit']); checks.push('test:unit');
    }
    if (changed.some(line => /\s+src\/components\/ui\//.test(line))) {
      assertLocalTests(scripts, ['test:ui']); checks.push('test:ui');
    }
  }
  if (changed.some(line => /\s+scripts\/codex\//.test(line))) checks.push('test:codex-worker');
  return checks;
}
