import { describe, expect, it } from 'vitest';
import { safeReauthNext } from './reauthTypes';
describe('step-up return paths', () => {
  it.each(['//evil.example/app/profile', '/\\evil.example/app/settings', 'https://evil.example/app/profile', '/other', 'javascript:alert(1)'])('rejects %s', input => {
    expect(safeReauthNext(input)).toBe('/app/settings');
  });
  it('preserves only allowed same-origin pages and their resume parameters', () => {
    expect(safeReauthNext('/app/profile?stepup=1')).toBe('/app/profile?stepup=1');
  });
});
