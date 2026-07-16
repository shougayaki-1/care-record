import { describe, it, expect } from 'vitest';
import type { calendar_v3 } from 'googleapis';
import {
    SyncError,
    type SyncErrorKind,
    classifyGoogleError,
    buildJstIsoString,
    buildFloatingDate,
    emptyGoogleSyncStats,
    mergeGoogleSyncStats,
    buildGoogleEventBody,
    type ShiftForGoogle,
    getGoogleEventPrivateProp,
    getLegacyEventSignature,
    getEventBodySignature,
    normalizeGoogleEventDate,
    isActiveGoogleEvent,
    choosePrimaryGoogleEvent,
    GOOGLE_PROP_SHIFT_ID,
    GOOGLE_PROP_ORG_ID,
} from './googleSync';

const ev = (e: Partial<calendar_v3.Schema$Event>): calendar_v3.Schema$Event => e;

const baseShift: ShiftForGoogle = {
    id: 'shift-1',
    title: '日勤',
    start_at: '2026-06-28T00:00:00+09:00',
    end_at: '2026-06-28T09:00:00+09:00',
    status: 'published',
    cancel_reason: null,
    google_event_id: null,
    shift_staffs: [{ staff_id: 'staff-a' }],
};

/**
 * これらは shift.ts の Google カレンダー同期ロジックの中核を支える純粋関数。
 * 「同期の冪等性」「リトライ可否の判定」「JST の正確な時刻組み立て」が壊れると
 * カレンダーの二重登録・無限リトライ・1日ズレといった重大障害につながるため、
 * 現状の正しい振る舞いを characterization test として固定する。
 */

