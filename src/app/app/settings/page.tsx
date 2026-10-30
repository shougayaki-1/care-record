'use client';
import { getActionErrorMessage, readActionResult } from '@/utils/actionResult';

import { GOOGLE_CONNECTION_LABELS, googleConnectionMessage } from '@/utils/googleSync';

import { useEffect, useState, useCallback, useRef, Suspense } from 'react';
import { checkManagementPermission, checkShiftPermission } from '@/utils/permissions';
import {
  Box, Typography, Alert, CircularProgress, Stack, Tabs, Tab
} from '@/components/ui/mui';
import { AppButton, AppDialog, AppTextField, PageBody, PageLayout } from '@/components/ui';
import SettingsIcon from '@mui/icons-material/Settings';
import { OrganizationBasics } from '@/components/settings/OrganizationBasics';
import { GoogleIntegrationSettings } from '@/components/settings/GoogleIntegrationSettings';
import { McpImportSettings } from '@/components/settings/McpImportSettings';
import { McpKpiSettings } from '@/components/settings/McpKpiSettings';
import { OrganizationDangerSettings } from '@/components/settings/OrganizationDangerSettings';

import { supabase } from '@/lib/supabase';
import { useWorkspace } from '@/context/WorkspaceContext';
import { useRouter, useSearchParams } from 'next/navigation';
import { callGasApi } from '@/app/actions/gas';
import { deleteOrganization, disconnectGoogleCalendar, leaveOrganization, updateOrganizationDriveFolder, updateOrganizationName } from '@/app/actions/organization';
import { useSettingsCalendarSync } from '@/hooks/useSettingsCalendarSync';
import { useToast } from '@/components/ui/ToastProvider';
import { useConfirm } from '@/components/ui/ConfirmProvider';
import { getGoogleAuthUrlAction, getGoogleConnectionHealth, type GoogleConnectionState } from '@/app/actions/google';
import LaborPremiumSettings from '@/components/settings/LaborPremiumSettings';
import ServiceTypeSettings from '@/components/settings/ServiceTypeSettings';
import StaffRoleSettings from '@/components/settings/StaffRoleSettings';
import { getSettingsSectionsData } from '@/app/actions/settingsSections';
import type { LaborPremiumType } from '@/utils/laborPremium';
import type { ServiceType } from '@/app/actions/serviceTypes';
import type { StaffRole } from '@/app/actions/staffRoles';
import { takeProviderReauthGrant } from '@/app/actions/authSecurity';
import { useReauth } from '@/hooks/useReauth';

// reauth_grants の purpose のうち、この画面で発行し得るもの
// OAuth step-up 再認証の往復から戻ってきた後に再開する操作
type StepUpResumeAction = 'connect_calendar' | 'reauthorize_calendar' | 'disconnect_calendar' | 'delete_org';

type GasResponse = {
    status: string;
    folderId?: string;
    folderUrl?: string;
    calendarId?: string;
    message?: string;
    shareStatus?: string;
    shareMessage?: string;
};

// URLパラメータを扱うコンポーネントはSuspenseで囲む必要があるため、中身を分離
const SETTINGS_TABS = ['basic', 'google', 'rules', 'danger'] as const;

