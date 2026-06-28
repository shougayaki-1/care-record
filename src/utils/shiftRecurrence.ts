/**
 * ひな形（shift_patterns）からの月次シフト自動生成にまつわる純粋ロジック。
 *
 * 元々 shift.ts の generateShiftsForMonth / previewShiftsForMonth に
 * インラインで埋め込まれていた日付・繰り返し計算を切り出したもの。
 * DB アクセスや権限チェックは含まず、入力→出力が決定的な計算のみを扱う。
 *
 * 重要な不変条件:
 *  - 夜勤（終了 <= 開始）の終了時刻は「翌日」へ繰り上がる
 *  - 既存シフト側と occurrence 側で算出する突合キーが一致する（冪等性の要）
 */

import { buildFloatingDate, buildJstIsoString } from './googleSync';

const pad = (n: number) => String(n).padStart(2, '0');

const addDaysUtc = (year: number, month: number, day: number, days: number) => {
    const date = new Date(Date.UTC(year, month - 1, day));
    date.setUTCDate(date.getUTCDate() + days);
    return {
        year: date.getUTCFullYear(),
        month: date.getUTCMonth() + 1,
        day: date.getUTCDate(),
    };
};

const minutesOfDay = (timeStr: string): number => {
    const { hour, minute } = parseHourMinute(timeStr);
    return hour * 60 + minute;
};

/** "09:30" -> { hour: 9, minute: 30 } */
export function parseHourMinute(timeStr: string): { hour: number; minute: number } {
    const [hour, minute] = timeStr.split(':').map(Number);
    return { hour, minute };
}

/**
 * 夜勤判定。終了が開始以下（同時刻含む）なら日跨ぎの夜勤とみなす。
 */
export function isOvernightShift(startTime: string, endTime: string): boolean {
    const s = parseHourMinute(startTime);
    const e = parseHourMinute(endTime);
    return e.hour * 60 + e.minute <= s.hour * 60 + s.minute;
}

/**
 * RRULE 展開の基準となる DTSTART 文字列（フローティング: 当月1日 + 開始時刻）。
 * 例: 2026-06 / "09:00" -> "20260601T090000Z"
 */
export function buildPatternDtStart(year: number, month: number, startTime: string): string {
    const { hour, minute } = parseHourMinute(startTime);
    return buildFloatingDate(year, month, 1, hour, minute).toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
}

/** rrulestr() に渡す "DTSTART:...\nRRULE:..." 文字列を組み立てる。 */
export function buildPatternRuleString(year: number, month: number, startTime: string, rrule: string): string {
    return `DTSTART:${buildPatternDtStart(year, month, startTime)}\nRRULE:${rrule}`;
}

/**
 * 1回の出現日（year/month/day, いずれも JST 暦の値）から、
 * シフトの開始・終了時刻（UTC ISO 文字列）を算出する。
 * 夜勤の場合、終了時刻は翌日に繰り上がる。
 */
export function computeOccurrenceDateTimes(
    year: number,
    month: number,
    day: number,
    startTime: string,
    endTime: string,
): { startAt: string; endAt: string; isOvernight: boolean } {
    const s = parseHourMinute(startTime);
    const e = parseHourMinute(endTime);
    const overnight = isOvernightShift(startTime, endTime);

    const startAtStr = buildJstIsoString(year, month, day, `${pad(s.hour)}:${pad(s.minute)}`);
    let endAtStr: string;
    if (overnight) {
        const nextDay = new Date(Date.UTC(year, month - 1, day));
        nextDay.setUTCDate(nextDay.getUTCDate() + 1);
        endAtStr = buildJstIsoString(nextDay.getUTCFullYear(), nextDay.getUTCMonth() + 1, nextDay.getUTCDate(), `${pad(e.hour)}:${pad(e.minute)}`);
    } else {
        endAtStr = buildJstIsoString(year, month, day, `${pad(e.hour)}:${pad(e.minute)}`);
    }

    return {
        startAt: new Date(startAtStr).toISOString(),
        endAt: new Date(endAtStr).toISOString(),
        isOvernight: overnight,
    };
}

/**
 * ひな形内セグメントの時刻を、親シフト出現日の JST 日付へ合成する。
 * 親シフトが夜勤の場合、親開始時刻より前のセグメント開始は翌日扱いにする。
 */
export function computeOccurrenceSegmentDateTimes(
    year: number,
    month: number,
    day: number,
    parentStartTime: string,
    parentEndTime: string,
    segmentStartTime: string,
    segmentEndTime: string,
): { startAt: string; endAt: string; isOvernight: boolean } {
    const parentOvernight = isOvernightShift(parentStartTime, parentEndTime);
    const parentStartMinutes = minutesOfDay(parentStartTime);
    const segmentStartMinutes = minutesOfDay(segmentStartTime);
    const segmentEndMinutes = minutesOfDay(segmentEndTime);

    const startDayOffset = parentOvernight && segmentStartMinutes < parentStartMinutes ? 1 : 0;
    const endDayOffset = startDayOffset + (segmentEndMinutes <= segmentStartMinutes ? 1 : 0);

    const startDate = addDaysUtc(year, month, day, startDayOffset);
    const endDate = addDaysUtc(year, month, day, endDayOffset);
    const start = parseHourMinute(segmentStartTime);
    const end = parseHourMinute(segmentEndTime);

    const startAtStr = buildJstIsoString(startDate.year, startDate.month, startDate.day, `${pad(start.hour)}:${pad(start.minute)}`);
    const endAtStr = buildJstIsoString(endDate.year, endDate.month, endDate.day, `${pad(end.hour)}:${pad(end.minute)}`);

    return {
        startAt: new Date(startAtStr).toISOString(),
        endAt: new Date(endAtStr).toISOString(),
        isOvernight: endDayOffset > startDayOffset,
    };
}

/** ひな形ID と JST日付文字列(YYYY-MM-DD) から突合キーを作る。 */
export function patternDateKey(patternId: string, jstDateStr: string): string {
    return `${patternId}::${jstDateStr}`;
}

/**
 * 既存シフトの start_at(UTC ISO) を JST 日付文字列(YYYY-MM-DD) に変換する。
 * UTC へ +9h して日付部分を取り出す。
 */
export function jstDateStrFromStartAt(startAtIso: string): string {
    return new Date(new Date(startAtIso).getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/**
 * RRULE の出現(フローティング UTC Date) を JST 日付文字列(YYYY-MM-DD) に変換する。
 * フローティング基準のため UTC 上の年月日がそのまま JST 暦の日付になる。
 */
export function jstDateStrFromOccurrence(occurrence: Date): string {
    return `${occurrence.getUTCFullYear()}-${pad(occurrence.getUTCMonth() + 1)}-${pad(occurrence.getUTCDate())}`;
}
