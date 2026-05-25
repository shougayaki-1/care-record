'use client';

import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useClients } from '@/hooks/useClients';
import { useToast } from '@/components/ui/ToastProvider';

export function useClientsPage(orgId: string | undefined) {
  const { showToast } = useToast();
  const [showArchived, setShowArchived] = useState(false);

  // 既存の useClients フックを呼び出してデータ取得を共通化
  const { clients, loading, refetch } = useClients(orgId, showArchived);

  const [openAdd, setOpenAdd] = useState(false);
  const [newName, setNewName] = useState('');
  
  const [openEdit, setOpenEdit] = useState(false);
  const [editId, setEditId] = useState('');
  const [editName, setEditName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleOpenAdd = () => {
    setNewName('');
    setOpenAdd(true);
  };

  const handleOpenEdit = (client: { id: string; name: string }) => {
    setEditId(client.id);
    setEditName(client.name);
    setOpenEdit(true);
  };

  const handleAddClient = async () => {
    if (!newName.trim() || !orgId) return;
    setIsSubmitting(true);
    try {
      const { error } = await supabase
        .from('clients')
        .insert([{ name: newName.trim(), organization_id: orgId }]);
      if (error) throw error;
      
      setOpenAdd(false);
      setNewName('');
      showToast('登録しました');
      refetch();
    } catch (error) {
      console.error(error);
      showToast('登録に失敗しました', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUpdateClient = async () => {
    if (!editName.trim()) return;
    setIsSubmitting(true);
    try {
      const { error } = await supabase
        .from('clients')
        .update({ name: editName.trim() })
        .eq('id', editId);
      if (error) throw error;
      
      setOpenEdit(false);
      showToast('更新しました');
      refetch();
    } catch (error) {
      console.error(error);
      showToast('更新に失敗しました', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleArchive = async (id: string, isArchive: boolean) => {
    try {
      const { error } = await supabase
        .from('clients')
        .update({ archived_at: isArchive ? new Date().toISOString() : null })
        .eq('id', id);
      
      if (error) throw error;
      showToast(isArchive ? 'アーカイブしました' : '復元しました');
      refetch();
    } catch (e) {
      console.error(e);
      showToast('エラーが発生しました', 'error');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('本当に削除しますか？\nこの利用者の記録データも全て削除されます。\nこの操作は取り消せません。')) return;
    try {
      const { error } = await supabase.from('clients').delete().eq('id', id);
      if (error) throw error;
      showToast('完全に削除しました');
      refetch();
    } catch (e) {
      console.error(e);
      showToast('削除できませんでした。権限などを確認してください。', 'error');
    }
  };

  return {
    clients,
    loading,
    showArchived,
    setShowArchived,
    openAdd,
    setOpenAdd,
    newName,
    setNewName,
    openEdit,
    setOpenEdit,
    editName,
    setEditName,
    isSubmitting,
    handleOpenAdd,
    handleOpenEdit,
    handleAddClient,
    handleUpdateClient,
    handleArchive,
    handleDelete
  };
}