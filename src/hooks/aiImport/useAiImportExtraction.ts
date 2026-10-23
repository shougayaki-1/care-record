import { useState, type Dispatch, type SetStateAction } from 'react';
import type { ReviewRow } from '@/components/ui/AiImportReviewTable';
import { useConfirm } from '@/components/ui/ConfirmProvider';
import { DEFAULT_TEMPLATE } from '@/constants/formTemplates';
import type { ExtractionResult } from '@/lib/ai/extractSchema';
import { readAiExtractSse } from '@/lib/ai/sseClient';
import { buildProcessingGroups, toReviewRow, toErrorRow, type Candidate, type FileEntry, type FileGroup } from './transforms';
import type { ImportAction } from './types';

/** SSEストリームを読んで ExtractionResult を収集する */
async function streamExtract(
  formData: FormData,
  onRecord: (result: ExtractionResult, fileIndex: number) => void,
  onError: (message: string, fileIndex: number) => void,
  onGroupDone: (fileIndex: number) => void,
): Promise<number> {
  const orgId = (formData.get('organizationId') as string) ?? '';
  const extractUrl = `/api/ai/extract?organizationId=${encodeURIComponent(orgId)}`;
  const response = await fetch(extractUrl, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok || !response.body) {
    const text = await response.text().catch(() => '');
    throw new Error(text || `サーバーエラー (${response.status})`);
  }

  let total = 0;

  await readAiExtractSse(response.body, (event) => {
    if (event.type === 'record') {
      onRecord(event.result, event.fileIndex);
    } else if (event.type === 'error') {
      onError(event.message, event.fileIndex);
    } else if (event.type === 'group_done') {
      onGroupDone(event.fileIndex);
    } else if (event.type === 'done') {
      total = event.total;
    }
  });

  return total;
}

type ExtractionOptions = {
  organizationId: string | undefined;
  candidatesReady: boolean;
  clients: Candidate[];
  helpers: Candidate[];
  fileEntries: FileEntry[];
  groups: FileGroup[];
  rows: ReviewRow[];
  setRows: Dispatch<SetStateAction<ReviewRow[]>>;
  action: ImportAction;
  setOperationKind: (kind: 'extract' | 'save') => void;
};

export function useAiImportExtraction({ organizationId, candidatesReady, clients, helpers, fileEntries, groups, rows, setRows, action, setOperationKind }: ExtractionOptions) {
  const { run, isRunning } = action;
  const confirm = useConfirm();
  const [processedCount, setProcessedCount] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  // 処理開始
  const handleProcess = async () => {
    if (!organizationId || !candidatesReady || fileEntries.length === 0 || isRunning()) return;
    setOperationKind('extract');
    await run(async (isCurrent) => {
      setProcessedCount(0);
      setTotalCount(0);
      const extractedRows: ReviewRow[] = [];
      let extractionError: string | null = null;
      try {
        const formData = new FormData();
        formData.set('organizationId', organizationId);
        formData.set('formTemplate', JSON.stringify(DEFAULT_TEMPLATE));
        formData.set('clients', JSON.stringify(clients));
        formData.set('helpers', JSON.stringify(helpers));

        // グループ情報を構築
        // fileIndex はファイルエントリの順序
        const orderedEntries = [...fileEntries];
        for (const entry of orderedEntries) {
          formData.append('files[]', entry.file);
        }

        const processingGroups = buildProcessingGroups(orderedEntries, groups);
        formData.set('grouping', JSON.stringify(processingGroups));

        setTotalCount(processingGroups.length);

        await streamExtract(
          formData,
          (result, fileIndex) => {
            const row = toReviewRow(crypto.randomUUID(), result, fileIndex, orderedEntries, processingGroups, clients, helpers);
            extractedRows.push(row);
          },
          (message, fileIndex) => {
            const row = toErrorRow(crypto.randomUUID(), message, fileIndex, orderedEntries, processingGroups);
            extractedRows.push(row);
            extractionError = message;
          },
          () => {
            if (isCurrent()) setProcessedCount((n) => n + 1);
          },
        );
      } catch (error) {
        // Retain previously reviewed input after a transport failure. If this was
        // the first attempt, keep any complete records received before the error.
        if (isCurrent() && rows.length === 0 && extractedRows.length > 0) setRows(extractedRows);
        throw error;
      }
      if (!isCurrent()) return;
      if (extractionError || extractedRows.length === 0) {
        if (rows.length === 0) setRows(extractedRows);
        throw new Error(extractionError || 'AIから結果を受信できませんでした');
      }
      setRows(extractedRows);
    }, {
      confirm: rows.length > 0 ? () => confirm({ message: '現在の確認結果がクリアされます。続けますか？' }) : undefined,
      successMessage: 'AIの読み取りが完了しました。原本と照合してください。',
      errorMessage: 'AI処理に失敗しました。ファイルと入力内容は保持しています。もう一度処理開始してください。',
    });
  };

  return { processedCount, totalCount, handleProcess };
}
