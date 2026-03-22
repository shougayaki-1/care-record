// src/app/actions/shift.ts
'use server';

import { createClient } from '@supabase/supabase-js';
import { google, calendar_v3 } from 'googleapis';
import { getGoogleOAuthClient } from '@/utils/googleCalendar';

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
);

// リクエストペイロードの型定義
export type ShiftPayload = {
    organizationId: string;
    clientId: string;
    title: string;
    startAt: string; 
    endAt: string;   
    isRecurring: boolean;
    rrule?: string;
    staffIds: string[];      
    ghostStaffIds: string[]; 
    status?: 'published' | 'cancelled';
    cancelReason?: string;
    baseShiftId?: string;
};

// DB操作用の型定義
type ShiftStaffInsert = {
    shift_id: string;
    user_id: string | null;
    ghost_staff_id: string | null;
};

type ShiftUpdateData = {
    title?: string;
    start_at?: string;
    end_at?: string;
    status?: 'published' | 'cancelled';
    cancel_reason?: string;
    updated_at?: string;
    google_event_id?: string;
};

// --- Google Calendar API 直接同期用のヘルパー関数 ---
async function syncToGoogleCalendarDirect(organizationId: string, shiftId: string, action: 'sync' | 'delete') {
    try {
        // 1. 組織の連携情報（カレンダーIDとリフレッシュトークン）を取得
        const { data: orgData } = await supabaseAdmin
            .from('organizations')
            .select('google_calendar_id, google_refresh_token')
            .eq('id', organizationId)
            .single();

        if (!orgData?.google_calendar_id || !orgData?.google_refresh_token) {
            return; // 連携されていない場合はスキップ
        }

        // 2. シフト情報を取得
        const { data: shiftData } = await supabaseAdmin
            .from('shifts')
            .select(`
                id, title, start_at, end_at, status, cancel_reason, google_event_id, rrule,
                shift_staffs ( user_id, ghost_staff_id )
            `)
            .eq('id', shiftId)
            .single();

        if (!shiftData) return;

        // 3. OAuth クライアントの準備
        const oauth2Client = getGoogleOAuthClient();
        oauth2Client.setCredentials({ refresh_token: orgData.google_refresh_token });
        const calendarApi = google.calendar({ version: 'v3', auth: oauth2Client });

        // 4. 削除（物理削除）の場合
        if (action === 'delete') {
            if (shiftData.google_event_id) {
                try {
                    await calendarApi.events.delete({
                        calendarId: orgData.google_calendar_id,
                        eventId: shiftData.google_event_id
                    });
                } catch (e: unknown) {
                    // ★修正: anyを排除。すでに削除されていた場合のエラー(404, 410)は無視
                    const err = e as { code?: number };
                    if (err.code !== 404 && err.code !== 410) throw e;
                }
            }
            return;
        }

        // 5. 作成・更新・キャンセルの場合（sync）
        
        // 色分けのロジック: 担当スタッフのIDから 1〜11 の colorId を決定する
        const staffIds = (shiftData.shift_staffs || []).map(s => s.user_id || s.ghost_staff_id).filter(Boolean);
        let colorId: string | undefined = undefined;
        
        if (shiftData.status === 'cancelled') {
            colorId = '8'; // キャンセルはグレー(8)に固定
        } else if (staffIds.length > 0 && staffIds[0]) {
            const staffId = staffIds[0];
            let hash = 0;
            for (let i = 0; i < staffId.length; i++) {
                hash = staffId.charCodeAt(i) + ((hash << 5) - hash);
            }
            colorId = ((Math.abs(hash) % 11) + 1).toString();
        }

        const eventTitle = shiftData.status === 'cancelled' ? `【休】${shiftData.title}` : shiftData.title;
        const description = shiftData.cancel_reason ? `キャンセル理由: ${shiftData.cancel_reason}` : '';

        // ★修正: anyを排除し、Google API公式の型を使用
        const eventBody: calendar_v3.Schema$Event = {
            summary: eventTitle,
            description: description,
            start: { dateTime: shiftData.start_at, timeZone: 'Asia/Tokyo' },
            end: { dateTime: shiftData.end_at, timeZone: 'Asia/Tokyo' },
            colorId: colorId
        };

        let newEventId = shiftData.google_event_id;

        if (shiftData.google_event_id) {
            // 更新
            try {
                await calendarApi.events.update({
                    calendarId: orgData.google_calendar_id,
                    eventId: shiftData.google_event_id,
                    requestBody: eventBody
                });
            } catch (e: unknown) {
                // ★修正: anyを排除。万が一Google側で消されていた場合は新規作成にフォールバック
                const err = e as { code?: number };
                if (err.code === 404) {
                    const res = await calendarApi.events.insert({
                        calendarId: orgData.google_calendar_id,
                        requestBody: eventBody
                    });
                    if (res.data.id) newEventId = res.data.id;
                } else {
                    throw e;
                }
            }
        } else {
            // 新規作成
            const res = await calendarApi.events.insert({
                calendarId: orgData.google_calendar_id,
                requestBody: eventBody
            });
            if (res.data.id) newEventId = res.data.id;
        }

        // 6. 新しく作成されて EventID が発行・変更された場合はDBに保存
        if (newEventId && newEventId !== shiftData.google_event_id) {
            await supabaseAdmin
                .from('shifts')
                .update({ google_event_id: newEventId })
                .eq('id', shiftId);
        }
        
    } catch (error) {
        console.error('Google Calendar Direct Sync Error:', error);
        // エラーになってもシフト保存自体は止めない
    }
}

