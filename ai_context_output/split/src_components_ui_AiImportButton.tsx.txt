'use client';

import { useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Divider,
  Paper,
  Typography,
} from '@mui/material';
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
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
  const [dragOver, setDragOver] = useState(false);

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
    setDragOver(false);
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
      <Button
        variant="outlined"
        size="small"
        startIcon={<AutoFixHighIcon />}
        onClick={openWizard}
        disabled={disabled}
      >
        {hasExistingValues ? 'AIで読み取り（上書き）' : 'AIで読み取り'}
      </Button>

      {/* ウィザードダイアログ */}
      <Dialog open={wizardOpen} onClose={closeWizard} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <AutoFixHighIcon color="primary" fontSize="small" />
          AIで記録を読み取る
        </DialogTitle>

        <DialogContent dividers sx={{ p: 2 }}>
          <AiInfoPanel variant="dialog" />

          <Divider sx={{ my: 1.5 }} />

          {/* ファイル選択エリア */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,application/pdf"
            style={{ display: 'none' }}
            onChange={handleFileInputChange}
          />

          {selectedFile ? (
            <Paper
              variant="outlined"
              sx={{ p: 2, display: 'flex', alignItems: 'center', gap: 1.5, bgcolor: 'action.hover' }}
            >
              <InsertDriveFileIcon color="action" />
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography fontSize="0.875rem" noWrap>
                  {selectedFile.name}
                </Typography>
                <Typography fontSize="0.75rem" color="text.secondary">
                  {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
                </Typography>
              </Box>
              <Button
                size="small"
                onClick={() => fileInputRef.current?.click()}
                disabled={loading}
              >
                変更
              </Button>
            </Paper>
          ) : (
            <Paper
              variant="outlined"
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              sx={{
                p: 3,
                textAlign: 'center',
                border: '2px dashed',
                borderColor: dragOver ? 'primary.main' : 'primary.light',
                bgcolor: dragOver ? 'primary.50' : 'background.default',
                cursor: 'pointer',
                transition: 'border-color 0.15s, background-color 0.15s',
              }}
            >
              <CloudUploadIcon color="primary" sx={{ fontSize: 36, mb: 0.5 }} />
              <Typography fontSize="0.875rem" color="text.secondary">
                クリックまたはドラッグ&ドロップでファイルを選択
              </Typography>
              <Typography fontSize="0.75rem" color="text.disabled" mt={0.5}>
                PDF・JPEG・PNG・WebP（最大10MB）
              </Typography>
            </Paper>
          )}

          {errorMessage && (
            <Alert severity="error" sx={{ mt: 1.5 }} onClose={() => setErrorMessage(null)}>
              {errorMessage}
            </Alert>
          )}
        </DialogContent>

        <DialogActions sx={{ px: 2, py: 1.5 }}>
          <Button onClick={closeWizard} disabled={loading}>
            キャンセル
          </Button>
          <Button
            variant="contained"
            startIcon={loading ? <CircularProgress size={16} color="inherit" /> : <AutoFixHighIcon />}
            onClick={handleProcess}
            disabled={!selectedFile || loading}
          >
            {loading ? '読み取り中...' : '処理開始'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* 上書き確認ダイアログ */}
      <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)}>
        <DialogTitle>確認</DialogTitle>
        <DialogContent>
          <DialogContentText>
            既存の入力内容が上書きされます。続けますか？
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmOpen(false)}>キャンセル</Button>
          <Button onClick={handleConfirmContinue} variant="contained">
            続ける
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
