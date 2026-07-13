'use server';

import { rrulestr } from 'rrule';

import { withSafeError } from '@/utils/errors';
import { buildFloatingDate, buildJstIsoString } from '@/utils/googleSync';
import {
  buildPatternRuleString,
  computeOccurrenceDateTimes,
  isOvernightShift,
  jstDateStrFromOccurrence,
  jstDateStrFromStartAt,
  patternDateKey,
} from '@/utils/shiftRecurrence';
import { assertShiftPermission, supabaseAdmin } from '@/utils/supabase/auth';

import {
  createShiftInternal,
  saveShiftSegmentsFromPattern,
  updateShiftInternal,
  type PatternSegmentRow,
} from './internal';

/**
 * ひな形から1ヶ月分のシフトをプレビュー表示用に計算する (DB書き込みは行わない)
 */
export async function previewShiftsForMonth(organizationId: string, yearMonth: string) {
  return withSafeError('previewShiftsForMonth', async () => {
      await assertShiftPermission(organizationId, 'view', { requireAllScope: true });
      const [year, month] = yearMonth.split('-').map(Number);
      const lastDayNum = new Date(year, month, 0).getDate();

      const startDateJST = buildFloatingDate(year, month, 1, 0, 0);
      const endDateJST = buildFloatingDate(year, month, lastDayNum, 23, 59);

      try {
          const { data: patterns } = await supabaseAdmin.from('shift_patterns').select(`
              *,
              shift_pattern_staffs(staff_id),
              shift_pattern_segments(
                  id,
                  pattern_id,
                  service_type_id,
                  start_time,
                  end_time,
                  sort_order,
                  shift_pattern_segment_staffs(staff_id, staff_role_id)
              )
          `).eq('organization_id', organizationId).is('deleted_at', null);

          if (!patterns || patterns.length === 0) return { total: 0, details: [] };

          let totalNewCount = 0;
          const details: { title: string; count: number; isOvernight: boolean }[] = [];

          for (const p of patterns) {
              const ruleStr = buildPatternRuleString(year, month, p.start_time, p.rrule);
              const rule = rrulestr(ruleStr);
              const occurrences = rule.between(startDateJST, endDateJST, true);

              const isOvernight = isOvernightShift(p.start_time, p.end_time);

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
  });
}

/**
 * ひな形から対象月のシフトを一括生成する
 */
export async function generateShiftsForMonth(organizationId: string, yearMonth: string) {
  return withSafeError('generateShiftsForMonth', async () => {
      await assertShiftPermission(organizationId, 'create', { requireAllScope: true });
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
              .is('deleted_at', null)
              .not('pattern_id', 'is', null)
              .gte('start_at', startSearchISO)
              .lte('start_at', endSearchISO);

          const existingMap = new Map<string, { id: string, is_modified: boolean }>();
          existingShifts?.forEach(s => {
              const key = patternDateKey(s.pattern_id, jstDateStrFromStartAt(s.start_at));
              existingMap.set(key, { id: s.id, is_modified: s.is_modified || false });
          });

          const { data: patterns } = await supabaseAdmin.from('shift_patterns').select(`
              *,
              shift_pattern_staffs(staff_id),
              shift_pattern_segments(
                  id,
                  pattern_id,
                  service_type_id,
                  start_time,
                  end_time,
                  sort_order,
                  shift_pattern_segment_staffs(staff_id, staff_role_id)
              )
          `).eq('organization_id', organizationId).is('deleted_at', null);

          if (!patterns || patterns.length === 0) return { success: true, count: 0 };

          let createdCount = 0;
          let skippedCount = 0;
          let updatedCount = 0;
          const tasks: Array<() => Promise<unknown>> = [];

          for (const p of patterns) {
              const ruleStr = buildPatternRuleString(year, month, p.start_time, p.rrule);
              const rule = rrulestr(ruleStr);
              const occurrences = rule.between(startDateJST, endDateJST, true);

              for (const dateJST of occurrences) {
                  const yy = dateJST.getUTCFullYear();
                  const mm = dateJST.getUTCMonth() + 1;
                  const dd = dateJST.getUTCDate();

                  const patternSegments = ((p.shift_pattern_segments ?? []) as PatternSegmentRow[])
                      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
                  const fallbackStaffIds = (p.shift_pattern_staffs ?? [])
                      .map((staff: { staff_id: string | null }) => staff.staff_id)
                      .filter((staffId: string | null): staffId is string => Boolean(staffId));
                  const baseJstDateStr = jstDateStrFromOccurrence(dateJST);

                  // Pattern versions are effective on JST calendar dates. This
                  // prevents a future staff change from being regenerated into
                  // prior months.
                  if ((p.effective_from && baseJstDateStr < p.effective_from)
                      || (p.effective_until && baseJstDateStr > p.effective_until)) {
                      continue;
                  }

                  const { startAt, endAt } = computeOccurrenceDateTimes(yy, mm, dd, p.start_time, p.end_time);

                  const keyNormal = patternDateKey(p.id, baseJstDateStr);
                  const payload = {
                      organizationId,
                      clientId: p.client_id,
                      title: p.title,
                      startAt,
                      endAt,
                      status: 'published' as const,
                      isModified: false
                  };

                  const existNormal = existingMap.get(keyNormal);
                  if (existNormal) {
                      if (!existNormal.is_modified) {
                          // org は冒頭で検証済みのため内部実装を直接呼ぶ（多数回の getUser を回避）
                          tasks.push(async () => {
                              await updateShiftInternal(existNormal.id, payload, 'skip');
                              await saveShiftSegmentsFromPattern(
                                  existNormal.id,
                                  patternSegments,
                                  { year: yy, month: mm, day: dd, parentStartTime: p.start_time, parentEndTime: p.end_time },
                                  fallbackStaffIds,
                              );
                          });
                          updatedCount++;
                      } else {
                          skippedCount++;
                      }
                  } else {
                      tasks.push(async () => {
                          const created = await createShiftInternal({ ...payload, patternId: p.id }, 'skip');
                          await saveShiftSegmentsFromPattern(
                              created.shiftId,
                              patternSegments,
                              { year: yy, month: mm, day: dd, parentStartTime: p.start_time, parentEndTime: p.end_time },
                              fallbackStaffIds,
                          );
                      });
                      createdCount++;
                  }
              }
          }

          // 部分失敗を握りつぶさず集計する（DB挿入のみ。Google同期は後続のバッチ処理に委ねる）
          const results: PromiseSettledResult<unknown>[] = [];
          const CHUNK_SIZE = 100;
          for (let i = 0; i < tasks.length; i += CHUNK_SIZE) {
              const chunk = tasks.slice(i, i + CHUNK_SIZE).map((task) => task());
              results.push(...await Promise.allSettled(chunk));
          }
          const failedCount = results.filter(r => r.status === 'rejected').length;
          if (failedCount > 0) {
              results.forEach(r => { if (r.status === 'rejected') console.error('Generate Shift DB Error:', r.reason); });
          }

          return { success: true, count: createdCount, updated: updatedCount, skipped: skippedCount, failed: failedCount };
      } catch (error) {
          console.error('Generate Shifts Error:', error);
          throw error;
      }
  });
}
