'use server';

import { google, calendar_v3 } from 'googleapis';
import { getGoogleOAuthClient } from '@/utils/googleCalendar';
import { rrulestr } from 'rrule';
import { supabaseAdmin, assertOrgRole, assertOrgPermission, assertResourceOrgPermission, getAuthedUser } from '@/utils/supabase/auth';
import { decryptGoogleToken } from '@/utils/googleTokenCrypto';
import { recordAuditEvent } from '@/utils/supabase/audit';
import { getRetentionPolicy, retentionDeadline } from '@/utils/supabase/retentionPolicy';

/**
 * 複数 shiftId が呼び出し元のアクセス可能な事業所に属することを検証する。
 * 属さない / 存在しない shiftId が混在する場合は例外。
 */
async function assertShiftsAccessible(shiftIds: string[]): Promise<void> {
    if (!shiftIds || shiftIds.length === 0) return;
    const { data, error } = await supabaseAdmin
        .from('shifts')
        .select('id, organization_id')
        .in('id', shiftIds);
    if (error) throw error;
    if ((data?.length || 0) !== shiftIds.length) throw new Error('対象シフトが見つかりません');

    const orgIds = Array.from(new Set((data || []).map(s => s.organization_id)));
    for (const orgId of orgIds) {
        await assertOrgPermission(orgId, 'staffs');
    }
}

async function softDeleteShiftIds(organizationId: string, shiftIds: string[], reason: string) {
    if (shiftIds.length === 0) return;
    const actor = await assertOrgPermission(organizationId, 'staffs');
    const policy = await getRetentionPolicy(organizationId, 'shift');
    const { error } = await supabaseAdmin.from('shifts').update({
        deleted_at: new Date().toISOString(), deleted_by: actor.userId,
        deletion_reason: reason, retention_until: retentionDeadline(policy.years),
        google_sync_status: 'synced', google_sync_error: null, google_synced_at: new Date().toISOString(),
    }).eq('organization_id', organizationId).in('id', shiftIds).is('deleted_at', null);
    if (error) throw error;
    await recordAuditEvent({ organizationId, actorId: actor.userId, action: 'shift.bulk_soft_delete',
        resourceType: 'shift', reason, details: { shiftIds, count: shiftIds.length, legalBasis: policy.legalBasis } });
}

export type ShiftPayload = {
    organizationId: string;
    clientId: string;
    title: string;
    startAt: string;
    endAt: string;
    staffIds: string[];
    status?: 'published' | 'cancelled';
    cancelReason?: string;
    patternId?: string;
    isModified?: boolean;
};

export type ShiftPatternPayload = {
    organizationId: string;
    clientId: string;
    title: string;
    startTime: string;
    endTime: string;
    rrule: string;
    staffIds: string[];
};

type ShiftStaffInsert = { shift_id: string; staff_id: string; };
type PatternStaffInsert = { pattern_id: string; staff_id: string; };

type ShiftUpdateData = {
    title?: string;
    start_at?: string;
    end_at?: string;
    status?: 'published' | 'cancelled';
    cancel_reason?: string | null;
    updated_at?: string;
    google_event_id?: string | null;
    google_sync_status?: GoogleSyncStatus;
    google_sync_error?: string | null;
    google_synced_at?: string | null;
    is_modified?: boolean;
};

type GoogleSyncStatus = 'synced' | 'pending_upsert' | 'pending_delete' | 'failed';

type GoogleSyncStats = {
    created: number;
    updated: number;
    linked: number;
    deletedRemote: number;
    deduped: number;
};

const emptyGoogleSyncStats = (): GoogleSyncStats => ({
    created: 0,
    updated: 0,
    linked: 0,
    deletedRemote: 0,
    deduped: 0,
});

function mergeGoogleSyncStats(target: GoogleSyncStats, source?: Partial<GoogleSyncStats>) {
    if (!source) return;
    target.created += source.created || 0;
    target.updated += source.updated || 0;
    target.linked += source.linked || 0;
    target.deletedRemote += source.deletedRemote || 0;
    target.deduped += source.deduped || 0;
}

const GOOGLE_PROP_SHIFT_ID = 'careRecordShiftId';
const GOOGLE_PROP_ORG_ID = 'careRecordOrgId';

