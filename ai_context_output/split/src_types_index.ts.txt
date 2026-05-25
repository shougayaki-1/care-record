export type OrganizationRole = 'owner' | 'manager' | 'staff' | 'super_admin';

// 1. Client / ClientData の統合（archived_at を必須またはオプショナルで統一）
export interface ClientData {
  id: string;
  name: string;
  archived_at?: string | null;
  google_template_id?: string | null;
  google_folder_id?: string | null;
}

// 2. Staff / StaffAssignment の StaffData への統合
export interface StaffData {
  id: string;
  name: string;
  type?: 'member' | 'ghost'; // 'member' = ログインユーザー, 'ghost' = 転記用
}

export type ReportStatus = 'draft' | 'pending' | 'approved' | 'remanded';

export interface FormItem {
  id: string;
  label: string;
  type: 'text' | 'number' | 'checkbox' | 'time' | 'select' | 'section' | 'multicheckbox';
  options?: string;
  required: boolean;
  hasDetail?: boolean;
  [key: string]: unknown;
}

export interface ShiftStaffData {
  staff_id: string;
  staffs: { name: string } | null;
}

export interface ShiftData {
  id: string;
  client_id: string;
  title: string | null;
  start_at: string;
  end_at: string;
  status: string;
  cancel_reason: string | null;
  shift_staffs: ShiftStaffData[];
  clients?: { id?: string; name: string } | null;
}

export type ShiftPayload = {
  organizationId: string;
  clientId: string;
  title: string;
  startAt: string;
  endAt: string;
  staffIds: string[];
  status?: 'published' | 'cancelled';
  cancelReason?: string;
  patternId?: string;
  isModified?: boolean;
};

export type ShiftPatternPayload = {
  organizationId: string;
  clientId: string;
  title: string;
  startTime: string;
  endTime: string;
  rrule: string;
  staffIds: string[];
};

export interface FetchedPatternData {
  id: string;
  client_id: string;
  title: string;
  start_time: string;
  end_time: string;
  rrule: string;
  clients: { name: string } | null;
  shift_pattern_staffs: { staff_id: string; staffs: { name: string } | null }[];
}

export interface AuditLogRow {
  id: string;
  created_at: string;
  organization_id: string;
  actor_id: string;
  action_type: string;
  target_resource: string | null;
  details: Record<string, unknown> | null;
  profiles: { name: string } | null;
}

export interface AccountProfile {
  id: string;
  name: string;
  email?: string;
  role: string;
  status: 'active' | 'invited';
  invitation_code?: string;
}

export interface ReportData {
  id: string;
  start_at: string;
  end_at: string;
  status: string;
  client_id: string;
  clients: { name: string } | null;
  helper?: { name: string } | null;
  report_values: {
    data: {
      _helpers?: string[];
      service_time?: string | number;
      travel_time?: string | number;
    };
  }[] | null;
}

export interface AggregatedRow {
  name: string;
  plannedHours: number;
  actualHours: number;
}

export type ActionResponse<T = unknown> =
  | { status: 'success'; data: T }
  | { status: 'error'; message: string };

// --- 新規追加・集約する型定義 ---

// 3. アカウント管理画面でローカル定義されていた型を集約
export interface MemberRow {
  user_id: string;
  role: string;
}

export interface ProfileRow {
  id: string;
  name: string;
  email?: string;
}

export interface InvitationRow {
  id: string;
  target_name: string | null;
  role: string;
  code: string;
}

// 4. 汎用的なフォーム回答用、およびGASレスポンス用の型を追加
export type FormAnswers = Record<string, string | number | boolean | string[]>;

export interface GasResponse {
  status: 'success' | 'error';
  folderId?: string;
  folderUrl?: string;
  docId?: string;
  docUrl?: string;
  message?: string;
}