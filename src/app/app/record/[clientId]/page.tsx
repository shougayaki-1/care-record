'use client';

import { Alert, Box, Button, CircularProgress, Container, IconButton, Stack, Typography } from '@/components/ui/mui';
import CloseIcon from '@mui/icons-material/Close';
import SendIcon from '@mui/icons-material/Send';
import SaveIcon from '@mui/icons-material/Save';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import AssignmentReturnIcon from '@mui/icons-material/AssignmentReturn';
import DeleteIcon from '@mui/icons-material/Delete';
import PhotoCamera from '@mui/icons-material/PhotoCamera';

import { AiImportButton, AppButton, AppDialog, InnerPageHeader, PageLayout } from '@/components/ui';
import { MonthSplitTabs } from '@/components/record/MonthSplitTabs';
import { RecordDynamicSections } from '@/components/record/RecordDynamicSections';
import { RecordMetaForm } from '@/components/record/RecordMetaForm';
import { ShiftSuggestions } from '@/components/record/ShiftSuggestions';
import { useRecordForm } from '@/hooks/useRecordForm';
export default function RecordPage() {
  const {
    router, showToast, currentOrg, clientId, shiftId, segmentId,
    autosaveState, clientName, template, answers, selectableStaffs, staffRoles, serviceTypes,
    selectedHelpers, actualStaffs, actualServiceTypeId, startDateTime, endDateTime,
    serviceTime, travelTime, roundTripDistanceKm, travelCostRateYenPerKm, images,
    aiFilledFields, isSpanningMonth, selectedPart, originalShiftTimes,
    currentReportId, currentStatus, isDirty, openCloseDialog, loading, errors, submitting,
    shiftSuggestions, linkedShifts, dismissedSuggestions, shiftSegments, selectedSegmentId,
    dismissShiftSuggestion, setShiftSuggestions, setLinkedShifts,
    setActualServiceTypeId, setActualStaffs, setStartDateTime, setEndDateTime,
    setServiceTime, setTravelTime, setRoundTripDistanceKm,
    setDistanceTouched, setIsDirty, setOpenCloseDialog,
    formatTimeForLabel, formatSegmentLabel, handlePartChange, handleChange, handleAnswerChange,
    handleImageUpload, handleDeleteReport, handleDraftSave, handleSubmit, handlePendingSave,
    handleApprove, handleRemand, handleClose, handleDialogDiscard, handleDialogSaveDraft,
    handleAiExtracted, groupedSections, isAdmin, isReadOnly, canDeleteRecord, travelCostYen,
    requiresSegmentSelection, aiClients, aiHelpers, handleStaffChange,
  } = useRecordForm();
  if (loading) return <Box sx={{ display: 'flex', justifyContent: 'center', p: 10 }}><CircularProgress /></Box>;

  return (
    <PageLayout>
       <InnerPageHeader
            icon={<IconButton edge="start" onClick={handleClose} sx={{ color: 'action.active' }}><CloseIcon /></IconButton>}
            title={currentReportId ? (isAdmin && currentStatus === 'pending' ? '記録の確認・承認' : (currentStatus === 'approved' ? '承認済の記録' : '記録を修正')) : `${clientName} 様`}
            actions={(
            <Stack direction="row" spacing={1} useFlexGap flexWrap="nowrap" justifyContent="flex-end" sx={{ overflowX: 'auto', overflowY: 'hidden', WebkitOverflowScrolling: 'touch', maxWidth: '100%' }}>
                {currentReportId && currentStatus !== 'approved' && canDeleteRecord && (
                    <IconButton color="error" onClick={handleDeleteReport} disabled={submitting}><DeleteIcon /></IconButton>
                )}
                
                {isAdmin && currentStatus === 'pending' && <Button variant="contained" color="success" size="small" startIcon={<CheckCircleIcon />} onClick={handleApprove} disabled={submitting || requiresSegmentSelection || isDirty}>承認</Button>}
                {isAdmin && currentStatus === 'approved' && <Button variant="contained" color="warning" size="small" startIcon={<AssignmentReturnIcon />} onClick={handleRemand} disabled={submitting || requiresSegmentSelection}>承認取消</Button>}
                {isAdmin && currentStatus === 'pending' && (
                    <Button variant="outlined" size="small" startIcon={<SaveIcon />} onClick={handlePendingSave} disabled={submitting || requiresSegmentSelection}>
                        変更を保存
                    </Button>
                )}
                {!isAdmin && currentStatus === 'pending' && (
                    <Button variant="contained" size="small" startIcon={<SaveIcon />} onClick={handlePendingSave} disabled={submitting || requiresSegmentSelection}>
                        変更を保存
                    </Button>
                )}
                {currentStatus !== 'pending' && currentStatus !== 'approved' && (
                    <>
                        <Button variant="outlined" size="small" startIcon={<SaveIcon />} onClick={handleDraftSave} disabled={submitting || requiresSegmentSelection}>下書き</Button>
                        <Button variant="contained" size="small" startIcon={<SendIcon />} onClick={handleSubmit} disabled={submitting || requiresSegmentSelection} sx={{ fontWeight: 'bold' }}>送信</Button>
                    </>
                )}
            </Stack>
            )}
       />

      <Box sx={{ flexGrow: 1, overflowY: 'auto', p: { xs: 2, sm: 3 } }}>
        <Container maxWidth="md" disableGutters sx={{ width: '100%' }}>
            <Stack spacing={{ xs: 2.5, sm: 4 }}>
            {currentStatus !== 'approved' && autosaveState !== 'idle' && (
              <Alert severity={autosaveState === 'error' ? 'warning' : 'info'}>
                {autosaveState === 'saving' ? '入力内容を保存中です…' : autosaveState === 'saved' ? '入力内容は自動保存されています' : '自動保存に失敗しました。通信を確認して入力を続けてください。'}
              </Alert>
            )}
            
            {isSpanningMonth && (
              <MonthSplitTabs
                selectedPart={selectedPart}
                originalShiftTimes={originalShiftTimes}
                formatTimeForLabel={formatTimeForLabel}
                onPartChange={handlePartChange}
              />
            )}

            {shiftId && shiftSegments.length > 1 && !selectedSegmentId && (
                <Alert severity="info" sx={{ mb: 2 }}>
                    このシフトには複数のサービス区間があります。以下から区間を選択して記録を作成してください。
                </Alert>
            )}

            {shiftId && shiftSegments.length > 1 && !currentReportId && (
                <Alert severity={requiresSegmentSelection ? 'info' : 'success'}>
                    <Stack spacing={1}>
                        <Typography variant="subtitle2" fontWeight="bold">
                            記録を作成する区間を選択してください
                        </Typography>
                        <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                            {shiftSegments.map((segment, index) => (
                                <Button
                                    key={segment.id}
                                    size="small"
                                    variant={(selectedSegmentId || segmentId) === segment.id ? 'contained' : 'outlined'}
                                    onClick={() => router.replace(`/app/record/${clientId}?shiftId=${shiftId}&segmentId=${segment.id}`)}
                                >
                                    {formatSegmentLabel(segment, index)}
                                </Button>
                            ))}
                        </Stack>
                    </Stack>
                </Alert>
            )}

            <ShiftSuggestions
              organizationId={currentOrg?.id}
              reportId={currentReportId}
              suggestions={shiftSuggestions}
              linkedShifts={linkedShifts}
              dismissedSuggestions={dismissedSuggestions}
              onDismiss={dismissShiftSuggestion}
              onSuggestionsChange={setShiftSuggestions}
              onLinkedShiftsChange={setLinkedShifts}
              onError={(message) => showToast(message, 'error')}
            />

            {currentStatus !== 'approved' && (
              <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
                <AiImportButton
                  organizationId={currentOrg?.id ?? ''}
                  formTemplate={template}
                  clients={aiClients}
                  helpers={aiHelpers}
                  onExtracted={handleAiExtracted}
                  hasExistingValues={Object.keys(answers).length > 0}
                  disabled={submitting || loading || !currentOrg || requiresSegmentSelection}
                />
              </Box>
            )}

            <RecordMetaForm
              actualServiceTypeId={actualServiceTypeId}
              serviceTypes={serviceTypes}
              selectedHelpers={selectedHelpers}
              selectableStaffs={selectableStaffs}
              actualStaffs={actualStaffs}
              staffRoles={staffRoles}
              startDateTime={startDateTime}
              endDateTime={endDateTime}
              serviceTime={serviceTime}
              travelTime={travelTime}
              roundTripDistanceKm={roundTripDistanceKm}
              travelCostYen={travelCostYen}
              travelCostRateYenPerKm={travelCostRateYenPerKm}
              errors={errors}
              aiFilledFields={aiFilledFields}
              disabled={isReadOnly}
              onServiceTypeChange={(value) => { setActualServiceTypeId(value); setIsDirty(true); }}
              onStaffChange={handleStaffChange}
              onActualStaffsChange={(value) => { setActualStaffs(value); setIsDirty(true); }}
              onStartChange={(value) => handleChange(setStartDateTime, value)}
              onEndChange={(value) => handleChange(setEndDateTime, value)}
              onServiceTimeChange={(value) => handleChange(setServiceTime, value)}
              onTravelTimeChange={(value) => handleChange(setTravelTime, value)}
              onDistanceChange={(value) => { setDistanceTouched(true); handleChange(setRoundTripDistanceKm, value); }}
            />

            <RecordDynamicSections
              sections={groupedSections}
              answers={answers}
              errors={errors}
              aiFilledFields={aiFilledFields}
              disabled={isReadOnly}
              onAnswerChange={handleAnswerChange}
            />

            <Box sx={{ p: { xs: 2, sm: 3 }, mt: 3, borderRadius: 1 }}>
                <Typography variant="subtitle2" fontWeight="bold" gutterBottom>画像添付</Typography>
                <Stack direction="row" gap={2} flexWrap="wrap">
                    {images.map(img => (
                        <Box key={img.id} component="img" src={img.url} sx={{ width: 100, height: 100, objectFit: 'cover', borderRadius: 1 }} />
                    ))}
                    <IconButton color="primary" component="label" disabled={!currentReportId || isReadOnly} sx={{ width: 100, height: 100, border: '1px dashed', borderColor: 'divider', borderRadius: 1, flexDirection: 'column' }}>
                        <input hidden accept="image/*" type="file" onChange={handleImageUpload} disabled={!currentReportId || isReadOnly} />
                        <PhotoCamera />
                        {!currentReportId && <Typography variant="caption" sx={{ fontSize: 9 }}>未保存</Typography>}
                    </IconButton>
                </Stack>
                {!currentReportId && <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>※一度下書き保存すると画像を添付できます</Typography>}
            </Box>

            </Stack>
        </Container>
      </Box>

      <AppDialog
        open={openCloseDialog}
        onClose={() => setOpenCloseDialog(false)}
        title="保存されていない変更があります"
        dividers={false}
        actions={<><AppButton variant="text" intent="danger" onClick={handleDialogDiscard}>破棄して移動</AppButton><AppButton onClick={handleDialogSaveDraft} autoFocus>下書き保存</AppButton></>}
      >
        <Typography>入力内容が保存されていません。下書きとして保存しますか？</Typography>
      </AppDialog>
    </PageLayout>
  );
}
