'use client';

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { callGasApi } from '@/app/actions/gas';
import { deleteOrganization, leaveOrganization, getAuditLogs } from '@/app/actions/organization';
import { repairUnsyncedShifts, forceSyncAllShifts } from '@/app/actions/shiftCalendar';
import { getGoogleAuthUrlAction } from '@/app/actions/google';
import { useToast } from '@/components/ui/ToastProvider';
import { Workspace } from '@/context/WorkspaceContext';
import { AuditLogRow } from '@/types';

type GasResponse = {
  status: string;
  folderId?: string;
  folderUrl?: string;
  message?: string;
};

export function useSettingsPage(currentOrg: Workspace | null, refreshWorkspace: () => void) {
  const { showToast } = useToast();

  const [tabIndex, setTabIndex] = useState(0);
  const [orgName, setOrgName] = useState('');
  const [googleFolderId, setGoogleFolderId] = useState<string | null>(null);
  const [googleCalendarId, setGoogleCalendarId] = useState<string | null>(null);
  const [driveUrl, setDriveUrl] = useState('');
  
  const [saving, setSaving] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [connectingCal, setConnectingCal] = useState(false);
  const [repairingCal, setRepairingCal] = useState(false);
  const [resyncingCal, setResyncingCal] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);
  
  const [logs, setLogs] = useState<AuditLogRow[]>([]);

  const [openDeleteDialog, setOpenDeleteDialog] = useState(false);
  const [openLeaveDialog, setOpenLeaveDialog] = useState(false);
  const [confirmInput, setConfirmInput] = useState('');

  const fetchOrgDetails = useCallback(async () => {
    if (!currentOrg) return;
    const { data } = await supabase
      .from('organizations')
      .select('name, google_folder_id, google_calendar_id')
      .eq('id', currentOrg.id)
      .single();
    
    if (data) {
      setOrgName(data.name);
      setGoogleFolderId(data.google_folder_id);
      setGoogleCalendarId(data.google_calendar_id);
      if (data.google_folder_id) {
        setDriveUrl(`https://drive.google.com/drive/folders/${data.google_folder_id}`);
      }
    }
  }, [currentOrg]);

  const fetchLogs = useCallback(async () => {
    if (!currentOrg) return;
    try {
      const data = await getAuditLogs(currentOrg.id);
      if (data.status === 'success') {
        setLogs(data.data || []);
      }
    } catch (e) { 
      console.error(e); 
    }
  }, [currentOrg]);

  const handleSave = async () => {
    if (!orgName.trim() || !currentOrg) return;
    setSaving(true);
    setMessage(null);
    try {
      const { error } = await supabase.from('organizations').update({ name: orgName }).eq('id', currentOrg.id);
      if (error) throw error;
      
      if (googleFolderId) {
        const { data: { user } } = await supabase.auth.getUser();
        await callGasApi({
          action: 'manage_org_folder',
          orgName: orgName,
          orgId: currentOrg.id,
          userEmail: user?.email,
          currentFolderId: googleFolderId
        });
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
      
      const result = await callGasApi({
        action: 'manage_org_folder',
        orgName: orgName,
        orgId: currentOrg.id,
        userEmail: user?.email,
        currentFolderId: googleFolderId
      }) as GasResponse;

      if (result.status === 'success' && result.folderId) {
        const newFolderId = result.folderId;
        await supabase
          .from('organizations')
          .update({ google_folder_id: newFolderId })
          .eq('id', currentOrg.id);

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
    if (!currentOrg) return;
    try {
      await supabase.from('organizations').update({ google_folder_id: null }).eq('id', currentOrg.id);
      setGoogleFolderId(null);
      showToast('連携を解除しました');
    } catch (e) { 
      console.error(e);
      showToast('解除に失敗しました', 'error'); 
    }
  };

  const handleConnectCalendar = async () => {
    if (!currentOrg) return;
    setConnectingCal(true);
    try {
      const url = await getGoogleAuthUrlAction(currentOrg.id);
      window.location.href = url;
    } catch (e) {
      console.error(e);
      showToast('認証URLの取得に失敗しました', 'error');
      setConnectingCal(false);
    }
  };

  const handleDisconnectCalendar = async () => {
    if (!currentOrg) return;
    try {
      await supabase.from('organizations').update({ 
        google_calendar_id: null,
        google_refresh_token: null 
      }).eq('id', currentOrg.id);
      setGoogleCalendarId(null);
      showToast('連携を解除しました');
    } catch (e) { 
      console.error(e);
      showToast('解除に失敗しました', 'error'); 
    }
  };

  const handleRepairCalendar = async () => {
    if (!currentOrg) return;
    setRepairingCal(true);
    try {
      const res = await repairUnsyncedShifts(currentOrg.id);
      if (res.success) {
        showToast(`同期修復が完了しました。（修復されたシフト数: ${res.count} 件）`, 'success');
      }
    } catch (e) {
      console.error(e);
      showToast('カレンダーの同期修復に失敗しました。再接続をお試しください。', 'error');
    } finally {
      setRepairingCal(false);
    }
  };

  const handleForceResyncCalendar = async () => {
    if (!currentOrg) return;
    setResyncingCal(true);
    try {
      const res = await forceSyncAllShifts(currentOrg.id);
      if (res.success) {
        showToast(`全件の強制再同期が完了しました。（同期されたシフト数: ${res.count} 件）`, 'success');
      }
    } catch (e) {
      console.error(e);
      showToast('全件強制再同期に失敗しました。再接続をお試しください。', 'error');
    } finally {
      setResyncingCal(false);
    }
  };

  const handleDeleteOrg = async () => {
    if (!currentOrg || confirmInput !== currentOrg.name) return;
    try {
      const res = await deleteOrganization(currentOrg.id);
      if (res.status === 'success') {
        showToast('事業所を削除しました');
        window.location.href = '/setup';
      } else {
        throw new Error(res.message);
      }
    } catch (e: unknown) { 
      console.error(e); 
      const msg = e instanceof Error ? e.message : String(e);
      showToast('削除失敗: ' + msg, 'error'); 
    }
  };

  const handleLeaveOrg = async () => {
    if (!currentOrg) return;
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const res = await leaveOrganization(currentOrg.id, user.id);
      if (res.status === 'success') {
        showToast('事業所から脱退しました');
        window.location.href = '/setup';
      } else {
        throw new Error(res.message);
      }
    } catch (e: unknown) { 
      const msg = e instanceof Error ? e.message : String(e);
      showToast(msg, 'error'); 
    }
  };

  return {
    tabIndex,
    setTabIndex,
    orgName,
    setOrgName,
    googleFolderId,
    googleCalendarId,
    driveUrl,
    saving,
    connecting,
    connectingCal,
    repairingCal,
    resyncingCal,
    message,
    setMessage,
    logs,
    openDeleteDialog,
    setOpenDeleteDialog,
    openLeaveDialog,
    setOpenLeaveDialog,
    confirmInput,
    setConfirmInput,
    fetchOrgDetails,
    fetchLogs,
    handleSave,
    handleConnectDrive,
    handleDisconnectDrive,
    handleConnectCalendar,
    handleDisconnectCalendar,
    handleRepairCalendar,
    handleForceResyncCalendar,
    handleDeleteOrg,
    handleLeaveOrg
  };
}