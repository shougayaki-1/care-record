/**
 * Google カレンダー同期にまつわる「副作用のない純粋ロジック」を集約するモジュール。
 *
 * これらは元々 `src/app/actions/shift.ts`（'use server'）に埋め込まれていたが、
 * Server Action モジュールは async 関数しか export できずテスト不能だったため、
 * 純粋関数として切り出した。挙動は移設前と完全に同一。
 */

import type { calendar_v3 } from 'googleapis';

/**
 * Googleカレンダー同期で発生したエラーを種別付きで表現する。
 * - auth      : トークン失効（再認証が必要。リトライ不可）
 * - forbidden : カレンダーのアクセス権不足（再認証だけでは解消しない）
 * - misconfigured : OAuthクライアント等の設定不備
 * - rate_limit: レート制限（待機してリトライ可能）
 * - transient : 一時的なサーバー/ネットワーク障害（リトライ可能）
 * - permanent : それ以外の恒久的なエラー（リトライ不可）
 * - skipped   : 連携未設定など、同期対象外のため何もしなかった
 */
export type SyncErrorKind = 'auth' | 'forbidden' | 'misconfigured' | 'rate_limit' | 'transient' | 'permanent' | 'skipped';

export class SyncError extends Error {
    kind: SyncErrorKind;
    code?: number;
    constructor(message: string, kind: SyncErrorKind, code?: number) {
        super(message);
        this.name = 'SyncError';
        this.kind = kind;
        this.code = code;
    }
}

export function classifyGoogleError(e: unknown): SyncError {
    if (e instanceof SyncError) return e;
    const err = e as {
        code?: number | string;
        status?: number;
        // Google OAuth は error を文字列("invalid_grant")で、Calendar API は {message:string} で返す
        response?: { status?: number; data?: { error?: string | { message?: string; errors?: Array<{ reason?: string }> }; error_description?: string } };
        message?: string;
    };
    // Gaxios(googleapis) は HTTP ステータスを response.status に持つ。code は文字列のこともあるため数値のみ採用。
    const raw = err?.response?.status
        ?? (typeof err?.code === 'number' ? err.code : undefined)
        ?? err?.status;
    const code = typeof raw === 'number' ? raw : undefined;
    const errorField = err?.response?.data?.error;
    // OAuth エラーは error が文字列("invalid_grant")、Calendar API は error.message にメッセージが入る
    const oauthErrorCode = typeof errorField === 'string' ? errorField : undefined;
    const msg = (typeof errorField === 'object' ? errorField?.message : undefined)
        || err?.response?.data?.error_description
        || err?.message;
    // These are application configuration errors, including HTTP 401 responses.
    // Asking the user to reconnect cannot fix an invalid OAuth client secret.
    if (oauthErrorCode && /^(invalid_client|unauthorized_client|invalid_scope|redirect_uri_mismatch)$/.test(oauthErrorCode)) {
        return new SyncError(msg || oauthErrorCode, 'misconfigured', code);
    }
    // OAuth のトークン失効: invalid_grant(HTTP 400)はコードチェック前に判定が必要
    if (oauthErrorCode && /invalid_grant|invalid_token/i.test(oauthErrorCode)) {
        return new SyncError(msg || oauthErrorCode, 'auth', code);
    }
    if (typeof msg === 'string' && /\b(invalid_grant|invalid_token|unauthorized)\b/i.test(msg) && code !== 403) {
        return new SyncError(msg, 'auth', code);
    }
    const googleReasons = typeof errorField === 'object' ? (errorField?.errors || []).map(error => error.reason || '') : [];
    if (code === 401) return new SyncError(msg || 'auth error', 'auth', code);
    if (code === 403) {
        if (googleReasons.some(reason => /^(rateLimitExceeded|userRateLimitExceeded|quotaExceeded|dailyLimitExceeded)$/i.test(reason))) {
            return new SyncError(msg || 'rate limit', 'rate_limit', code);
        }
        if (googleReasons.some(reason => /^(accessNotConfigured|serviceDisabled)$/i.test(reason))) {
            return new SyncError(msg || 'API is not enabled', 'misconfigured', code);
        }
        return new SyncError(msg || 'permission denied', 'forbidden', code);
    }
    if (code === 429) return new SyncError(msg || 'rate limit', 'rate_limit', code);
    if (typeof code === 'number' && code >= 500) return new SyncError(msg || 'server error', 'transient', code);
    if (code === undefined) return new SyncError(msg || 'network error', 'transient'); // ネットワーク断などコード無しは一時障害扱い
    return new SyncError(msg || 'unknown error', 'permanent', code);
}

