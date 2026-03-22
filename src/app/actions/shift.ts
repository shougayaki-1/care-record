// src/app/actions/shift.ts
'use server';

import { createClient } from '@supabase/supabase-js';
import { callGasApi } from './gas'; // GAS呼び出し用の関数をインポート

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
    google_event_id?: string; // カレンダー連携用に追加
};

// --- Googleカレンダー同期用のヘルパー関数 ---
// 組織のgoogle_calendar_idを取得し、GASを叩いて同期する
async function syncToGoogleCalendar(organizationId: string, shiftId: string, action: 'sync' | 'delete') {
    try {
        // 1. 組織のカレンダーIDと、シフトのイベントIDを取得
        const { data: orgData } = await supabaseAdmin
            .from('organizations')
            .select('google_calendar_id')
            .eq('id', organizationId)
            .single();

        if (!orgData?.google_calendar_id) return; // カレンダー連携されていない場合はスキップ

        const { data: shiftData } = await supabaseAdmin
            .from('shifts')
            .select('id, title, start_at, end_at, status, cancel_reason, google_event_id, rrule')
            .eq('id', shiftId)
            .single();

        if (!shiftData) return;

        // 2. 削除（物理削除）の場合
        if (action === 'delete') {
            if (shiftData.google_event_id) {
                await callGasApi({
                    action: 'delete_calendar_event',
                    calendarId: orgData.google_calendar_id,
                    eventId: shiftData.google_event_id
                });
            }
            return;
        }

        // 3. 作成・更新・キャンセルの場合（sync）
        // ※今回はSaaS初期リリースとして、複雑なRRULEはカレンダー側に渡さず「単発の予定」として同期する前提のコードにしています
        const res = await callGasApi({
            action: 'sync_calendar_event',
            calendarId: orgData.google_calendar_id,
            eventId: shiftData.google_event_id || null, // 新規の場合はnull
            title: shiftData.title || '予定',
            startAt: shiftData.start_at,
            endAt: shiftData.end_at,
            isCancelled: shiftData.status === 'cancelled',
            description: shiftData.cancel_reason ? `キャンセル理由: ${shiftData.cancel_reason}` : ''
        });

        // 4. 新規作成でGASからeventIdが返ってきたらDBに保存
        if (res.status === 'success' && res.eventId && !shiftData.google_event_id) {
            await supabaseAdmin
                .from('shifts')
                .update({ google_event_id: res.eventId })
                .eq('id', shiftId);
        }
    } catch (error) {
        console.error('Google Calendar Sync Error:', error);
        // 同期エラーでシフト自体の保存を止めないため、ログ出力のみとする
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

        // ★ Googleカレンダーへ同期
        await syncToGoogleCalendar(organizationId, shift.id, 'sync');

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

        // ★ Googleカレンダーへ同期（organizationIdが必要なため、既存データから取得）
        let targetOrgId = organizationId;
        if (!targetOrgId) {
            const { data } = await supabaseAdmin.from('shifts').select('organization_id').eq('id', shiftId).single();
            if (data) targetOrgId = data.organization_id;
        }
        if (targetOrgId) await syncToGoogleCalendar(targetOrgId, shiftId, 'sync');

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

        // ★ Googleカレンダーへ同期
        const { data } = await supabaseAdmin.from('shifts').select('organization_id').eq('id', shiftId).single();
        if (data) await syncToGoogleCalendar(data.organization_id, shiftId, 'sync');

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