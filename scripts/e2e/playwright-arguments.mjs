const criticalFiles = [
  'tests/auth.spec.ts',
  'tests/workspace-routing.spec.ts',
  'tests/staff-features.spec.ts',
  'tests/tenant-isolation.spec.ts',
];

export function playwrightArguments(suite, files = [], project) {
  if (!['critical', 'all'].includes(suite)) {
    throw new Error(`Unknown E2E suite "${suite}". Use "critical" or "all".`);
  }
  if (files.some(file => !/^tests\/[A-Za-z0-9-]+\.spec\.ts$/.test(file))) {
    throw new Error('Optional E2E test files must be paths such as tests/auth.spec.ts.');
  }
  if (project !== undefined && !['chromium', 'mobile-chrome'].includes(project)) {
    throw new Error('E2E_PROJECT must be chromium or mobile-chrome.');
  }
  if (suite === 'critical' && project && project !== 'chromium') {
    throw new Error('The critical E2E suite only supports chromium.');
  }
  const selectedProject = suite === 'critical' ? 'chromium' : project;
  return ['test', ...(selectedProject ? [`--project=${selectedProject}`] : []),
    ...(files.length ? files : suite === 'critical' ? criticalFiles : [])];
}
