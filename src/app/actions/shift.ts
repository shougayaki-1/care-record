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
    patternId?: string;
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

/**
 * 日本時間のISO文字列を生成する補助関数
 * サーバー(UTC)で実行されても確実にJSTの時刻を作る
 */
function toJSTISOString(date: Date | string, timeStr?: string) {
    const d = new Date(date);
    const pad = (n: number) => String(n).padStart(2, '0');
    const yy = d.getFullYear();
    const mm = pad(d.getMonth() + 1);
    const dd = pad(d.getDate());
    
    // timeStrがあればそれを使用、なければdateから取得
    let hh, min;
    if (timeStr) {
        [hh, min] = timeStr.split(':');
    } else {
        hh = pad(d.getHours());
        min = pad(d.getMinutes());
    }
    
    // タイムゾーン+09:00を明示的に付与
    return `${yy}-${mm}-${dd}T${hh}:${min}:00+09:00`;
}

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
        
        // ★修正: Google APIに送る日時に確実にタイムゾーン(Asia/Tokyo)とオフセットを含める
        const eventBody: calendar_v3.Schema$Event = {
            summary: eventTitle,
            description: shiftData.cancel_reason ? `キャンセル理由: ${shiftData.cancel_reason}` : '',
            start: { 
                dateTime: new Date(shiftData.start_at).toISOString(), // DBのUTCをそのまま送る(Z付)
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
            organization_id: payload.organizationId, client_id: payload.clientId, title: payload.title,
            start_at: payload.startAt, end_at: payload.endAt, status: payload.status || 'published',
            pattern_id: payload.patternId || null
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

export async function clearGeneratedShiftsForMonth(organizationId: string, yearMonth: string) {
    const [year, month] = yearMonth.split('-').map(Number);
    const startDateJST = new Date(`${year}-${String(month).padStart(2, '0')}-01T00:00:00+09:00`);
    const endDateJST = new Date(year, month, 0, 23, 59, 59); // 月末
    const endDateISO = toJSTISOString(endDateJST, "23:59");

    try {
        const { data: shifts, error } = await supabaseAdmin.from('shifts')
            .select('id')
            .eq('organization_id', organizationId)
            .not('pattern_id', 'is', null)
            .gte('start_at', startDateJST.toISOString())
            .lte('start_at', new Date(endDateISO).toISOString());

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

export async function generateShiftsForMonth(organizationId: string, yearMonth: string) {
    const [year, month] = yearMonth.split('-').map(Number);
    
    // ★重要: 月の開始・終了を「JSTの午前0時」として定義
    // 文字列から作ることで環境のタイムゾーンに左右されないようにする
    const startDateJST = new Date(`${year}-${String(month).padStart(2, '0')}-01T00:00:00+09:00`);
    const endDateJST = new Date(year, month, 0, 23, 59, 59); // 月末
    const endDateISO = toJSTISOString(endDateJST, "23:59");

    try {
        const { data: patterns } = await supabaseAdmin.from('shift_patterns').select(`
            *, shift_pattern_staffs(staff_id)
        `).eq('organization_id', organizationId);

        if (!patterns || patterns.length === 0) return { success: true, count: 0 };

        let createdCount = 0;
        const promises: Promise<any>[] = [];

        for (const p of patterns) {
            // RRULEの基準日をJSTの開始日に設定
            const dtStartStr = startDateJST.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
            const ruleStr = `DTSTART:${dtStartStr}\nRRULE:${p.rrule}`;
            const rule = rrulestr(ruleStr);
            
            // 指定期間内の該当日を取得（念のため余裕を持たせて前後数時間含めて判定）
            const occurrences = rule.between(startDateJST, new Date(endDateISO), true);

            for (const dateJST of occurrences) {
                // dateJSTはrruleライブラリによって生成されたDateオブジェクト
                const yy = dateJST.getFullYear();
                const mm = dateJST.getMonth() + 1;
                const dd = dateJST.getDate();

                const [sHour, sMin] = p.start_time.split(':').map(Number);
                const [eHour, eMin] = p.end_time.split(':').map(Number);
                
                const pad = (n: number) => String(n).padStart(2, '0');
                const isOvernight = eHour < sHour;
                const staffIds = p.shift_pattern_staffs.map((s: { staff_id: string }) => s.staff_id);

                if (isOvernight) {
                    // overnight split: Part 1 and Part 2
                    // --- Part 1 (Day 1: p.start_time to 00:00 of nextDay) ---
                    const startAtStr1 = `${yy}-${pad(mm)}-${pad(dd)}T${pad(sHour)}:${pad(sMin)}:00+09:00`;
                    
                    const nextDay = new Date(dateJST);
                    nextDay.setDate(nextDay.getDate() + 1);
                    const nextYY = nextDay.getFullYear();
                    const nextMM = nextDay.getMonth() + 1;
                    const nextDD = nextDay.getDate();
                    const endAtStr1 = `${nextYY}-${pad(nextMM)}-${pad(nextDD)}T00:00:00+09:00`;

                    // Check duplicate on Day 1
                    const dayStart = `${yy}-${pad(mm)}-${pad(dd)}T00:00:00+09:00`;
                    const dayEnd = `${yy}-${pad(mm)}-${pad(dd)}T23:59:59+09:00`;

                    const { data: existingPart1 } = await supabaseAdmin.from('shifts')
                        .select('id')
                        .eq('pattern_id', p.id)
                        .gte('start_at', new Date(dayStart).toISOString())
                        .lte('start_at', new Date(dayEnd).toISOString())
                        .maybeSingle();

                    const part1Payload = {
                        organizationId,
                        clientId: p.client_id,
                        title: p.title,
                        startAt: new Date(startAtStr1).toISOString(),
                        endAt: new Date(endAtStr1).toISOString(),
                        staffIds: staffIds,
                        status: 'published' as const,
                    };

                    if (existingPart1) {
                        promises.push(updateShift(existingPart1.id, part1Payload, false));
                    } else {
                        promises.push(createShift({ ...part1Payload, patternId: p.id }, false));
                        createdCount++;
                    }

                    // --- Part 2 (Day 2: 00:00 to p.end_time) ---
                    const startAtStr2 = `${nextYY}-${pad(nextMM)}-${pad(nextDD)}T00:00:00+09:00`;
                    const endAtStr2 = `${nextYY}-${pad(nextMM)}-${pad(nextDD)}T${pad(eHour)}:${pad(eMin)}:00+09:00`;

                    // Check duplicate starting exactly at 00:00 of nextDay JST
                    const targetStart2 = new Date(startAtStr2).toISOString();
                    const { data: existingPart2 } = await supabaseAdmin.from('shifts')
                        .select('id')
                        .eq('pattern_id', p.id)
                        .eq('start_at', targetStart2)
                        .maybeSingle();

                    const part2Payload = {
                        organizationId,
                        clientId: p.client_id,
                        title: p.title,
                        startAt: new Date(startAtStr2).toISOString(),
                        endAt: new Date(endAtStr2).toISOString(),
                        staffIds: staffIds,
                        status: 'published' as const,
                    };

                    if (existingPart2) {
                        promises.push(updateShift(existingPart2.id, part2Payload, false));
                    } else {
                        promises.push(createShift({ ...part2Payload, patternId: p.id }, false));
                        createdCount++;
                    }

                } else {
                    // standard shift
                    const startAtStr = `${yy}-${pad(mm)}-${pad(dd)}T${pad(sHour)}:${pad(sMin)}:00+09:00`;
                    const endAtStr = `${yy}-${pad(mm)}-${pad(dd)}T${pad(eHour)}:${pad(eMin)}:00+09:00`;

                    // Check duplicate on Day 1
                    const dayStart = `${yy}-${pad(mm)}-${pad(dd)}T00:00:00+09:00`;
                    const dayEnd = `${yy}-${pad(mm)}-${pad(dd)}T23:59:59+09:00`;

                    const { data: existing } = await supabaseAdmin.from('shifts')
                        .select('id')
                        .eq('pattern_id', p.id)
                        .gte('start_at', new Date(dayStart).toISOString())
                        .lte('start_at', new Date(dayEnd).toISOString())
                        .maybeSingle();

                    const payload = {
                        organizationId,
                        clientId: p.client_id,
                        title: p.title,
                        startAt: new Date(startAtStr).toISOString(),
                        endAt: new Date(endAtStr).toISOString(),
                        staffIds: staffIds,
                        status: 'published' as const,
                    };

                    if (existing) {
                        promises.push(updateShift(existing.id, payload, false));
                    } else {
                        promises.push(createShift({ ...payload, patternId: p.id }, false));
                        createdCount++;
                    }
                }
            }
        }
        await Promise.all(promises);
        return { success: true, count: createdCount };
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
            Promise.all(deletePromises);
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