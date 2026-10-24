import type { AccountOverviewItem, InviteStaffCandidate } from '@/app/actions/accounts';

export type AccountProfile = AccountOverviewItem;
export type OrgRoleOption = { id: string; name: string; color: string | null; is_preset: boolean; is_dangerous: boolean };
export type AccountsData = { accountList: AccountProfile[]; currentUserId: string; availableRoles: OrgRoleOption[]; inviteStaffCandidates: InviteStaffCandidate[] };
