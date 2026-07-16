export const RATE_LIMIT_MESSAGE = 'ログイン試行が一定回数を超えました。約15分後に再度お試しください。';

// セッションの時間制約はクライアント・Proxy・Server Actionで共有する。
export const SESSION_IDLE_MINUTES = 24 * 60;
export const SESSION_IDLE_MS = SESSION_IDLE_MINUTES * 60 * 1000;
export const SESSION_ABSOLUTE_HOURS = 30 * 24;
export const SESSION_ABSOLUTE_MS = SESSION_ABSOLUTE_HOURS * 60 * 60 * 1000;
export const REAUTH_GRANT_TTL_MINUTES = 10;
