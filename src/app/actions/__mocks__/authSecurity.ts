import { fn } from 'storybook/test';
import type * as AuthSecurity from '../authSecurity';

// Replace the complete server module without evaluating Auth/crypto dependencies.
export const requestPasswordReset = fn<typeof AuthSecurity.requestPasswordReset>().mockResolvedValue({ ok: true });
export const finishPasswordReset = fn<typeof AuthSecurity.finishPasswordReset>().mockResolvedValue({ ok: true });
export const getReauthMethods = fn<typeof AuthSecurity.getReauthMethods>().mockResolvedValue(['password', 'google', 'azure']);
export const verifyReauthPassword = fn<typeof AuthSecurity.verifyReauthPassword>().mockResolvedValue({ token: 'storybook-grant', expiresAt: '2099-01-01T00:00:00Z' });
export const startProviderReauth = fn<typeof AuthSecurity.startProviderReauth>().mockResolvedValue({ nonce: 'storybook-nonce', provider: 'google' });
export const takeProviderReauthGrant = fn<typeof AuthSecurity.takeProviderReauthGrant>().mockResolvedValue(null);
export const changeAccountPassword = fn<typeof AuthSecurity.changeAccountPassword>().mockResolvedValue(undefined);
export const changeAccountEmail = fn<typeof AuthSecurity.changeAccountEmail>().mockResolvedValue(undefined);
