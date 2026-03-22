'use server';

import { createClient } from '@supabase/supabase-js';
import { google, calendar_v3 } from 'googleapis';
import { getGoogleOAuthClient } from '@/utils/googleCalendar';

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
    isRecurring: boolean;
    rrule?: string;
    staffIds: string[]; // ★新設計：staffsテーブルのIDのみの配列
    status?: 'published' | 'cancelled';
    cancelReason?: string;
    baseShiftId?: string;
};

type ShiftStaffInsert = {
    shift_id: string;
    staff_id: string; // ★新設計
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

async function syncToGoogleCalendarDirect(organizationId: string, shiftId: string, action: 'sync' | 'delete') {
    try {
        const { data: orgData } = await supabaseAdmin.from('organizations').select('google_calendar_id, google_refresh_token').eq('id', organizationId).single();
        if (!orgData?.google_calendar_id || !orgData?.google_refresh_token) return;

        // ★新設計のテーブル構造で取得
        const { data: shiftData } = await supabaseAdmin.from('shifts').select('id, title, start_at, end_at, status, cancel_reason, google_event_id, rrule, shift_staffs(staff_id)').eq('id', shiftId).single();
        if (!shiftData) return;

        const oauth2Client = getGoogleOAuthClient();
        oauth2Client.setCredentials({ refresh_token: orgData.google_refresh_token });
        const calendarApi = google.calendar({ version: 'v3', auth: oauth2Client });

        if (action === 'delete') {
            if (shiftData.google_event_id) {
                try {
                    await calendarApi.events.delete({ calendarId: orgData.google_calendar_id, eventId: shiftData.google_event_id });
                } catch (e: unknown) {
                    const err = e as { code?: number };
                    if (err.code !== 404 && err.code !== 410) throw e;
                }
            }
            return;
        }

        const staffIds = (shiftData.shift_staffs || []).map(s => s.staff_id).filter(Boolean);
        let colorId: string | undefined = undefined;
        
        if (shiftData.status === 'cancelled') {
            colorId = '8'; 
        } else if (staffIds.length > 0 && staffIds[0]) {
            const staffId = staffIds[0];
            let hash = 0;
            for (let i = 0; i < staffId.length; i++) hash = staffId.charCodeAt(i) + ((hash << 5) - hash);
            colorId = ((Math.abs(hash) % 11) + 1).toString();
        }

        const eventTitle = shiftData.status === 'cancelled' ? `【休】${shiftData.title}` : shiftData.title;
        const eventBody: calendar_v3.Schema$Event = {
            summary: eventTitle,
            description: shiftData.cancel_reason ? `キャンセル理由: ${shiftData.cancel_reason}` : '',
            start: { dateTime: shiftData.start_at, timeZone: 'Asia/Tokyo' },
            end: { dateTime: shiftData.end_at, timeZone: 'Asia/Tokyo' },
            colorId: colorId
        };

        let newEventId = shiftData.google_event_id;

        if (shiftData.google_event_id) {
            try {
                await calendarApi.events.update({ calendarId: orgData.google_calendar_id, eventId: shiftData.google_event_id, requestBody: eventBody });
            } catch (e: unknown) {
                const err = e as { code?: number };
                if (err.code === 404) {
                    const res = await calendarApi.events.insert({ calendarId: orgData.google_calendar_id, requestBody: eventBody });
                    if (res.data.id) newEventId = res.data.id;
                } else throw e;
            }
        } else {
            const res = await calendarApi.events.insert({ calendarId: orgData.google_calendar_id, requestBody: eventBody });
            if (res.data.id) newEventId = res.data.id;
        }

        if (newEventId && newEventId !== shiftData.google_event_id) {
            await supabaseAdmin.from('shifts').update({ google_event_id: newEventId }).eq('id', shiftId);
        }
    } catch (error) {
        console.error('Google Calendar Direct Sync Error:', error);
    }
}

export async function createShift(payload: ShiftPayload) {
    try {
        const { data: shift, error: shiftError } = await supabaseAdmin.from('shifts').insert({
            organization_id: payload.organizationId, client_id: payload.clientId, title: payload.title,
            start_at: payload.startAt, end_at: payload.endAt, is_recurring: payload.isRecurring, rrule: payload.rrule || null, status: payload.status || 'published'
        }).select('id').single();

        if (shiftError || !shift) throw new Error(shiftError?.message);

        // ★新設計のインサート
        if (payload.staffIds.length > 0) {
            const staffInserts: ShiftStaffInsert[] = payload.staffIds.map(sid => ({ shift_id: shift.id, staff_id: sid }));
            await supabaseAdmin.from('shift_staffs').insert(staffInserts);
        }

        await syncToGoogleCalendarDirect(payload.organizationId, shift.id, 'sync');
        return { success: true, shiftId: shift.id };
    } catch (error) { console.error('Create Shift Error:', error); throw error; }
}

export async function updateShift(shiftId: string, payload: Partial<ShiftPayload>) {
    try {
        const updateData: ShiftUpdateData = {};
        if (payload.title !== undefined) updateData.title = payload.title;
        if (payload.startAt !== undefined) updateData.start_at = payload.startAt;
        if (payload.endAt !== undefined) updateData.end_at = payload.endAt;
        if (payload.status !== undefined) updateData.status = payload.status;
        if (payload.cancelReason !== undefined) updateData.cancel_reason = payload.cancelReason;

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
        if (targetOrgId) await syncToGoogleCalendarDirect(targetOrgId, shiftId, 'sync');

        return { success: true };
    } catch (error) { console.error('Update Shift Error:', error); throw error; }
}

export async function cancelShift(shiftId: string, reason: string = '') {
    try {
        await supabaseAdmin.from('shifts').update({ status: 'cancelled', cancel_reason: reason, updated_at: new Date().toISOString() }).eq('id', shiftId);
        const { data } = await supabaseAdmin.from('shifts').select('organization_id').eq('id', shiftId).single();
        if (data) await syncToGoogleCalendarDirect(data.organization_id, shiftId, 'sync');
        return { success: true };
    } catch (error) { console.error('Cancel Shift Error:', error); throw error; }
}

export async function getShifts(organizationId: string, startDate: string, endDate: string) {
    try {
        // ★新設計の取得クエリ (shift_staffs -> staffs)
        const { data, error } = await supabaseAdmin.from('shifts').select(`
            *,
            clients (id, name),
            shift_staffs (
                staff_id,
                staffs (name)
            )
        `).eq('organization_id', organizationId)
          .or(`rrule.not.is.null,and(start_at.gte.${startDate},start_at.lte.${endDate})`);

        if (error) throw error;
        return data;
    } catch (error) { console.error('Get Shifts Error:', error); throw error; }
}