export type GoogleConnectionState = 'disconnected' | 'healthy' | 'reauth_required' | 'calendar_missing' | 'forbidden' | 'misconfigured' | 'temporarily_unavailable';

export const GOOGLE_CONNECTION_LABELS: Record<GoogleConnectionState, string> = {
    disconnected: '未連携',
    healthy: '連携・正常',
    reauth_required: '再認証が必要',
    calendar_missing: 'カレンダー要確認',
    forbidden: 'アクセス権を確認',
    misconfigured: '連携設定を確認',
    temporarily_unavailable: '一時的に接続できません',
};

export function googleConnectionMessage(state: GoogleConnectionState): string | null {
    if (state === 'healthy') return null;
    if (state === 'calendar_missing') return '連携先のカレンダーが見つからないか、アクセスできません。元のGoogleアカウントとカレンダーの共有設定を確認してください。';
    if (state === 'disconnected') return googleSyncErrorMessage('skipped');
    return googleSyncErrorMessage(state === 'reauth_required' ? 'auth' : state === 'temporarily_unavailable' ? 'transient' : state);
}

export function googleConnectionStateFromError(error: unknown): GoogleConnectionState {
    const classified = classifyGoogleError(error);
    if (classified.kind === 'auth') return 'reauth_required';
    if (classified.kind === 'forbidden') return 'forbidden';
    if (classified.kind === 'rate_limit' || classified.kind === 'transient') return 'temporarily_unavailable';
    if (classified.code === 404) return 'calendar_missing';
    return 'misconfigured';
}

/** Shared guidance: reconnect only when it can actually resolve the error. */
export function googleSyncErrorMessage(kind?: string): string | null {
    switch (kind) {
        case 'auth': return 'Googleの認証が無効になっています。設定画面の「Googleを再認証」を実行してください。連携の解除は不要です。';
        case 'forbidden': return 'Googleカレンダーへのアクセス権がありません。連携したGoogleアカウントのカレンダー編集権限を確認してください。';
        case 'misconfigured': return 'Google連携の設定に問題があります。管理者にOAuth設定・Calendar APIの有効化を確認してください。';
        case 'rate_limit': return 'Google側で利用制限が発生しています。時間をおいて再試行してください。再認証は不要です。';
        case 'transient': return 'Googleとの通信に一時的な問題が発生しています。時間をおいて再試行してください。再認証は不要です。';
        case 'permanent': return 'Googleカレンダーへの同期に失敗しました。設定画面で接続状態を確認してください。';
        case 'skipped': return 'Googleカレンダーが連携されていません。設定画面から接続してください。';
        default: return null;
    }
}

/**
 * 年、月、日から正確なJSTの開始・終了時刻文字列（ISO8601形式）を組み立てる
 */