describe('classifyGoogleError', () => {
    it('SyncError はそのまま素通しする（再分類しない）', () => {
        const original = new SyncError('boom', 'skipped', 418);
        expect(classifyGoogleError(original)).toBe(original);
    });

    describe('OAuth トークン失効（error が文字列）', () => {
        // invalid_grant は HTTP 400 で返るため、コード分岐より前に auth と判定される必要がある
        it('invalid_grant(HTTP 400) を auth に分類する', () => {
            const e = {
                code: 400,
                response: { status: 400, data: { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' } },
            };
            const se = classifyGoogleError(e);
            expect(se.kind).toBe('auth');
            expect(se.code).toBe(400);
            expect(se.message).toBe('Token has been expired or revoked.');
        });

        it('invalid_token を auth に分類する', () => {
            const se = classifyGoogleError({ response: { data: { error: 'invalid_token' } } });
            expect(se.kind).toBe('auth');
        });

        it('error_description が無ければ error コード文字列をメッセージに使う', () => {
            const se = classifyGoogleError({ response: { data: { error: 'invalid_grant' } } });
            expect(se.kind).toBe('auth');
            expect(se.message).toBe('invalid_grant');
        });
    });

    describe('メッセージ文字列による auth 判定', () => {
        it.each(['invalid_grant', 'invalid_token', 'unauthorized'])(
            'message に %s を含む場合は auth',
            (token) => {
                const se = classifyGoogleError({ message: `request failed: ${token} here` });
                expect(se.kind).toBe('auth');
            },
        );

        it('Calendar API 形式（error.message）からメッセージを拾い auth 判定する', () => {
            const se = classifyGoogleError({ response: { data: { error: { message: 'The user is unauthorized.' } } } });
            expect(se.kind).toBe('auth');
            expect(se.message).toBe('The user is unauthorized.');
        });
    });

    describe('HTTP ステータスコードによる分類', () => {
        it.each<[number, SyncErrorKind]>([
            [401, 'auth'],
            [403, 'auth'],
            [429, 'rate_limit'],
            [500, 'transient'],
            [502, 'transient'],
            [503, 'transient'],
            [404, 'permanent'],
            [400, 'permanent'],
        ])('HTTP %i -> %s', (status, expected) => {
            const se = classifyGoogleError({ response: { status } });
            expect(se.kind).toBe(expected);
            expect(se.code).toBe(status);
        });

        it('response.status を最優先で採用する', () => {
            // code(数値) と response.status が食い違う場合は response.status が勝つ
            const se = classifyGoogleError({ code: 500, response: { status: 429 } });
            expect(se.kind).toBe('rate_limit');
            expect(se.code).toBe(429);
        });

        it('403 の userRateLimitExceeded は認証切れではなく rate_limit に分類する', () => {
            const se = classifyGoogleError({
                response: {
                    status: 403,
                    data: { error: { message: 'Quota exceeded', errors: [{ reason: 'userRateLimitExceeded' }] } },
                },
            });
            expect(se.kind).toBe('rate_limit');
        });

        it('文字列の code は無視し、response.status / status を見る', () => {
            // Node の "ECONNRESET" のような文字列 code は数値として採用しない
            const se = classifyGoogleError({ code: 'ECONNRESET', status: 503 });
            expect(se.kind).toBe('transient');
            expect(se.code).toBe(503);
        });
    });

    describe('コード不在（ネットワーク断など）', () => {
        it('code が無ければ transient（コード未設定）として扱う', () => {
            const se = classifyGoogleError({ message: 'socket hang up' });
            expect(se.kind).toBe('transient');
            expect(se.code).toBeUndefined();
            expect(se.message).toBe('socket hang up');
        });

        it('完全に空のオブジェクトでも落ちずに transient を返す', () => {
            const se = classifyGoogleError({});
            expect(se.kind).toBe('transient');
            expect(se.message).toBe('network error');
        });

        it('null を渡しても落ちない', () => {
            const se = classifyGoogleError(null);
            expect(se.kind).toBe('transient');
        });
    });

    it('既定メッセージ: 該当文言が無いコード付きエラーは permanent', () => {
        const se = classifyGoogleError({ response: { status: 418 } });
        expect(se.kind).toBe('permanent');
        expect(se.message).toBe('unknown error');
        expect(se.code).toBe(418);
    });
});

describe('buildJstIsoString', () => {
    it('月・日をゼロ埋めし +09:00 と秒を付与する', () => {
        expect(buildJstIsoString(2026, 1, 5, '09:30')).toBe('2026-01-05T09:30:00+09:00');
    });

    it('2桁の月日はそのまま使う', () => {
        expect(buildJstIsoString(2026, 12, 31, '23:59')).toBe('2026-12-31T23:59:00+09:00');
    });

    it('生成した文字列を Date 化すると JST として正しく解釈される', () => {
        // 2026-06-28T00:00:00+09:00 == 2026-06-27T15:00:00Z
        const d = new Date(buildJstIsoString(2026, 6, 28, '00:00'));
        expect(d.toISOString()).toBe('2026-06-27T15:00:00.000Z');
    });
});

describe('buildFloatingDate', () => {
    it('月は 1始まりで受け取り UTC で構築する（TZ非依存）', () => {
        // month=6 -> UTC の 6月。getUTCMonth は 0始まりで 5
        const d = buildFloatingDate(2026, 6, 28, 9, 30);
        expect(d.getUTCFullYear()).toBe(2026);
        expect(d.getUTCMonth()).toBe(5);
        expect(d.getUTCDate()).toBe(28);
        expect(d.getUTCHours()).toBe(9);
        expect(d.getUTCMinutes()).toBe(30);
    });

    it('実行環境のローカルTZに依存せず同一の瞬間を返す', () => {
        expect(buildFloatingDate(2026, 1, 1, 0, 0).toISOString()).toBe('2026-01-01T00:00:00.000Z');
    });

    it('月末日の指定が翌月に繰り上がらない', () => {
        const d = buildFloatingDate(2026, 2, 28, 23, 59);
        expect(d.toISOString()).toBe('2026-02-28T23:59:00.000Z');
    });
});

describe('emptyGoogleSyncStats / mergeGoogleSyncStats', () => {
    it('emptyGoogleSyncStats は全項目ゼロ', () => {
        expect(emptyGoogleSyncStats()).toEqual({ created: 0, updated: 0, linked: 0, deletedRemote: 0, deduped: 0 });
    });

    it('呼ぶたびに新しいオブジェクトを返す（共有参照でない）', () => {
        const a = emptyGoogleSyncStats();
        const b = emptyGoogleSyncStats();
        a.created = 5;
        expect(b.created).toBe(0);
    });

    it('source を target に加算する', () => {
        const target = emptyGoogleSyncStats();
        mergeGoogleSyncStats(target, { created: 2, deduped: 1 });
        mergeGoogleSyncStats(target, { created: 3, updated: 1 });
        expect(target).toEqual({ created: 5, updated: 1, linked: 0, deletedRemote: 0, deduped: 1 });
    });

    it('source が undefined なら何もしない', () => {
        const target = emptyGoogleSyncStats();
        mergeGoogleSyncStats(target, undefined);
        expect(target).toEqual(emptyGoogleSyncStats());
    });
});

describe('buildGoogleEventBody', () => {
    it('extendedProperties に shiftId と orgId を埋め込む（同期の同定キー）', () => {
        const body = buildGoogleEventBody('org-1', baseShift);
        expect(body.extendedProperties?.private?.[GOOGLE_PROP_SHIFT_ID]).toBe('shift-1');
        expect(body.extendedProperties?.private?.[GOOGLE_PROP_ORG_ID]).toBe('org-1');
    });

    it('時刻は UTC ISO に正規化し timeZone=Asia/Tokyo を付与する', () => {
        const body = buildGoogleEventBody('org-1', baseShift);
        expect(body.start?.dateTime).toBe('2026-06-27T15:00:00.000Z');
        expect(body.start?.timeZone).toBe('Asia/Tokyo');
        expect(body.end?.dateTime).toBe('2026-06-28T00:00:00.000Z');
    });

    it('スタッフ色は決定的（同一 staffId なら毎回同じ色）= 冪等性', () => {
        const a = buildGoogleEventBody('org-1', baseShift);
        const b = buildGoogleEventBody('org-1', { ...baseShift });
        expect(a.colorId).toBe(b.colorId);
    });

    it('スタッフ色は "1".."11" の範囲に収まる', () => {
        for (const staff_id of ['staff-a', 'staff-b', 'x', 'zzzzzzzzzz', '日本語ID']) {
            const body = buildGoogleEventBody('org-1', { ...baseShift, shift_staffs: [{ staff_id }] });
            const n = Number(body.colorId);
            expect(n).toBeGreaterThanOrEqual(1);
            expect(n).toBeLessThanOrEqual(11);
        }
    });

    it('スタッフ未割当なら colorId は付かない', () => {
        const body = buildGoogleEventBody('org-1', { ...baseShift, shift_staffs: [] });
        expect(body.colorId).toBeUndefined();
    });

    it('キャンセル時はタイトルに【休】、色は8、理由を description に入れる', () => {
        const body = buildGoogleEventBody('org-1', {
            ...baseShift,
            status: 'cancelled',
            cancel_reason: '体調不良',
        });
        expect(body.summary).toBe('【休】日勤');
        expect(body.colorId).toBe('8');
        expect(body.description).toBe('キャンセル理由: 体調不良');
    });

    it('キャンセル色はスタッフ色より優先される', () => {
        const body = buildGoogleEventBody('org-1', { ...baseShift, status: 'cancelled' });
        expect(body.colorId).toBe('8');
    });

    it('タイトル未設定なら "シフト" を使う', () => {
        const body = buildGoogleEventBody('org-1', { ...baseShift, title: null });
        expect(body.summary).toBe('シフト');
    });
});

describe('normalizeGoogleEventDate', () => {
    it('空文字はそのまま空文字', () => {
        expect(normalizeGoogleEventDate('')).toBe('');
    });

    it('同一の瞬間を表す異なる表記を同じ ISO に揃える', () => {
        // +09:00 表記と Z 表記が同じ瞬間なら同じ正規形になる（重複検出の要）
        expect(normalizeGoogleEventDate('2026-06-28T00:00:00+09:00'))
            .toBe(normalizeGoogleEventDate('2026-06-27T15:00:00Z'));
    });

    it('パース不能な値はそのまま返す', () => {
        expect(normalizeGoogleEventDate('not-a-date')).toBe('not-a-date');
    });
});

describe('event signatures（重複判定の鍵）', () => {
    it('生成 body の署名と、同一内容の既存イベントの署名が一致する', () => {
        // この一致こそが「二重登録の抑止」を担保する
        const body = buildGoogleEventBody('org-1', baseShift);
        const existing = ev({
            summary: '日勤',
            start: { dateTime: '2026-06-28T00:00:00+09:00' }, // 別表記だが同じ瞬間
            end: { dateTime: '2026-06-28T09:00:00+09:00' },
        });
        expect(getLegacyEventSignature(existing)).toBe(getEventBodySignature(body));
    });

    it('終日イベント（date のみ）でも署名を組める', () => {
        const e = ev({ summary: 'X', start: { date: '2026-06-28' }, end: { date: '2026-06-29' } });
        expect(getLegacyEventSignature(e)).toContain('X::');
    });
});

describe('getGoogleEventPrivateProp', () => {
    it('存在する private プロパティを返す', () => {
        const e = ev({ extendedProperties: { private: { [GOOGLE_PROP_SHIFT_ID]: 'shift-9' } } });
        expect(getGoogleEventPrivateProp(e, GOOGLE_PROP_SHIFT_ID)).toBe('shift-9');
    });

    it('無ければ undefined', () => {
        expect(getGoogleEventPrivateProp(ev({}), GOOGLE_PROP_SHIFT_ID)).toBeUndefined();
    });
});

describe('isActiveGoogleEvent', () => {
    it('id があり status が cancelled でなければ active', () => {
        expect(isActiveGoogleEvent(ev({ id: 'e1' }))).toBe(true);
        expect(isActiveGoogleEvent(ev({ id: 'e1', status: 'confirmed' }))).toBe(true);
    });

    it('id 無し / cancelled は非active', () => {
        expect(isActiveGoogleEvent(ev({ status: 'confirmed' }))).toBe(false);
        expect(isActiveGoogleEvent(ev({ id: 'e1', status: 'cancelled' }))).toBe(false);
    });
});

describe('choosePrimaryGoogleEvent（重複イベントの代表選出）', () => {
    it('非active を除外する', () => {
        const events = [ev({ id: 'a', status: 'cancelled' }), ev({ id: 'b', updated: '2026-01-01T00:00:00Z' })];
        expect(choosePrimaryGoogleEvent(events)?.id).toBe('b');
    });

    it('preferredId が active なら最優先で選ぶ', () => {
        const events = [
            ev({ id: 'old', updated: '2026-06-01T00:00:00Z' }),
            ev({ id: 'pref', updated: '2020-01-01T00:00:00Z' }),
        ];
        expect(choosePrimaryGoogleEvent(events, 'pref')?.id).toBe('pref');
    });

    it('preferredId が非active なら無視し、最新 updated を選ぶ', () => {
        const events = [
            ev({ id: 'pref', status: 'cancelled' }),
            ev({ id: 'newer', updated: '2026-06-10T00:00:00Z' }),
            ev({ id: 'older', updated: '2026-01-01T00:00:00Z' }),
        ];
        expect(choosePrimaryGoogleEvent(events, 'pref')?.id).toBe('newer');
    });

    it('preferred 指定なしなら最新 updated を選ぶ', () => {
        const events = [
            ev({ id: 'older', updated: '2026-01-01T00:00:00Z' }),
            ev({ id: 'newer', updated: '2026-06-10T00:00:00Z' }),
        ];
        expect(choosePrimaryGoogleEvent(events)?.id).toBe('newer');
    });

    it('active が無ければ undefined', () => {
        expect(choosePrimaryGoogleEvent([ev({ id: 'a', status: 'cancelled' })])).toBeUndefined();
    });
});
