import { fn } from 'storybook/test';
import type * as Auth from '../auth';

// Storybook must not evaluate the server module or its Auth/crypto dependencies.
export const registerWithPassword = fn<typeof Auth.registerWithPassword>().mockResolvedValue({ ok: true, signedIn: false });
export const loginWithPassword = fn<typeof Auth.loginWithPassword>().mockResolvedValue({ ok: false, reason: 'invalid_credentials' });
export const recordLogout = fn<typeof Auth.recordLogout>().mockResolvedValue(undefined);
export const heartbeatSession = fn<typeof Auth.heartbeatSession>().mockResolvedValue({ ok: true, data: undefined });
