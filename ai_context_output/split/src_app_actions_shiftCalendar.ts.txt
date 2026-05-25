'use server';

import { google, calendar_v3 } from 'googleapis';
import { getGoogleOAuthClient } from '@/utils/googleCalendar';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { requireOrgMember } from '@/utils/authCheck';

/**
 * Googleカレンダーへの同期処理（内部関数・他ファイルから呼び出し用）
 */
export async function syncToGoogleCalendarDirect(organizationId: string, shiftId: string, action: 'sync' | 'delete') {
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

export async function syncSingleShift(organizationId: string, shiftId: string, action: 'sync' | 'delete' = 'sync') {
    // 認可チェック (manager以上)
    await requireOrgMember(organizationId, 'manager');

    try {
        await syncToGoogleCalendarDirect(organizationId, shiftId, action);
        return { success: true };
    } catch (error) {
        console.error('Sync Single Shift Action Error:', error);
        throw error;
    }
}

export async function repairUnsyncedShifts(organizationId: string) {
    // 認可チェック (manager以上)
    await requireOrgMember(organizationId, 'manager');

    try {
        const { data: unsyncedShifts, error } = await supabaseAdmin
            .from('shifts')
            .select('id')
            .eq('organization_id', organizationId)
            .is('google_event_id', null);

        if (error) throw error;
        if (!unsyncedShifts || unsyncedShifts.length === 0) {
            return { success: true, count: 0 };
        }

        let successCount = 0;
        for (const shift of unsyncedShifts) {
            try {
                await syncToGoogleCalendarDirect(organizationId, shift.id, 'sync');
                successCount++;
                
                await new Promise(resolve => setTimeout(resolve, 300));
            } catch (syncErr) {
                console.error(`Shift ID ${shift.id} sync failed during repair:`, syncErr);
            }
        }

        return { success: true, count: successCount };
    } catch (error) {
        console.error('Repair Unsynced Shifts Error:', error);
        throw error;
    }
}

export async function forceSyncAllShifts(organizationId: string) {
    // 認可チェック (manager以上)
    await requireOrgMember(organizationId, 'manager');

    try {
        const { data: allShifts, error } = await supabaseAdmin
            .from('shifts')
            .select('id')
            .eq('organization_id', organizationId);

        if (error) throw error;
        if (!allShifts || allShifts.length === 0) {
            return { success: true, count: 0 };
        }

        let successCount = 0;
        for (const shift of allShifts) {
            try {
                await syncToGoogleCalendarDirect(organizationId, shift.id, 'sync');
                successCount++;
                
                await new Promise(resolve => setTimeout(resolve, 300));
            } catch (syncErr) {
                console.error(`Shift ID ${shift.id} sync failed during force resync:`, syncErr);
            }
        }

        return { success: true, count: successCount };
    } catch (error) {
        console.error('Force Sync All Shifts Error:', error);
        throw error;
    }
}