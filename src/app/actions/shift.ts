'use server';

import { createClient } from '@supabase/supabase-js';
import { google, calendar_v3 } from 'googleapis';
import { getGoogleOAuthClient } from '@/utils/googleCalendar';
import { rrulestr } from 'rrule';

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
);

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
    google_event_id?: string;
    is_modified?: boolean;
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
        response?: { status?: number; data?: { error?: { message?: string }; error_description?: string } };
        message?: string;
    };
    // Gaxios(googleapis) は HTTP ステータスを response.status に持つ。code は文字列のこともあるため数値のみ採用。
    const raw = err?.response?.status
        ?? (typeof err?.code === 'number' ? err.code : undefined)
        ?? err?.status;
    const code = typeof raw === 'number' ? raw : undefined;
    const msg = err?.response?.data?.error?.message || err?.response?.data?.error_description || err?.message;
    // OAuth のトークン失効は invalid_grant として返ることがある（HTTPコードが付かない場合の保険）
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

/**
 * Googleカレンダーへの同期処理。
 * 失敗時は SyncError を投げる（呼び出し側で握りつぶさず判断できるようにする）。
 * 連携未設定やシフト不在の場合は kind='skipped' の SyncError を投げる。
 */
async function syncToGoogleCalendarDirect(organizationId: string, shiftId: string, action: 'sync' | 'delete') {
    const { data: orgData } = await supabaseAdmin.from('organizations').select('google_calendar_id, google_refresh_token').eq('id', organizationId).single();
    if (!orgData?.google_calendar_id || !orgData?.google_refresh_token) {
        throw new SyncError('Google calendar not connected', 'skipped');
    }

    const { data: shiftData } = await supabaseAdmin.from('shifts').select('id, title, start_at, end_at, status, cancel_reason, google_event_id, shift_staffs(staff_id)').eq('id', shiftId).single();
    if (!shiftData) {
        throw new SyncError('Shift not found', 'skipped');
    }

    const oauth2Client = getGoogleOAuthClient();
    oauth2Client.setCredentials({ refresh_token: orgData.google_refresh_token });
    const calendarApi = google.calendar({ version: 'v3', auth: oauth2Client });

    if (action === 'delete') {
        if (shiftData.google_event_id) {
            try {
                await withRetry(() => calendarApi.events.delete({ calendarId: orgData.google_calendar_id!, eventId: shiftData.google_event_id! }));
            } catch (e: unknown) {
                const se = classifyGoogleError(e);
                // 404/410 はイベントが既に消えている＝削除成功とみなす
                if (se.code !== 404 && se.code !== 410) throw se;
            }
        }
        return;
    }

        const staffIds = (shiftData.shift_staffs || []).map(s => s.staff_id).filter(Boolean);
        let colorId: string | undefined = undefined;

        if (shiftData.status === 'cancelled') colorId = '8';
        else if (staffIds.length > 0 && staffIds[0]) {
            const staffId = staffIds[0];
            let hash = 0;
            for (let i = 0; i < staffId.length; i++) hash = staffId.charCodeAt(i) + ((hash << 5) - hash);
            colorId = ((Math.abs(hash) % 11) + 1).toString();
        }

        const eventTitle = shiftData.status === 'cancelled' ? `【休】${shiftData.title}` : shiftData.title;

        const eventBody: calendar_v3.Schema$Event = {
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
            colorId: colorId
        };

    let newEventId = shiftData.google_event_id;

    if (shiftData.google_event_id) {
        try {
            await withRetry(() => calendarApi.events.update({ calendarId: orgData.google_calendar_id!, eventId: shiftData.google_event_id!, requestBody: eventBody }));
        } catch (e: unknown) {
            const se = classifyGoogleError(e);
            if (se.code === 404) {
                // Googleカレンダー側でイベントが削除済み → 作り直す
                const res = await withRetry(() => calendarApi.events.insert({ calendarId: orgData.google_calendar_id!, requestBody: eventBody }));
                if (res.data.id) newEventId = res.data.id;
            } else throw se;
        }
    } else {
        const res = await withRetry(() => calendarApi.events.insert({ calendarId: orgData.google_calendar_id!, requestBody: eventBody }));
        if (res.data.id) newEventId = res.data.id;
    }

    if (newEventId && newEventId !== shiftData.google_event_id) {
        await supabaseAdmin.from('shifts').update({ google_event_id: newEventId }).eq('id', shiftId);
    }
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
            console.error(`Google Calendar sync (${action}) failed for shift ${shiftId} [${se.kind}]:`, se.message);
        }
    }
}