// ==========================================
// 1. シフトの新規作成
// ==========================================
export async function createShift(payload: ShiftPayload) {
    const { organizationId, clientId, title, startAt, endAt, isRecurring, rrule, staffIds, ghostStaffIds, status = 'published' } = payload;

    try {
        const { data: shift, error: shiftError } = await supabaseAdmin
            .from('shifts')
            .insert({
                organization_id: organizationId,
                client_id: clientId,
                title: title,
                start_at: startAt,
                end_at: endAt,
                is_recurring: isRecurring,
                rrule: rrule || null,
                status: status
            })
            .select('id')
            .single();

        if (shiftError || !shift) throw new Error(shiftError?.message || 'シフトの作成に失敗しました');

        const staffInserts: ShiftStaffInsert[] = [];
        staffIds.forEach(userId => {
            staffInserts.push({ shift_id: shift.id, user_id: userId, ghost_staff_id: null });
        });
        ghostStaffIds.forEach(ghostId => {
            staffInserts.push({ shift_id: shift.id, user_id: null, ghost_staff_id: ghostId });
        });

        if (staffInserts.length > 0) {
            const { error: staffError } = await supabaseAdmin.from('shift_staffs').insert(staffInserts);
            if (staffError) throw new Error(staffError.message);
        }

        // API経由でGoogleカレンダーへ同期
        await syncToGoogleCalendarDirect(organizationId, shift.id, 'sync');

        return { success: true, shiftId: shift.id };
    } catch (error) {
        console.error('Create Shift Error:', error);
        throw error;
    }
}

// ==========================================
// 2. シフトの更新（時間や担当者の変更）
// ==========================================
export async function updateShift(shiftId: string, payload: Partial<ShiftPayload>) {
    const { title, startAt, endAt, staffIds, ghostStaffIds, status, cancelReason, organizationId } = payload;

    try {
        const updateData: ShiftUpdateData = {};
        if (title !== undefined) updateData.title = title;
        if (startAt !== undefined) updateData.start_at = startAt;
        if (endAt !== undefined) updateData.end_at = endAt;
        if (status !== undefined) updateData.status = status;
        if (cancelReason !== undefined) updateData.cancel_reason = cancelReason;

        if (Object.keys(updateData).length > 0) {
            updateData.updated_at = new Date().toISOString();
            const { error: shiftError } = await supabaseAdmin.from('shifts').update(updateData).eq('id', shiftId);
            if (shiftError) throw shiftError;
        }

        if (staffIds !== undefined || ghostStaffIds !== undefined) {
            await supabaseAdmin.from('shift_staffs').delete().eq('shift_id', shiftId);
            
            const staffInserts: ShiftStaffInsert[] = [];
            (staffIds || []).forEach(userId => {
                staffInserts.push({ shift_id: shiftId, user_id: userId, ghost_staff_id: null });
            });
            (ghostStaffIds || []).forEach(ghostId => {
                staffInserts.push({ shift_id: shiftId, user_id: null, ghost_staff_id: ghostId });
            });

            if (staffInserts.length > 0) {
                const { error: staffError } = await supabaseAdmin.from('shift_staffs').insert(staffInserts);
                if (staffError) throw staffError;
            }
        }

        // API経由でGoogleカレンダーへ同期
        let targetOrgId = organizationId;
        if (!targetOrgId) {
            const { data } = await supabaseAdmin.from('shifts').select('organization_id').eq('id', shiftId).single();
            if (data) targetOrgId = data.organization_id;
        }
        if (targetOrgId) await syncToGoogleCalendarDirect(targetOrgId, shiftId, 'sync');

        return { success: true };
    } catch (error) {
        console.error('Update Shift Error:', error);
        throw error;
    }
}

// ==========================================
// 3. シフトのキャンセル（論理削除）
// ==========================================
export async function cancelShift(shiftId: string, reason: string = '') {
    try {
        const { error } = await supabaseAdmin
            .from('shifts')
            .update({ 
                status: 'cancelled', 
                cancel_reason: reason,
                updated_at: new Date().toISOString()
            })
            .eq('id', shiftId);

        if (error) throw error;

        // API経由でGoogleカレンダーへ同期
        const { data } = await supabaseAdmin.from('shifts').select('organization_id').eq('id', shiftId).single();
        if (data) await syncToGoogleCalendarDirect(data.organization_id, shiftId, 'sync');

        return { success: true };
    } catch (error) {
        console.error('Cancel Shift Error:', error);
        throw error;
    }
}

// ==========================================
// 4. 特定期間のシフト取得
// ==========================================
export async function getShifts(organizationId: string, startDate: string, endDate: string) {
    try {
        const { data, error } = await supabaseAdmin
            .from('shifts')
            .select(`
                *,
                clients (id, name),
                shift_staffs (
                    user_id,
                    ghost_staff_id,
                    profiles (name),
                    ghost_staffs (name)
                )
            `)
            .eq('organization_id', organizationId)
            .or(`rrule.not.is.null,and(start_at.gte.${startDate},start_at.lte.${endDate})`);

        if (error) throw error;
        return data;
    } catch (error) {
        console.error('Get Shifts Error:', error);
        throw error;
    }
}