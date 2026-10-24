'use client';
import { useEffect, useRef, useState } from 'react';
import { Stack, Typography } from '@/components/ui/mui';
import { AppButton, AppDialog } from '@/components/ui';
import { useToast } from '@/components/ui/ToastProvider';
import { useReauth } from '@/hooks/useReauth';
import { takeProviderReauthGrant } from '@/app/actions/authSecurity';
import { addOrganizationOwner } from '@/app/actions/organizationOwners';
import { ActionResultError, getActionErrorMessage, readActionResult } from '@/utils/actionResult';
import { readOwnerAddResume, OWNER_ADD_RESUME_KEY } from '@/utils/ownerAddResume';
import type { Workspace } from '@/context/WorkspaceContext';
import type { AccountProfile } from './types';

type Props = { currentOrg: Workspace; currentUserId: string; accountList: AccountProfile[]; isFetching: boolean; fetchData: () => Promise<void>; refreshWorkspace: () => Promise<void> };
export function useOwnerAddFlow({ currentOrg, currentUserId, accountList, isFetching, fetchData, refreshWorkspace }: Props) {
  const { showToast } = useToast();
  const isOwner = currentOrg.role === 'owner';
  const { requestReauth, reauthDialog } = useReauth();
  const [ownerTarget, setOwnerTarget] = useState<{ orgId: string; id: string; name: string; token?: string } | null>(null);
  const [ownerAdding, setOwnerAdding] = useState(false);
  const ownerBusy = useRef(false);
  const resumeHandled = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const orgRef = useRef(currentOrg);
  const accountsRef = useRef(accountList);
  useEffect(() => { orgRef.current = currentOrg; accountsRef.current = accountList; }, [currentOrg, accountList]);

  useEffect(() => {
    if (!currentOrg || isFetching || !currentUserId || resumeHandled.current) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('action') !== 'owner_add') return;
    resumeHandled.current = true;
    const pending = readOwnerAddResume(params, sessionStorage.getItem(OWNER_ADD_RESUME_KEY), currentOrg.id, currentUserId);
    const target = pending && accountList.find(account => account.id === pending.targetId && account.status === 'active' && account.role === 'member');
    window.history.replaceState(null, '', '/app/accounts');
    sessionStorage.removeItem(OWNER_ADD_RESUME_KEY);
    void (async () => {
      const grant = await readActionResult(takeProviderReauthGrant('owner_add'));
      if (!mounted.current) return;
      if (!pending || !target || orgRef.current.id !== pending.orgId || orgRef.current.role !== 'owner' || !accountsRef.current.some(account => account.id === target.id && account.status === 'active' && account.role === 'member') || !grant || params.has('stepupError')) {
        showToast('再認証または追加対象を確認できません。もう一度オーナー追加を開始してください。', 'error');
        return;
      }
      // SSO復帰だけで昇格しない。再検証した対象を確認画面へ戻す。
      setOwnerTarget({ orgId: pending.orgId, id: target.id, name: target.name, token: grant.token });
    })().catch(() => { if (mounted.current) showToast('再認証を確認できません。もう一度お試しください。', 'error'); });
  }, [currentOrg, currentUserId, accountList, isFetching, showToast]);

  const executeOwnerAdd = async () => {
    if (!ownerTarget || !currentOrg || currentOrg.role !== 'owner' || currentOrg.id !== ownerTarget.orgId || ownerBusy.current) return;
    const target = ownerTarget;
    ownerBusy.current = true;
    setOwnerAdding(true);
    try {
      sessionStorage.setItem(OWNER_ADD_RESUME_KEY, JSON.stringify({ orgId: target.orgId, targetId: target.id, actorId: currentUserId }));
      const grant = target.token ? { token: target.token } : await requestReauth('owner_add', {
        next: `/app/accounts?stepup=1&action=owner_add&reauthOrg=${target.orgId}&target=${target.id}`,
      });
      if (!grant) return;
      if (!mounted.current) return;
      if (orgRef.current?.id !== target.orgId || orgRef.current.role !== 'owner') {
        throw new ActionResultError('VALIDATION_ERROR', '事業所が変更されています。もう一度追加対象を選んでください。');
      }
      if (!accountsRef.current.some(account => account.id === target.id && account.status === 'active' && account.role === 'member')) {
        throw new ActionResultError('VALIDATION_ERROR', '追加対象が変更されています。もう一度追加対象を選んでください。');
      }
      await readActionResult(addOrganizationOwner(target.orgId, target.id, grant.token));
      if (!mounted.current) return;
      sessionStorage.removeItem(OWNER_ADD_RESUME_KEY);
      setOwnerTarget(null);
      showToast('オーナーを追加しました。現在のオーナーも引き続きオーナーです。');
      await fetchData();
      await refreshWorkspace();
    } catch (error) {
      if (!mounted.current) return;
      // 使用済み・期限切れのSSO証明を次の試行に持ち越さない。
      setOwnerTarget({ orgId: target.orgId, id: target.id, name: target.name });
      showToast(getActionErrorMessage(error, 'オーナーの追加に失敗しました'), 'error');
    } finally {
      ownerBusy.current = false;
      if (mounted.current) setOwnerAdding(false);
    }
  };

  return { openOwnerAdd: (account: AccountProfile) => { if (!ownerBusy.current) setOwnerTarget({ orgId: currentOrg.id, id: account.id, name: account.name }); }, ownerAddDialog: <>
      <AppDialog open={Boolean(ownerTarget)} title="オーナーに追加" maxWidth="xs"
        onClose={() => { if (!ownerAdding) { setOwnerTarget(null); sessionStorage.removeItem(OWNER_ADD_RESUME_KEY); } }}
        actions={<><AppButton intent="secondary" variant="text" disabled={ownerAdding} onClick={() => { setOwnerTarget(null); sessionStorage.removeItem(OWNER_ADD_RESUME_KEY); }}>キャンセル</AppButton>
          <AppButton loading={ownerAdding} disabled={currentOrg.id !== ownerTarget?.orgId || !isOwner} onClick={executeOwnerAdd}>オーナーに追加</AppButton></>}>
        <Stack spacing={2}>
          <Typography>「{ownerTarget?.name}」さんに、記録の閲覧・出力、権限管理、事業所削除を含むすべての権限を付与します。</Typography>
          <Typography>現在のオーナーは引き続きオーナーです。業務ロールとスタッフの紐付けは維持されます。</Typography>
          <Typography variant="body2" color="text.secondary">追加には本人の再認証が必要です。</Typography>
        </Stack>
      </AppDialog>
      {reauthDialog}

</> };
}
