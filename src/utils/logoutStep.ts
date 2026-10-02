export const LOGOUT_STEP_TIMEOUT_MS = 2000;

/** Authentication/network locks must not strand a user on the recovery screen. */
export async function runLogoutStep(operation: () => Promise<unknown>, label: string): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      Promise.resolve().then(operation),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('logout timed out')), LOGOUT_STEP_TIMEOUT_MS);
      }),
    ]);
  } catch (error) {
    console.warn(label, error);
  } finally {
    clearTimeout(timer);
  }
}