type BatchOutcome = {
    succeeded: number;
    failed: number;
    failedIds: string[];
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
    let errorKind: SyncErrorKind | undefined;

    for (const shift of shifts) {
        try {
            await syncToGoogleCalendarDirect(organizationId, shift.id, action);
            succeeded++;
        } catch (e) {
            const se = classifyGoogleError(e);
            if (se.kind === 'skipped') { succeeded++; continue; }
            failedIds.push(shift.id);
            errorKind = se.kind;
            if (se.kind === 'auth') break; // 認証切れは継続不可
        }
        if (delayMs > 0) await new Promise(resolve => setTimeout(resolve, delayMs));
    }
    return { succeeded, failed: failedIds.length, failedIds, errorKind };
}

/**
 * 同期ステータス（連携の有無・全件数・未同期件数）を取得する。
 * UIの「同期ステータス」表示やバッチ同期のループ制御に使用する。
 */
export async function getSyncStatus(organizationId: string) {
    const { data: orgData } = await supabaseAdmin
        .from('organizations')
        .select('google_calendar_id, google_refresh_token')
        .eq('id', organizationId)
        .single();

    const connected = !!(orgData?.google_calendar_id && orgData?.google_refresh_token);

    const { count: total } = await supabaseAdmin
        .from('shifts')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', organizationId);

    const { count: unsynced } = await supabaseAdmin
        .from('shifts')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', organizationId)
        .is('google_event_id', null);

    return { connected, total: total || 0, unsynced: unsynced || 0 };
}

/**
 * 未同期（google_event_id IS NULL）のシフトを最大 limit 件だけ同期する。
 * サーバー側で完結する短時間バッチ。残件数を返すので、クライアントは
 * remaining が 0 になるまで繰り返し呼ぶ（タイムアウト回避＆再開可能）。
 */
