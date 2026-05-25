'use client';

import { useEffect, Suspense } from 'react';
import { Box, Button, Typography, Paper, Stack, CircularProgress, Alert, Tabs, Tab, IconButton } from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import SaveIcon from '@mui/icons-material/Save';
import DescriptionIcon from '@mui/icons-material/Description';
import AssignmentIndIcon from '@mui/icons-material/AssignmentInd';
import FolderIcon from '@mui/icons-material/Folder';

import { useParams, useRouter } from 'next/navigation';
import { useWorkspace } from '@/context/WorkspaceContext';
import { useToast } from '@/components/ui/ToastProvider';

// 分割コンポーネントおよび新設フックのインポート
import { FormSettingsTab } from './_components/FormSettingsTab';
import { StaffAssignmentTab } from './_components/StaffAssignmentTab';
import { GoogleDocsTab } from './_components/GoogleDocsTab';
import { useClientSettings } from './_hooks/useClientSettings';

export default function ClientSettingsPage() {
    const router = useRouter();
    const params = useParams();
    const clientId = params.id as string;
    const { currentOrg, loading: wsLoading } = useWorkspace();
    const { showToast } = useToast();

    // 顧客詳細設定用ビジネスロジックフックの適用
    const {
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
    } = useClientSettings(clientId, currentOrg, showToast);

    useEffect(() => {
        if (!wsLoading && currentOrg) {
            fetchClientData();
            fetchOtherClients();
        }
    }, [wsLoading, currentOrg, fetchClientData, fetchOtherClients]);

    const handleConfirmCreateTemplate = async () => {
        if (templateId) {
            if (!confirm('既にテンプレートIDが入力されています。新しく作成して上書きしますか？')) return;
        }
        await handleCreateTemplate();
    };

    if (loading) return <Box p={4}><CircularProgress /></Box>;

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <Box sx={{ p: 2, borderBottom: '1px solid #e0e0e0', bgcolor: '#fff', flexShrink: 0 }}>
                <Stack direction="row" alignItems="center" spacing={2} mb={2}>
                    <IconButton onClick={() => router.back()}><ArrowBackIcon /></IconButton>
                    <Box>
                        <Typography variant="caption" color="text.secondary">利用者設定</Typography>
                        <Typography variant="h5" fontWeight="bold">{clientName} 様</Typography>
                    </Box>
                </Stack>
                <Tabs value={tabIndex} onChange={(_, v) => setTabIndex(v)} variant="fullWidth">
                    <Tab icon={<DescriptionIcon />} label="記録フォーム" />
                    <Tab icon={<AssignmentIndIcon />} label="担当スタッフ" />
                    <Tab icon={<FolderIcon />} label="帳票・連携" />
                </Tabs>
            </Box>

            <Box sx={{ flexGrow: 1, overflowY: 'auto', p: 3, bgcolor: '#f5f5f5' }}>
                {message && <Alert severity={message.type} sx={{ mb: 3 }}>{message.text}</Alert>}

                {tabIndex === 0 && (
                    <FormSettingsTab 
                        clientId={clientId}
                        formItems={formItems}
                        setFormItems={setFormItems}
                        otherClients={otherClients}
                        showToast={showToast}
                    />
                )}

                {tabIndex === 1 && (
                    <StaffAssignmentTab 
                        allStaffs={allStaffs}
                        assignedStaffIds={assignedStaffIds}
                        setAssignedStaffIds={setAssignedStaffIds}
                    />
                )}

                {tabIndex === 2 && (
                    <GoogleDocsTab 
                        templateId={templateId}
                        setTemplateId={setTemplateId}
                        formItems={formItems}
                        isCreatingTemplate={isCreatingTemplate}
                        handleCreateTemplate={handleConfirmCreateTemplate}
                        showToast={showToast}
                    />
                )}
            </Box>

            <Paper elevation={3} sx={{ p: 2, borderTop: '1px solid #ddd', display: 'flex', justifyContent: 'center', bgcolor: '#fff', flexShrink: 0, zIndex: 10 }}>
                <Button 
                    variant="contained" 
                    size="large" 
                    startIcon={<SaveIcon />} 
                    onClick={() => { 
                        if (tabIndex === 0) handleSaveForm(); 
                        if (tabIndex === 1) handleSaveAssignments(); 
                        if (tabIndex === 2) handleSaveTemplateId(); 
                    }} 
                    disabled={isSaving} 
                    sx={{ minWidth: 300, fontWeight: 'bold', height: 48 }}
                >
                    {isSaving ? '保存中...' : '設定を保存'}
                </Button>
            </Paper>
        </Box>
    );
}