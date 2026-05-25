'use server';

import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { requireOrgMember } from '@/utils/authCheck';
import { syncToGoogleCalendarDirect } from './shiftCalendar';
import { ShiftPayload } from '@/types';

type ShiftStaffInsert = { shift_id: string; staff_id: string; };

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

export async function createShift(payload: ShiftPayload, awaitSync: boolean | 'skip' = true) {
    // 認可チェック (manager以上)
    await requireOrgMember(payload.organizationId, 'manager');

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
            // 同期を明示的スキップ
        } else if (awaitSync) {
            await syncToGoogleCalendarDirect(payload.organizationId, shift.id, 'sync');
        } else {
            syncToGoogleCalendarDirect(payload.organizationId, shift.id, 'sync').catch(e => console.error('Async Sync Error:', e));
        }

        return { success: true, shiftId: shift.id };
    } catch (error) { console.error(error); throw error; }
}

export async function updateShift(shiftId: string, payload: Partial<ShiftPayload>, awaitSync: boolean | 'skip' = true) {
    let targetOrgId = payload.organizationId;
    if (!targetOrgId) {
        const { data } = await supabaseAdmin.from('shifts').select('organization_id').eq('id', shiftId).single();
        targetOrgId = data?.organization_id;
    }
    if (!targetOrgId) throw new Error('事業所IDが特定できません。');

    // 認可チェック (manager以上)
    await requireOrgMember(targetOrgId, 'manager');

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

        if (awaitSync === 'skip') {
            // スキップ
        } else if (awaitSync) {
            await syncToGoogleCalendarDirect(targetOrgId, shiftId, 'sync');
        } else {
            syncToGoogleCalendarDirect(targetOrgId, shiftId, 'sync').catch(e => console.error('Async Sync Error:', e));
        }
        return { success: true };
    } catch (error) { console.error(error); throw error; }
}

export async function updateShiftTimeOnly(shiftId: string, startAt: string, endAt: string) {
    const { data } = await supabaseAdmin.from('shifts').select('organization_id').eq('id', shiftId).single();
    if (!data?.organization_id) throw new Error('対象シフトが存在しません。');

    // 認可チェック (manager以上)
    await requireOrgMember(data.organization_id, 'manager');

    try {
        await supabaseAdmin.from('shifts').update({
            start_at: startAt,
            end_at: endAt,
            updated_at: new Date().toISOString(),
            is_modified: true
        }).eq('id', shiftId);

        await syncToGoogleCalendarDirect(data.organization_id, shiftId, 'sync');
        return { success: true };
    } catch (error) { console.error(error); throw error; }
}

export async function toggleCancelShift(shiftId: string, isCancel: boolean, reason: string = '') {
    const { data } = await supabaseAdmin.from('shifts').select('organization_id').eq('id', shiftId).single();
    if (!data?.organization_id) throw new Error('対象シフトが存在しません。');

    // 認可チェック (manager以上)
    await requireOrgMember(data.organization_id, 'manager');

    try {
        const status = isCancel ? 'cancelled' : 'published';
        const cancelReason = isCancel ? reason : null;
        await supabaseAdmin.from('shifts').update({
            status,
            cancel_reason: cancelReason,
            updated_at: new Date().toISOString(),
            is_modified: true
        }).eq('id', shiftId);

        await syncToGoogleCalendarDirect(data.organization_id, shiftId, 'sync');
        return { success: true };
    } catch (error) { console.error(error); throw error; }
}

export async function getShifts(organizationId: string, startDate: string, endDate: string) {
    // 認可チェック (一般スタッフ以上なら誰でも閲覧可能)
    await requireOrgMember(organizationId, 'staff');

    try {
        const { data, error } = await supabaseAdmin.from('shifts').select(`
            *, clients (id, name), shift_staffs (staff_id, staffs (name))
        `).eq('organization_id', organizationId)
            .gte('start_at', startDate).lte('start_at', endDate);
        if (error) throw error;
        return data;
    } catch (error) { console.error(error); throw error; }
}

export async function deleteShiftCompletely(shiftId: string) {
    const { data: shiftData } = await supabaseAdmin.from('shifts').select('organization_id').eq('id', shiftId).single();
    if (!shiftData?.organization_id) throw new Error('対象のシフトが存在しません。');

    // 認可チェック (manager以上)
    await requireOrgMember(shiftData.organization_id, 'manager');

    try {
        await syncToGoogleCalendarDirect(shiftData.organization_id, shiftId, 'delete');

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
    if (shiftIds.length === 0) return { success: true };
    
    // 代表して最初の1件から組織IDを引いて権限チェック
    const { data: shiftData } = await supabaseAdmin.from('shifts').select('organization_id').eq('id', shiftIds[0]).single();
    if (!shiftData?.organization_id) throw new Error('対象のシフトが存在しないか、不正なIDです。');

    // 認可チェック (manager以上)
    await requireOrgMember(shiftData.organization_id, 'manager');

    try {
        const { data: shiftsData } = await supabaseAdmin
            .from('shifts')
            .select('id, organization_id')
            .in('id', shiftIds);

        if (shiftsData) {
            const deletePromises = shiftsData.map(shift =>
                syncToGoogleCalendarDirect(shift.organization_id, shift.id, 'delete')
                    .catch(e => console.error('Bulk Delete Sync Error:', e))
            );
            await Promise.all(deletePromises);
        }

        const { error } = await supabaseAdmin
            .from('shifts')
            .delete()
            .in('id', shiftIds);

        if (error) throw error;
        return { success: true };
    } catch (error) {
        console.error('Delete Shifts Bulk Error:', error);
        throw error;
    }
}

export async function deleteShiftsDbOnly(shiftIds: string[]) {
    if (shiftIds.length === 0) return { success: true };

    const { data: shiftData } = await supabaseAdmin.from('shifts').select('organization_id').eq('id', shiftIds[0]).single();
    if (!shiftData?.organization_id) throw new Error('不正なシフトデータです。');

    // 認可チェック (manager以上)
    await requireOrgMember(shiftData.organization_id, 'manager');

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