export async function syncUnsyncedBatch(organizationId: string, limit = 20) {
    const status = await getSyncStatus(organizationId);
    if (!status.connected) {
        return { processed: 0, succeeded: 0, failed: 0, remaining: status.unsynced, errorKind: 'skipped' as SyncErrorKind, connected: false };
    }

    const { data: shifts } = await supabaseAdmin
        .from('shifts')
        .select('id')
        .eq('organization_id', organizationId)
        .is('google_event_id', null)
        .limit(limit);

    if (!shifts || shifts.length === 0) {
        return { processed: 0, succeeded: 0, failed: 0, remaining: 0, connected: true };
    }

    const outcome = await processShiftsSequential(organizationId, shifts, 'sync');

    // 同期後の残件数を再取得（成功分は google_event_id が埋まり減る）
    const { count: remaining } = await supabaseAdmin
        .from('shifts')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', organizationId)
        .is('google_event_id', null);

    return {
        processed: shifts.length,
        succeeded: outcome.succeeded,
        failed: outcome.failed,
        remaining: remaining || 0,
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
    const status = await getSyncStatus(organizationId);
    if (!status.connected) {
        return { processed: 0, succeeded: 0, failed: 0, nextCursor: cursor, remaining: 0, errorKind: 'skipped' as SyncErrorKind, connected: false };
    }

    let query = supabaseAdmin
        .from('shifts')
        .select('id')
        .eq('organization_id', organizationId)
        .order('id', { ascending: true })
        .limit(limit);
    if (cursor) query = query.gt('id', cursor);

    const { data: shifts } = await query;

    if (!shifts || shifts.length === 0) {
        return { processed: 0, succeeded: 0, failed: 0, nextCursor: cursor, remaining: 0, connected: true };
    }

    const outcome = await processShiftsSequential(organizationId, shifts, 'sync');
    const nextCursor = shifts[shifts.length - 1].id;

    const { count: remaining } = await supabaseAdmin
        .from('shifts')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', organizationId)
        .gt('id', nextCursor);

    return {
        processed: shifts.length,
        succeeded: outcome.succeeded,
        failed: outcome.failed,
        nextCursor,
        remaining: remaining || 0,
        errorKind: outcome.errorKind,
        connected: true
    };
}

export async function createShift(payload: ShiftPayload, awaitSync: boolean | 'skip' = true) {
    try {
        const { data: shift, error: shiftError } = await supabaseAdmin.from('shifts').insert({
            organization_id: payload.organizationId,
            client_id: payload.clientId,
            title: payload.title,
            start_at: payload.startAt,
            end_at: payload.endAt,
            status: payload.status || 'published',
            pattern_id: payload.patternId || null,
            is_modified: payload.isModified ?? false
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

export async function updateShift(shiftId: string, payload: Partial<ShiftPayload>, awaitSync: boolean | 'skip' = true) {
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
            await supabaseAdmin.from('shifts').update(updateData).eq('id', shiftId);
        }

        if (payload.staffIds !== undefined) {
            await supabaseAdmin.from('shift_staffs').delete().eq('shift_id', shiftId);
            const staffInserts: ShiftStaffInsert[] = payload.staffIds.map(sid => ({ shift_id: shiftId, staff_id: sid }));
            if (staffInserts.length > 0) await supabaseAdmin.from('shift_staffs').insert(staffInserts);
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
    try {
        await supabaseAdmin.from('shifts').update({
            start_at: startAt,
            end_at: endAt,
            updated_at: new Date().toISOString(),
            is_modified: true
        }).eq('id', shiftId);

        const { data } = await supabaseAdmin.from('shifts').select('organization_id').eq('id', shiftId).single();
        if (data) await trySyncSilently(data.organization_id, shiftId, 'sync');
        return { success: true };
    } catch (error) { console.error(error); throw error; }
}

export async function toggleCancelShift(shiftId: string, isCancel: boolean, reason: string = '') {
    try {
        const status = isCancel ? 'cancelled' : 'published';
        const cancelReason = isCancel ? reason : null;
        await supabaseAdmin.from('shifts').update({
            status,
            cancel_reason: cancelReason,
            updated_at: new Date().toISOString(),
            is_modified: true
        }).eq('id', shiftId);

        const { data } = await supabaseAdmin.from('shifts').select('organization_id').eq('id', shiftId).single();
        if (data) await trySyncSilently(data.organization_id, shiftId, 'sync');
        return { success: true };
    } catch (error) { console.error(error); throw error; }
}

export async function getShifts(organizationId: string, startDate: string, endDate: string) {
    try {
        const { data, error } = await supabaseAdmin.from('shifts').select(`
            *, clients (id, name), shift_staffs (staff_id, staffs (name))
        `).eq('organization_id', organizationId)
            .gte('start_at', startDate).lte('start_at', endDate);
        if (error) throw error;
        return data;
    } catch (error) { console.error(error); throw error; }
}

export async function getShiftPatterns(organizationId: string) {
    const { data, error } = await supabaseAdmin.from('shift_patterns').select(`
        *, clients (id, name), shift_pattern_staffs (staff_id, staffs (name))
    `).eq('organization_id', organizationId);
    if (error) throw error;
    return data;
}

export async function createShiftPattern(payload: ShiftPatternPayload) {
    const { data: pattern, error } = await supabaseAdmin.from('shift_patterns').insert({
        organization_id: payload.organizationId, client_id: payload.clientId, title: payload.title,
        start_time: payload.startTime, end_time: payload.endTime, rrule: payload.rrule
    }).select('id').single();
    if (error || !pattern) throw error;

    if (payload.staffIds.length > 0) {
        const inserts: PatternStaffInsert[] = payload.staffIds.map(sid => ({ pattern_id: pattern.id, staff_id: sid }));
        await supabaseAdmin.from('shift_pattern_staffs').insert(inserts);
    }
    return { success: true };
}

export async function updateShiftPattern(patternId: string, payload: ShiftPatternPayload) {
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
        return { success: true };
    } catch (error) {
        console.error('Update Shift Pattern Error:', error);
        throw error;
    }
}

/**
 * 月次で一括展開されたシフトを消去する
 */
export async function clearGeneratedShiftsForMonth(
    organizationId: string,
    yearMonth: string,
    unmodifiedOnly: boolean = true
) {
    const [year, month] = yearMonth.split('-').map(Number);
    const lastDayNum = new Date(year, month, 0).getDate();

    const startDateISO = new Date(buildJstIsoString(year, month, 1, "00:00")).toISOString();
    const endDateISO = new Date(buildJstIsoString(year, month, lastDayNum, "23:59")).toISOString();

    try {
        let query = supabaseAdmin.from('shifts')
            .select('id')
            .eq('organization_id', organizationId)
            .not('pattern_id', 'is', null)
            .or(`and(start_at.gte.${startDateISO},start_at.lte.${endDateISO})`);

        if (unmodifiedOnly) {
            query = query.eq('is_modified', false);
        }

        const { data: shifts, error } = await query;
        if (error) throw error;
        if (!shifts || shifts.length === 0) return { success: true, count: 0 };

        const shiftIds = shifts.map(s => s.id);

        // Googleカレンダーからの削除に成功（または不要）だったものだけをDBから削除する。
        // 失敗分はDBに残し、未削除として再試行できるようにする（Google側に孤児イベントを残さない）。
        const outcome = await processShiftsSequential(organizationId, shifts, 'delete');
        const deletableIds = shiftIds.filter(id => !outcome.failedIds.includes(id));

        if (deletableIds.length > 0) {
            const { error: deleteError } = await supabaseAdmin.from('shifts')
                .delete()
                .in('id', deletableIds);
            if (deleteError) throw deleteError;
        }

        return { success: true, count: deletableIds.length, failed: outcome.failed, errorKind: outcome.errorKind };
    } catch (error) {
        console.error('Clear Deployed Shifts Error:', error);
        throw error;
    }
}

/**
 * 指定したシフトID群を「Googleから削除成功した分のみDB削除」する安全なチャンク削除。
 * クライアントは件数が多い場合に分割して繰り返し呼ぶ（タイムアウト回避）。
 */
export async function deleteShiftsBatch(organizationId: string, shiftIds: string[]) {
    if (!shiftIds || shiftIds.length === 0) return { success: true, deleted: 0, failed: 0 };
    try {
        const { data: shifts } = await supabaseAdmin
            .from('shifts')
            .select('id')
            .eq('organization_id', organizationId)
            .in('id', shiftIds);

        if (!shifts || shifts.length === 0) return { success: true, deleted: 0, failed: 0 };

        const outcome = await processShiftsSequential(organizationId, shifts, 'delete');
        const deletableIds = shifts.map(s => s.id).filter(id => !outcome.failedIds.includes(id));

        if (deletableIds.length > 0) {
            const { error: deleteError } = await supabaseAdmin.from('shifts').delete().in('id', deletableIds);
            if (deleteError) throw deleteError;
        }
        return { success: true, deleted: deletableIds.length, failed: outcome.failed, errorKind: outcome.errorKind };
    } catch (error) {
        console.error('Delete Shifts Batch Error:', error);
        throw error;
    }
}

export async function deleteShiftPattern(patternId: string) {
    const { error } = await supabaseAdmin.from('shift_patterns').delete().eq('id', patternId);
    if (error) throw error;
    return { success: true };
}

/**
 * ひな形から1ヶ月分のシフトをプレビュー表示用に計算する (DB書き込みは行わない)
 */
export async function previewShiftsForMonth(organizationId: string, yearMonth: string) {
    const [year, month] = yearMonth.split('-').map(Number);
    const lastDayNum = new Date(year, month, 0).getDate();

    const startDateJST = buildFloatingDate(year, month, 1, 0, 0);
    const endDateJST = buildFloatingDate(year, month, lastDayNum, 23, 59);

    try {
        const { data: patterns } = await supabaseAdmin.from('shift_patterns').select(`
            *, shift_pattern_staffs(staff_id)
        `).eq('organization_id', organizationId);

        if (!patterns || patterns.length === 0) return { total: 0, details: [] };

        let totalNewCount = 0;
        const details: { title: string; count: number; isOvernight: boolean }[] = [];

        for (const p of patterns) {
            const [sHour, sMin] = p.start_time.split(':').map(Number);
            const dtStartStr = buildFloatingDate(year, month, 1, sHour, sMin).toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
            const ruleStr = `DTSTART:${dtStartStr}\nRRULE:${p.rrule}`;
            const rule = rrulestr(ruleStr);
            const occurrences = rule.between(startDateJST, endDateJST, true);

            const [eHour] = p.end_time.split(':').map(Number);
            const isOvernight = eHour < sHour;

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
        `).eq('organization_id', organizationId);

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
                const isOvernight = eHour < sHour;
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
                        promises.push(updateShift(existNormal.id, payload, 'skip'));
                        updatedCount++;
                    } else {
                        skippedCount++;
                    }
                } else {
                    promises.push(createShift({ ...payload, patternId: p.id }, 'skip'));
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
    try {
        const { data: shiftData } = await supabaseAdmin
            .from('shifts')
            .select('organization_id')
            .eq('id', shiftId)
            .single();

        if (shiftData) {
            await trySyncSilently(shiftData.organization_id, shiftId, 'delete');
        }

        const { error } = await supabaseAdmin
            .from('shifts')
            .delete()
            .eq('id', shiftId);

        if (error) throw error;
        return { success: true };
    } catch (error) {
        console.error('Delete Shift Completely Error:', error);
        throw error;
    }
}

export async function deleteShiftsBulk(shiftIds: string[]) {
    try {
        const { data: shiftsData } = await supabaseAdmin
            .from('shifts')
            .select('id, organization_id')
            .in('id', shiftIds);

        if (!shiftsData || shiftsData.length === 0) return { success: true, deleted: 0, failed: 0 };

        // 組織ごとにまとめて安全削除（Google削除成功分のみDB削除）
        const byOrg = new Map<string, string[]>();
        for (const s of shiftsData) {
            const list = byOrg.get(s.organization_id) || [];
            list.push(s.id);
            byOrg.set(s.organization_id, list);
        }

        let deleted = 0;
        let failed = 0;
        let errorKind: SyncErrorKind | undefined;
        for (const [orgId, ids] of byOrg) {
            const outcome = await processShiftsSequential(orgId, ids.map(id => ({ id })), 'delete');
            const deletableIds = ids.filter(id => !outcome.failedIds.includes(id));
            if (deletableIds.length > 0) {
                const { error } = await supabaseAdmin.from('shifts').delete().in('id', deletableIds);
                if (error) throw error;
            }
            deleted += deletableIds.length;
            failed += outcome.failed;
            if (outcome.errorKind) errorKind = outcome.errorKind;
        }
        return { success: true, deleted, failed, errorKind };
    } catch (error) {
        console.error('Delete Shifts Bulk Error:', error);
        throw error;
    }
}

/**
 * 単一のシフトをGoogleカレンダーに直接強制同期または削除する
 * （第3引数 action に 'sync' または 'delete' を指定。デフォルトは 'sync'）
 */
export async function syncSingleShift(organizationId: string, shiftId: string, action: 'sync' | 'delete' = 'sync') {
    try {
        await syncToGoogleCalendarDirect(organizationId, shiftId, action);
        return { success: true };
    } catch (error) {
        console.error('Sync Single Shift Action Error:', error);
        throw error;
    }
}

/**
 * 未同期（google_event_id IS NULL）のシフトを抽出し、Googleカレンダーへ一括再同期する
 */
export async function repairUnsyncedShifts(organizationId: string) {
    try {
        // google_event_id が登録されていないシフトを検索
        const { data: unsyncedShifts, error } = await supabaseAdmin
            .from('shifts')
            .select('id')
            .eq('organization_id', organizationId)
            .is('google_event_id', null);

        if (error) throw error;
        if (!unsyncedShifts || unsyncedShifts.length === 0) {
            return { success: true, count: 0, failed: 0 };
        }

        const outcome = await processShiftsSequential(organizationId, unsyncedShifts, 'sync');
        return { success: true, count: outcome.succeeded, failed: outcome.failed, errorKind: outcome.errorKind };
    } catch (error) {
        console.error('Repair Unsynced Shifts Error:', error);
        throw error;
    }
}

/**
 * 登録されている全てのシフト（google_event_idの有無に関わらず）を抽出し、Googleカレンダーへ強制的に全件再同期する
 */
export async function forceSyncAllShifts(organizationId: string) {
    try {
        // google_event_id の有無にかかわらず、全てのシフトを検索
        const { data: allShifts, error } = await supabaseAdmin
            .from('shifts')
            .select('id')
            .eq('organization_id', organizationId);

        if (error) throw error;
        if (!allShifts || allShifts.length === 0) {
            return { success: true, count: 0, failed: 0 };
        }

        const outcome = await processShiftsSequential(organizationId, allShifts, 'sync');
        return { success: true, count: outcome.succeeded, failed: outcome.failed, errorKind: outcome.errorKind };
    } catch (error) {
        console.error('Force Sync All Shifts Error:', error);
        throw error;
    }
}

/**
 * Googleカレンダーの同期を伴わず、DBのシフトデータのみを一括削除する（一括消去時のパフォーマンス・エラー防止対策用）
 */
export async function deleteShiftsDbOnly(shiftIds: string[]) {
    try {
        const { error } = await supabaseAdmin
            .from('shifts')
            .delete()
            .in('id', shiftIds);

        if (error) throw error;
        return { success: true };
    } catch (error) {
        console.error('Delete Shifts DB Only Error:', error);
        throw error;
    }
}