'use client';

import { useRef, useState } from 'react';
import { Alert, Box, Stack, Typography } from '@mui/material';
import { AppButton } from './AppButton';
import { AppDialog } from './AppDialog';
import { RecordFormDialog } from './RecordFormLayout';
import { AiFilePicker } from './AiFilePicker';
import { ScrollableActions } from './Layout';
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh';
import InsertDriveFileIcon from '@mui/icons-material/InsertDriveFile';
import type { FormItem, PromptCandidate } from '@/lib/ai/extractPrompt';
import type { ExtractionResult } from '@/lib/ai/extractSchema';
import { readAiExtractSse } from '@/lib/ai/sseClient';
import { AiInfoPanel } from '@/components/ui/AiInfoPanel';

export type AiImportButtonProps = {
  organizationId: string;
  formTemplate: FormItem[];
  clients: PromptCandidate[];
  helpers: PromptCandidate[];
  onExtracted: (result: ExtractionResult) => void;
  hasExistingValues?: boolean;
  disabled?: boolean;
};

export function AiImportButton({
  organizationId,
  formTemplate,
  clients,
  helpers,
  onExtracted,
  hasExistingValues = false,
  disabled = false,
}: AiImportButtonProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const openWizard = () => {
    setSelectedFile(null);
    setErrorMessage(null);
    setWizardOpen(true);
  };

  const closeWizard = () => {
    if (loading) return;
    setWizardOpen(false);
    setSelectedFile(null);
    setErrorMessage(null);
    setConfirmOpen(false);
  };

  const handleFileSelect = (file: File) => {
    setSelectedFile(file);
    setErrorMessage(null);
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFileSelect(file);
    e.target.value = '';
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFileSelect(file);
  };

  const handleProcess = () => {
    if (!selectedFile) return;
    if (hasExistingValues) {
      setConfirmOpen(true);
    } else {
      void processFile(selectedFile);
    }
  };

  const handleConfirmContinue = () => {
    setConfirmOpen(false);
    if (selectedFile) void processFile(selectedFile);
  };

  const processFile = async (file: File) => {
    setLoading(true);
    setErrorMessage(null);
    try {
      const formData = new FormData();
      formData.append('files[]', file);
      formData.set('formTemplate', JSON.stringify(formTemplate));
      formData.set('clients', JSON.stringify(clients));
      formData.set('helpers', JSON.stringify(helpers));

      const extractUrl = `/api/ai/extract?organizationId=${encodeURIComponent(organizationId)}`;
      const response = await fetch(extractUrl, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok || !response.body) {
        const text = await response.text().catch(() => '');
        throw new Error(text || `サーバーエラー (${response.status})`);
      }

      let extracted = false;
      await readAiExtractSse(response.body, (event) => {
        if (event.type === 'record' && !extracted) {
          extracted = true;
          onExtracted(event.result);
        } else if (event.type === 'error') {
          throw new Error(event.message || 'AIの読み取りに失敗しました');
        }
      });

      if (!extracted) {
        throw new Error('AIから結果を受信できませんでした');
      }

      setWizardOpen(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'AIの読み取りに失敗しました';
      setErrorMessage(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <ScrollableActions aria-label="AI読み取り" role="group" tabIndex={0}>
        <AppButton intent="secondary" variant="outlined" size="small" startIcon={<AutoFixHighIcon />} onClick={openWizard} disabled={disabled}>
          {hasExistingValues ? 'AIで読み取り（上書き）' : 'AIで読み取り'}
        </AppButton>
      </ScrollableActions>
      <RecordFormDialog
        open={wizardOpen}
        onClose={closeWizard}
        title="AIで記録を読み取る"
        loading={loading}
        actions={<>
          <AppButton intent="secondary" variant="text" size="small" onClick={closeWizard} disabled={loading}>キャンセル</AppButton>
          <AppButton size="small" startIcon={<AutoFixHighIcon />} onClick={handleProcess} disabled={!selectedFile} loading={loading}>
            {loading ? '読み取り中...' : '処理開始'}
          </AppButton>
        </>}
      >
        <AiInfoPanel variant="dialog" />
        <Box>
          <Typography component="h3" variant="subtitle2" color="text.secondary" fontWeight="bold" gutterBottom>原本ファイル</Typography>
          {selectedFile ? (
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ xs: 'stretch', sm: 'center' }} sx={{ p: 2, bgcolor: 'background.muted' }}>
              <InsertDriveFileIcon color="action" />
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>{selectedFile.name}</Typography>
                <Typography variant="caption" color="text.secondary">{(selectedFile.size / 1024 / 1024).toFixed(2)} MB</Typography>
              </Box>
            </Stack>
          ) : null}
          <AiFilePicker inputRef={fileInputRef} onChange={handleFileInputChange} onDrop={handleDrop} disabled={loading} buttonLabel={selectedFile ? 'ファイルを変更' : 'ファイルを選択'} />
        </Box>
        {errorMessage && <Alert severity="error" onClose={() => setErrorMessage(null)}>{errorMessage}</Alert>}
      </RecordFormDialog>
      <AppDialog open={confirmOpen} onClose={() => setConfirmOpen(false)} title="確認" actions={<ScrollableActions aria-label="上書き確認操作" role="group" tabIndex={0}>
        <AppButton intent="secondary" variant="text" onClick={() => setConfirmOpen(false)}>キャンセル</AppButton>
        <AppButton onClick={handleConfirmContinue}>続ける</AppButton>
      </ScrollableActions>}>
        <Typography>既存の入力内容が上書きされます。続けますか？</Typography>
      </AppDialog>
    </>
  );
}
