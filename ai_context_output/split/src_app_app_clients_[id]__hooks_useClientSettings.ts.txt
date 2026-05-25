'use client';

import { useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { callGasApi } from '@/app/actions/gas';
import { FormItem } from '@/constants/formTemplates';
import { convertSchemaToReadable } from '@/utils/templateHelper';
import { Workspace } from '@/context/WorkspaceContext';

type Staff = { id: string; name: string; type: 'member' | 'ghost' };

export function useClientSettings(
  clientId: string, 
  currentOrg: Workspace | null, 
  showToast: (msg: string, severity?: 'success' | 'error') => void
) {
    const [loading, setLoading] = useState(true);
    const [clientName, setClientName] = useState('');
    const [tabIndex, setTabIndex] = useState(0);

    const [formItems, setFormItems] = useState<FormItem[]>([]);
    const [allStaffs, setAllStaffs] = useState<Staff[]>([]);
    const [assignedStaffIds, setAssignedStaffIds] = useState<string[]>([]);
    const [templateId, setTemplateId] = useState('');

    const [isSaving, setIsSaving] = useState(false);
    const [isCreatingTemplate, setIsCreatingTemplate] = useState(false);
    const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);
    const [otherClients, setOtherClients] = useState<{id: string, name: string}[]>([]);

    const fetchClientData = useCallback(async () => {
        try {
            const { data: client } = await supabase.from('clients').select('name, google_template_id').eq('id', clientId).single();
            if (client) {
                setClientName(client.name);
                setTemplateId(client.google_template_id || '');
            }

            const { data: template } = await supabase.from('form_templates').select('schema').eq('client_id', clientId).maybeSingle();
            if (template?.schema && Array.isArray(template.schema) && template.schema.length > 0) {
                setFormItems(template.schema as FormItem[]);
            }

            if (currentOrg) {
                let staffs: Staff[] = [];
                const { data: members } = await supabase.from('organization_members').select('user_id').eq('organization_id', currentOrg.id);
                if (members) {
                    const userIds = members.map(m => m.user_id);
                    const { data: profiles } = await supabase.from('profiles').select('id, name').in('id', userIds);
                    if (profiles) staffs = [...staffs, ...profiles.map(p => ({ id: p.id, name: p.name, type: 'member' as const }))];
                }
                const { data: ghosts } = await supabase.from('ghost_staffs').select('id, name').eq('organization_id', currentOrg.id);
                if (ghosts) staffs = [...staffs, ...ghosts.map(g => ({ id: g.id, name: g.name, type: 'ghost' as const }))];
                
                setAllStaffs(staffs);

                const { data: assigns } = await supabase.from('assignments').select('helper_id, ghost_staff_id').eq('client_id', clientId);
                if (assigns) {
                    const ids = assigns.map(a => a.helper_id || a.ghost_staff_id).filter(id => id !== null) as string[];
                    setAssignedStaffIds(ids);
                }
            }
        } catch (error) {
            console.error(error);
        } finally {
            setLoading(false);
        }
    }, [clientId, currentOrg]);

    const fetchOtherClients = useCallback(async () => {
        if (!currentOrg) return;
        const { data } = await supabase.from('clients').select('id, name').eq('organization_id', currentOrg.id).neq('id', clientId);
        setOtherClients(data || []);
    }, [currentOrg, clientId]);

    const handleSaveForm = async () => {
        setIsSaving(true);
        setMessage(null);
        try {
            const { data: existing } = await supabase.from('form_templates').select('id').eq('client_id', clientId).maybeSingle();
            if (existing) {
                const { error } = await supabase.from('form_templates').update({ schema: formItems, updated_at: new Date() }).eq('client_id', clientId);
                if (error) throw error;
            } else {
                const { error } = await supabase.from('form_templates').insert({ client_id: clientId, schema: formItems });
                if (error) throw error;
            }
            setMessage({ type: 'success', text: 'フォーム設定を保存しました！' });
            setTimeout(() => setMessage(null), 3000);
        } catch (error) {
            console.error(error);
            setMessage({ type: 'error', text: '保存に失敗しました' });
        } finally {
            setIsSaving(false);
        }
    };

    const handleSaveAssignments = async () => {
        setIsSaving(true);
        setMessage(null);
        try {
            const { error: deleteError } = await supabase.from('assignments').delete().eq('client_id', clientId);
            if (deleteError) throw deleteError;

            const inserts = assignedStaffIds.map(staffId => {
                const staff = allStaffs.find(s => s.id === staffId);
                return {
                    client_id: clientId,
                    helper_id: staff?.type === 'member' ? staffId : null,
                    ghost_staff_id: staff?.type === 'ghost' ? staffId : null
                };
            });

            if (inserts.length > 0) {
                const { error: insertError } = await supabase.from('assignments').insert(inserts);
                if (insertError) throw insertError;
            }

            setMessage({ type: 'success', text: '担当スタッフを更新しました！' });
            setTimeout(() => setMessage(null), 3000);
            fetchClientData();
        } catch (error) {
            console.error('Assignment save error:', error);
            setMessage({ type: 'error', text: '更新に失敗しました' });
        } finally {
            setIsSaving(false);
        }
    };

    const handleSaveTemplateId = async () => {
        setIsSaving(true);
        setMessage(null);
        try {
            await supabase.from('clients').update({ google_template_id: templateId }).eq('id', clientId);
            setMessage({ type: 'success', text: 'テンプレートIDを保存しました' });
            setTimeout(() => setMessage(null), 3000);
        } catch (e) {
            console.error(e);
            setMessage({ type: 'error', text: '保存失敗' });
        } finally {
            setIsSaving(false);
        }
    };

    const handleCreateTemplate = async () => {
        if (!currentOrg || !clientName) return;

        setIsCreatingTemplate(true);
        setMessage(null);

        try {
            const { data: orgData } = await supabase.from('organizations').select('google_folder_id').eq('id', currentOrg.id).single();
            const { data: clientData } = await supabase.from('clients').select('google_folder_id').eq('id', clientId).single();
            
            if (!orgData?.google_folder_id) {
                throw new Error('事業所のGoogleドライブ連携が設定されていません。「事業所設定」から連携を行ってください。');
            }

            const folderRes = await callGasApi({
                action: 'manage_client_folder',
                orgFolderId: orgData.google_folder_id,
                clientName: clientName,
                currentFolderId: clientData?.google_folder_id
            });
            
            if (folderRes.status !== 'success') throw new Error('フォルダ作成エラー: ' + folderRes.message);
            
            if (folderRes.folderId !== clientData?.google_folder_id) {
                await supabase.from('clients').update({ google_folder_id: folderRes.folderId }).eq('id', clientId);
            }

            const readableSchema = convertSchemaToReadable(formItems);

            const createRes = await callGasApi({
                action: 'create_template_doc',
                folderId: folderRes.folderId,
                clientName: clientName,
                schema: readableSchema 
            });

            if (createRes.status === 'success') {
                setTemplateId(createRes.docId);
                await supabase.from('clients').update({ google_template_id: createRes.docId }).eq('id', clientId);
                setMessage({ type: 'success', text: 'テンプレートを作成し、連携しました！別タブで開きます。' });
                window.open(createRes.docUrl, '_blank');
            } else {
                throw new Error(createRes.message);
            }

        } catch (e) {
            console.error(e);
            setMessage({ type: 'error', text: 'エラーが発生しました: ' + String(e) });
        } finally {
            setIsCreatingTemplate(false);
        }
    };

    return {
        loading,
        clientName,
        tabIndex,
        setTabIndex,
        formItems,
        setFormItems,
        allStaffs,
        assignedStaffIds,
        setAssignedStaffIds,
        templateId,
        setTemplateId,
        isSaving,
        isCreatingTemplate,
        message,
        otherClients,
        fetchClientData,
        fetchOtherClients,
        handleSaveForm,
        handleSaveAssignments,
        handleSaveTemplateId,
        handleCreateTemplate
    };
}