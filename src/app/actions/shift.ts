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
 * Googleカレンダーへの同期処理
 */
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

export async function createShift(payload: ShiftPayload, awaitSync: boolean = true) {
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

        if (awaitSync) {
            await syncToGoogleCalendarDirect(payload.organizationId, shift.id, 'sync');
        } else {
            syncToGoogleCalendarDirect(payload.organizationId, shift.id, 'sync').catch(e => console.error('Async Sync Error:', e));
        }

        return { success: true, shiftId: shift.id };
    } catch (error) { console.error(error); throw error; }
}

export async function updateShift(shiftId: string, payload: Partial<ShiftPayload>, awaitSync: boolean = true) {
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
            if (awaitSync) {
                await syncToGoogleCalendarDirect(targetOrgId, shiftId, 'sync');
            } else {
                syncToGoogleCalendarDirect(targetOrgId, shiftId, 'sync').catch(e => console.error('Async Sync Error:', e));
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
        if (data) await syncToGoogleCalendarDirect(data.organization_id, shiftId, 'sync');
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

        const deletePromises = shifts.map(shift =>
            syncToGoogleCalendarDirect(organizationId, shift.id, 'delete')
                .catch(e => console.error('Clear Month Sync Error:', e))
        );
        await Promise.all(deletePromises);

        const { error: deleteError } = await supabaseAdmin.from('shifts')
            .delete()
            .in('id', shiftIds);

        if (deleteError) throw deleteError;

        return { success: true, count: shifts.length };
    } catch (error) {
        console.error('Clear Deployed Shifts Error:', error);
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
        const details: any[] = [];

        for (const p of patterns) {
            const [sHour, sMin] = p.start_time.split(':').map(Number);
            const dtStartStr = buildFloatingDate(year, month, 1, sHour, sMin).toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
            const ruleStr = `DTSTART:${dtStartStr}\nRRULE:${p.rrule}`;
            const rule = rrulestr(ruleStr);
            const occurrences = rule.between(startDateJST, endDateJST, true);

            const [eHour, eMin] = p.end_time.split(':').map(Number);
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
        const promises: Promise<any>[] = [];

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

                let startAtStr = buildJstIsoString(yy, mm, dd, `${pad(sHour)}:${pad(sMin)}`);
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
                        promises.push(updateShift(existNormal.id, payload, false));
                        updatedCount++;
                    } else {
                        skippedCount++;
                    }
                } else {
                    promises.push(createShift({ ...payload, patternId: p.id }, false));
                    createdCount++;
                }
            }
        }

        await Promise.all(promises);
        return { success: true, count: createdCount, updated: updatedCount, skipped: skippedCount };
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
            await syncToGoogleCalendarDirect(shiftData.organization_id, shiftId, 'delete');
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