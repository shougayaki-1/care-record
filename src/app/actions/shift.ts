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
    organizationId: string; clientId: string; title: string;
    startAt: string; endAt: string;
    staffIds: string[]; 
    status?: 'published' | 'cancelled';
    cancelReason?: string;
};

export type ShiftPatternPayload = {
    organizationId: string; clientId: string; title: string;
    startTime: string; endTime: string; rrule: string;
    staffIds: string[];
};

type ShiftStaffInsert = { shift_id: string; staff_id: string; };
type PatternStaffInsert = { pattern_id: string; staff_id: string; };

type ShiftUpdateData = {
    title?: string; start_at?: string; end_at?: string;
    status?: 'published' | 'cancelled'; cancel_reason?: string | null;
    updated_at?: string; google_event_id?: string;
};

async function syncToGoogleCalendarDirect(organizationId: string, shiftId: string, action: 'sync' | 'delete') {
    try {
        const { data: orgData } = await supabaseAdmin.from('organizations').select('google_calendar_id, google_refresh_token').eq('id', organizationId).single();
        if (!orgData?.google_calendar_id || !orgData?.google_refresh_token) return;

        const { data: shiftData } = await supabaseAdmin.from('shifts').select('id, title, start_at, end_at, status, cancel_reason, google_event_id, shift_staffs(staff_id)').eq('id', shiftId).single();
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
    } catch (error) { console.error('Google Calendar Direct Sync Error:', error); }
}

export async function createShift(payload: ShiftPayload) {
    try {
        const { data: shift, error: shiftError } = await supabaseAdmin.from('shifts').insert({
            organization_id: payload.organizationId, client_id: payload.clientId, title: payload.title,
            start_at: payload.startAt, end_at: payload.endAt, status: payload.status || 'published'
        }).select('id').single();

        if (shiftError || !shift) throw new Error(shiftError?.message);

        if (payload.staffIds.length > 0) {
            const staffInserts: ShiftStaffInsert[] = payload.staffIds.map(sid => ({ shift_id: shift.id, staff_id: sid }));
            await supabaseAdmin.from('shift_staffs').insert(staffInserts);
        }

        await syncToGoogleCalendarDirect(payload.organizationId, shift.id, 'sync');
        return { success: true, shiftId: shift.id };
    } catch (error) { console.error(error); throw error; }
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
    } catch (error) { console.error(error); throw error; }
}

export async function updateShiftTimeOnly(shiftId: string, startAt: string, endAt: string) {
    try {
        await supabaseAdmin.from('shifts').update({ start_at: startAt, end_at: endAt, updated_at: new Date().toISOString() }).eq('id', shiftId);
        const { data } = await supabaseAdmin.from('shifts').select('organization_id').eq('id', shiftId).single();
        if (data) await syncToGoogleCalendarDirect(data.organization_id, shiftId, 'sync');
        return { success: true };
    } catch (error) { console.error(error); throw error; }
}

export async function toggleCancelShift(shiftId: string, isCancel: boolean, reason: string = '') {
    try {
        const status = isCancel ? 'cancelled' : 'published';
        const cancelReason = isCancel ? reason : null;
        await supabaseAdmin.from('shifts').update({ status, cancel_reason: cancelReason, updated_at: new Date().toISOString() }).eq('id', shiftId);
        const { data } = await supabaseAdmin.from('shifts').select('organization_id').eq('id', shiftId).single();
        if (data) await syncToGoogleCalendarDirect(data.organization_id, shiftId, 'sync');
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

export async function deleteShiftPattern(patternId: string) {
    const { error } = await supabaseAdmin.from('shift_patterns').delete().eq('id', patternId);
    if (error) throw error;
    return { success: true };
}

export async function generateShiftsForMonth(organizationId: string, yearMonth: string) {
    const [year, month] = yearMonth.split('-').map(Number);
    const startDate = new Date(year, month - 1, 1, 0, 0, 0);
    const endDate = new Date(year, month, 0, 23, 59, 59);

    try {
        const { data: patterns } = await supabaseAdmin.from('shift_patterns').select(`
            *, shift_pattern_staffs(staff_id)
        `).eq('organization_id', organizationId);

        if (!patterns || patterns.length === 0) return { success: true, count: 0 };

        let createdCount = 0;

        for (const p of patterns) {
            const dtStartStr = startDate.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
            const ruleStr = `DTSTART:${dtStartStr}\nRRULE:${p.rrule}`;
            const rule = rrulestr(ruleStr);
            const occurrences = rule.between(startDate, endDate, true);

            for (const date of occurrences) {
                const [sHour, sMin] = p.start_time.split(':').map(Number);
                const [eHour, eMin] = p.end_time.split(':').map(Number);
                
                const startAt = new Date(date);
                startAt.setHours(sHour, sMin, 0, 0);
                
                const endAt = new Date(date);
                endAt.setHours(eHour, eMin, 0, 0);
                if (eHour < sHour) endAt.setDate(endAt.getDate() + 1);

                const { data: existing } = await supabaseAdmin.from('shifts')
                    .select('id').eq('pattern_id', p.id)
                    .gte('start_at', new Date(date.setHours(0,0,0,0)).toISOString())
                    .lt('start_at', new Date(date.setHours(23,59,59,999)).toISOString())
                    .maybeSingle();

                if (!existing) {
                    // ★修正：any排除のため、明確な型を指定
                    const staffIds = p.shift_pattern_staffs.map((s: { staff_id: string }) => s.staff_id);
                    // ★修正: isRecurring を削除（単発シフトなので）
                    await createShift({
                        organizationId,
                        clientId: p.client_id,
                        title: p.title,
                        startAt: startAt.toISOString(),
                        endAt: endAt.toISOString(),
                        staffIds: staffIds,
                        status: 'published'
                    });
                    createdCount++;
                }
            }
        }
        return { success: true, count: createdCount };
    } catch (error) {
        console.error('Generate Shifts Error:', error);
        throw error;
    }
}