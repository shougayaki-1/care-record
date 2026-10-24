'use client';
import { useRef, useState, type ReactElement } from 'react';
import type { DocumentProps } from '@react-pdf/renderer';
import type { PdfReportData } from '@/components/pdf/ServiceRecordDocument';
import { supabase } from '@/lib/supabase';
import { readActionResult, getActionErrorMessage } from '@/utils/actionResult';
import { callGasApi } from '@/app/actions/gas';
import { auditReportExport } from '@/app/actions/reports';
import { updateClientGoogleLink } from '@/app/actions/clients';
import { buildReportsCsv, buildTravelSettlementCsv, getReportData, getReportHelperNames as getExportHelperNames } from '@/utils/reportsExport';
import { snapshotExportReports, loadReportValues, loadExportTemplates, loadPdfTemplate, type Report, type ExportReport } from '@/utils/reportExportData';
import { buildGasReportOutput } from '@/utils/reportGasExport';
import { downloadBlob } from '@/utils/downloadBlob';
import { useToast } from '@/components/ui/ToastProvider';
import { useConfirm } from '@/components/ui/ConfirmProvider';

export function useReportExport({ organizationId, reports, selected, filterShiftId }: {
  organizationId?: string; reports: Report[]; selected: readonly string[]; filterShiftId: string | null;
}) {
  const { showToast } = useToast();
  const confirm = useConfirm();
  const busy = useRef(false);
  const [exporting, setExporting] = useState(false);
  const [gasProgress, setGasProgress] = useState<{ total: number; current: number; currentName: string } | null>(null);

  // Lock covers confirmation, fetching and output across every format.
  async function runExport(operation: () => Promise<void>) {
    if (busy.current || !organizationId) return;
    busy.current = true;
    setExporting(true);
    try { await operation(); }
    finally { busy.current = false; setExporting(false); }
  }

  const handleExportCSV = () => runExport(async () => {
    const targetReports = snapshotExportReports(reports, selected);
    if (targetReports.length === 0) { showToast('出力するデータがありません。', 'warning'); return; }
    if (!(await confirm({ message: `${targetReports.length}件のデータをエクスポートします。\n差し込み印刷用に全ての項目を列に展開します。よろしいですか？` }))) return;
    try {
      await readActionResult(auditReportExport(organizationId!, targetReports.map((report) => report.id), 'csv'));
      const clientIds = Array.from(new Set(targetReports.map(r => r.clients.id)));
      const templates = await loadExportTemplates(clientIds);

      const exportReports = await loadReportValues(targetReports);
      const csvContent = buildReportsCsv(
        exportReports,
        templates,
      );
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      downloadBlob(blob, `reports_export_${new Date().toISOString().slice(0,10)}.csv`);
    } catch (e) { console.error(e); showToast('エクスポート中にエラーが発生しました', 'error'); }
  });

  const handleExportTravelCosts = () => runExport(async () => {
    const targetReports = snapshotExportReports(reports, selected);
    if (targetReports.length === 0) { showToast('出力するデータがありません。', 'warning'); return; }
    try {
      const exportReports = await loadReportValues(targetReports);
      const { csv, missingCount, itemCount } = buildTravelSettlementCsv(exportReports);
      if (missingCount > 0) {
        showToast(`${missingCount}件の承認済み記録にスタッフ別交通費がありません。記録を確認してください。`, 'warning');
        return;
      }
      if (itemCount === 0) { showToast('出力できる承認済みの交通費がありません', 'warning'); return; }
      await readActionResult(auditReportExport(organizationId!, exportReports.filter((report) => report.status === 'approved').map((report) => report.id), 'csv'));
      downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8;' }), `travel_settlement_${new Date().toISOString().slice(0, 10)}.csv`);
    } catch (error) {
      console.error(error);
      showToast('交通費の出力に失敗しました', 'error');
    }
  });

  const handleBulkDownloadPDF = () => runExport(async () => {
    const targetReports = snapshotExportReports(reports, selected);
    if (targetReports.length === 0) { showToast('出力するデータがありません', 'warning'); return; }
    const pdfConfirmMsg = targetReports.length > 50
      ? `${targetReports.length}件のPDFを作成します。\n時間がかかる場合があります。`
      : `${targetReports.length}件のPDFを出力しますか？`;
    if (!(await confirm({ message: pdfConfirmMsg }))) return;

    try {
      await readActionResult(auditReportExport(organizationId!, targetReports.map((report) => report.id), 'pdf'));
      const exportReports = await loadReportValues(targetReports);
      const pdfReports = await Promise.all(exportReports.map(async (report) => {
        const data = getReportData(report);
        if (!data) throw new Error('Export report body is missing');
        const template = await loadPdfTemplate(report.clients.id);

        const pdfData: PdfReportData = {
          id: report.id,
          clientName: report.clients.name,
          helperName: getExportHelperNames(report),
          startAt: report.start_at, endAt: report.end_at,
          data: data,
          template
        };
        return { reportId: report.id, report, pdfData };
      }));

      const validReports = pdfReports.map(({ pdfData }) => pdfData);

      if (filterShiftId) {
        const { downloadReportZip, buildReportFileName } = await import('@/utils/reportZipExport');
        const entries = pdfReports
          .map(({ report, pdfData }) => {
            const serviceTypeName = report.segment?.service_type?.name ?? null;
            return {
              data: pdfData,
              fileName: buildReportFileName(report.clients.name, serviceTypeName, report.start_at, report.end_at),
            };
          });
        const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        await downloadReportZip(entries, `サービス提供記録_${dateStr}`);
      } else {
        const [{ pdf }, { ServiceRecordDocument }] = await Promise.all([
          import('@react-pdf/renderer'),
          import('@/components/pdf/ServiceRecordDocument'),
        ]);
        const pdfDocument = <ServiceRecordDocument reports={validReports} /> as ReactElement<DocumentProps>;
        const blob = await pdf(pdfDocument).toBlob();
        downloadBlob(blob, `reports_${new Date().toISOString().slice(0,10)}.pdf`);
      }
    } catch (e) { console.error(e); showToast('PDF作成中にエラーが発生しました', 'error'); }
  });

  const handleCreateGasPdf = () => runExport(async () => {
    const targetReports = snapshotExportReports(reports, selected);
    if (targetReports.length === 0) { showToast('出力するデータがありません。', 'warning'); return; }
    try {
      const clientIds = Array.from(new Set(targetReports.map((report) => report.clients.id)));
      const { data: clientsInfo, error: clientsInfoError } = await supabase.from('clients').select('id, name, google_template_id, google_folder_id').in('id', clientIds);
      if (clientsInfoError) throw clientsInfoError;
      if (clientIds.some((id) => !clientsInfo?.some((client) => client.id === id))) {
          throw new Error('Export client is missing');
      }

      const templates = await loadExportTemplates(clientIds);
      const schemaMap = new Map(templates.map((template) => [template.client_id, template.schema ?? []]));

      const { data: orgInfo, error: orgError } = await supabase.from('organizations').select('google_folder_id').eq('id', organizationId!).single();
      if (orgError) throw orgError;
      if (!orgInfo) throw new Error('Export organization is missing');
      if (!orgInfo.google_folder_id) { showToast('事業所のGoogleドライブ連携が設定されていません。設定画面から連携を行ってください。', 'warning'); return; }

      if (!(await confirm({ message: `${targetReports.length}件の帳票を作成しますか？\n（Googleドライブに保存されます）` }))) return;
      setGasProgress({ total: targetReports.length, current: 0, currentName: '準備中...' });

      let lastOpenedFolderUrl: string | null = null;

      const exportReports = await loadReportValues(targetReports);
      await readActionResult(auditReportExport(organizationId!, targetReports.map((report) => report.id), 'pdf'));
      const clientGroups: Record<string, ExportReport[]> = {};
      exportReports.forEach((report) => {
          const clientId = report.clients.id;
          if (!clientGroups[clientId]) clientGroups[clientId] = [];
          clientGroups[clientId].push(report);
      });
      let processedCount = 0;
      const now = new Date();
      const timeStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
      const exportFolderName = `${timeStr}_出力分`;

      for (const client of clientsInfo || []) {
          const reports = clientGroups[client.id];
          if (!reports) continue;
          if (!client.google_template_id) {
              processedCount += reports.length;
              setGasProgress({ total: targetReports.length, current: processedCount, currentName: `${client.name}: テンプレート未設定のためスキップ` });
              continue;
          }

          setGasProgress(prev => ({ ...prev!, currentName: `${client.name}: フォルダ確認中...` }));

          const folderRes = await readActionResult(callGasApi({
              action: 'manage_client_folder',
              organizationId: organizationId!,
              clientId: client.id,
              orgFolderId: orgInfo.google_folder_id,
              clientName: client.name,
              currentFolderId: client.google_folder_id
          }));

          if (folderRes.folderId && folderRes.folderId !== client.google_folder_id) {
              await readActionResult(updateClientGoogleLink(organizationId!, client.id, { folderId: folderRes.folderId }));
          }
          const clientRootFolderId = folderRes.folderId;

          setGasProgress(prev => ({ ...prev!, currentName: `${client.name}: サブフォルダ作成中...` }));
          const subFolderRes = await readActionResult(callGasApi({
              action: 'create_sub_folder',
              organizationId: organizationId!,
              clientId: client.id,
              parentId: clientRootFolderId,
              folderName: exportFolderName
          }));
          const targetFolderId = subFolderRes.folderId;
          lastOpenedFolderUrl = subFolderRes.folderUrl;

          const clientSchema = schemaMap.get(client.id) ?? [];

          for (const report of reports) {
              setGasProgress(prev => ({ ...prev!, currentName: `${client.name}: ${new Date(report.start_at).toLocaleDateString()} の記録を作成中...` }));
              const { data: finalPayload, fileName } = buildGasReportOutput(report, client.name, clientSchema);
              await readActionResult(callGasApi({
                  action: 'create_pdf',
                  organizationId: organizationId!,
                  clientId: client.id,
                  reportId: report.id,
                  folderId: targetFolderId,
                  templateId: client.google_template_id,
                  data: finalPayload,
                  fileName
              }));
              processedCount++;
              setGasProgress({ total: targetReports.length, current: processedCount, currentName: '' });
          }
      }
      showToast('作成が完了しました。保存先のフォルダを開きます。');
      if (lastOpenedFolderUrl) window.open(lastOpenedFolderUrl, '_blank');

    } catch (e) { console.error(e); showToast(getActionErrorMessage(e, 'エラーが発生しました'), 'error'); }
    finally { setGasProgress(null); }
  });

  return { exporting, gasProgress, handleExportCSV, handleExportTravelCosts, handleBulkDownloadPDF, handleCreateGasPdf };
}
