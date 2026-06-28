import { describe, it, expect } from 'vitest';
import {
    parseHourMinute,
    isOvernightShift,
    buildPatternDtStart,
    buildPatternRuleString,
    computeOccurrenceDateTimes,
    computeOccurrenceSegmentDateTimes,
    patternDateKey,
    jstDateStrFromStartAt,
    jstDateStrFromOccurrence,
} from './shiftRecurrence';

/**
 * 月次シフト自動生成の中核。夜勤の日跨ぎと、既存シフト⇔出現の突合キー一致が
 * 崩れると「シフト重複」「誤スキップ」「終了が前日になる」等の重大障害になるため、
 * 現状の正しい振る舞いを characterization test として固定する。
 */

describe('parseHourMinute', () => {
    it('HH:MM を数値に分解する', () => {
        expect(parseHourMinute('09:30')).toEqual({ hour: 9, minute: 30 });
        expect(parseHourMinute('00:00')).toEqual({ hour: 0, minute: 0 });
        expect(parseHourMinute('23:59')).toEqual({ hour: 23, minute: 59 });
    });
});

describe('isOvernightShift', () => {
    it('終了 > 開始 は日勤（false）', () => {
        expect(isOvernightShift('09:00', '18:00')).toBe(false);
    });
    it('終了 < 開始 は夜勤（true）', () => {
        expect(isOvernightShift('22:00', '06:00')).toBe(true);
    });
    it('終了 == 開始（24h勤務）は夜勤扱い（true）', () => {
        expect(isOvernightShift('09:00', '09:00')).toBe(true);
    });
    it('分単位の境界も判定する', () => {
        expect(isOvernightShift('09:00', '09:01')).toBe(false);
        expect(isOvernightShift('09:01', '09:00')).toBe(true);
    });
});

describe('buildPatternDtStart / buildPatternRuleString', () => {
    it('当月1日 + 開始時刻の DTSTART 文字列を組む', () => {
        expect(buildPatternDtStart(2026, 6, '09:00')).toBe('20260601T090000Z');
    });
    it('月をゼロ埋めする', () => {
        expect(buildPatternDtStart(2026, 1, '00:05')).toBe('20260101T000500Z');
    });
    it('DTSTART と RRULE を改行で連結する', () => {
        expect(buildPatternRuleString(2026, 6, '09:00', 'FREQ=WEEKLY;BYDAY=MO'))
            .toBe('DTSTART:20260601T090000Z\nRRULE:FREQ=WEEKLY;BYDAY=MO');
    });
});

describe('computeOccurrenceDateTimes', () => {
    it('日勤: 開始・終了とも同日、JST→UTC 変換される', () => {
        const r = computeOccurrenceDateTimes(2026, 6, 28, '09:00', '18:00');
        expect(r.isOvernight).toBe(false);
        // 09:00 JST = 00:00Z, 18:00 JST = 09:00Z
        expect(r.startAt).toBe('2026-06-28T00:00:00.000Z');
        expect(r.endAt).toBe('2026-06-28T09:00:00.000Z'); // 18:00 JST = 09:00Z
    });

    it('夜勤: 終了が翌日へ繰り上がる', () => {
        const r = computeOccurrenceDateTimes(2026, 6, 28, '22:00', '06:00');
        expect(r.isOvernight).toBe(true);
        // 開始 22:00 JST(28日) = 13:00Z(28日)
        expect(r.startAt).toBe('2026-06-28T13:00:00.000Z');
        // 終了 06:00 JST(29日) = 21:00Z(28日)
        expect(r.endAt).toBe('2026-06-28T21:00:00.000Z');
    });

    it('月末の夜勤は翌月1日へ正しく繰り上がる', () => {
        const r = computeOccurrenceDateTimes(2026, 6, 30, '22:00', '06:00');
        // 終了 06:00 JST(7/1) = 21:00Z(6/30)
        expect(r.endAt).toBe('2026-06-30T21:00:00.000Z');
        // 開始は6/30
        expect(r.startAt).toBe('2026-06-30T13:00:00.000Z');
    });

    it('年末の夜勤は翌年へ繰り上がる', () => {
        const r = computeOccurrenceDateTimes(2026, 12, 31, '23:00', '07:00');
        // 開始 23:00 JST(12/31) = 14:00Z(12/31)
        expect(r.startAt).toBe('2026-12-31T14:00:00.000Z');
        // 終了 07:00 JST(2027/1/1) = 22:00Z(12/31)
        expect(r.endAt).toBe('2026-12-31T22:00:00.000Z');
        expect(r.endAt > r.startAt).toBe(true);
    });

    it('終了は常に開始より後（夜勤でも逆転しない）', () => {
        const r = computeOccurrenceDateTimes(2026, 2, 28, '20:00', '05:00');
        expect(new Date(r.endAt).getTime()).toBeGreaterThan(new Date(r.startAt).getTime());
    });
});

