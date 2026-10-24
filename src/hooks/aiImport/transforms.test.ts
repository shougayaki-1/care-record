// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { buildProcessingGroups, buildSavePayload, isValidDraftTime, toErrorRow, toReviewRow, type FileEntry } from './transforms';
import type { ExtractionResult } from '@/lib/ai/extractSchema';

const clients = [{ id: 'client', name: 'テスト利用者' }];
const helpers = [{ id: 'helper', name: 'テスト担当者' }];
const result: ExtractionResult = {
  meta: { date: '2026-10-23', start_at: '09:00', end_at: '10:00', client_name: '利用者', helper_names: ['担当者'], client_id_candidate: null, helper_id_candidates: [] },
  values: { note: '記録' }, confidence: 'high', warnings: [],
};
const entries: FileEntry[] = ['a', 'b', 'c'].map((id) => ({ id, file: new File(['image'], `${id}.png`, { type: 'image/png' }), groupId: id === 'b' ? null : 'group', previewUrl: `blob:${id}` }));
const groups = [{ id: 'group', fileIds: ['c', 'missing', 'a'] }];
const row = () => toReviewRow('row', result, 2, entries, buildProcessingGroups(entries, groups), clients, helpers);

describe('AI import transformations', () => {
  it('preserves original file indices and group order, omitting deleted files', () => {
    expect(buildProcessingGroups(entries, groups)).toEqual([[2, 0], [1]]);
    expect(row()).toMatchObject({ id: 'row', fileIndex: 2, fileName: 'c.png', previewUrl: 'blob:c', fileCount: 2, clientId: 'client', helperId: 'helper', status: 'pending' });
    expect(toErrorRow('error', 'failed', 2, entries, [[2, 0]])).toMatchObject({ result: null, status: 'error', errorMessage: 'failed', fileCount: 2, fileName: 'c.png', previewUrl: 'blob:c' });
  });
  it('prefers valid candidate IDs and skips invalid helper IDs before using name fallback', () => {
    const otherClients = [...clients, { id: 'other-client', name: '別利用者' }];
    const otherHelpers = [...helpers, { id: 'other-helper', name: '別担当者' }];
    const matched = toReviewRow('row', { ...result, meta: { ...result.meta, client_id_candidate: 'other-client', helper_id_candidates: ['unknown', 'other-helper'] } }, 0, entries, [], otherClients, otherHelpers);
    expect(matched).toMatchObject({ clientId: 'other-client', helperId: 'other-helper' });
    expect(toReviewRow('row', { ...result, meta: { ...result.meta, client_id_candidate: 'unknown', helper_id_candidates: ['unknown'] } }, 0, entries, [], clients, helpers)).toMatchObject({ clientId: 'client', helperId: 'helper' });
    expect(toReviewRow('row', result, 0, entries, [], [], [])).toMatchObject({ clientId: null, helperId: null });
  });
  it.each([
    ['2026-10-23', '09:00', '10:00', true],
    ['2026-10-23', '09:00', '09:00', false],
    ['2026-10-23', '10:00', '09:00', false],
    ['', '09:00', '10:00', false],
    ['invalid', '09:00', '10:00', false],
    ['2026-10-23', '', '10:00', false],
    ['2026-10-23', '25:00', '26:00', false],
  ])('validates draft interval %s %s–%s', (date, start, end, valid) => {
    expect(isValidDraftTime(date, start, end)).toBe(valid);
  });
  it('builds the existing draft/audit payload using reviewed values and current candidates', () => {
    expect(buildSavePayload({ ...row(), date: '2026-10-24', startAt: '11:00', endAt: '12:00', result: { ...result, values: { note: '修正済み' } } }, 'org', clients, helpers)).toEqual({ organizationId: 'org', clientId: 'client', startAt: '2026-10-24T11:00:00', endAt: '2026-10-24T12:00:00', status: 'draft', values: { note: '修正済み', _helpers: ['テスト担当者'] }, expectedVersion: 0, auditSource: 'ai_import', auditFileCount: 2 });
    expect(() => buildSavePayload(row(), 'org', [], helpers)).toThrow('利用者が未選択');
    expect(() => buildSavePayload(row(), 'org', clients, [])).toThrow('スタッフが未選択');
    expect(() => buildSavePayload({ ...row(), result: null }, 'org', clients, helpers)).toThrow('読み取り結果');
    expect(() => buildSavePayload({ ...row(), endAt: '08:00' }, 'org', clients, helpers)).toThrow('日時が不正');
  });
});
