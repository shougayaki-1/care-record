export type FormItem = {
  id: string; label: string; type: 'text' | 'number' | 'checkbox' | 'time' | 'select' | 'section' | 'multicheckbox';
  options?: string; required: boolean; hasDetail?: boolean;
  detailMode?: 'conditional' | 'always'; detailLabel?: string;
};

export type FormAnswers = Record<string, string | number | boolean | string[]>;
export type HelperProfile = { id: string; name: string; defaultTravelCostYen: number | null };
export type TravelExpense = { method: 'car' | 'public_transport' | 'other' | 'none'; amountYen: string };
export type StaffRoleOption = { id: string; name: string };
export type ServiceTypeOption = { id: string; name: string };
export type ActualStaffInput = { staff_id: string; staff_role_id: string | null };
export type ReportStatus = 'draft' | 'pending' | 'approved' | 'remanded';

export type ShiftStaffData = {
    staff_id: string;
    staffs: { name: string } | null;
};

export type ShiftSegmentData = {
    id: string;
    start_at: string;
    end_at: string;
    service_type_id?: string | null;
    service_type?: { id?: string; name: string } | null;
    shift_segment_staffs?: Array<{
        staff_id: string;
        staff_role_id?: string | null;
        staff?: { name: string } | null;
    }>;
};

export type ShiftSuggestion = { id: string; title: string | null; start_at: string; end_at: string; staffName: string | null };
export type LinkedShift = { shift_id: string; is_primary: boolean; shifts: { id: string; title: string | null; start_at: string; end_at: string; shift_staffs: Array<{ staffs: { name: string } | null }> } | null };

export type RecordFormState = {
  clientName: string;
  template: FormItem[];
  answers: FormAnswers;
  selectableStaffs: HelperProfile[];
  staffRoles: StaffRoleOption[];
  serviceTypes: ServiceTypeOption[];
  selectedHelpers: string[];
  actualStaffs: ActualStaffInput[];
  actualServiceTypeId: string;
  startDateTime: string;
  endDateTime: string;
  serviceTime: string;
  travelTime: string;
  travelExpenses: Record<string, TravelExpense>;
  aiFilledFields: Set<string>;
  hasAiDraftSource: boolean;
  isSpanningMonth: boolean;
  selectedPart: 'part1' | 'part2';
  originalShiftTimes: { start_at: string; end_at: string } | null;
};

export type RecordUiState = {
  currentReportId: string | null;
  currentStatus: ReportStatus | null;
  isDirty: boolean;
  openCloseDialog: boolean;
  loading: boolean;
  errors: Record<string, string>;
  submitting: boolean;
};

export type RecordShiftState = {
  shiftSuggestions: ShiftSuggestion[];
  linkedShifts: LinkedShift[];
  dismissedSuggestions: Set<string>;
  shiftSegments: ShiftSegmentData[];
  selectedSegmentId: string | null;
};