describe('computeOccurrenceSegmentDateTimes', () => {
    it('日勤セグメントを親シフト開始日へ合成する', () => {
        const r = computeOccurrenceSegmentDateTimes(2026, 6, 28, '09:00', '15:00', '10:00', '14:00');
        expect(r.isOvernight).toBe(false);
        expect(r.startAt).toBe('2026-06-28T01:00:00.000Z');
        expect(r.endAt).toBe('2026-06-28T05:00:00.000Z');
    });

    it('夜勤の前半セグメントは終了を翌日に繰り上げる', () => {
        const r = computeOccurrenceSegmentDateTimes(2026, 6, 28, '22:00', '06:00', '22:00', '00:00');
        expect(r.isOvernight).toBe(true);
        expect(r.startAt).toBe('2026-06-28T13:00:00.000Z');
        expect(r.endAt).toBe('2026-06-28T15:00:00.000Z');
    });

    it('夜勤の0時以降セグメントは開始・終了とも翌日扱いにする', () => {
        const r = computeOccurrenceSegmentDateTimes(2026, 6, 28, '22:00', '06:00', '00:00', '06:00');
        expect(r.isOvernight).toBe(false);
        expect(r.startAt).toBe('2026-06-28T15:00:00.000Z');
        expect(r.endAt).toBe('2026-06-28T21:00:00.000Z');
    });

    it('月末夜勤の0時以降セグメントは翌月1日へ合成する', () => {
        const r = computeOccurrenceSegmentDateTimes(2026, 6, 30, '22:00', '06:00', '00:00', '06:00');
        expect(r.startAt).toBe('2026-06-30T15:00:00.000Z');
        expect(r.endAt).toBe('2026-06-30T21:00:00.000Z');
    });
});

describe('突合キーの対称性（冪等性の核心）', () => {
    it('既存側(start_at→) と 出現側 が同じ JST 日付文字列を生む', () => {
        // 2026-06-28 09:00 JST のシフト
        const startAtUtc = '2026-06-28T00:00:00.000Z';
        // 既存シフト側
        const fromExisting = jstDateStrFromStartAt(startAtUtc);
        // 出現側（フローティング UTC で 6/28）
        const fromOccurrence = jstDateStrFromOccurrence(new Date(Date.UTC(2026, 5, 28, 9, 0)));
        expect(fromExisting).toBe('2026-06-28');
        expect(fromExisting).toBe(fromOccurrence);
    });

    it('JST 深夜0時台のシフトでも日付がズレない（UTC では前日でも JST で当日）', () => {
        // 2026-06-28 00:30 JST = 2026-06-27T15:30Z
        const r = computeOccurrenceDateTimes(2026, 6, 28, '00:30', '08:30');
        expect(jstDateStrFromStartAt(r.startAt)).toBe('2026-06-28');
    });

    it('生成→既存読み戻しのラウンドトリップでキーが一致する（重複生成を防ぐ）', () => {
        const patternId = 'pat-1';
        const occurrence = new Date(Date.UTC(2026, 5, 28, 9, 0)); // 6/28
        // 1回目の生成
        const { startAt } = computeOccurrenceDateTimes(2026, 6, 28, '09:00', '18:00');
        const keyAtGenerate = patternDateKey(patternId, jstDateStrFromOccurrence(occurrence));
        // 次回実行時、DB の start_at から復元するキー
        const keyFromDb = patternDateKey(patternId, jstDateStrFromStartAt(startAt));
        expect(keyFromDb).toBe(keyAtGenerate);
    });

    it('夜勤シフトでも突合キーは「開始日」基準で一致する', () => {
        const patternId = 'pat-night';
        const { startAt } = computeOccurrenceDateTimes(2026, 6, 30, '22:00', '06:00');
        const keyAtGenerate = patternDateKey(patternId, jstDateStrFromOccurrence(new Date(Date.UTC(2026, 5, 30))));
        const keyFromDb = patternDateKey(patternId, jstDateStrFromStartAt(startAt));
        expect(keyFromDb).toBe(keyAtGenerate);
        expect(keyFromDb).toBe('pat-night::2026-06-30');
    });
});

describe('patternDateKey', () => {
    it('patternId::date 形式', () => {
        expect(patternDateKey('p1', '2026-06-28')).toBe('p1::2026-06-28');
    });
});
