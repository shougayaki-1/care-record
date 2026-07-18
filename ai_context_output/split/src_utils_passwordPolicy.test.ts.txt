import { describe, expect, it } from 'vitest';
import { PASSWORD_POLICY_HINT, validatePassword } from './passwordPolicy';

describe('password policy', () => {
  it('requires only a minimum of eight characters', () => {
    expect(validatePassword('aaaaaaaa')).toEqual({ ok: true });
    expect(validatePassword('12345678')).toEqual({ ok: true });
    expect(validatePassword('short')).toEqual({
      ok: false,
      message: 'パスワードは8文字以上で設定してください。',
    });
  });

  it('does not advertise character-class requirements', () => {
    expect(PASSWORD_POLICY_HINT).toBe('8文字以上で設定してください。');
  });
});
