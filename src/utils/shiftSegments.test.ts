import { describe, expect, test } from 'vitest';

import {
  areSegmentDraftsEqual,
  toSaveSegmentInputs,
  validateSegmentDrafts,
  type SegmentDraft,
} from './shiftSegments';

const bounds = {
  shiftStart: '2026-07-28T09:00',
  shiftEnd: '2026-07-28T18:00',
};

const validSegment: SegmentDraft = {
  service_type_id: '',
  start_at: '2026-07-28T09:00',
  end_at: '2026-07-28T10:00',
  staffs: [{ staff_id: 'staff-1', staff_role_id: '' }],
};

describe('validateSegmentDrafts', () => {
  test.each([
    {
      name: '区間ゼロ',
      segments: [],
      expected: 'サービス区間を1つ以上追加してください',
    },
    {
      name: '空の開始日時',
      segments: [{ ...validSegment, start_at: '' }],
      expected: '区間1の開始・終了日時を入力してください',
    },
    {
      name: '開始と終了が同じ',
      segments: [{ ...validSegment, end_at: validSegment.start_at }],
      expected: '区間1の終了日時は開始日時より後に設定してください',
    },
    {
      name: '終了が開始より前',
      segments: [{ ...validSegment, end_at: '2026-07-28T08:59' }],
      expected: '区間1の終了日時は開始日時より後に設定してください',
    },
    {
      name: 'スタッフ未設定',
      segments: [{ ...validSegment, staffs: [] }],
      expected: 'すべてのサービス区間に担当スタッフを設定してください',
    },
  ])('$nameを拒否する', ({ segments, expected }) => {
    expect(validateSegmentDrafts(segments, bounds)).toBe(expected);
  });

  test('正常な区間を受け入れる', () => {
    expect(validateSegmentDrafts([validSegment], bounds)).toBeNull();
  });
});

describe('toSaveSegmentInputs', () => {
  test('日時、並び順、空の任意IDを保存形式へ変換する', () => {
    expect(toSaveSegmentInputs([validSegment])).toEqual([{
      service_type_id: null,
      start_at: new Date(validSegment.start_at).toISOString(),
      end_at: new Date(validSegment.end_at).toISOString(),
      sort_order: 0,
      staffs: [{ staff_id: 'staff-1', staff_role_id: null }],
    }]);
  });
});

describe('areSegmentDraftsEqual', () => {
  test('保存対象が同じなら表示用メタデータの違いを無視する', () => {
    expect(areSegmentDraftsEqual(
      [{ ...validSegment, id: 'segment-1', service_type_name: '身体介護' }],
      [{ ...validSegment, id: 'segment-2', service_type_name: '名称変更後' }],
    )).toBe(true);
  });

  test.each([
    ['サービス種別', { service_type_id: 'service-2' }],
    ['開始日時', { start_at: '2026-07-28T09:30' }],
    ['終了日時', { end_at: '2026-07-28T10:30' }],
    ['スタッフ', { staffs: [{ staff_id: 'staff-2', staff_role_id: '' }] }],
    ['役割', { staffs: [{ staff_id: 'staff-1', staff_role_id: 'role-1' }] }],
  ])('%sの変更を検出する', (_, patch) => {
    expect(areSegmentDraftsEqual([validSegment], [{ ...validSegment, ...patch }])).toBe(false);
  });
});