type GoogleCalendarClient = ReturnType<typeof google.calendar>;
type ShiftForGoogle = {
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

/**
 * 年、月、日から正確なJSTの開始・終了時刻文字列（ISO8601形式）を組み立てる
 */
function buildJstIsoString(year: number, month: number, day: number, timeStr: string) {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${year}-${pad(month)}-${pad(day)}T${timeStr}:00+09:00`;
}

/**
 * タイムゾーンの影響を受けずにローカル時間を正しく扱うための Floating 時間 Date
 */
function buildFloatingDate(year: number, month: number, day: number, hour: number, minute: number): Date {
    return new Date(Date.UTC(year, month - 1, day, hour, minute));
}

/**
 * Googleカレンダー同期で発生したエラーを種別付きで表現する。
 * - auth      : 認証切れ・権限不足（再認証が必要。リトライ不可）
 * - rate_limit: レート制限（待機してリトライ可能）
 * - transient : 一時的なサーバー/ネットワーク障害（リトライ可能）
 * - permanent : それ以外の恒久的なエラー（リトライ不可）
 * - skipped   : 連携未設定など、同期対象外のため何もしなかった
 */
type SyncErrorKind = 'auth' | 'rate_limit' | 'transient' | 'permanent' | 'skipped';

class SyncError extends Error {
    kind: SyncErrorKind;
    code?: number;
    constructor(message: string, kind: SyncErrorKind, code?: number) {
        super(message);
        this.name = 'SyncError';
        this.kind = kind;
        this.code = code;
    }
}

function classifyGoogleError(e: unknown): SyncError {
    if (e instanceof SyncError) return e;
    const err = e as {
        code?: number | string;
        status?: number;
        // Google OAuth は error を文字列("invalid_grant")で、Calendar API は {message:string} で返す
        response?: { status?: number; data?: { error?: string | { message?: string }; error_description?: string } };
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
    // OAuth のトークン失効: invalid_grant(HTTP 400)はコードチェック前に判定が必要
    if (oauthErrorCode && /invalid_grant|invalid_token/i.test(oauthErrorCode)) {
        return new SyncError(msg || oauthErrorCode, 'auth', code);
    }
    if (typeof msg === 'string' && /invalid_grant|invalid_token|unauthorized/i.test(msg)) {
        return new SyncError(msg, 'auth', code);
    }
    if (code === 401 || code === 403) return new SyncError(msg || 'auth error', 'auth', code);
    if (code === 429) return new SyncError(msg || 'rate limit', 'rate_limit', code);
    if (typeof code === 'number' && code >= 500) return new SyncError(msg || 'server error', 'transient', code);
    if (code === undefined) return new SyncError(msg || 'network error', 'transient'); // ネットワーク断などコード無しは一時障害扱い
    return new SyncError(msg || 'unknown error', 'permanent', code);
}

/**
 * Google API 呼び出しを指数バックオフ付きでリトライする。
 * rate_limit / transient のみ再試行し、auth / permanent は即座に投げる。
 */
async function withRetry<T>(fn: () => Promise<T>, retries = 4): Promise<T> {
    let attempt = 0;
    for (;;) {
        try {
            return await fn();
        } catch (e) {
            const se = classifyGoogleError(e);
            attempt++;
            if (attempt > retries || (se.kind !== 'rate_limit' && se.kind !== 'transient')) throw se;
            const backoff = Math.min(8000, 400 * 2 ** (attempt - 1)) + Math.floor(Math.random() * 300);
            await new Promise(resolve => setTimeout(resolve, backoff));
        }
    }
}

function buildGoogleEventBody(organizationId: string, shiftData: ShiftForGoogle): calendar_v3.Schema$Event {
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

function getGoogleEventPrivateProp(event: calendar_v3.Schema$Event, key: string): string | undefined {
    return event.extendedProperties?.private?.[key] || undefined;
}

function getGoogleEventStart(event: calendar_v3.Schema$Event): string {
    return event.start?.dateTime || event.start?.date || '';
}

function getGoogleEventEnd(event: calendar_v3.Schema$Event): string {
    return event.end?.dateTime || event.end?.date || '';
}

function getLegacyEventSignature(event: calendar_v3.Schema$Event): string {
    return `${event.summary || ''}::${normalizeGoogleEventDate(getGoogleEventStart(event))}::${normalizeGoogleEventDate(getGoogleEventEnd(event))}`;
}

function normalizeGoogleEventDate(value: string): string {
    if (!value) return '';
    const time = Date.parse(value);
    return Number.isNaN(time) ? value : new Date(time).toISOString();
}

function getEventBodySignature(eventBody: calendar_v3.Schema$Event): string {
    return `${eventBody.summary || ''}::${normalizeGoogleEventDate(eventBody.start?.dateTime || eventBody.start?.date || '')}::${normalizeGoogleEventDate(eventBody.end?.dateTime || eventBody.end?.date || '')}`;
}

function isActiveGoogleEvent(event: calendar_v3.Schema$Event): boolean {
    return !!event.id && event.status !== 'cancelled';
}

function choosePrimaryGoogleEvent(events: calendar_v3.Schema$Event[], preferredId?: string | null) {
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

async function listGoogleEventsByShiftId(
    calendarApi: GoogleCalendarClient,
    calendarId: string,
    organizationId: string,
    shiftId: string,
): Promise<calendar_v3.Schema$Event[]> {
    const events: calendar_v3.Schema$Event[] = [];
    let pageToken: string | undefined;
    do {
        const res = await withRetry(() => calendarApi.events.list({
            calendarId,
            maxResults: 2500,
            pageToken,
            showDeleted: false,
            privateExtendedProperty: [
                `${GOOGLE_PROP_SHIFT_ID}=${shiftId}`,
                `${GOOGLE_PROP_ORG_ID}=${organizationId}`,
            ],
        }));
        events.push(...(res.data.items || []).filter(isActiveGoogleEvent));
        pageToken = res.data.nextPageToken || undefined;
    } while (pageToken);
    return events;
}

async function listAllActiveGoogleEvents(
    calendarApi: GoogleCalendarClient,
    calendarId: string,
): Promise<calendar_v3.Schema$Event[]> {
    const events: calendar_v3.Schema$Event[] = [];
    let pageToken: string | undefined;
    do {
        const res = await withRetry(() => calendarApi.events.list({
            calendarId,
            maxResults: 2500,
            pageToken,
            showDeleted: false,
        }));
        events.push(...(res.data.items || []).filter(isActiveGoogleEvent));
        pageToken = res.data.nextPageToken || undefined;
    } while (pageToken);
    return events;
}

async function deleteGoogleEventIfExists(
    calendarApi: GoogleCalendarClient,
    calendarId: string,
    eventId: string,
): Promise<boolean> {
    try {
        await withRetry(() => calendarApi.events.delete({ calendarId, eventId }));
        return true;
    } catch (e: unknown) {
        const se = classifyGoogleError(e);
        if (se.code === 404 || se.code === 410) return false;
        throw se;
    }
}

async function deleteDuplicateGoogleEvents(
    calendarApi: GoogleCalendarClient,
    calendarId: string,
    events: calendar_v3.Schema$Event[],
    keepEventId: string,
): Promise<number> {
    let deduped = 0;
    for (const event of events) {
        if (!event.id || event.id === keepEventId || event.status === 'cancelled') continue;
        await deleteGoogleEventIfExists(calendarApi, calendarId, event.id);
        deduped++;
    }
    return deduped;
}

async function markShiftGoogleSync(
    shiftId: string,
    status: GoogleSyncStatus,
    options: { eventId?: string | null; error?: string | null } = {},
) {
    const updateData: ShiftUpdateData = {
        google_sync_status: status,
        google_sync_error: options.error ?? null,
        google_synced_at: status === 'synced' ? new Date().toISOString() : null,
    };
    if ('eventId' in options) updateData.google_event_id = options.eventId ?? null;
    await supabaseAdmin.from('shifts').update(updateData).eq('id', shiftId);
}

/**
 * Googleカレンダーへの同期処理。
 * 失敗時は SyncError を投げる（呼び出し側で握りつぶさず判断できるようにする）。
 * 連携未設定やシフト不在の場合は kind='skipped' の SyncError を投げる。
 */
async function syncToGoogleCalendarDirect(organizationId: string, shiftId: string, action: 'sync' | 'delete'): Promise<GoogleSyncStats> {
    const stats = emptyGoogleSyncStats();
    const { data: orgData } = await supabaseAdmin.from('organizations').select('google_calendar_id, google_refresh_token').eq('id', organizationId).single();
    if (!orgData?.google_calendar_id || !orgData?.google_refresh_token) {
        throw new SyncError('Google calendar not connected', 'skipped');
    }

    const { data: shiftData } = await supabaseAdmin.from('shifts').select('id, title, start_at, end_at, status, cancel_reason, google_event_id, deleted_at, shift_staffs(staff_id)').eq('id', shiftId).single();
    if (!shiftData) {
        throw new SyncError('Shift not found', 'skipped');
    }

    const oauth2Client = getGoogleOAuthClient();
    oauth2Client.setCredentials({ refresh_token: decryptGoogleToken(orgData.google_refresh_token) });
    const calendarApi = google.calendar({ version: 'v3', auth: oauth2Client });

    if (action === 'delete' || shiftData.deleted_at) {
        if (shiftData.google_event_id) {
            const deleted = await deleteGoogleEventIfExists(calendarApi, orgData.google_calendar_id, shiftData.google_event_id);
            if (deleted) stats.deletedRemote++;
        }
        const linkedEvents = await listGoogleEventsByShiftId(calendarApi, orgData.google_calendar_id, organizationId, shiftId);
        for (const event of linkedEvents) {
            if (!event.id || event.id === shiftData.google_event_id) continue;
            const deleted = await deleteGoogleEventIfExists(calendarApi, orgData.google_calendar_id, event.id);
            if (deleted) stats.deletedRemote++;
        }
        await markShiftGoogleSync(shiftId, 'synced', { eventId: null });
        return stats;
    }

    const eventBody = buildGoogleEventBody(organizationId, shiftData as ShiftForGoogle);
    let newEventId = shiftData.google_event_id || null;

    if (shiftData.google_event_id) {
        try {
            await withRetry(() => calendarApi.events.update({ calendarId: orgData.google_calendar_id!, eventId: shiftData.google_event_id!, requestBody: eventBody }));
            stats.updated++;
            const linkedEvents = await listGoogleEventsByShiftId(calendarApi, orgData.google_calendar_id, organizationId, shiftId);
            const deduped = await deleteDuplicateGoogleEvents(calendarApi, orgData.google_calendar_id, linkedEvents, shiftData.google_event_id);
            stats.deduped += deduped;
        } catch (e: unknown) {
            const se = classifyGoogleError(e);
            if (se.code === 404) {
                newEventId = null;
            } else throw se;
        }
    }

    if (!newEventId) {
        const linkedEvents = await listGoogleEventsByShiftId(calendarApi, orgData.google_calendar_id, organizationId, shiftId);
        const primary = choosePrimaryGoogleEvent(linkedEvents, shiftData.google_event_id);
        if (primary?.id) {
            await withRetry(() => calendarApi.events.update({ calendarId: orgData.google_calendar_id!, eventId: primary.id!, requestBody: eventBody }));
            newEventId = primary.id;
            stats.linked++;
            stats.updated++;
            const deduped = await deleteDuplicateGoogleEvents(calendarApi, orgData.google_calendar_id, linkedEvents, primary.id);
            stats.deduped += deduped;
        }
    }

    if (!newEventId) {
        const res = await withRetry(() => calendarApi.events.insert({ calendarId: orgData.google_calendar_id!, requestBody: eventBody }));
        if (res.data.id) newEventId = res.data.id;
        stats.created++;
    }

    await markShiftGoogleSync(shiftId, 'synced', { eventId: newEventId });
    return stats;
}

/**
 * 対話的な単一シフト操作（作成・更新・キャンセル）からの同期用ラッパー。
 * 同期に失敗してもDB操作自体は成功扱いとし、シフトは「未同期」として残す
 * （後から同期ステータス画面で一括再同期できる）。失敗種別をログに残す。
 */
async function trySyncSilently(organizationId: string, shiftId: string, action: 'sync' | 'delete') {
    try {
        await syncToGoogleCalendarDirect(organizationId, shiftId, action);
    } catch (e) {
        const se = classifyGoogleError(e);
        if (se.kind !== 'skipped') {
            await markShiftGoogleSync(shiftId, 'failed', { error: se.message }).catch(console.error);
            console.error(`Google Calendar sync (${action}) failed for shift ${shiftId} [${se.kind}]:`, se.message);
        }
    }
}

type BatchOutcome = {
    succeeded: number;
    failed: number;
    failedIds: string[];
    stats: GoogleSyncStats;
    /** 最後に観測したエラー種別（UIで原因別メッセージを出すために使用） */
    errorKind?: SyncErrorKind;
};

/**
 * シフトのリストを直列で同期/削除し、成功・失敗を集計する。
 * - withRetry によりレート制限/一時障害は内部で自動リトライ
 * - 認証切れ(auth)を検知したら以降は全て失敗するため早期終了する
 * - 'skipped'（連携未設定・シフト不在）は何もしなかった成功扱い
 */
async function processShiftsSequential(
    organizationId: string,
    shifts: { id: string }[],
    action: 'sync' | 'delete',
    delayMs = 150
): Promise<BatchOutcome> {
    let succeeded = 0;
    const failedIds: string[] = [];
    const stats = emptyGoogleSyncStats();
    let errorKind: SyncErrorKind | undefined;

    for (const shift of shifts) {
        try {
            const result = await syncToGoogleCalendarDirect(organizationId, shift.id, action);
            mergeGoogleSyncStats(stats, result);
            succeeded++;
        } catch (e) {
            const se = classifyGoogleError(e);
            if (se.kind === 'skipped') { succeeded++; continue; }
            await markShiftGoogleSync(shift.id, 'failed', { error: se.message }).catch(console.error);
            failedIds.push(shift.id);
            errorKind = se.kind;
            if (se.kind === 'auth') break; // 認証切れは継続不可
        }
        if (delayMs > 0) await new Promise(resolve => setTimeout(resolve, delayMs));
    }
    return { succeeded, failed: failedIds.length, failedIds, stats, errorKind };
}

/**
 * 同期ステータス（連携の有無・全件数・未同期件数）を取得する。
 * UIの「同期ステータス」表示やバッチ同期のループ制御に使用する。
 */
export async function getSyncStatus(organizationId: string) {
    await assertOrgPermission(organizationId, 'staffs');
    const { data: orgData } = await supabaseAdmin
        .from('organizations')
        .select('google_calendar_id, google_refresh_token')
        .eq('id', organizationId)
        .single();

    const connected = !!(orgData?.google_calendar_id && orgData?.google_refresh_token);

    const { count: total } = await supabaseAdmin
        .from('shifts')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', organizationId)
        .is('deleted_at', null);

    const { count: unsynced } = await supabaseAdmin
        .from('shifts')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', organizationId)
        .is('deleted_at', null)
        .or('google_event_id.is.null,google_sync_status.in.(pending_upsert,failed)');

    return { connected, total: total || 0, unsynced: unsynced || 0 };
}

/**
 * 未同期（google_event_id IS NULL）のシフトを最大 limit 件だけ同期する。
 * サーバー側で完結する短時間バッチ。残件数を返すので、クライアントは
 * remaining が 0 になるまで繰り返し呼ぶ（タイムアウト回避＆再開可能）。
 */
export async function syncUnsyncedBatch(organizationId: string, limit = 20) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
        throw new Error('同期件数が不正です');
    }
    const status = await getSyncStatus(organizationId);
    if (!status.connected) {
        return { processed: 0, succeeded: 0, failed: 0, remaining: status.unsynced, errorKind: 'skipped' as SyncErrorKind, connected: false };
    }

    const { data: shifts } = await supabaseAdmin
        .from('shifts')
        .select('id')
        .eq('organization_id', organizationId)
        .is('deleted_at', null)
        .or('google_event_id.is.null,google_sync_status.in.(pending_upsert,failed)')
        .limit(limit);

    if (!shifts || shifts.length === 0) {
        return { processed: 0, succeeded: 0, failed: 0, remaining: 0, connected: true, ...emptyGoogleSyncStats() };
    }

    const outcome = await processShiftsSequential(organizationId, shifts, 'sync');

    // 同期後の残件数を再取得（成功分は google_event_id が埋まり減る）
    const { count: remaining } = await supabaseAdmin
        .from('shifts')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', organizationId)
        .is('deleted_at', null)
        .or('google_event_id.is.null,google_sync_status.in.(pending_upsert,failed)');

    return {
        processed: shifts.length,
        succeeded: outcome.succeeded,
        failed: outcome.failed,
        remaining: remaining || 0,
        ...outcome.stats,
        errorKind: outcome.errorKind,
        connected: true
    };
}

/**
 * 全シフトを強制再同期するためのチャンク処理。
 * id 昇順で cursor より後ろを最大 limit 件処理し、次回用カーソルと残件数を返す。
 * クライアントは remaining が 0 になるまで nextCursor を渡して繰り返す。
 */
export async function forceSyncBatch(organizationId: string, cursor: string | null, limit = 20) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
        throw new Error('同期件数が不正です');
    }
    const status = await getSyncStatus(organizationId);
    if (!status.connected) {
        return { processed: 0, succeeded: 0, failed: 0, nextCursor: cursor, remaining: 0, errorKind: 'skipped' as SyncErrorKind, connected: false };
    }

    let query = supabaseAdmin
        .from('shifts')
        .select('id')
        .eq('organization_id', organizationId)
        .is('deleted_at', null)
        .order('id', { ascending: true })
        .limit(limit);
    if (cursor) query = query.gt('id', cursor);

    const { data: shifts } = await query;

    if (!shifts || shifts.length === 0) {
        return { processed: 0, succeeded: 0, failed: 0, nextCursor: cursor, remaining: 0, connected: true, ...emptyGoogleSyncStats() };
    }

    const outcome = await processShiftsSequential(organizationId, shifts, 'sync');
    const nextCursor = shifts[shifts.length - 1].id;

    const { count: remaining } = await supabaseAdmin
        .from('shifts')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', organizationId)
        .is('deleted_at', null)
        .gt('id', nextCursor);

    return {
        processed: shifts.length,
        succeeded: outcome.succeeded,
        failed: outcome.failed,
        nextCursor,
        remaining: remaining || 0,
        ...outcome.stats,
        errorKind: outcome.errorKind,
        connected: true
    };
}

export type RepairGoogleCalendarSyncOptions = {
    limit?: number;
};

export async function repairGoogleCalendarSync(organizationId: string, options: RepairGoogleCalendarSyncOptions = {}) {
    await assertOrgPermission(organizationId, 'staffs');
    const limit = options.limit && Number.isInteger(options.limit) ? Math.min(Math.max(options.limit, 1), 5000) : 5000;

    const { data: orgData } = await supabaseAdmin
        .from('organizations')
        .select('google_calendar_id, google_refresh_token')
        .eq('id', organizationId)
        .single();
    if (!orgData?.google_calendar_id || !orgData?.google_refresh_token) {
        return { processed: 0, succeeded: 0, failed: 0, connected: false, errorKind: 'skipped' as SyncErrorKind, failedIds: [] as string[], ...emptyGoogleSyncStats() };
    }

    const oauth2Client = getGoogleOAuthClient();
    oauth2Client.setCredentials({ refresh_token: decryptGoogleToken(orgData.google_refresh_token) });
    const calendarApi = google.calendar({ version: 'v3', auth: oauth2Client });

    const allEvents = await listAllActiveGoogleEvents(calendarApi, orgData.google_calendar_id);
    const eventsByShiftId = new Map<string, calendar_v3.Schema$Event[]>();
    const legacyEventsBySignature = new Map<string, calendar_v3.Schema$Event[]>();
    for (const event of allEvents) {
        const eventOrgId = getGoogleEventPrivateProp(event, GOOGLE_PROP_ORG_ID);
        const eventShiftId = getGoogleEventPrivateProp(event, GOOGLE_PROP_SHIFT_ID);
        if (eventOrgId === organizationId && eventShiftId) {
            eventsByShiftId.set(eventShiftId, [...(eventsByShiftId.get(eventShiftId) || []), event]);
        } else if (!eventShiftId) {
            const signature = getLegacyEventSignature(event);
            legacyEventsBySignature.set(signature, [...(legacyEventsBySignature.get(signature) || []), event]);
        }
    }

    const { data: shifts } = await supabaseAdmin
        .from('shifts')
        .select('id, title, start_at, end_at, status, cancel_reason, google_event_id, deleted_at, google_sync_status, shift_staffs(staff_id)')
        .eq('organization_id', organizationId)
        .order('id', { ascending: true })
        .limit(limit);

    const stats = emptyGoogleSyncStats();
    let processed = 0;
    let succeeded = 0;
    const failedIds: string[] = [];
    let errorKind: SyncErrorKind | undefined;

    for (const shift of (shifts || []) as ShiftForGoogle[]) {
        processed++;
        try {
            if (shift.deleted_at) {
                const candidates = [...(eventsByShiftId.get(shift.id) || [])];
                if (shift.google_event_id) {
                    const savedEvent = allEvents.find(event => event.id === shift.google_event_id);
                    if (savedEvent && !candidates.some(event => event.id === savedEvent.id)) candidates.push(savedEvent);
                }
                for (const event of candidates) {
                    if (!event.id) continue;
                    const deleted = await deleteGoogleEventIfExists(calendarApi, orgData.google_calendar_id, event.id);
                    if (deleted) stats.deletedRemote++;
                }
                await markShiftGoogleSync(shift.id, 'synced', { eventId: null });
                succeeded++;
                continue;
            }

            const eventBody = buildGoogleEventBody(organizationId, shift);
            const signature = getEventBodySignature(eventBody);
            const candidates = [...(eventsByShiftId.get(shift.id) || [])];

            if (shift.google_event_id) {
                const savedEvent = allEvents.find(event => event.id === shift.google_event_id);
                if (savedEvent && !candidates.some(event => event.id === savedEvent.id)) candidates.push(savedEvent);
            }

            if (candidates.length === 0) {
                const legacyCandidates = legacyEventsBySignature.get(signature) || [];
                candidates.push(...legacyCandidates);
            }

            const primary = choosePrimaryGoogleEvent(candidates, shift.google_event_id);
            if (primary?.id) {
                await withRetry(() => calendarApi.events.update({
                    calendarId: orgData.google_calendar_id!,
                    eventId: primary.id!,
                    requestBody: eventBody,
                }));
                stats.updated++;
                if (primary.id !== shift.google_event_id) stats.linked++;
                const deduped = await deleteDuplicateGoogleEvents(calendarApi, orgData.google_calendar_id, candidates, primary.id);
                stats.deduped += deduped;
                await markShiftGoogleSync(shift.id, 'synced', { eventId: primary.id });
            } else {
                const res = await withRetry(() => calendarApi.events.insert({
                    calendarId: orgData.google_calendar_id!,
                    requestBody: eventBody,
                }));
                if (res.data.id) await markShiftGoogleSync(shift.id, 'synced', { eventId: res.data.id });
                stats.created++;
            }
            succeeded++;
        } catch (e) {
            const se = classifyGoogleError(e);
            await markShiftGoogleSync(shift.id, 'failed', { error: se.message }).catch(console.error);
            failedIds.push(shift.id);
            errorKind = se.kind;
            if (se.kind === 'auth') break;
        }
    }

    return {
        processed,
        succeeded,
        failed: failedIds.length,
        failedIds,
        connected: true,
        errorKind,
        ...stats,
    };
}

// 認可チェックを伴う公開アクション
export async function createShift(payload: ShiftPayload, awaitSync: boolean | 'skip' = true) {
    const actor = await assertOrgPermission(payload.organizationId, 'staffs');
    const result = await createShiftInternal(payload, awaitSync);
    await recordAuditEvent({ organizationId: payload.organizationId, actorId: actor.userId, action: 'shift.create', resourceType: 'shift', resourceId: result.shiftId });
    return result;
}

// 認可チェックを伴わない内部実装（呼び出し元で必ず先に検証すること）
async function createShiftInternal(payload: ShiftPayload, awaitSync: boolean | 'skip' = true) {
    try {
        const { data: shift, error: shiftError } = await supabaseAdmin.from('shifts').insert({
            organization_id: payload.organizationId,
            client_id: payload.clientId,
            title: payload.title,
            start_at: payload.startAt,
            end_at: payload.endAt,
            status: payload.status || 'published',
            pattern_id: payload.patternId || null,
            is_modified: payload.isModified ?? false,
            google_sync_status: 'pending_upsert',
            google_sync_error: null,
            google_synced_at: null
        }).select('id').single();

        if (shiftError || !shift) throw new Error(shiftError?.message);

        if (payload.staffIds.length > 0) {
            const staffInserts: ShiftStaffInsert[] = payload.staffIds.map(sid => ({ shift_id: shift.id, staff_id: sid }));
            await supabaseAdmin.from('shift_staffs').insert(staffInserts);
        }

        if (awaitSync === 'skip') {
            // カレンダーへの同期を意図的に完全にスキップ（一括展開などのパフォーマンス・レート制限対策用）
        } else if (awaitSync) {
            await trySyncSilently(payload.organizationId, shift.id, 'sync');
        } else {
            trySyncSilently(payload.organizationId, shift.id, 'sync');
        }

        return { success: true, shiftId: shift.id };
    } catch (error) { console.error(error); throw error; }
}

// 認可チェックを伴う公開アクション
export async function updateShift(shiftId: string, payload: Partial<ShiftPayload>, awaitSync: boolean | 'skip' = true) {
    const actor = await assertResourceOrgPermission('shifts', shiftId, 'staffs');
    const { organizationId } = actor;
    if (payload.organizationId && payload.organizationId !== organizationId) {
        throw new Error('シフトの事業所は変更できません');
    }
    const result = await updateShiftInternal(shiftId, payload, awaitSync);
    await recordAuditEvent({ organizationId, actorId: actor.userId, action: 'shift.update', resourceType: 'shift', resourceId: shiftId, details: { fields: Object.keys(payload) } });
    return result;
}

// 認可チェックを伴わない内部実装（呼び出し元で必ず先に検証すること）
async function updateShiftInternal(shiftId: string, payload: Partial<ShiftPayload>, awaitSync: boolean | 'skip' = true) {
    try {
        const updateData: ShiftUpdateData = {};
        if (payload.title !== undefined) updateData.title = payload.title;
        if (payload.startAt !== undefined) updateData.start_at = payload.startAt;
        if (payload.endAt !== undefined) updateData.end_at = payload.endAt;
        if (payload.status !== undefined) updateData.status = payload.status;
        if (payload.cancelReason !== undefined) updateData.cancel_reason = payload.cancelReason;

        updateData.is_modified = payload.isModified ?? true;

        if (Object.keys(updateData).length > 0) {
            updateData.updated_at = new Date().toISOString();
            updateData.google_sync_status = 'pending_upsert';
            updateData.google_sync_error = null;
            updateData.google_synced_at = null;
            await supabaseAdmin.from('shifts').update(updateData).eq('id', shiftId);
        }

        if (payload.staffIds !== undefined) {
            await supabaseAdmin.from('shift_staffs').delete().eq('shift_id', shiftId);
            const staffInserts: ShiftStaffInsert[] = payload.staffIds.map(sid => ({ shift_id: shiftId, staff_id: sid }));
            if (staffInserts.length > 0) await supabaseAdmin.from('shift_staffs').insert(staffInserts);
            await supabaseAdmin.from('shifts').update({
                google_sync_status: 'pending_upsert',
                google_sync_error: null,
                google_synced_at: null,
                updated_at: new Date().toISOString(),
            }).eq('id', shiftId);
        }

        const targetOrgId = payload.organizationId || (await supabaseAdmin.from('shifts').select('organization_id').eq('id', shiftId).single()).data?.organization_id;
        if (targetOrgId) {
            if (awaitSync === 'skip') {
                // カレンダーへの同期をスキップ
            } else if (awaitSync) {
                await trySyncSilently(targetOrgId, shiftId, 'sync');
            } else {
                trySyncSilently(targetOrgId, shiftId, 'sync');
            }
        }
        return { success: true };
    } catch (error) { console.error(error); throw error; }
}

export async function updateShiftTimeOnly(shiftId: string, startAt: string, endAt: string) {
    const actor = await assertResourceOrgPermission('shifts', shiftId, 'staffs');
    try {
        await supabaseAdmin.from('shifts').update({
            start_at: startAt,
            end_at: endAt,
            updated_at: new Date().toISOString(),
            is_modified: true,
            google_sync_status: 'pending_upsert',
            google_sync_error: null,
            google_synced_at: null
        }).eq('id', shiftId);

        const { data } = await supabaseAdmin.from('shifts').select('organization_id').eq('id', shiftId).single();
        if (data) await trySyncSilently(data.organization_id, shiftId, 'sync');
        await recordAuditEvent({ organizationId: actor.organizationId, actorId: actor.userId, action: 'shift.time_update', resourceType: 'shift', resourceId: shiftId });
        return { success: true };
    } catch (error) { console.error(error); throw error; }
}

export async function toggleCancelShift(shiftId: string, isCancel: boolean, reason: string = '') {
    const actor = await assertResourceOrgPermission('shifts', shiftId, 'staffs');
    try {
        const status = isCancel ? 'cancelled' : 'published';
        const cancelReason = isCancel ? reason : null;
        await supabaseAdmin.from('shifts').update({
            status,
            cancel_reason: cancelReason,
            updated_at: new Date().toISOString(),
            is_modified: true,
            google_sync_status: 'pending_upsert',
            google_sync_error: null,
            google_synced_at: null
        }).eq('id', shiftId);

        const { data } = await supabaseAdmin.from('shifts').select('organization_id').eq('id', shiftId).single();
        if (data) await trySyncSilently(data.organization_id, shiftId, 'sync');
        await recordAuditEvent({ organizationId: actor.organizationId, actorId: actor.userId, action: isCancel ? 'shift.cancel' : 'shift.reopen', resourceType: 'shift', resourceId: shiftId, reason: isCancel ? reason : null });
        return { success: true };
    } catch (error) { console.error(error); throw error; }
}

export type ShiftQueryFilter = {
    staffId?: string;
    clientId?: string;
};

export async function getShifts(organizationId: string, startDate: string, endDate: string, filter: ShiftQueryFilter = {}) {
    await assertOrgRole(organizationId);
    try {
        const staffRelation = filter.staffId
            ? 'shift_staffs!inner (staff_id, staffs (name))'
            : 'shift_staffs (staff_id, staffs (name))';
        let query = supabaseAdmin.from('shifts').select(`
            id,
            organization_id,
            client_id,
            title,
            start_at,
            end_at,
            status,
            cancel_reason,
            clients (id, name),
            ${staffRelation}
        `).eq('organization_id', organizationId)
            .is('deleted_at', null)
            .gte('start_at', startDate).lte('start_at', endDate)
            .order('start_at', { ascending: false });
        if (filter.staffId) query = query.eq('shift_staffs.staff_id', filter.staffId);
        if (filter.clientId) query = query.eq('client_id', filter.clientId);

        const { data, error } = await query;
        if (error) throw error;
        return data;
    } catch (error) { console.error(error); throw error; }
}

export async function getShiftPatterns(organizationId: string) {
    await assertOrgRole(organizationId);
    const { data, error } = await supabaseAdmin.from('shift_patterns').select(`
        id,
        client_id,
        title,
        start_time,
        end_time,
        rrule,
        clients (id, name),
        shift_pattern_staffs (staff_id, staffs (name))
    `).eq('organization_id', organizationId).is('deleted_at', null).order('start_time', { ascending: true });
    if (error) throw error;
    return data;
}

export async function createShiftPattern(payload: ShiftPatternPayload) {
    const actor = await assertOrgPermission(payload.organizationId, 'staffs');
    const { data: pattern, error } = await supabaseAdmin.from('shift_patterns').insert({
        organization_id: payload.organizationId, client_id: payload.clientId, title: payload.title,
        start_time: payload.startTime, end_time: payload.endTime, rrule: payload.rrule
    }).select('id').single();
    if (error || !pattern) throw error;

    if (payload.staffIds.length > 0) {
        const inserts: PatternStaffInsert[] = payload.staffIds.map(sid => ({ pattern_id: pattern.id, staff_id: sid }));
        await supabaseAdmin.from('shift_pattern_staffs').insert(inserts);
    }
    await recordAuditEvent({ organizationId: payload.organizationId, actorId: actor.userId, action: 'shift_pattern.create', resourceType: 'shift_pattern', resourceId: pattern.id });
    return { success: true };
}

export async function updateShiftPattern(patternId: string, payload: ShiftPatternPayload) {
    const actor = await assertResourceOrgPermission('shift_patterns', patternId, 'staffs');
    try {
        const { error } = await supabaseAdmin.from('shift_patterns').update({
            client_id: payload.clientId,
            title: payload.title,
            start_time: payload.startTime,
            end_time: payload.endTime,
            rrule: payload.rrule,
            updated_at: new Date().toISOString()
        }).eq('id', patternId);
        if (error) throw error;

        await supabaseAdmin.from('shift_pattern_staffs').delete().eq('pattern_id', patternId);

        if (payload.staffIds.length > 0) {
            const inserts: PatternStaffInsert[] = payload.staffIds.map(sid => ({ pattern_id: patternId, staff_id: sid }));
            await supabaseAdmin.from('shift_pattern_staffs').insert(inserts);
        }
        await recordAuditEvent({ organizationId: actor.organizationId, actorId: actor.userId, action: 'shift_pattern.update', resourceType: 'shift_pattern', resourceId: patternId });
        return { success: true };
    } catch (error) {
        console.error('Update Shift Pattern Error:', error);
        throw error;
    }
}

/**
 * 指定したシフトID群を「Googleから削除成功した分のみDB削除」する安全なチャンク削除。
 * クライアントは件数が多い場合に分割して繰り返し呼ぶ（タイムアウト回避）。
 */
export async function deleteShiftsBatch(organizationId: string, shiftIds: string[]) {
    if (!shiftIds || shiftIds.length === 0) return { success: true, deleted: 0, failed: 0, errorKind: undefined as SyncErrorKind | undefined, ...emptyGoogleSyncStats() };
    await assertOrgPermission(organizationId, 'staffs');
    await assertShiftsAccessible(shiftIds);
    try {
        const { data: shifts } = await supabaseAdmin
            .from('shifts')
            .select('id')
            .eq('organization_id', organizationId)
            .in('id', shiftIds);

        if (!shifts || shifts.length === 0) return { success: true, deleted: 0, failed: 0, errorKind: undefined as SyncErrorKind | undefined, ...emptyGoogleSyncStats() };

        const outcome = await processShiftsSequential(organizationId, shifts, 'delete');
        const deletableIds = shifts.map(s => s.id).filter(id => !outcome.failedIds.includes(id));

        if (deletableIds.length > 0) {
            await softDeleteShiftIds(organizationId, deletableIds, 'シフト一括削除');
        }
        return { success: true, deleted: deletableIds.length, failed: outcome.failed, errorKind: outcome.errorKind, ...outcome.stats };
    } catch (error) {
        console.error('Delete Shifts Batch Error:', error);
        throw error;
    }
}

export async function deleteShiftPattern(patternId: string) {
    const actor = await assertResourceOrgPermission('shift_patterns', patternId, 'staffs');
    const policy = await getRetentionPolicy(actor.organizationId, 'shift');
    const { error } = await supabaseAdmin.from('shift_patterns').update({ deleted_at: new Date().toISOString(),
        deleted_by: actor.userId, retention_until: retentionDeadline(policy.years) }).eq('id', patternId).is('deleted_at', null);
    if (error) throw error;
    await recordAuditEvent({ organizationId: actor.organizationId, actorId: actor.userId, action: 'shift_pattern.soft_delete',
        resourceType: 'shift_pattern', resourceId: patternId, reason: '管理者による削除', details: { legalBasis: policy.legalBasis } });
    return { success: true };
}

/**
 * ひな形から1ヶ月分のシフトをプレビュー表示用に計算する (DB書き込みは行わない)
 */
export async function previewShiftsForMonth(organizationId: string, yearMonth: string) {
    await assertOrgRole(organizationId);
    const [year, month] = yearMonth.split('-').map(Number);
    const lastDayNum = new Date(year, month, 0).getDate();

    const startDateJST = buildFloatingDate(year, month, 1, 0, 0);
    const endDateJST = buildFloatingDate(year, month, lastDayNum, 23, 59);

    try {
        const { data: patterns } = await supabaseAdmin.from('shift_patterns').select(`
            *, shift_pattern_staffs(staff_id)
        `).eq('organization_id', organizationId).is('deleted_at', null);

        if (!patterns || patterns.length === 0) return { total: 0, details: [] };

        let totalNewCount = 0;
        const details: { title: string; count: number; isOvernight: boolean }[] = [];

        for (const p of patterns) {
            const [sHour, sMin] = p.start_time.split(':').map(Number);
            const dtStartStr = buildFloatingDate(year, month, 1, sHour, sMin).toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
            const ruleStr = `DTSTART:${dtStartStr}\nRRULE:${p.rrule}`;
            const rule = rrulestr(ruleStr);
            const occurrences = rule.between(startDateJST, endDateJST, true);

            const [eHour, eMin] = p.end_time.split(':').map(Number);
            const isOvernight = eHour * 60 + eMin <= sHour * 60 + sMin;

            let patternCount = 0;
            occurrences.forEach(() => {
                totalNewCount += 1;
                patternCount += 1;
            });

            details.push({
                title: p.title,
                count: patternCount,
                isOvernight
            });
        }

        return {
            total: totalNewCount,
            details
        };
    } catch (e) {
        console.error('Preview Calculation Error:', e);
        throw e;
    }
}

/**
 * ひな形から対象月のシフトを一括生成する
 */
export async function generateShiftsForMonth(organizationId: string, yearMonth: string) {
    await assertOrgPermission(organizationId, 'staffs');
    const [year, month] = yearMonth.split('-').map(Number);
    const lastDayNum = new Date(year, month, 0).getDate();

    const startDateJST = buildFloatingDate(year, month, 1, 0, 0);
    const endDateJST = buildFloatingDate(year, month, lastDayNum, 23, 59);

    try {
        const startSearchISO = new Date(buildJstIsoString(year, month, 1, "00:00")).toISOString();
        const endSearchDate = new Date(buildJstIsoString(year, month, lastDayNum, "23:59"));
        endSearchDate.setDate(endSearchDate.getDate() + 2);
        const endSearchISO = endSearchDate.toISOString();

        const { data: existingShifts } = await supabaseAdmin.from('shifts')
            .select('id, pattern_id, start_at, is_modified')
            .eq('organization_id', organizationId)
            .is('deleted_at', null)
            .not('pattern_id', 'is', null)
            .gte('start_at', startSearchISO)
            .lte('start_at', endSearchISO);

        const existingMap = new Map<string, { id: string, is_modified: boolean }>();
        existingShifts?.forEach(s => {
            const jstDateStr = new Date(new Date(s.start_at).getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
            const key = `${s.pattern_id}::${jstDateStr}`;
            existingMap.set(key, { id: s.id, is_modified: s.is_modified || false });
        });

        const { data: patterns } = await supabaseAdmin.from('shift_patterns').select(`
            *, shift_pattern_staffs(staff_id)
        `).eq('organization_id', organizationId).is('deleted_at', null);

        if (!patterns || patterns.length === 0) return { success: true, count: 0 };

        let createdCount = 0;
        let skippedCount = 0;
        let updatedCount = 0;
        const promises: Promise<unknown>[] = [];

        for (const p of patterns) {
            const [sHour, sMin] = p.start_time.split(':').map(Number);
            const dtStartStr = buildFloatingDate(year, month, 1, sHour, sMin).toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
            const ruleStr = `DTSTART:${dtStartStr}\nRRULE:${p.rrule}`;
            const rule = rrulestr(ruleStr);
            const occurrences = rule.between(startDateJST, endDateJST, true);

            for (const dateJST of occurrences) {
                const yy = dateJST.getUTCFullYear();
                const mm = dateJST.getUTCMonth() + 1;
                const dd = dateJST.getUTCDate();

                const [eHour, eMin] = p.end_time.split(':').map(Number);
                const pad = (n: number) => String(n).padStart(2, '0');
                const isOvernight = eHour * 60 + eMin <= sHour * 60 + sMin;
                const staffIds = p.shift_pattern_staffs.map((s: { staff_id: string }) => s.staff_id);
                const baseJstDateStr = `${yy}-${pad(mm)}-${pad(dd)}`;

                const startAtStr = buildJstIsoString(yy, mm, dd, `${pad(sHour)}:${pad(sMin)}`);
                let endAtStr: string;

                if (isOvernight) {
                    const nextDay = new Date(Date.UTC(yy, mm - 1, dd));
                    nextDay.setUTCDate(nextDay.getUTCDate() + 1);
                    endAtStr = buildJstIsoString(nextDay.getUTCFullYear(), nextDay.getUTCMonth() + 1, nextDay.getUTCDate(), `${pad(eHour)}:${pad(eMin)}`);
                } else {
                    endAtStr = buildJstIsoString(yy, mm, dd, `${pad(eHour)}:${pad(eMin)}`);
                }

                const keyNormal = `${p.id}::${baseJstDateStr}`;
                const payload = {
                    organizationId,
                    clientId: p.client_id,
                    title: p.title,
                    startAt: new Date(startAtStr).toISOString(),
                    endAt: new Date(endAtStr).toISOString(),
                    staffIds: staffIds,
                    status: 'published' as const,
                    isModified: false
                };

                const existNormal = existingMap.get(keyNormal);
                if (existNormal) {
                    if (!existNormal.is_modified) {
                        // org は冒頭で検証済みのため内部実装を直接呼ぶ（多数回の getUser を回避）
                        promises.push(updateShiftInternal(existNormal.id, payload, 'skip'));
                        updatedCount++;
                    } else {
                        skippedCount++;
                    }
                } else {
                    promises.push(createShiftInternal({ ...payload, patternId: p.id }, 'skip'));
                    createdCount++;
                }
            }
        }

        // 部分失敗を握りつぶさず集計する（DB挿入のみ。Google同期は後続のバッチ処理に委ねる）
        const results = await Promise.allSettled(promises);
        const failedCount = results.filter(r => r.status === 'rejected').length;
        if (failedCount > 0) {
            results.forEach(r => { if (r.status === 'rejected') console.error('Generate Shift DB Error:', r.reason); });
        }

        return { success: true, count: createdCount, updated: updatedCount, skipped: skippedCount, failed: failedCount };
    } catch (error) {
        console.error('Generate Shifts Error:', error);
        throw error;
    }
}

export async function deleteShiftCompletely(shiftId: string) {
    const actor = await assertResourceOrgPermission('shifts', shiftId, 'staffs');
    try {
        const { data: shiftData } = await supabaseAdmin
            .from('shifts')
            .select('organization_id')
            .eq('id', shiftId)
            .single();

        if (shiftData) {
            await syncToGoogleCalendarDirect(shiftData.organization_id, shiftId, 'delete');
        }

        const policy = await getRetentionPolicy(actor.organizationId, 'shift');
        const { error } = await supabaseAdmin.from('shifts').update({
            deleted_at: new Date().toISOString(), deleted_by: actor.userId,
            deletion_reason: '管理者による削除', retention_until: retentionDeadline(policy.years),
            google_sync_status: 'synced', google_sync_error: null, google_synced_at: new Date().toISOString(),
        }).eq('id', shiftId).is('deleted_at', null);

        if (error) throw error;
        await recordAuditEvent({ organizationId: actor.organizationId, actorId: actor.userId, action: 'shift.soft_delete', resourceType: 'shift', resourceId: shiftId, reason: '管理者による削除', details: { legalBasis: policy.legalBasis } });
        return { success: true };
    } catch (error) {
        const se = classifyGoogleError(error);
        await markShiftGoogleSync(shiftId, 'failed', { error: se.message }).catch(console.error);
        console.error('Delete Shift Completely Error:', error);
        throw error;
    }
}

/**
 * 単一のシフトをGoogleカレンダーに直接強制同期または削除する
 * （第3引数 action に 'sync' または 'delete' を指定。デフォルトは 'sync'）
 */
export async function syncSingleShift(organizationId: string, shiftId: string, action: 'sync' | 'delete' = 'sync') {
    const resource = await assertResourceOrgPermission('shifts', shiftId, 'staffs');
    if (resource.organizationId !== organizationId) {
        throw new Error('指定された事業所のシフトではありません');
    }
    try {
        await syncToGoogleCalendarDirect(organizationId, shiftId, action);
        return { success: true };
    } catch (error) {
        console.error('Sync Single Shift Action Error:', error);
        throw error;
    }
}

/**
 * Googleカレンダーの同期を伴わず、DBのシフトデータのみを一括削除する（一括消去時のパフォーマンス・エラー防止対策用）
 */
export async function deleteShiftsDbOnly(shiftIds: string[]) {
    await assertShiftsAccessible(shiftIds);
    try {
        const { data: shifts } = await supabaseAdmin.from('shifts').select('id, organization_id').in('id', shiftIds);
        const grouped = new Map<string, { id: string }[]>();
        for (const shift of shifts || []) grouped.set(shift.organization_id, [...(grouped.get(shift.organization_id) || []), { id: shift.id }]);
        for (const [orgId, ids] of grouped) {
            const actor = await assertOrgPermission(orgId, 'staffs');
            const policy = await getRetentionPolicy(orgId, 'shift');
            const targets = (ids || []).map((shift) => shift.id);
            const { error } = await supabaseAdmin.from('shifts').update({
                deleted_at: new Date().toISOString(), deleted_by: actor.userId,
                deletion_reason: 'DB一括削除', retention_until: retentionDeadline(policy.years),
                google_sync_status: 'pending_delete', google_sync_error: null, google_synced_at: null,
            }).in('id', targets).is('deleted_at', null);
            if (error) throw error;
            await recordAuditEvent({ organizationId: orgId, actorId: actor.userId, action: 'shift.bulk_soft_delete', resourceType: 'shift', reason: 'DB一括削除', details: { shiftIds: targets } });
        }
        return { success: true };
    } catch (error) {
        console.error('Delete Shifts DB Only Error:', error);
        throw error;
    }
}

export type MyShiftItem = {
    id: string;
    organization_id: string;
    client_id: string;
    title: string | null;
    start_at: string;
    end_at: string;
    status: string;
    cancel_reason: string | null;
    clients: { id: string; name: string } | null;
    shift_staffs: { staff_id: string; staffs: { name: string } | null }[];
    report: { id: string; status: string } | null;
};

export async function getMyShiftsWithStatus(
    organizationId: string,
    startDate: string,
    endDate: string
): Promise<MyShiftItem[]> {
    const user = await getAuthedUser();

    const { data: staffRow } = await supabaseAdmin
        .from('staffs')
        .select('id')
        .eq('organization_id', organizationId)
        .eq('user_id', user.id)
        .maybeSingle();

    if (!staffRow) return [];

    const { data: shifts, error } = await supabaseAdmin
        .from('shifts')
        .select(`
            id,
            organization_id,
            client_id,
            title,
            start_at,
            end_at,
            status,
            cancel_reason,
            clients (id, name),
            shift_staffs!inner (staff_id, staffs (name))
        `)
        .eq('organization_id', organizationId)
        .eq('shift_staffs.staff_id', staffRow.id)
        .is('deleted_at', null)
        .gte('start_at', startDate)
        .lte('start_at', endDate)
        .order('start_at', { ascending: true });

    if (error) throw error;
    if (!shifts || shifts.length === 0) return [];

    const shiftIds = shifts.map(s => s.id);
    const { data: reports } = await supabaseAdmin
        .from('reports')
        .select('id, shift_id, status')
        .in('shift_id', shiftIds)
        .is('deleted_at', null);

    const reportByShiftId = new Map(
        (reports ?? []).map(r => [r.shift_id, { id: r.id, status: r.status }])
    );

    return (shifts as unknown as Omit<MyShiftItem, 'report'>[]).map(shift => ({
        ...shift,
        report: reportByShiftId.get(shift.id) ?? null,
    }));
}
