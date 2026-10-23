import { AppButton, ScrollableActions } from '@/components/ui';
import { Box, Checkbox, IconButton, List, ListItem, ListItemIcon, ListItemText, Stack, Tooltip, Typography, LinearProgress } from '@/components/ui/mui';
import DeleteIcon from '@mui/icons-material/Delete';
import MergeTypeIcon from '@mui/icons-material/MergeType';
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf';
import ImageIcon from '@mui/icons-material/Image';
import type { FileEntry, FileGroup } from '@/hooks/aiImport/transforms';

type Props = {
  fileEntries: FileEntry[];
  groups: FileGroup[];
  selectedFileIds: Set<string>;
  pending: boolean;
  progress?: { processed: number; total: number };
  toggleSelectFile: (id: string) => void;
  ungroupFile: (id: string) => void;
  removeFile: (id: string) => void;
  mergeSelected: () => void;
};
export function AiImportFiles({ fileEntries, groups, selectedFileIds, pending, progress, toggleSelectFile, ungroupFile, removeFile, mergeSelected }: Props) {
  const fileIcon = (file: File) => {
    if (file.type === 'application/pdf') return <PictureAsPdfIcon fontSize="small" color="error" />;
    return <ImageIcon fontSize="small" color="primary" />;
  };

  // グループ表示用のマップ
  const groupByGroupId = new Map(groups.map((g) => [g.id, g]));

  // ファイルリスト表示（グループ単位でまとめる）
  const renderedGroupIds = new Set<string>();
  const fileListItems: React.ReactNode[] = [];
  for (const entry of fileEntries) {
    if (entry.groupId && !renderedGroupIds.has(entry.groupId)) {
      renderedGroupIds.add(entry.groupId);
      const grp = groupByGroupId.get(entry.groupId);
      if (!grp) continue;
      const grpEntries = grp.fileIds
        .map((fid) => fileEntries.find((e) => e.id === fid))
        .filter(Boolean) as FileEntry[];
      fileListItems.push(
        <Box component="li" key={`group-${entry.groupId}`} sx={{ border: '1px dashed', borderColor: 'primary.light', borderRadius: 1, p: 0.5, mb: 0.5 }}>
          <Typography variant="caption" color="primary" sx={{ pl: 1 }}>
            グループ（{grpEntries.length} ファイル → 1記録）
          </Typography>
          <List dense disablePadding>
          {grpEntries.map((ge) => (
            <ListItem key={ge.id} disablePadding sx={{ pl: 2 }}>
              <ListItemIcon sx={{ minWidth: 28 }}>
                <Checkbox
                  size="small"
                  slotProps={{ input: { 'aria-label': `${ge.file.name}を選択` } }}
                  checked={selectedFileIds.has(ge.id)}
                  onChange={() => toggleSelectFile(ge.id)}
                  disabled={pending}
                />
              </ListItemIcon>
              <ListItemIcon sx={{ minWidth: 28 }}>{fileIcon(ge.file)}</ListItemIcon>
              <ListItemText
                primary={ge.file.name}
                primaryTypographyProps={{ fontSize: '0.85rem', noWrap: true }}
              />
              <Tooltip title="グループから外す">
                <IconButton aria-label={`${ge.file.name}をグループから外す`} size="small" onClick={() => ungroupFile(ge.id)} disabled={pending}>
                  <MergeTypeIcon fontSize="small" />
                </IconButton>
              </Tooltip>
              <IconButton aria-label={`${ge.file.name}を削除`} size="small" onClick={() => removeFile(ge.id)} disabled={pending}>
                <DeleteIcon fontSize="small" />
              </IconButton>
            </ListItem>
          ))}
          </List>
        </Box>,
      );
    } else if (!entry.groupId) {
      fileListItems.push(
        <ListItem key={entry.id} disablePadding>
          <ListItemIcon sx={{ minWidth: 28 }}>
            <Checkbox
              size="small"
              slotProps={{ input: { 'aria-label': `${entry.file.name}を選択` } }}
              checked={selectedFileIds.has(entry.id)}
              onChange={() => toggleSelectFile(entry.id)}
              disabled={pending}
            />
          </ListItemIcon>
          <ListItemIcon sx={{ minWidth: 28 }}>{fileIcon(entry.file)}</ListItemIcon>
          <ListItemText
            primary={entry.file.name}
            primaryTypographyProps={{ fontSize: '0.85rem', noWrap: true }}
          />
          <IconButton aria-label={`${entry.file.name}を削除`} size="small" onClick={() => removeFile(entry.id)} disabled={pending}>
            <DeleteIcon fontSize="small" />
          </IconButton>
        </ListItem>,
      );
    }
  }

  return <>
      {/* ファイルリスト */}
      {fileEntries.length > 0 && (
        <Box sx={{ mb: 2, p: 1, borderTop: 1, borderBottom: 1, borderColor: 'divider' }}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'center' }} sx={{ mb: 1 }}>
            <Typography variant="subtitle2">{fileEntries.length} ファイル選択中</Typography>
            <Tooltip title="選択したファイルを1記録としてまとめる">
              <ScrollableActions aria-label="ファイル操作" role="group" tabIndex={0}>
                <AppButton intent="secondary"
                  size="small"
                  startIcon={<MergeTypeIcon />}
                  disabled={selectedFileIds.size < 2 || pending}
                  onClick={mergeSelected}
                  variant="outlined"
                >
                  1記録としてまとめる
                </AppButton>
              </ScrollableActions>
            </Tooltip>
          </Stack>
          <List dense>{fileListItems}</List>
        </Box>
      )}

      {progress && (
        <Box mb={2}>
          <Typography variant="body2" color="text.secondary" mb={0.5}>
            {progress.processed} / {progress.total || fileEntries.length} 件処理中...
          </Typography>
          <LinearProgress aria-label="AI読み取りの進捗" variant={progress.total > 0 ? 'determinate' : 'indeterminate'} value={progress.total > 0 ? (progress.processed / progress.total) * 100 : undefined} />
        </Box>
      )}
  </>;
}
