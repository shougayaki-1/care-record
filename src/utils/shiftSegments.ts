import type { SaveSegmentInput } from '@/app/actions/shiftSegments';

export type SegmentDraft = {
  id?: string;
  service_type_id: string;
  service_type_name?: string;
  start_at: string;
  end_at: string;
  staffs: { staff_id: string; staff_role_id: string }[];
};

type ShiftBounds = {
  shiftStart: string;
  shiftEnd: string;
};

function validDate(value: string): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function validateSegmentDrafts(
  segments: readonly SegmentDraft[],
  { shiftStart, shiftEnd }: ShiftBounds,
): string | null {
  const shiftStartDate = validDate(shiftStart);
  const shiftEndDate = validDate(shiftEnd);
  if (!shiftStartDate || !shiftEndDate) return '必須項目（利用者、日時）をすべて入力してください';
  if (shiftStartDate >= shiftEndDate) return 'シフトの終了日時は開始日時より後に設定してください';
  if (segments.length === 0) return 'サービス区間を1つ以上追加してください';

  for (const [index, segment] of segments.entries()) {
    const start = validDate(segment.start_at);
    const end = validDate(segment.end_at);
    if (!start || !end) return `区間${index + 1}の開始・終了日時を入力してください`;
    if (start >= end) return `区間${index + 1}の終了日時は開始日時より後に設定してください`;
    if (segment.staffs.length === 0 || segment.staffs.some((staff) => !staff.staff_id)) {
      return 'すべてのサービス区間に担当スタッフを設定してください';
    }
    if (start < shiftStartDate || end > shiftEndDate) {
      return `区間${index + 1}はシフトの開始・終了日時の範囲内に設定してください`;
    }
  }
  return null;
}

export function toSaveSegmentInputs(segments: readonly SegmentDraft[]): SaveSegmentInput[] {
  return segments.map((segment, index) => ({
    service_type_id: segment.service_type_id || null,
    start_at: new Date(segment.start_at).toISOString(),
    end_at: new Date(segment.end_at).toISOString(),
    sort_order: index,
    staffs: segment.staffs.map((staff) => ({
      staff_id: staff.staff_id,
      staff_role_id: staff.staff_role_id || null,
    })),
  }));
}

export function areSegmentDraftsEqual(
  left: readonly SegmentDraft[],
  right: readonly SegmentDraft[],
): boolean {
  const comparable = (segments: readonly SegmentDraft[]) => segments.map((segment) => ({
    service_type_id: segment.service_type_id,
    start_at: segment.start_at,
    end_at: segment.end_at,
    staffs: segment.staffs.map((staff) => ({
      staff_id: staff.staff_id,
      staff_role_id: staff.staff_role_id,
    })),
  }));
  return JSON.stringify(comparable(left)) === JSON.stringify(comparable(right));
}
