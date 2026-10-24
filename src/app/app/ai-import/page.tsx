'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { AiFilePicker, AppButton, PageLayout, RecordFormHeader, RecordFormBody } from '@/components/ui';
import { Alert, Box, Typography } from '@/components/ui/mui';
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh';
import { useWorkspace } from '@/context/WorkspaceContext';
import { useAiImportCandidates } from '@/hooks/useAiImportCandidates';
import { DEFAULT_TEMPLATE } from '@/constants/formTemplates';
import { AiImportReviewTable } from '@/components/ui/AiImportReviewTable';
import { AiInfoPanel } from '@/components/ui/AiInfoPanel';
import { useAsyncRecordAction } from '@/hooks/useAsyncRecordAction';
import { useConfirm } from '@/components/ui/ConfirmProvider';
import { useAiImportFiles } from '@/hooks/aiImport/useAiImportFiles';
import { useAiImportReview } from '@/hooks/aiImport/useAiImportReview';
import { useAiImportExtraction } from '@/hooks/aiImport/useAiImportExtraction';
import { AiImportFiles } from '@/components/ai-import/AiImportFiles';

export default function AiImportPage() {
  const { currentOrg } = useWorkspace();
  return <AiImportWorkspace key={currentOrg?.id ?? ''} organizationId={currentOrg?.id} />;
}

function AiImportWorkspace({ organizationId }: { organizationId: string | undefined }) {
  const action = useAsyncRecordAction(organizationId);
  const { pending, error: actionError, isRunning, clearError } = action;
  const [operationKind, setOperationKind] = useState<'extract' | 'save' | 'close'>('extract');
  const processing = pending && operationKind === 'extract';
  const saving = pending && operationKind === 'save';
  const confirm = useConfirm();
  const router = useRouter();

  const { clients, helpers, status: candidateStatus, retry: retryCandidates } = useAiImportCandidates(organizationId);
  const candidatesReady = candidateStatus === 'success';

  const { rows, setRows, handleRowChange, handleSaveSelected } = useAiImportReview({
    organizationId, candidatesReady, clients, helpers, action, setOperationKind,
  });
  const files = useAiImportFiles(rows, isRunning);
  const { fileEntries, fileInputRef, handleFileInput, handleDrop, clearFiles } = files;
  const { processedCount, totalCount, handleProcess } = useAiImportExtraction({
    organizationId, candidatesReady, clients, helpers, fileEntries, groups: files.groups, rows, setRows, action, setOperationKind,
  });

  const handleClose = async () => {
    if (isRunning()) return;
    setOperationKind('close');
    await action.run(async (isCurrent) => {
      if (isCurrent()) router.back();
    }, {
      confirm: fileEntries.length > 0 || rows.some((row) => row.saveStatus !== 'saved')
        ? () => confirm({ title: '保存されていない変更があります', message: '選択したファイルや未保存の確認内容があります。保存せず閉じますか？', confirmText: '保存せず閉じる', confirmColor: 'warning' })
        : undefined,
      errorMessage: '画面を閉じられませんでした。もう一度お試しください。',
    });
  };

  return (
    <PageLayout>
      <RecordFormHeader title="AI一括取込" onClose={() => void handleClose()} disabled={pending} actions={<>
        {fileEntries.length > 0 && !processing && <AppButton intent="secondary" variant="text" size="small" disabled={pending} onClick={() => {
          if (isRunning()) return;
          clearFiles();
          setRows([]);
        }}>クリア</AppButton>}
        <AppButton size="small" startIcon={<AutoFixHighIcon />} disabled={fileEntries.length === 0 || !organizationId || !candidatesReady || saving || (pending && operationKind === 'close')} loading={processing} onClick={() => void handleProcess()}>
          {processing ? '処理中...' : '処理開始'}
        </AppButton>
      </>} />
      <RecordFormBody>
        <AiInfoPanel variant="page" />
        {candidateStatus === 'loading' && <Alert severity="info">利用者・スタッフ候補を取得中です。取得完了後に処理を開始できます。</Alert>}
        {candidateStatus === 'error' && <Alert severity="error" action={<AppButton intent="secondary" size="small" disabled={pending} onClick={() => void retryCandidates()}>候補を再取得</AppButton>}>利用者・スタッフ候補を取得できませんでした。再取得してください。選択したファイルと確認内容は保持しています。</Alert>}
        {candidatesReady && (clients.length === 0 || helpers.length === 0) && <Alert severity="warning">{clients.length === 0 ? '利用者' : ''}{clients.length === 0 && helpers.length === 0 ? '・' : ''}{helpers.length === 0 ? 'スタッフ' : ''}候補が登録されていません。下書き保存には利用者とスタッフの登録が必要です。</Alert>}
        <Box>
          <Typography variant="subtitle2" color="text.secondary" fontWeight="bold" gutterBottom>原本ファイル</Typography>
          <AiFilePicker inputRef={fileInputRef} onChange={handleFileInput} onDrop={handleDrop} multiple disabled={pending} />
        </Box>

      <AiImportFiles {...files} pending={pending} progress={processing ? { processed: processedCount, total: totalCount } : undefined} />

      {actionError && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => { clearError(); }}>
          {actionError}
        </Alert>
      )}

      {/* 結果テーブル */}
      {rows.length > 0 && (
        <Box sx={{ py: 2 }}>
          <AiImportReviewTable
            rows={rows}
            clients={clients}
            helpers={helpers}
            formTemplate={DEFAULT_TEMPLATE}
            onRowChange={handleRowChange}
            onSaveSelected={handleSaveSelected}
            saving={pending || !candidatesReady}
          />
        </Box>
      )}
      </RecordFormBody>
    </PageLayout>
  );
}
