// src/utils/permissions.ts
// フレキシブルロール権限の型定義とユーティリティ関数

export type RecordScope = 'all' | 'assigned' | 'none';
export type RecordAction = 'view' | 'create' | 'edit' | 'delete' | 'approve';
export type ShiftAction = 'view' | 'create' | 'edit' | 'delete' | 'approve';
export type ManagementArea =
  | 'staffs'
  | 'clients'
  | 'accounts'
  | 'organization'
  | 'integrations'
  | 'auditLogs'
  | 'reports'
  | 'roles'
  | 'organizationDelete'
  | 'ownerTransfer';

export type RolePermissions = {
  records: Record<RecordAction, RecordScope>;
  shifts: Record<ShiftAction, RecordScope>;
  management: Record<ManagementArea, boolean>;
};

// ─── 定数 ────────────────────────────────────────────────────────────────────

export const EMPTY_PERMISSIONS: RolePermissions = {
  records: { view: 'none', create: 'none', edit: 'none', delete: 'none', approve: 'none' },
  shifts:  { view: 'none', create: 'none', edit: 'none', delete: 'none', approve: 'none' },
  management: {
    staffs: false,
    clients: false,
    accounts: false,
    organization: false,
    integrations: false,
    auditLogs: false,
    reports: false,
    roles: false,
    organizationDelete: false,
    ownerTransfer: false,
  },
};

export const FULL_PERMISSIONS: RolePermissions = {
  records: { view: 'all', create: 'all', edit: 'all', delete: 'all', approve: 'all' },
  shifts:  { view: 'all', create: 'all', edit: 'all', delete: 'all', approve: 'all' },
  management: {
    staffs: true,
    clients: true,
    accounts: true,
    organization: true,
    integrations: true,
    auditLogs: true,
    reports: true,
    roles: true,
    organizationDelete: true,
    ownerTransfer: true,
  },
};

/** 管理者プリセット */
export const PRESET_MANAGER_PERMISSIONS: RolePermissions = {
  records: { view: 'all', create: 'all', edit: 'all', delete: 'all', approve: 'all' },
  shifts:  { view: 'all', create: 'all', edit: 'all', delete: 'all', approve: 'all' },
  management: {
    staffs: true,
    clients: true,
    accounts: false,
    organization: false,
    integrations: false,
    auditLogs: true,
    reports: true,
    roles: false,
    organizationDelete: false,
    ownerTransfer: false,
  },
};

/** 一般スタッフプリセット */
export const PRESET_STAFF_PERMISSIONS: RolePermissions = {
  records: { view: 'assigned', create: 'assigned', edit: 'assigned', delete: 'none', approve: 'none' },
  shifts:  { view: 'assigned', create: 'none', edit: 'none', delete: 'none', approve: 'none' },
  management: {
    staffs: false,
    clients: false,
    accounts: false,
    organization: false,
    integrations: false,
    auditLogs: false,
    reports: false,
    roles: false,
    organizationDelete: false,
    ownerTransfer: false,
  },
};

// ─── スコープ優先順 ───────────────────────────────────────────────────────────

const SCOPE_PRIORITY: Record<RecordScope, number> = { all: 2, assigned: 1, none: 0 };

function mergeScope(a: RecordScope, b: RecordScope): RecordScope {
  return SCOPE_PRIORITY[a] >= SCOPE_PRIORITY[b] ? a : b;
}

// ─── 関数 ────────────────────────────────────────────────────────────────────

/**
 * 複数ロールのパーミッションをマージする。
 * スコープは "all > assigned > none" の優先順位で勝ちが採用される。
 * management フラグは OR (true が勝つ)。
 */
export function mergePermissions(roles: RolePermissions[]): RolePermissions {
  if (roles.length === 0) return { ...EMPTY_PERMISSIONS };

  const result: RolePermissions = {
    records: { ...EMPTY_PERMISSIONS.records },
    shifts: { ...EMPTY_PERMISSIONS.shifts },
    management: { ...EMPTY_PERMISSIONS.management },
  };

  for (const role of roles) {
    for (const action of Object.keys(result.records) as RecordAction[]) {
      result.records[action] = mergeScope(result.records[action], role.records[action]);
    }
    for (const action of Object.keys(result.shifts) as ShiftAction[]) {
      result.shifts[action] = mergeScope(result.shifts[action], role.shifts[action]);
    }
    for (const area of Object.keys(result.management) as ManagementArea[]) {
      result.management[area] = result.management[area] || Boolean(role.management?.[area]);
    }
  }

  return result;
}

/**
 * レコード操作の可否を判定する。
 * @param permissions 有効権限
 * @param action 操作種別
 * @param isAssigned 現在のユーザーが対象クライアントに担当割り当て済みか
 */
export function checkRecordPermission(
  permissions: RolePermissions,
  action: RecordAction,
  isAssigned: boolean
): boolean {
  const scope = permissions.records[action];
  if (scope === 'all') return true;
  if (scope === 'assigned') return isAssigned;
  return false;
}

/**
 * シフト操作の可否を判定する。
 * @param permissions 有効権限
 * @param action 操作種別
 * @param isAssigned 現在のユーザーが対象シフトに担当割り当て済みか
 */
export function checkShiftPermission(
  permissions: RolePermissions,
  action: ShiftAction,
  isAssigned: boolean
): boolean {
  const scope = permissions.shifts[action];
  if (scope === 'all') return true;
  if (scope === 'assigned') return isAssigned;
  return false;
}

/**
 * 管理エリアへのアクセス可否を判定する。
 */
export function checkManagementPermission(
  permissions: RolePermissions,
  area: ManagementArea
): boolean {
  return permissions.management[area];
}
