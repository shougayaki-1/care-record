export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { validateDeploymentEnv } = await import('@/lib/env/server');
    validateDeploymentEnv();
  }
}
