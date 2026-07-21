export const RATE_LIMIT_MESSAGE = 'ログイン試行が一定回数を超えました。約15分後に再度お試しください。';

// セッションの時間制約はクライアント・Proxy・Server Actionで共有する。
export const SESSION_IDLE_MINUTES = 24 * 60;
export const SESSION_IDLE_MS = SESSION_IDLE_MINUTES * 60 * 1000;
export const SESSION_ABSOLUTE_HOURS = 30 * 24;
export const SESSION_ABSOLUTE_MS = SESSION_ABSOLUTE_HOURS * 60 * 60 * 1000;
export const REAUTH_GRANT_TTL_MINUTES = 10;

// SSOのみ（パスワード未設定）のアカウントが重要操作を再認証する際、
// Google/MicrosoftへのリダイレクトのCSRF対策nonceを保持するCookie。
export const STEPUP_NONCE_COOKIE = 'su_nonce';
// 上記の再認証が完了した直後、発行された reauth_grants トークンを
// クライアントへ一度だけ受け渡すための短命Cookie。
export const STEPUP_GRANT_COOKIE = 'su_grant';
export const STEPUP_GRANT_COOKIE_TTL_SECONDS = 60;
