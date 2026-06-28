'use client';

import { useRef, useState } from 'react';
import {
  Button,
  CircularProgress,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  Snackbar,
  Alert,
} from '@mui/material';
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh';
import type { FormItem, PromptCandidate } from '@/lib/ai/extractPrompt';
import type { ExtractionResult } from '@/lib/ai/extractSchema';
import { readAiExtractSse } from '@/lib/ai/sseClient';

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
  const [loading, setLoading] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleButtonClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // Reset input so the same file can be selected again if needed
    e.target.value = '';

    if (hasExistingValues) {
      setPendingFile(file);
      setConfirmOpen(true);
    } else {
      void processFile(file);
    }
  };

  const handleConfirmContinue = () => {
    setConfirmOpen(false);
    if (pendingFile) {
      void processFile(pendingFile);
      setPendingFile(null);
    }
  };

  const handleConfirmCancel = () => {
    setConfirmOpen(false);
    setPendingFile(null);
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
    } catch (err) {
      const message = err instanceof Error ? err.message : 'AIの読み取りに失敗しました';
      setErrorMessage(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,application/pdf"
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />

      <Button
        variant="outlined"
        size="small"
        startIcon={loading ? <CircularProgress size={16} color="inherit" /> : <AutoFixHighIcon />}
        onClick={handleButtonClick}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
      >
        {loading ? 'AIが記録を読み取っています...' : hasExistingValues ? '紙で上書き補完' : '紙から入力'}
      </Button>

      {/* 上書き確認ダイアログ */}
      <Dialog open={confirmOpen} onClose={handleConfirmCancel}>
        <DialogTitle>確認</DialogTitle>
        <DialogContent>
          <DialogContentText>
            既存の入力内容が上書きされます。続けますか？
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleConfirmCancel}>キャンセル</Button>
          <Button onClick={handleConfirmContinue} variant="contained">
            続ける
          </Button>
        </DialogActions>
      </Dialog>

      {/* エラー通知 */}
      <Snackbar
        open={!!errorMessage}
        autoHideDuration={6000}
        onClose={() => setErrorMessage(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity="error" onClose={() => setErrorMessage(null)} variant="filled">
          {errorMessage}
        </Alert>
      </Snackbar>
    </>
  );
}
