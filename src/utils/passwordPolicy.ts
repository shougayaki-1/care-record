// パスワードポリシー（3省2ガイドライン: 推測困難なパスワードの強制）。
// クライアント検証に加え、Supabase ダッシュボード側の最小強度設定も併用すること。

export const PASSWORD_MIN_LENGTH = 8;

// 英大文字・英小文字・数字・記号のうち、いくつの種類を必須とするか。
const REQUIRED_CHARACTER_CLASSES = 3;

export const PASSWORD_POLICY_HINT =
  `${PASSWORD_MIN_LENGTH}文字以上で、英大文字・英小文字・数字・記号のうち${REQUIRED_CHARACTER_CLASSES}種類以上を含めてください。`;

export type PasswordValidationResult = { ok: true } | { ok: false; message: string };

/** パスワードがポリシーを満たすか検証する。 */
export function validatePassword(password: string): PasswordValidationResult {
  if (!password || password.length < PASSWORD_MIN_LENGTH) {
    return { ok: false, message: `パスワードは${PASSWORD_MIN_LENGTH}文字以上で設定してください。` };
  }

  const classes = [
    /[a-z]/, // 英小文字
    /[A-Z]/, // 英大文字
    /[0-9]/, // 数字
    /[^A-Za-z0-9]/, // 記号
  ].filter((re) => re.test(password)).length;

  if (classes < REQUIRED_CHARACTER_CLASSES) {
    return {
      ok: false,
      message: `英大文字・英小文字・数字・記号のうち${REQUIRED_CHARACTER_CLASSES}種類以上を含めてください。`,
    };
  }

  return { ok: true };
}