function SettingsContent() {
    const { currentOrg, loading: wsLoading, refreshWorkspace } = useWorkspace();
    const router = useRouter();
    const searchParams = useSearchParams();
    const { showToast } = useToast();
    const confirm = useConfirm();

    const [tabIndex, setTabIndex] = useState(() => Math.max(0, SETTINGS_TABS.indexOf(searchParams.get('tab') as typeof SETTINGS_TABS[number])));

    useEffect(() => {
        const nextIndex = SETTINGS_TABS.indexOf(searchParams.get('tab') as typeof SETTINGS_TABS[number]);
        // eslint-disable-next-line react-hooks/set-state-in-effect -- URL is the source for deep links to a settings section.
        setTabIndex(Math.max(0, nextIndex));
    }, [searchParams]);

    const handleTabChange = (_: React.SyntheticEvent, nextIndex: number) => {
        setTabIndex(nextIndex);
        router.replace(`/app/settings?tab=${SETTINGS_TABS[nextIndex]}`, { scroll: false });
    };
    const [orgName, setOrgName] = useState('');
    const [googleFolderId, setGoogleFolderId] = useState<string | null>(null);
    const [googleCalendarId, setGoogleCalendarId] = useState<string | null>(null);
    const [googleConnectionState, setGoogleConnectionState] = useState<GoogleConnectionState>('disconnected');
    const [driveUrl, setDriveUrl] = useState('');
    
    const [saving, setSaving] = useState(false);
    const [connecting, setConnecting] = useState(false);
    const [connectingCal, setConnectingCal] = useState(false);
    const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);
    
    const [openDeleteDialog, setOpenDeleteDialog] = useState(false);
    const [openLeaveDialog, setOpenLeaveDialog] = useState(false);
    const [confirmInput, setConfirmInput] = useState('');
    const { requestReauth, reauthDialog } = useReauth();

    // 労働時間ルール・サービス種別・スタッフ役割の3セクションをまとめて1回で取得する
    const [settingsSectionsData, setSettingsSectionsData] = useState<{
        laborPremiumTypes: LaborPremiumType[];
        serviceTypes: ServiceType[];
        staffRoles: StaffRole[];
    } | null>(null);
    const canRepairCalendarSync = Boolean(
        currentOrg &&
        checkShiftPermission(currentOrg.effectivePermissions, 'edit', true) &&
        currentOrg.effectivePermissions.shifts.edit === 'all'
    );

    const fetchOrgDetails = useCallback(async () => {
        if (!currentOrg) return;
        const { data } = await supabase
            .from('organizations')
            .select('name, google_folder_id, google_calendar_id, google_connection_status')
            .eq('id', currentOrg.id)
            .single();
        
        if (data) {
            setOrgName(data.name);
            setGoogleFolderId(data.google_folder_id);
            setGoogleCalendarId(data.google_calendar_id);
            setGoogleConnectionState((data.google_connection_status as GoogleConnectionState | null) || (data.google_calendar_id ? 'temporarily_unavailable' : 'disconnected'));
            if(data.google_folder_id) {
                setDriveUrl(`https://drive.google.com/drive/folders/${data.google_folder_id}`);
            }
        }
    }, [currentOrg]);

    useEffect(() => {
        if (!currentOrg || !googleCalendarId || !checkManagementPermission(currentOrg.effectivePermissions, 'integrations')) return;
        void readActionResult(getGoogleConnectionHealth(currentOrg.id))
            .then(({ state }) => setGoogleConnectionState(state))
            .catch(() => setGoogleConnectionState('temporarily_unavailable'));
    }, [currentOrg, googleCalendarId]);

    useEffect(() => {
        if (!wsLoading && currentOrg) {
            if (!Object.values(currentOrg.effectivePermissions.management).some(Boolean)) {
                router.push('/app');
                return;
            }
            queueMicrotask(() => void fetchOrgDetails());
        }
    }, [wsLoading, currentOrg, router, fetchOrgDetails]);

    // 労働時間ルール・サービス種別・スタッフ役割: 3セクション分をまとめて1回のServer Actionで取得し、
    // 各コンポーネントの初期表示props（initialLaborPremiumTypes等）として渡す。
    useEffect(() => {
        if (!currentOrg) return;
        let cancelled = false;
        readActionResult(getSettingsSectionsData(currentOrg.id))
            .then((data) => { if (!cancelled) setSettingsSectionsData(data); })
            .catch((e) => { console.error(e); });
        return () => { cancelled = true; };
    }, [currentOrg]);

    // Google OAuth コールバック後のトースト表示
    useEffect(() => {
        const successMsg = searchParams.get('success');
        const errorMsg = searchParams.get('error');

        if (successMsg === 'calendar_connected') {
            showToast('Googleカレンダーの連携・認証を更新しました。', 'success');
            // パラメータを消去（replaceはエラーを防ぐため今回はシンプルにURLを上書き）
            window.history.replaceState(null, '', '/app/settings');
        } else if (errorMsg) {
            const state = errorMsg.startsWith('google_') ? errorMsg.slice('google_'.length) : '';
            const message = Object.hasOwn(GOOGLE_CONNECTION_LABELS, state)
                ? googleConnectionMessage(state as GoogleConnectionState) : null;
            showToast(message || 'Googleカレンダーの連携に失敗しました。もう一度お試しください。', 'error');
            window.history.replaceState(null, '', '/app/settings');
        }
    }, [searchParams, showToast]);

    // OAuth step-up再認証(/auth/reauth-callback)から戻ってきた際、中断していた操作を再開する。
    const stepupHandledRef = useRef(false);
    useEffect(() => {
        const stepupError = searchParams.get('stepupError');
        if (stepupError) {
            window.history.replaceState(null, '', '/app/settings');
            showToast('本人確認に失敗しました。もう一度お試しください。', 'error');
            return;
        }
        const stepup = searchParams.get('stepup');
        const action = searchParams.get('action') as StepUpResumeAction | null;
        if (stepup !== '1' || !action || !currentOrg || stepupHandledRef.current) return;
        stepupHandledRef.current = true;
        window.history.replaceState(null, '', '/app/settings');

        (async () => {
            try {
                const grant = await readActionResult(takeProviderReauthGrant(action === 'delete_org' ? 'organization_delete' : 'external_secret_change'));
                if (searchParams.get('reauthOrg') !== currentOrg.id) {
                    showToast('本人確認を開始した事業所と一致しません。もう一度お試しください。', 'error');
                    return;
                }
                if (!grant) {
                    showToast('再認証の有効期限が切れました。もう一度お試しください。', 'error');
                    return;
                }
                if (action === 'connect_calendar' || action === 'reauthorize_calendar') {
                    setConnectingCal(true);
                    const url = await readActionResult(getGoogleAuthUrlAction(
                        currentOrg.id,
                        action === 'reauthorize_calendar' ? 'reauthorize' : 'connect',
                        grant.token,
                    ));
                    window.location.href = url;
                } else if (action === 'disconnect_calendar') {
                    await readActionResult(disconnectGoogleCalendar(currentOrg.id, grant.token));
                    setGoogleCalendarId(null);
                    showToast('連携を解除しました');
                } else if (action === 'delete_org') {
                    await readActionResult(deleteOrganization(currentOrg.id, grant.token));
                    showToast('事業所を削除しました');
                    window.location.href = '/setup';
                }
            } catch (e) {
                console.error(e);
                showToast('操作に失敗しました', 'error');
                setConnectingCal(false);
            }
        })();
    }, [searchParams, currentOrg, showToast]);

    const handleSave = async () => {
        if (!orgName.trim() || !currentOrg) return;
        setSaving(true);
        setMessage(null);
        try {
            await readActionResult(updateOrganizationName(currentOrg.id, orgName));
            
            if (googleFolderId) {
                const { data: { user } } = await supabase.auth.getUser();
                await readActionResult(callGasApi({
                    action: 'manage_org_folder',
                    organizationId: currentOrg.id,
                    orgName: orgName,
                    orgId: currentOrg.id,
                    userEmail: user?.email,
                    currentFolderId: googleFolderId
                }));
            }

            setMessage({ type: 'success', text: '更新しました' });
            refreshWorkspace();
        } catch (error) { 
            console.error(error); 
            setMessage({ type: 'error', text: '更新失敗' }); 
        } finally { 
            setSaving(false); 
        }
    };

    const handleConnectDrive = async () => {
        if (!currentOrg) return;
        setConnecting(true);
        setMessage(null);
        try {
            const { data: { user } } = await supabase.auth.getUser();
            
            const result = await readActionResult(callGasApi({
                action: 'manage_org_folder',
                organizationId: currentOrg.id,
                orgName: orgName,
                orgId: currentOrg.id,
                userEmail: user?.email,
                currentFolderId: googleFolderId
            })) as GasResponse;

            if (result.status === 'success' && result.folderId) {
                const newFolderId = result.folderId;
                await readActionResult(updateOrganizationDriveFolder(currentOrg.id, newFolderId));

                setGoogleFolderId(newFolderId);
                if (result.folderUrl) setDriveUrl(result.folderUrl);
                showToast('Googleドライブと連携しました');
            } else {
                throw new Error(result.message || 'Unknown error');
            }
        } catch (e) {
            console.error(e);
            setMessage({ type: 'error', text: '連携に失敗しました。GASの設定を確認してください。' });
        } finally {
            setConnecting(false);
        }
    };

    const handleDisconnectDrive = async () => {
        if (!(await confirm({ message: '連携を解除しますか？\n（Googleドライブ上のフォルダは削除されません。アプリからの参照のみ解除されます。）', confirmText: '解除する', confirmColor: 'warning' }))) return;
        if (!currentOrg) return;
        try {
            await readActionResult(updateOrganizationDriveFolder(currentOrg.id, null));
            setGoogleFolderId(null);
            showToast('連携を解除しました');
        } catch(e) { 
            console.error(e);
            showToast('解除に失敗しました', 'error'); 
        }
    };

    // OAuth認証によるカレンダー作成（Googleへ遷移）
    const handleConnectCalendar = async (mode: 'connect' | 'reauthorize' = 'connect') => {
        if (!currentOrg) return;
        setConnectingCal(true);
        try {
            const grant = await requestReauth('external_secret_change', {
                preferredMethod: 'google',
                next: `/app/settings?stepup=1&action=${mode === 'reauthorize' ? 'reauthorize_calendar' : 'connect_calendar'}&reauthOrg=${currentOrg.id}`,
                calendarAuthorization: () => readActionResult(getGoogleAuthUrlAction(currentOrg.id, mode)),
            });
            if (!grant) {
                setConnectingCal(false);
                return;
            }
            const url = await readActionResult(getGoogleAuthUrlAction(currentOrg.id, mode, grant.token));
            // Googleのログイン画面へリダイレクト
            window.location.href = url;
        } catch (e) {
            console.error(e);
            showToast('認証URLの取得に失敗しました', 'error');
            setConnectingCal(false);
        }
    };

    const handleDisconnectCalendar = async () => {
        if (!(await confirm({ message: 'カレンダーの連携を解除しますか？\n（作成されたカレンダー自体はGoogleに残り、トークンのみ破棄されます）', confirmText: '解除する', confirmColor: 'warning' }))) return;
        if (!currentOrg) return;
        try {
            const grant = await requestReauth('external_secret_change', {
                preferredMethod: 'google', next: `/app/settings?stepup=1&action=disconnect_calendar&reauthOrg=${currentOrg.id}`,
            });
            if (!grant) return;
            await readActionResult(disconnectGoogleCalendar(currentOrg.id, grant.token));
            setGoogleCalendarId(null);
            showToast('連携を解除しました');
        } catch(e) {
            console.error(e);
            showToast('解除に失敗しました', 'error');
        }
    };

    const {
        syncStatus, clearSyncStatus, refreshSyncStatus, repairingCal, resyncingCal,
        syncProgress, handleRepairCalendar, handleForceResyncCalendar,
    } = useSettingsCalendarSync({ organizationId: currentOrg?.id, canRepair: canRepairCalendarSync, showToast, confirm });

    useEffect(() => {
        let active = true;
        queueMicrotask(() => {
            if (!active) return;
            if (googleCalendarId && canRepairCalendarSync) void refreshSyncStatus();
            else clearSyncStatus();
        });
        return () => { active = false; };
        // Sync status follows connection/organization changes, not adapter function identities.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [googleCalendarId, canRepairCalendarSync, currentOrg?.id]);

    const handleDeleteOrg = async () => {
        if (!currentOrg || confirmInput !== currentOrg.name) return;
        try {
            setOpenDeleteDialog(false);
            const grant = await requestReauth('organization_delete', {
                next: `/app/settings?stepup=1&action=delete_org&reauthOrg=${currentOrg.id}`,
            });
            if (!grant) return;
            await readActionResult(deleteOrganization(currentOrg.id, grant.token));
            showToast('事業所を削除しました');
            window.location.href = '/setup';
        } catch (e: unknown) {
            console.error(e);
            const msg = getActionErrorMessage(e);
            showToast('削除失敗: ' + msg, 'error');
        }
    };

    const handleLeaveOrg = async () => {
        if (!currentOrg) return;
        try {
            await readActionResult(leaveOrganization(currentOrg.id));
            showToast('事業所から脱退しました');
            window.location.href = '/setup';
        } catch (e: unknown) { 
            const msg = getActionErrorMessage(e);
            showToast(msg, 'error'); 
        }
    };

    if (wsLoading || !currentOrg) return <Box p={5} textAlign="center"><CircularProgress /></Box>;
    const canEditOrganization = checkManagementPermission(currentOrg.effectivePermissions, 'organization');
    const canManageIntegrations = checkManagementPermission(currentOrg.effectivePermissions, 'integrations');
    const canDeleteOrganization = currentOrg.role === 'owner' && checkManagementPermission(currentOrg.effectivePermissions, 'organizationDelete');

    return (
        <PageLayout>
            <Box sx={{ borderBottom: 1, borderColor: 'divider', px: { xs: 2, sm: 3 }, bgcolor: 'background.paper' }}>
                <Stack direction="row" alignItems="center" height={64} spacing={2}>
                    <SettingsIcon sx={{ color: 'action.active' }} />
                    <Typography variant="h6" fontWeight="bold" color="text.primary">事業所設定</Typography>
                </Stack>
                <Tabs value={tabIndex} onChange={handleTabChange} variant="scrollable" allowScrollButtonsMobile aria-label="事業所設定">
                    <Tab label="基本設定" />
                    <Tab label="Google連携" />
                    <Tab label="勤務・記録ルール" />
                    <Tab label="危険な設定" />
                </Tabs>
            </Box>

            <PageBody maxWidth={800}>
                    {message && <Alert severity={message.type} sx={{ mb: 3 }}>{message.text}</Alert>}

                    {tabIndex === 0 && (
                        <OrganizationBasics
                            orgName={orgName}
                            setOrgName={setOrgName}
                            canEditOrganization={canEditOrganization}
                            saving={saving}
                            handleSave={handleSave}
                        />
                    )}

                    {tabIndex === 1 && (
                        <>
                        <GoogleIntegrationSettings
                            orgName={orgName}
                            googleFolderId={googleFolderId}
                            googleCalendarId={googleCalendarId}
                            googleConnectionState={googleConnectionState}
                            driveUrl={driveUrl}
                            canManageIntegrations={canManageIntegrations}
                            canRepairCalendarSync={canRepairCalendarSync}
                            connecting={connecting}
                            connectingCal={connectingCal}
                            repairingCal={repairingCal}
                            resyncingCal={resyncingCal}
                            syncStatus={syncStatus}
                            syncProgress={syncProgress}
                            handleConnectDrive={handleConnectDrive}
                            handleDisconnectDrive={handleDisconnectDrive}
                            handleConnectCalendar={handleConnectCalendar}
                            handleDisconnectCalendar={handleDisconnectCalendar}
                            handleRepairCalendar={handleRepairCalendar}
                            handleForceResyncCalendar={handleForceResyncCalendar}
                        />
                        {canManageIntegrations && <McpImportSettings key={currentOrg.id} organizationId={currentOrg.id} />}
                        {canManageIntegrations && <McpKpiSettings key={currentOrg.id} organizationId={currentOrg.id} />}
                        </>
                    )}

                    {tabIndex === 2 && (
                        <Stack spacing={3}>
                            {/* 労働時間ルール */}
                            {canEditOrganization && (
                                <Box sx={{ p: { xs: 2, sm: 4 }, borderRadius: 1 }}>
                                    <Typography variant="h6" fontWeight="bold" gutterBottom>労働時間ルール</Typography>
                                    <Typography variant="body2" color="text.secondary" mb={2}>
                                        深夜割り増し・時間外割り増しなどの種別と計算方法を管理します。
                                    </Typography>
                                    <LaborPremiumSettings orgId={currentOrg.id} initialLaborPremiumTypes={settingsSectionsData?.laborPremiumTypes} />
                                </Box>
                            )}

                            {/* サービス種別 */}
                            {canEditOrganization && (
                                <Box sx={{ p: { xs: 2, sm: 4 }, borderRadius: 1 }}>
                                    <Typography variant="h6" fontWeight="bold" gutterBottom>サービス種別</Typography>
                                    <Typography variant="body2" color="text.secondary" mb={2}>
                                        シフト内の区間に設定できるサービス種別（例：重度訪問介護、移動支援）を管理します。
                                    </Typography>
                                    <ServiceTypeSettings orgId={currentOrg.id} initialServiceTypes={settingsSectionsData?.serviceTypes} />
                                </Box>
                            )}

                            {/* スタッフ役割 */}
                            {canEditOrganization && (
                                <Box sx={{ p: { xs: 2, sm: 4 }, borderRadius: 1 }}>
                                    <Typography variant="h6" fontWeight="bold" gutterBottom>スタッフ役割</Typography>
                                    <Typography variant="body2" color="text.secondary" mb={2}>
                                        シフト区間内でのスタッフの役割（例：正職員、パート、ボランティア）を管理します。無給フラグを設定することで給与計算から除外できます。
                                    </Typography>
                                    <StaffRoleSettings orgId={currentOrg.id} initialStaffRoles={settingsSectionsData?.staffRoles} />
                                </Box>
                            )}
                        </Stack>
                    )}

                    {tabIndex === 3 && (
                        <OrganizationDangerSettings
                            canDeleteOrganization={canDeleteOrganization}
                            onLeave={() => setOpenLeaveDialog(true)}
                            onDelete={() => { setConfirmInput(''); setOpenDeleteDialog(true); }}
                        />
                    )}

            </PageBody>

            {reauthDialog}
            <AppDialog
                open={openDeleteDialog}
                onClose={() => setOpenDeleteDialog(false)}
                title="事業所の削除申請"
                dividers={false}
                actions={<>
                    <AppButton variant="text" intent="secondary" onClick={() => setOpenDeleteDialog(false)}>キャンセル</AppButton>
                    <AppButton onClick={handleDeleteOrg} intent="danger" disabled={confirmInput !== currentOrg.name}>
                        本人確認して削除実行
                    </AppButton>
                </>}
            >
                    <Typography color="error" sx={{ mb: 2 }}>
                        削除保留状態にします。重要操作のため再認証します。<br/>
                        確認のため、事業所名 <b>{currentOrg.name}</b> を入力してください。
                    </Typography>
                    <AppTextField
                        fullWidth
                        size="small"
                        value={confirmInput}
                        onChange={e => setConfirmInput(e.target.value)}
                        placeholder={currentOrg.name}
                    />
            </AppDialog>

            <AppDialog open={openLeaveDialog} onClose={() => setOpenLeaveDialog(false)} title="脱退の確認" dividers={false} actions={<><AppButton variant="text" intent="secondary" onClick={() => setOpenLeaveDialog(false)}>キャンセル</AppButton><AppButton onClick={handleLeaveOrg} intent="warning">脱退する</AppButton></>}>
                    <Typography>
                        本当にこの事業所から脱退しますか？<br/>
                        オーナー権限を持っている場合は、事前に他のメンバーへ権限を譲渡する必要があります。
                    </Typography>
            </AppDialog>
        </PageLayout>
    );
}

// メインのエクスポート（Suspenseでラップ）
export default function SettingsPage() {
    return (
        <Suspense fallback={<Box p={5} textAlign="center"><CircularProgress /></Box>}>
            <SettingsContent />
        </Suspense>
    );
}
