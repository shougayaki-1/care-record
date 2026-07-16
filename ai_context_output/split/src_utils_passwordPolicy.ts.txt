// サーバーとUIで共有するパスワードポリシー。

export const PASSWORD_MIN_LENGTH = 8;

export const PASSWORD_POLICY_HINT = `${PASSWORD_MIN_LENGTH}文字以上で設定してください。`;

export type PasswordValidationResult = { ok: true } | { ok: false; message: string };

/** パスワードがポリシーを満たすか検証する。 */
export function validatePassword(password: string): PasswordValidationResult {
  if (!password || password.length < PASSWORD_MIN_LENGTH) {
    return { ok: false, message: `パスワードは${PASSWORD_MIN_LENGTH}文字以上で設定してください。` };
  }

  return { ok: true };
}
