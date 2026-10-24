import { useEffect, useRef, useState } from 'react';
import { useToast } from '@/components/ui/ToastProvider';
import type { ReviewRow } from '@/components/ui/AiImportReviewTable';
import type { FileEntry, FileGroup } from './transforms';

export function useAiImportFiles(rows: ReviewRow[], isRunning: () => boolean) {
  const { showToast } = useToast();
  const [fileEntries, setFileEntries] = useState<FileEntry[]>([]);
  const [groups, setGroups] = useState<FileGroup[]>([]);
  const [selectedFileIds, setSelectedFileIds] = useState<Set<string>>(new Set());
  const fileInputRef = useRef<HTMLInputElement>(null);
  const ownedUrls = useRef(new Set<string>());
  // A removed source can still be open in the review table. Release its URL
  // only after both the file list and the review rows stop referencing it.
  useEffect(() => {
    const live = new Set([...fileEntries, ...rows].map((entry) => entry.previewUrl));
    for (const url of ownedUrls.current) {
      if (!live.has(url)) { URL.revokeObjectURL(url); ownedUrls.current.delete(url); }
    }
  }, [fileEntries, rows]);
  useEffect(() => {
    const urls = ownedUrls.current;
    return () => { urls.forEach((url) => URL.revokeObjectURL(url)); urls.clear(); };
  }, []);
  // ファイル追加
  const addFiles = (files: File[]) => {
    if (isRunning()) return;
    const allowed = files.filter((f) =>
      f.type === 'application/pdf' ||
      f.type.startsWith('image/jpeg') ||
      f.type.startsWith('image/png') ||
      f.type.startsWith('image/webp'),
    );
    const entries: FileEntry[] = allowed.map((f) => ({
      id: crypto.randomUUID(),
      file: f,
      groupId: null,
      previewUrl: f.type.startsWith('image/') ? URL.createObjectURL(f) : null,
    }));
    entries.forEach((entry) => { if (entry.previewUrl) ownedUrls.current.add(entry.previewUrl); });
    setFileEntries((prev) => [...prev, ...entries]);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    addFiles(Array.from(e.dataTransfer.files));
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      addFiles(Array.from(e.target.files));
      e.target.value = '';
    }
  };

  const removeFile = (id: string) => {
    if (isRunning()) return;
    setFileEntries((prev) => prev.filter((f) => f.id !== id));
    setSelectedFileIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    setGroups((prev) =>
      prev
        .map((g) => ({ ...g, fileIds: g.fileIds.filter((fid) => fid !== id) }))
        .filter((g) => g.fileIds.length > 0),
    );
  };

  const toggleSelectFile = (id: string) => {
    if (isRunning()) return;
    setSelectedFileIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const mergeSelected = () => {
    if (isRunning()) return;
    if (selectedFileIds.size < 2) return;
    const ids = Array.from(selectedFileIds);
    const selectedEntries = fileEntries.filter((entry) => ids.includes(entry.id));
    if (selectedEntries.some((entry) => !entry.file.type.startsWith('image/'))) {
      showToast('PDFは単独で処理します。画像ファイルだけを選択してください。', 'warning');
      return;
    }
    const groupId = crypto.randomUUID();
    setGroups((prev) => {
      // Remove these ids from any existing group
      const cleaned = prev.map((g) => ({
        ...g,
        fileIds: g.fileIds.filter((fid) => !ids.includes(fid)),
      })).filter((g) => g.fileIds.length > 0);
      return [...cleaned, { id: groupId, fileIds: ids }];
    });
    setFileEntries((prev) =>
      prev.map((f) => (ids.includes(f.id) ? { ...f, groupId } : f)),
    );
    setSelectedFileIds(new Set());
  };

  const ungroupFile = (id: string) => {
    if (isRunning()) return;
    setFileEntries((prev) =>
      prev.map((f) => (f.id === id ? { ...f, groupId: null } : f)),
    );
    setGroups((prev) => {
      const next = prev
        .map((g) => ({ ...g, fileIds: g.fileIds.filter((fid) => fid !== id) }))
        .filter((g) => g.fileIds.length > 0);
      return next;
    });
  };

  const clearFiles = () => {
    if (isRunning()) return;
    setFileEntries([]);
    setGroups([]);
    setSelectedFileIds(new Set());
  };
  return { fileEntries, groups, selectedFileIds, fileInputRef, addFiles, handleDrop, handleFileInput, removeFile, toggleSelectFile, mergeSelected, ungroupFile, clearFiles };
}
