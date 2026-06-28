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

export type AiImportButtonProps = {
  formTemplate: FormItem[];
  clients: PromptCandidate[];
  helpers: PromptCandidate[];
  onExtracted: (result: ExtractionResult) => void;
  hasExistingValues?: boolean;
  disabled?: boolean;
};

export function AiImportButton({
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
      formData.set('file', file);
      formData.set('formTemplate', JSON.stringify(formTemplate));
      formData.set('clients', JSON.stringify(clients));
      formData.set('helpers', JSON.stringify(helpers));

      const response = await fetch('/api/ai/extract', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok || !response.body) {
        const text = await response.text().catch(() => '');
        throw new Error(text || `サーバーエラー (${response.status})`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let extracted = false;

      outer: while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // Parse SSE lines
        const lines = buffer.split('\n');
        // Keep the last (potentially incomplete) line in buffer
        buffer = lines.pop() ?? '';

        let currentEvent = '';
        let currentData = '';

        for (const line of lines) {
          if (line.startsWith('event:')) {
            currentEvent = line.slice(6).trim();
          } else if (line.startsWith('data:')) {
            currentData = line.slice(5).trim();
          } else if (line === '') {
            // Dispatch the event
            if (currentEvent === 'record' && currentData && !extracted) {
              try {
                const parsed = JSON.parse(currentData) as {
                  type: string;
                  index: number;
                  fileIndex: number;
                  result: ExtractionResult;
                };
                if (parsed.type === 'record' && parsed.result) {
                  extracted = true;
                  onExtracted(parsed.result);
                  // Cancel remaining stream to avoid consuming more data
                  await reader.cancel();
                  break outer;
                }
              } catch {
                // ignore parse errors on individual events
              }
            } else if (currentEvent === 'error' && currentData) {
              let sseError: Error | null = null;
              try {
                const parsed = JSON.parse(currentData) as { type: string; message: string };
                if (parsed.type === 'error') {
                  sseError = new Error(parsed.message || 'AIの読み取りに失敗しました');
                }
              } catch {
                // ignore JSON parse errors on error events
              }
              if (sseError) throw sseError;
            }
            currentEvent = '';
            currentData = '';
          }
        }
      }

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
        {loading ? 'AIが記録を読み取っています...' : '紙から入力'}
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
