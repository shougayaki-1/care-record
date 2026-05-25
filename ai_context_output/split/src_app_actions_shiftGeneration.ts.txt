'use server';

import { rrulestr } from 'rrule';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { requireOrgMember } from '@/utils/authCheck';
import { ShiftPatternPayload } from '@/types';
import { createShift, updateShift } from './shift';
import { syncToGoogleCalendarDirect } from './shiftCalendar';

type PatternStaffInsert = { pattern_id: string; staff_id: string; };

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

export async function getShiftPatterns(organizationId: string) {
    // 認可チェック (staff以上)
    await requireOrgMember(organizationId, 'staff');

    const { data, error } = await supabaseAdmin.from('shift_patterns').select(`
        *, clients (id, name), shift_pattern_staffs (staff_id, staffs (name))
    `).eq('organization_id', organizationId);
    if (error) throw error;
    return data;
}

export async function createShiftPattern(payload: ShiftPatternPayload) {
    // 認可チェック (manager以上)
    await requireOrgMember(payload.organizationId, 'manager');

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
    // 認可チェック (manager以上)
    await requireOrgMember(payload.organizationId, 'manager');

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

export async function deleteShiftPattern(patternId: string) {
    const { data } = await supabaseAdmin.from('shift_patterns').select('organization_id').eq('id', patternId).single();
    if (!data?.organization_id) throw new Error('対象のひな形パターンが存在しません。');

    // 認可チェック (manager以上)
    await requireOrgMember(data.organization_id, 'manager');

    const { error } = await supabaseAdmin.from('shift_patterns').delete().eq('id', patternId);
    if (error) throw error;
    return { success: true };
}

export async function previewShiftsForMonth(organizationId: string, yearMonth: string) {
    // 認可チェック (staff以上)
    await requireOrgMember(organizationId, 'staff');

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

export async function generateShiftsForMonth(organizationId: string, yearMonth: string) {
    // 認可チェック (manager以上)
    await requireOrgMember(organizationId, 'manager');

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

        await Promise.all(promises);
        return { success: true, count: createdCount, updated: updatedCount, skipped: skippedCount };
    } catch (error) {
        console.error('Generate Shifts Error:', error);
        throw error;
    }
}

export async function clearGeneratedShiftsForMonth(
    organizationId: string,
    yearMonth: string,
    unmodifiedOnly: boolean = true
) {
    // 認可チェック (manager以上)
    await requireOrgMember(organizationId, 'manager');

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

        const { error: deleteError = null } = await supabaseAdmin.from('shifts')
            .delete()
            .in('id', shiftIds);

        if (deleteError) throw deleteError;

        return { success: true, count: shifts.length };
    } catch (error) {
        console.error('Clear Deployed Shifts Error:', error);
        throw error;
    }
}