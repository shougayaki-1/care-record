'use client';

import React from 'react';
import { 
  Box, Typography, Button, Paper, Table, TableBody, TableCell, 
  TableContainer, TableHead, TableRow, IconButton, Stack, Tooltip, Switch, FormControlLabel, Chip, CircularProgress
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import SettingsIcon from '@mui/icons-material/Settings';
import DeleteIcon from '@mui/icons-material/Delete';
import ArchiveIcon from '@mui/icons-material/Archive';
import UnarchiveIcon from '@mui/icons-material/Unarchive';
import PeopleIcon from '@mui/icons-material/People';
import { useRouter } from 'next/navigation';
import { useWorkspace } from '@/context/WorkspaceContext';

// 分割・新規作成したHooksおよびコンポーネントのインポート
import { useClientsPage } from './_hooks/useClientsPage';
import { ClientAddDialog } from './_components/ClientAddDialog';
import { ClientEditDialog } from './_components/ClientEditDialog';

export default function ClientsPage() {
  const router = useRouter();
  const { currentOrg, loading: wsLoading } = useWorkspace();

  // ページ固有のビジネスロジックフックを使用
  const {
    clients,
    loading: isClientsLoading,
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
  } = useClientsPage(currentOrg?.id);

  const handleGoSettings = (id: string) => { 
    router.push(`/app/clients/${id}`); 
  };

  const loading = wsLoading || isClientsLoading;

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Box sx={{ height: 64, borderBottom: 1, borderColor: 'divider', display: 'flex', alignItems: 'center', px: 3, flexShrink: 0, bgcolor: 'background.paper' }}>
        <PeopleIcon sx={{ color: 'action.active', mr: 2 }} />
        <Typography variant="h6" fontWeight="bold" color="text.primary" sx={{ flexGrow: 1 }}>利用者管理</Typography>
        <FormControlLabel 
          control={<Switch checked={showArchived} onChange={e => setShowArchived(e.target.checked)} />} 
          label="アーカイブを表示" 
        />
      </Box>

      <Box sx={{ flexGrow: 1, overflowY: 'auto', p: 3 }}>
        <Box display="flex" justifyContent="flex-end" mb={3}>
          <Button variant="contained" startIcon={<AddIcon />} onClick={handleOpenAdd}>新規登録</Button>
        </Box>

        <TableContainer component={Paper} variant="outlined">
          <Table>
            <TableHead sx={{ bgcolor: '#f8f9fa' }}>
              <TableRow>
                <TableCell sx={{ fontWeight: 'bold' }}>利用者氏名</TableCell>
                <TableCell sx={{ fontWeight: 'bold' }}>状態</TableCell>
                <TableCell align="right" sx={{ fontWeight: 'bold' }}>操作</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {clients.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={3} align="center" sx={{ py: 5, color: '#999' }}>登録がありません</TableCell>
                </TableRow>
              ) : (
                clients.map((client) => (
                  <TableRow key={client.id} hover sx={{ opacity: client.archived_at ? 0.6 : 1, bgcolor: client.archived_at ? '#f9f9f9' : 'inherit' }}>
                    <TableCell>{client.name}</TableCell>
                    <TableCell>
                      {client.archived_at ? 
                        <Chip label="アーカイブ" size="small" /> : 
                        <Chip label="有効" color="success" size="small" variant="outlined" />
                      }
                    </TableCell>
                    <TableCell align="right">
                      <Stack direction="row" justifyContent="flex-end" spacing={1}>
                        {!client.archived_at && (
                          <>
                            <Tooltip title="氏名を編集">
                              <IconButton size="small" onClick={() => handleOpenEdit(client)}>
                                <EditIcon fontSize="small" />
                              </IconButton>
                            </Tooltip>
                            <Tooltip title="詳細設定">
                              <IconButton size="small" color="primary" onClick={() => handleGoSettings(client.id)}>
                                <SettingsIcon fontSize="small" />
                              </IconButton>
                            </Tooltip>
                          </>
                        )}
                        
                        {client.archived_at ? (
                          <>
                            <Tooltip title="復元">
                              <IconButton size="small" onClick={() => handleArchive(client.id, false)}>
                                <UnarchiveIcon />
                              </IconButton>
                            </Tooltip>
                            <Tooltip title="完全削除">
                              <IconButton size="small" color="error" onClick={() => handleDelete(client.id)}>
                                <DeleteIcon />
                              </IconButton>
                            </Tooltip>
                          </>
                        ) : (
                          <Tooltip title="アーカイブ">
                            <IconButton size="small" onClick={() => handleArchive(client.id, true)}>
                              <ArchiveIcon />
                            </IconButton>
                          </Tooltip>
                        )}
                      </Stack>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Box>

      {/* 抽出したダイアログコンポーネント */}
      <ClientAddDialog
        open={openAdd}
        onClose={() => setOpenAdd(false)}
        name={newName}
        onChangeName={setNewName}
        onConfirm={handleAddClient}
        disabled={isSubmitting}
      />

      <ClientEditDialog
        open={openEdit}
        onClose={() => setOpenEdit(false)}
        name={editName}
        onChangeName={setEditName}
        onConfirm={handleUpdateClient}
        disabled={isSubmitting}
      />
    </Box>
  );
}