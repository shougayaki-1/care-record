// Deno requires the extension; the app test compiler also imports this module.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore Deno requires explicit TypeScript extensions
import { normalizeValues, type FormItem } from './validate-candidate.ts';

type TemplateItem = FormItem & { required?: boolean };
type Source = {
  record_id: string; service_date: string | null; start_at: string | null; end_at: string | null;
  values: Record<string, unknown>; template: TemplateItem[] | null; actual_staff_count: number;
  linked_shift_count: number; shift: { id: string; start_at: string | null; end_at: string | null; client_matches: boolean | null; status: string | null } | null;
};

/** Checks are advisory: a missing link or historical template cannot be inferred. */
export function checkRecordQuality(source: Source, defaultTemplate: TemplateItem[]) {
  const issues: string[] = [];
  const values = source.values ?? {};
  const template = source.template ?? defaultTemplate;
  if (!values.service_time) issues.push('サービス提供時間を確認してください');
  if (!source.actual_staff_count) issues.push('担当スタッフを確認してください');
  const helpers = values._helpers;
  if (!Array.isArray(helpers) || helpers.length !== source.actual_staff_count) issues.push('担当スタッフの登録を確認してください');
  const expenses = values.travel_expenses;
  if (!Array.isArray(expenses) || expenses.length !== source.actual_staff_count || expenses.some((expense: unknown) => {
    if (!expense || typeof expense !== 'object') return true;
    const amount = (expense as { amount_yen?: unknown }).amount_yen;
    return typeof amount !== 'number' || !Number.isInteger(amount) || amount < 0 || amount > 100000;
  })) issues.push('交通費を確認してください');
  for (const item of template) {
    if (['service_time', 'travel_time', 'round_trip_distance_km', 'travel_cost_yen'].includes(item.id)) continue;
    const value = values[item.id];
    if (item.required && (!value || (Array.isArray(value) && value.length === 0))) issues.push(`${item.label}: 必須項目を確認してください`);
  }
  const fieldValues = Object.fromEntries(Object.entries(values).filter(([key]) => template.some(item => item.id === key || (item.hasDetail && `${item.id}_detail` === key))));
  normalizeValues(fieldValues, template, issues);
  const start = source.start_at ? Date.parse(source.start_at) : NaN;
  const end = source.end_at ? Date.parse(source.end_at) : NaN;
  if (!source.service_date || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) issues.push('記録の日時を確認してください');
  else if (new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(start)) !== source.service_date) issues.push('記録日と開始日時を確認してください');
  if (!source.shift) issues.push('対応するシフトを確認できません。予定との比較は要確認です');
  else {
    if (source.linked_shift_count > 1) issues.push('複数のシフトとの対応を確認してください');
    if (source.shift.status === 'cancelled') issues.push('対応するシフトは取消済みです');
    if (source.shift.client_matches !== true) issues.push('シフトの利用者を確認してください');
    const plannedStart = source.shift.start_at ? Date.parse(source.shift.start_at) : NaN;
    const plannedEnd = source.shift.end_at ? Date.parse(source.shift.end_at) : NaN;
    if (!Number.isFinite(plannedStart) || !Number.isFinite(plannedEnd)) issues.push('予定の日時を確認してください');
    else if (Number.isFinite(start) && Number.isFinite(end) && (start !== plannedStart || end !== plannedEnd)) issues.push('予定と実績の日時が異なります。理由を確認してください');
  }
  return { record_id: source.record_id, issues: [...new Set(issues)], status: issues.length ? 'needs_confirmation' : 'no_issues_detected', note: '現在のフォームと参照可能な予定による確認です。過去のフォームや分割記録などは別途確認してください。' };
}
