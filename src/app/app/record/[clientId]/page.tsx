'use client';

import React from 'react';
import {
  Box, Button, Container, Typography, Paper, Stack, IconButton, CircularProgress, Tabs, Tab
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import SendIcon from '@mui/icons-material/Send';
import SaveIcon from '@mui/icons-material/Save';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import AssignmentReturnIcon from '@mui/icons-material/AssignmentReturn';
import DeleteIcon from '@mui/icons-material/Delete';
import PhotoCamera from '@mui/icons-material/PhotoCamera';

import { useRecord } from './_hooks/useRecord';
import { RecordHeader } from './_components/RecordHeader';
import { RecordForm } from './_components/RecordForm';
import { RecordActions } from './_components/RecordActions';

export default function RecordPage() {
  const {
    clientId, currentOrg, currentReportId, clientName, template, answers,
    selectableStaffs, selectedHelpers, setSelectedHelpers,
    startDateTime, setStartDateTime, endDateTime, setEndDateTime,
    serviceTime, setServiceTime, travelTime, setTravelTime,
    currentStatus, isDirty, images, openCloseDialog, setOpenCloseDialog,
    openApproveDialog, setOpenApproveDialog, openSubmitDialog, setOpenSubmitDialog,
    openRemandDialog, setOpenRemandDialog, loading, errors, submitting,
    isSpanningMonth, selectedPart, originalShiftTimes, formatTimeForLabel,
    handlePartChange, handleChange, handleAnswerChange, handleImageUpload,
    handleDeleteReport, handleDraftSave, handleSubmit, executeSubmit,
    handleApprove, executeApprove, handleRemand, executeRemand, handleClose,
    handleDialogDiscard, handleDialogSaveDraft, groupedSections, isAdmin
  } = useRecord();

  if (loading) return <Box sx={{ display: 'flex', justifyContent: 'center', p: 10 }}><CircularProgress /></Box>;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
       <Box sx={{ height: 64, borderBottom: 1, borderColor: 'divider', display: 'flex', alignItems: 'center', px: 3, flexShrink: 0, bgcolor: 'background.paper' }}>
            <IconButton edge="start" onClick={handleClose} sx={{ mr: 1, color: 'action.active' }}><CloseIcon /></IconButton>
            <Typography variant="h6" fontWeight="bold" sx={{ color: 'text.primary', flexGrow: 1 }}>
                {currentReportId ? (isAdmin && currentStatus === 'pending' ? '記録の確認・承認' : (currentStatus === 'approved' ? '承認済みの記録' : '記録を修正')) : `${clientName} 様`}
            </Typography>
            
            <Stack direction="row" spacing={1}>
                {currentReportId && currentStatus !== 'approved' && (
                    <IconButton color="error" onClick={handleDeleteReport} disabled={submitting}><DeleteIcon /></IconButton>
                )}
                
                {isAdmin && currentStatus === 'pending' && <Button variant="contained" color="success" size="small" startIcon={<CheckCircleIcon />} onClick={handleApprove} disabled={submitting}>承認</Button>}
                {isAdmin && currentStatus === 'approved' && <Button variant="contained" color="warning" size="small" startIcon={<AssignmentReturnIcon />} onClick={handleRemand} disabled={submitting}>承認取消</Button>}
                {(!isAdmin || currentStatus !== 'pending') && currentStatus !== 'approved' && (
                    <>
                        <Button variant="outlined" size="small" startIcon={<SaveIcon />} onClick={handleDraftSave} disabled={submitting}>下書き</Button>
                        <Button variant="contained" size="small" startIcon={<SendIcon />} onClick={handleSubmit} disabled={submitting} sx={{ fontWeight: 'bold' }}>送信</Button>
                    </>
                )}
            </Stack>
       </Box>

      <Box sx={{ flexGrow: 1, overflowY: 'auto', p: 3 }}>
        <Container maxWidth="md" disableGutters>
            <Stack spacing={4}>
            
            {/* 月末跨ぎ夜勤用の分割タブ */}
            {isSpanningMonth && (
                <Paper variant="outlined" sx={{ p: 2, bgcolor: '#FFFDE7', borderColor: '#FFF59D', borderRadius: 3 }}>
                    <Typography variant="subtitle2" fontWeight="bold" color="warning.dark" mb={1.5}>
                        ⚠ このシフトは月末を跨ぐ夜勤のため、請求都合上00:00で分割して記録を登録します。
                    </Typography>
                    <Tabs 
                        value={selectedPart} 
                        onChange={(_, val) => handlePartChange(val)} 
                        variant="fullWidth"
                        sx={{ bgcolor: '#FFF', borderRadius: 2 }}
                    >
                        <Tab value="part1" label={`前半（月末日の24:00まで: ${formatTimeForLabel(originalShiftTimes?.start_at)} 〜 24:00）`} />
                        <Tab value="part2" label={`後半（翌月1日の00:00から: 00:00 〜 ${formatTimeForLabel(originalShiftTimes?.end_at)}）`} />
                    </Tabs>
                </Paper>
            )}

            {/* ヘッダーフォーム */}
            <Paper variant="outlined" sx={{ p: 4, borderRadius: 3, bgcolor: '#fff' }}>
                <RecordHeader
                    selectableStaffs={selectableStaffs}
                    selectedHelpers={selectedHelpers}
                    setSelectedHelpers={setSelectedHelpers}
                    startDateTime={startDateTime}
                    setStartDateTime={setStartDateTime}
                    endDateTime={endDateTime}
                    setEndDateTime={setEndDateTime}
                    serviceTime={serviceTime}
                    setServiceTime={setServiceTime}
                    travelTime={travelTime}
                    setTravelTime={setTravelTime}
                    errors={errors}
                    handleChange={handleChange}
                />
            </Paper>

            {/* 各動的フォーム */}
            <RecordForm
                groupedSections={groupedSections}
                answers={answers}
                handleAnswerChange={handleAnswerChange}
                errors={errors}
            />

            {/* 画像添付領域 */}
            <Paper variant="outlined" sx={{ p: 3, mt: 3, borderRadius: 3 }}>
                <Typography variant="subtitle2" fontWeight="bold" gutterBottom>画像添付</Typography>
                <Stack direction="row" gap={2} flexWrap="wrap">
                    {images.map(img => (
                        <Box key={img.id} component="img" src={img.url} sx={{ width: 100, height: 100, objectFit: 'cover', borderRadius: 1 }} />
                    ))}
                    <IconButton color="primary" component="label" sx={{ width: 100, height: 100, border: '1px dashed #ccc', borderRadius: 1, flexDirection: 'column' }}>
                        <input hidden accept="image/*" type="file" onChange={handleImageUpload} disabled={!currentReportId} />
                        <PhotoCamera />
                        {!currentReportId && <Typography variant="caption" sx={{ fontSize: 9 }}>未保存</Typography>}
                    </IconButton>
                </Stack>
                {!currentReportId && <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>※一度下書き保存すると画像を添付できます</Typography>}
            </Paper>

            </Stack>
        </Container>
      </Box>

      {/* 確認ダイアログ群 */}
      <RecordActions
        openCloseDialog={openCloseDialog}
        setOpenCloseDialog={setOpenCloseDialog}
        openApproveDialog={openApproveDialog}
        setOpenApproveDialog={setOpenApproveDialog}
        openSubmitDialog={openSubmitDialog}
        setOpenSubmitDialog={setOpenSubmitDialog}
        openRemandDialog={openRemandDialog}
        setOpenRemandDialog={setOpenRemandDialog}
        handleDialogDiscard={handleDialogDiscard}
        handleDialogSaveDraft={handleDialogSaveDraft}
        executeApprove={executeApprove}
        executeRemand={executeRemand}
        executeSubmit={executeSubmit}
      />
    </Box>
  );
}