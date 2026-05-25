'use client';

import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { pdf } from '@react-pdf/renderer';
import { ServiceRecordDocument, PdfReportData } from '@/components/pdf/ServiceRecordDocument';
import { callGasApi } from '@/app/actions/gas';
import { generateKeyMap, FormItem as HelperFormItem } from '@/utils/templateHelper';
import { Report, getReportData, getHelperNames, preparePdfData, CsvColumnDef } from '@/utils/reportExportHelper';

export function useReportExport(
  currentOrgId: string | undefined,
  showToast: (msg: string, severity?: 'success' | 'error') => void
) {
  const [exporting, setExporting] = useState(false);
  const [gasProgress, setGasProgress] = useState<{ total: number, current: number, currentName: string } | null>(null);

  const handleExportCSV = async (targetReports: Report[]) => {
    if (targetReports.length === 0) {
      alert('出力するデータがありません。');
      return;
    }
    if (!confirm(`${targetReports.length}件のデータをエクスポートします。\n差し込み印刷用にすべての項目を列に展開します。よろしいですか？`)) return;
    setExporting(true);
    try {
      const clientIds = Array.from(new Set(targetReports.map(r => r.clients.id)));
      const { data: templates } = await supabase.from('form_templates').select('client_id, schema').in('client_id', clientIds);

      const dynamicColumns: CsvColumnDef[] = [];
      const seenHeaders = new Set<string>();

      templates?.forEach(tmpl => {
          const schema = tmpl.schema as HelperFormItem[];
          if (!schema) return;
          schema.forEach(item => {
              if (item.type === 'section') return;
              if (['multicheckbox', 'select'].includes(item.type) && item.options) {
                  const options = item.options.split(',');
                  options.forEach((opt: string) => {
                      const cleanOpt = opt.trim();
                      const header = `${item.label}_${cleanOpt}`;
                      if (!seenHeaders.has(header)) { dynamicColumns.push({ header: header, key: item.id, type: 'option', matchValue: cleanOpt }); seenHeaders.add(header); }
                  });
              } else if (item.type === 'checkbox') {
                  const header = item.label;
                  if (!seenHeaders.has(header)) { dynamicColumns.push({ header: header, key: item.id, type: 'bool' }); seenHeaders.add(header); }
              } else {
                  const header = item.label;
                  if (!seenHeaders.has(header)) { dynamicColumns.push({ header: header, key: item.id, type: 'value' }); seenHeaders.add(header); }
              }
              if (item.hasDetail) {
                  const header = `${item.label}_詳細`;
                  if (!seenHeaders.has(header)) { dynamicColumns.push({ header: header, key: `${item.id}_detail`, type: 'value' }); seenHeaders.add(header); }
              }
          });
      });

      const fixedHeader = ['記録ID', 'ステータス', '利用者ID', '利用者名', '実施ヘルパー', '入力者名', '開始日付', '開始時刻', '終了日付', '終了時刻', 'サービス時間(h)', '移動時間(h)', '承認者名', '承認日時', '作成日時', '更新日時'];
      const headerRow = [...fixedHeader, ...dynamicColumns.map(c => c.header)];
      
      const rows = targetReports.map(r => {
          const data = getReportData(r) || {};
          const start = new Date(r.start_at);
          const end = new Date(r.end_at);
          const formatDate = (d: Date) => `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
          const formatTime = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
          let statusText = '';
          switch(r.status) { case 'approved': statusText = '承認済'; break; case 'remanded': statusText = '差戻し'; break; case 'pending': statusText = '未承認'; break; default: statusText = r.status; }

          const fbInputter = Array.isArray(r.helper) ? r.helper[0]?.name : r.helper?.name;

          const row = [
              r.id, statusText, r.clients.id, r.clients.name, getHelperNames(r), fbInputter || '不明',
              formatDate(start), formatTime(start), formatDate(end), formatTime(end),
              data.service_time || '0', data.travel_time || '0',
              r.approved_by_user?.name || '', r.approved_at ? new Date(r.approved_at).toLocaleString() : '',
              new Date(r.created_at).toLocaleString(), new Date(r.updated_at).toLocaleString()
          ];

          dynamicColumns.forEach(col => {
              const rawVal = data[col.key];
              if (col.type === 'bool') { row.push(rawVal ? '○' : ''); } 
              else if (col.type === 'option') {
                  let isMatch = false;
                  if (Array.isArray(rawVal)) isMatch = rawVal.includes(col.matchValue || '');
                  else if (typeof rawVal === 'string') isMatch = rawVal === col.matchValue;
                  row.push(isMatch ? '○' : '');
              } else {
                  if (rawVal === null || rawVal === undefined) row.push('');
                  else { const strVal = Array.isArray(rawVal) ? rawVal.join(' ') : String(rawVal); row.push(`"${strVal.replace(/"/g, '""')}"`); }
              }
          });
          return row.join(',');
      });

      const csvContent = '\uFEFF' + [headerRow.join(','), ...rows].join('\n'); 
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `reports_export_${new Date().toISOString().slice(0,10)}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (e) {
      console.error(e);
      showToast('エクスポート中にエラーが発生しました', 'error');
    } finally {
      setExporting(false);
    }
  };

  const handleBulkDownloadPDF = async (targetReports: Report[]) => {
    if (targetReports.length === 0) {
      alert('出力するデータがありません');
      return;
    }
    if (targetReports.length > 50) { if (!confirm(`${targetReports.length}件のPDFを作成します。\n時間がかかる場合があります。`)) return; } 
    else { if (!confirm(`${targetReports.length}件のPDFを出力しますか？`)) return; }

    setExporting(true);
    try {
      const pdfReports = await Promise.all(targetReports.map(async (report) => {
        const data = getReportData(report);
        if (!data) return null;
        const { data: tmplData } = await supabase.from('form_templates').select('schema').eq('client_id', report.clients.id).maybeSingle();
        
        const pdfData: PdfReportData = {
          id: report.id, 
          clientName: report.clients.name, 
          helperName: getHelperNames(report),
          startAt: report.start_at, endAt: report.end_at, 
          data: data, 
          template: (tmplData?.schema as HelperFormItem[]) || []
        };
        return pdfData;
      }));
      
      const validReports = pdfReports.filter((r): r is PdfReportData => r !== null);
      const blob = await pdf(<ServiceRecordDocument reports={validReports} />).toBlob();
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `reports_${new Date().toISOString().slice(0,10)}.pdf`;
      link.click();
    } catch (e) {
      console.error(e);
      showToast('PDF作成中にエラーが発生しました', 'error');
    } finally {
      setExporting(false);
    }
  };

  const handleCreateGasPdf = async (targetReports: Report[]) => {
    if (targetReports.length === 0) {
      alert('出力するデータがありません。');
      return;
    }
    
    const clientGroups: Record<string, Report[]> = {};
    targetReports.forEach(r => {
        const cid = r.clients.id;
        if (!clientGroups[cid]) clientGroups[cid] = [];
        clientGroups[cid].push(r);
    });

    const clientIds = Object.keys(clientGroups);
    const { data: clientsInfo } = await supabase.from('clients').select('id, name, google_template_id, google_folder_id').in('id', clientIds);
    const { data: templates } = await supabase.from('form_templates').select('client_id, schema').in('client_id', clientIds);

    const schemaMap: Record<string, HelperFormItem[]> = {};
    const keyMaps: Record<string, Record<string, string>> = {};

    templates?.forEach(t => { 
        const s = t.schema as HelperFormItem[];
        schemaMap[t.client_id] = s;
        keyMaps[t.client_id] = generateKeyMap(s);
    });

    const { data: orgInfo } = await supabase.from('organizations').select('google_folder_id').eq('id', currentOrgId!).single();
    if (!orgInfo?.google_folder_id) {
      alert('事業所のGoogleドライブ連携が設定されていません。\n設定画面から連携を行ってください。');
      return;
    }

    if (!confirm(`${targetReports.length}件の帳票を作成しますか？\n（Googleドライブに保存されます）`)) return;
    setGasProgress({ total: targetReports.length, current: 0, currentName: '準備中...' });

    let lastOpenedFolderUrl: string | null = null;

    try {
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
            
            const folderRes = await callGasApi({
                action: 'manage_client_folder',
                orgFolderId: orgInfo.google_folder_id,
                clientName: client.name,
                currentFolderId: client.google_folder_id
            });

            if (folderRes.status !== 'success') throw new Error(`Folder Error: ${folderRes.message}`);
            if (folderRes.folderId !== client.google_folder_id) {
                await supabase.from('clients').update({ google_folder_id: folderRes.folderId }).eq('id', client.id);
            }
            const clientRootFolderId = folderRes.folderId;

            setGasProgress(prev => ({ ...prev!, currentName: `${client.name}: サブフォルダ作成中...` }));
            const subFolderRes = await callGasApi({
                action: 'create_sub_folder',
                parentId: clientRootFolderId,
                folderName: exportFolderName
            });
            const targetFolderId = subFolderRes.folderId; 
            lastOpenedFolderUrl = subFolderRes.folderUrl;

            const clientSchema = schemaMap[client.id] || [];
            const clientKeyMap = keyMaps[client.id] || {};

            for (const report of reports) {
                setGasProgress(prev => ({ ...prev!, currentName: `${client.name}: ${new Date(report.start_at).toLocaleDateString()} の記録を作成中...` }));
                const data = getReportData(report) || {};
                
                const flatData: Record<string, string | number | boolean | null | undefined> = {};
                const start = new Date(report.start_at);
                const end = new Date(report.end_at);
                
                flatData['利用者名'] = client.name;
                flatData['担当ヘルパー名'] = getHelperNames(report);
                flatData['開始日付'] = `${start.getFullYear()}/${start.getMonth()+1}/${start.getDate()}`;
                flatData['開始時刻'] = `${start.getHours()}:${String(start.getMinutes()).padStart(2,'0')}`;
                flatData['終了日付'] = `${end.getFullYear()}/${end.getMonth()+1}/${end.getDate()}`;
                flatData['終了時刻'] = `${end.getHours()}:${String(end.getMinutes()).padStart(2,'0')}`;
                flatData['サービス時間'] = (data.service_time as string | number) || '0';
                flatData['移動時間'] = (data.travel_time as string | number) || '0';

                const readableData = preparePdfData(data, clientSchema, clientKeyMap);
                const finalPayload = { ...flatData, ...readableData } as Record<string, unknown>;

                await callGasApi({
                    action: 'create_pdf',
                    folderId: targetFolderId, 
                    templateId: client.google_template_id,
                    data: finalPayload, 
                    fileName: `${client.name}_${(flatData['開始日付'] as string).replace(/\//g,'-')}_提供記録`
                });
                processedCount++;
                setGasProgress({ total: targetReports.length, current: processedCount, currentName: '' });
            }
        }
        alert('作成が完了しました。保存先のフォルダを開きます。');
        if (lastOpenedFolderUrl) window.open(lastOpenedFolderUrl, '_blank');

    } catch (e) {
        console.error(e);
        showToast('GAS連携中にエラーが発生しました', 'error');
    } finally {
        setGasProgress(null);
    }
  };

  return {
    exporting,
    gasProgress,
    handleExportCSV,
    handleBulkDownloadPDF,
    handleCreateGasPdf
  };
}