export function buildJstIsoString(year: number, month: number, day: number, timeStr: string) {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${year}-${pad(month)}-${pad(day)}T${timeStr}:00+09:00`;
}

/**
 * タイムゾーンの影響を受けずにローカル時間を正しく扱うための Floating 時間 Date
 */
export function buildFloatingDate(year: number, month: number, day: number, hour: number, minute: number): Date {
    return new Date(Date.UTC(year, month - 1, day, hour, minute));
}

// ---------------------------------------------------------------------------
// 同期統計（冪等性の集計）
// ---------------------------------------------------------------------------

export type GoogleSyncStatus = 'synced' | 'pending_upsert' | 'pending_delete' | 'failed';

export type GoogleSyncStats = {
    created: number;
    updated: number;
    linked: number;
    deletedRemote: number;
    deduped: number;
};

export const emptyGoogleSyncStats = (): GoogleSyncStats => ({
    created: 0,
    updated: 0,
    linked: 0,
    deletedRemote: 0,
    deduped: 0,
});

export function mergeGoogleSyncStats(target: GoogleSyncStats, source?: Partial<GoogleSyncStats>) {
    if (!source) return;
    target.created += source.created || 0;
    target.updated += source.updated || 0;
    target.linked += source.linked || 0;
    target.deletedRemote += source.deletedRemote || 0;
    target.deduped += source.deduped || 0;
}

// ---------------------------------------------------------------------------
// Google イベントの構築・署名・重複解決（冪等性の中核）
// ---------------------------------------------------------------------------

export const GOOGLE_PROP_SHIFT_ID = 'careRecordShiftId';
export const GOOGLE_PROP_ORG_ID = 'careRecordOrgId';

export type ShiftForGoogle = {
    id: string;
    title: string | null;
    start_at: string;
    end_at: string;
    status: 'published' | 'cancelled';
    cancel_reason: string | null;
    google_event_id: string | null;
    deleted_at?: string | null;
    shift_staffs?: { staff_id: string | null }[] | null;
};

export function buildGoogleEventBody(organizationId: string, shiftData: ShiftForGoogle): calendar_v3.Schema$Event {
    const staffIds = (shiftData.shift_staffs || []).map(s => s.staff_id).filter(Boolean) as string[];
    let colorId: string | undefined = undefined;

    if (shiftData.status === 'cancelled') colorId = '8';
    else if (staffIds.length > 0 && staffIds[0]) {
        const staffId = staffIds[0];
        let hash = 0;
        for (let i = 0; i < staffId.length; i++) hash = staffId.charCodeAt(i) + ((hash << 5) - hash);
        colorId = ((Math.abs(hash) % 11) + 1).toString();
    }

    const title = shiftData.title || 'シフト';
    const eventTitle = shiftData.status === 'cancelled' ? `【休】${title}` : title;

    return {
        summary: eventTitle,
        description: shiftData.cancel_reason ? `キャンセル理由: ${shiftData.cancel_reason}` : '',
        start: {
            dateTime: new Date(shiftData.start_at).toISOString(),
            timeZone: 'Asia/Tokyo'
        },
        end: {
            dateTime: new Date(shiftData.end_at).toISOString(),
            timeZone: 'Asia/Tokyo'
        },
        colorId,
        extendedProperties: {
            private: {
                [GOOGLE_PROP_SHIFT_ID]: shiftData.id,
                [GOOGLE_PROP_ORG_ID]: organizationId,
            }
        }
    };
}

export function getGoogleEventPrivateProp(event: calendar_v3.Schema$Event, key: string): string | undefined {
    return event.extendedProperties?.private?.[key] || undefined;
}

export function getGoogleEventStart(event: calendar_v3.Schema$Event): string {
    return event.start?.dateTime || event.start?.date || '';
}

export function getGoogleEventEnd(event: calendar_v3.Schema$Event): string {
    return event.end?.dateTime || event.end?.date || '';
}

export function getLegacyEventSignature(event: calendar_v3.Schema$Event): string {
    return `${event.summary || ''}::${normalizeGoogleEventDate(getGoogleEventStart(event))}::${normalizeGoogleEventDate(getGoogleEventEnd(event))}`;
}

export function normalizeGoogleEventDate(value: string): string {
    if (!value) return '';
    const time = Date.parse(value);
    return Number.isNaN(time) ? value : new Date(time).toISOString();
}

export function getEventBodySignature(eventBody: calendar_v3.Schema$Event): string {
    return `${eventBody.summary || ''}::${normalizeGoogleEventDate(eventBody.start?.dateTime || eventBody.start?.date || '')}::${normalizeGoogleEventDate(eventBody.end?.dateTime || eventBody.end?.date || '')}`;
}

export function isActiveGoogleEvent(event: calendar_v3.Schema$Event): boolean {
    return !!event.id && event.status !== 'cancelled';
}

export function choosePrimaryGoogleEvent(events: calendar_v3.Schema$Event[], preferredId?: string | null) {
    const activeEvents = events.filter(isActiveGoogleEvent);
    if (preferredId) {
        const preferred = activeEvents.find(event => event.id === preferredId);
        if (preferred) return preferred;
    }
    return activeEvents.sort((a, b) => {
        const aUpdated = a.updated ? Date.parse(a.updated) : 0;
        const bUpdated = b.updated ? Date.parse(b.updated) : 0;
        return bUpdated - aUpdated;
    })[0];
}
