'use client';

import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Report, ReportStatus } from '@/utils/reportExportHelper';

export function useReportActions(
  setSelected: (val: readonly string[]) => void,
  setRawReports: React.Dispatch<React.SetStateAction<Report[]>>,
  showToast: (msg: string, severity?: 'success' | 'error' | 'info') => void
) {
  const [processing, setProcessing] = useState(false);

  const handleBulkApprove = async (selected: readonly string[]) => {
    if (selected.length === 0) return;
    if (!confirm(`${selected.length}件を一括承認しますか？`)) return;
    setProcessing(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const updateData = { status: 'approved' as ReportStatus, approved_by: user?.id, approved_at: new Date().toISOString() };
      await supabase.from('reports').update(updateData).in('id', selected);
      
      setRawReports(prev => prev.map(r => selected.includes(r.id) ? { ...r, ...updateData, approved_by_user: { name: 'あなた' } } : r));
      setSelected([]);
      showToast('一括承認しました', 'success');
    } catch (e) {
      console.error(e);
      showToast('エラーが発生しました', 'error');
    } finally {
      setProcessing(false);
    }
  };

  const handleBulkRemand = async (selected: readonly string[]) => {
    if (selected.length === 0 || !confirm(`${selected.length}件を一括で差戻ししますか？`)) return;
    setProcessing(true);
    try {
      await supabase.from('reports').update({ status: 'remanded', approved_by: null, approved_at: null }).in('id', selected);
      setRawReports(prev => prev.map(r => selected.includes(r.id) ? { ...r, status: 'remanded' as ReportStatus } : r));
      setSelected([]);
      showToast('差し戻しました', 'info');
    } catch (e) {
      console.error(e);
      showToast('エラーが発生しました', 'error');
    } finally {
      setProcessing(false);
    }
  };

  const handleBulkDelete = async (selected: readonly string[], reports: Report[]) => {
    if (selected.length === 0 || !confirm(`${selected.length}件を削除しますか？\nこの操作は取り消せません。`)) return;
    
    const targets = reports.filter(r => selected.includes(r.id));
    if (targets.some(r => r.status === 'approved')) {
      alert('選択項目の中に「承認済み」の記録が含まれています。承認を取り消してから削除してください。');
      return;
    }

    setProcessing(true);
    try {
      await supabase.from('reports').delete().in('id', selected);
      setRawReports(prev => prev.filter(r => !selected.includes(r.id)));
      setSelected([]);
      showToast('削除しました', 'success');
    } catch (e) {
      console.error(e);
      showToast('エラーが発生しました', 'error');
    } finally {
      setProcessing(false);
    }
  };

  return {
    processing,
    handleBulkApprove,
    handleBulkRemand,
    handleBulkDelete
  };
}