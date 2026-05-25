'use client';

import React from 'react';
import {
    Box, Typography, CircularProgress, Tabs, Tab, Button, Stack, TextField, MenuItem
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf';
import GridOnIcon from '@mui/icons-material/GridOn';
import SyncIcon from '@mui/icons-material/Sync';

import { useShiftManage } from './_hooks/useShiftManage';
import { ShiftPatternTab } from './_components/ShiftPatternTab';
import { ShiftCalendarTab } from './_components/ShiftCalendarTab';
import { MyShiftTab } from './_components/MyShiftTab';
import { StaffShiftTab } from './_components/StaffShiftTab';
import { ClientShiftTab } from './_components/ClientShiftTab';

// 新しく抽出したコンポーネントをインポート
import { ClearMonthDialog } from './_components/ClearMonthDialog';
import { ShiftPreviewDialog } from './_components/ShiftPreviewDialog';
import { UnsyncedBanner } from './_components/UnsyncedBanner';

import { ShiftFormModal } from '@/components/shifts/ShiftFormModal';
import { ShiftPatternModal } from '@/components/shifts/ShiftPatternModal';

export default function ShiftManagePage() {
    const {
        currentOrg, wsLoading, calendarRef, initialLoading, isFetching, generating, pdfGenerating,
        patterns, events, clients, staffs, tabIndex, setTabIndex,
        selectedStaffId, setSelectedStaffId, selectedClientId, setSelectedClientId,
        targetMonth, setTargetMonth, shiftModalOpen, setShiftModalOpen,
        patternModalOpen, setPatternModalOpen, clearDialogOpen, setClearDialogOpen,
        previewDialogOpen, setPreviewDialogOpen, selectedShift, setSelectedShift,
        selectedPattern, setSelectedPattern, clearMode, setClearMode, previewDetails,
        syncProgress, unsyncedCount, repairingFromBanner, resyncingCal,
        handleDownloadPdf, handleDownloadMatrixPdf, handleSaveShift, handleToggleCancel,
        handleDeleteShift, handleEventChange, handleSavePattern, handleOpenClearConfirm,
        executeClearMonthShifts, handleDeletePattern, handleCalculatePreview, executeGenerate,
        handleRepairFromBanner, handleForceResyncCalendar, isAdmin, showToast
    } = useShiftManage();

    if (wsLoading || !currentOrg) return null;

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
            <Box sx={{ borderBottom: 1, borderColor: 'divider', bgcolor: 'background.paper', px: 3, pt: 2, flexShrink: 0 }}>
                <Box display="flex" justifyContent="space-between" alignItems="center" mb={1}>
                    <Typography variant="h6" fontWeight="bold">全体シフト管理</Typography>
                    {isAdmin && tabIndex === 1 && (
                        <Button variant="contained" startIcon={<AddIcon />} onClick={() => { setSelectedShift(null); setShiftModalOpen(true); }} sx={{ boxShadow: 'none' }}>単発シフトを追加</Button>
                    )}
                    {isAdmin && tabIndex === 0 && (
                        <Button variant="contained" startIcon={<AddIcon />} onClick={() => { setSelectedPattern(null); setPatternModalOpen(true); }} sx={{ boxShadow: 'none' }}>ひな形を追加</Button>
                    )}
                </Box>
                <Tabs value={tabIndex} onChange={(_, v) => setTabIndex(v)}>
                    {isAdmin && <Tab label="基本パターン(ひな形)" />}
                    {isAdmin && <Tab label="全体カレンダー" />}
                    <Tab label="自分のシフト" />
                    <Tab label="スタッフ別" />
                    <Tab label="利用者別" />
                </Tabs>
            </Box>

            <Box sx={{ position: 'relative', flexGrow: 1, p: 3, bgcolor: '#f5f5f5', overflowY: 'auto' }}>
                {isFetching && !initialLoading && (
                    <Box sx={{ position: 'absolute', top: 16, right: 30, zIndex: 10 }}>
                        <CircularProgress size={24} />
                    </Box>
                )}

                {initialLoading ? (
                    <Box display="flex" justifyContent="center" alignItems="center" height="100%"><CircularProgress /></Box>
                ) : (
                    <>
                        <UnsyncedBanner 
                            unsyncedCount={unsyncedCount}
                            repairingFromBanner={repairingFromBanner}
                            onRepair={handleRepairFromBanner}
                        />

                        {tabIndex >= 1 && (
                            <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems="center" mb={2} spacing={2}>
                                <Box flexGrow={1} width="100%">
                                    {tabIndex === 3 && (
                                        <TextField select size="small" label="スタッフを選択" value={selectedStaffId} onChange={(e) => setSelectedStaffId(e.target.value)} sx={{ minWidth: 200, bgcolor: 'white' }}>
                                            <MenuItem value="all">全員を表示</MenuItem>
                                            {staffs.map(s => <MenuItem key={s.id} value={s.id}>{s.name}</MenuItem>)}
                                        </TextField>
                                    )}
                                    {tabIndex === 4 && (
                                        <TextField select size="small" label="利用者を選択" value={selectedClientId} onChange={(e) => setSelectedClientId(e.target.value)} sx={{ minWidth: 200, bgcolor: 'white' }}>
                                            <MenuItem value="all">全員を表示</MenuItem>
                                            {clients.map(c => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>)}
                                        </TextField>
                                    )}
                                </Box>
                                <Stack direction="row" spacing={1} sx={{ ml: 'auto' }}>
                                    {isAdmin && (
                                        <Button 
                                            variant="outlined" 
                                            color="primary" 
                                            startIcon={resyncingCal ? <CircularProgress size={16} color="inherit" /> : <SyncIcon />} 
                                            onClick={handleForceResyncCalendar} 
                                            disabled={resyncingCal || pdfGenerating}
                                            sx={{ bgcolor: 'white' }}
                                        >
                                            {resyncingCal ? '再同期中...' : 'Googleカレンダー全件再同期'}
                                        </Button>
                                    )}
                                    {tabIndex === 3 && selectedStaffId === 'all' && (
                                        <Button variant="outlined" color="primary" startIcon={<GridOnIcon />} onClick={handleDownloadMatrixPdf} disabled={pdfGenerating || resyncingCal} sx={{ bgcolor: 'white' }}>
                                            {pdfGenerating ? '作成中...' : '全体マトリックスPDF'}
                                        </Button>
                                    )}
                                    <Button variant="outlined" color="secondary" startIcon={<PictureAsPdfIcon />} onClick={handleDownloadPdf} disabled={pdfGenerating || resyncingCal} sx={{ bgcolor: 'white' }}>
                                        {pdfGenerating ? '作成中...' : '表示中の形式でPDF出力'}
                                    </Button>
                                </Stack>
                            </Stack>
                        )}

                        {/* 各タブの描画 */}
                        {tabIndex === 0 && isAdmin && (
                            <ShiftPatternTab
                                targetMonth={targetMonth}
                                setTargetMonth={setTargetMonth}
                                patterns={patterns}
                                generating={generating}
                                handleCalculatePreview={handleCalculatePreview}
                                handleOpenClearConfirm={handleOpenClearConfirm}
                                setSelectedPattern={setSelectedPattern}
                                setPatternModalOpen={setPatternModalOpen}
                                handleDeletePattern={handleDeletePattern}
                            />
                        )}

                        {tabIndex === 1 && (
                            <ShiftCalendarTab
                                calendarRef={calendarRef}
                                events={events}
                                isAdmin={isAdmin}
                                handleEventChange={handleEventChange}
                                setSelectedShift={setSelectedShift}
                                setShiftModalOpen={setShiftModalOpen}
                                showToast={showToast}
                            />
                        )}

                        {tabIndex === 2 && (
                            <MyShiftTab
                                calendarRef={calendarRef}
                                events={events}
                                showToast={showToast}
                            />
                        )}

                        {tabIndex === 3 && (
                            <StaffShiftTab
                                calendarRef={calendarRef}
                                events={events}
                                showToast={showToast}
                            />
                        )}

                        {tabIndex === 4 && (
                            <ClientShiftTab
                                calendarRef={calendarRef}
                                events={events}
                                showToast={showToast}
                            />
                        )}
                    </>
                )}
            </Box>

            {/* 各同期ステータス・モーダル */}
            {syncProgress && (
                <Box sx={{ position: 'fixed', bottom: 20, right: 20, bgcolor: 'white', p: 2.5, borderRadius: 3, boxShadow: 3, zIndex: 9999, border: '1px solid #E3E5E8', minWidth: 280 }}>
                    <Typography variant="body2" fontWeight="bold" gutterBottom>Googleカレンダー同期中...</Typography>
                    <Typography variant="caption" display="block" color="text.secondary" sx={{ mb: 1, textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                        {syncProgress.currentName}
                    </Typography>
                    {syncProgress.total > 1 ? (
                        <Box sx={{ width: '100%' }}>
                            <Box sx={{ display: 'flex', alignItems: 'center' }}>
                                <Box sx={{ width: '100%', mr: 1 }}>
                                    <CircularProgress variant="determinate" value={syncProgress.total > 0 ? (syncProgress.current / syncProgress.total) * 100 : 0} size={6} sx={{ height: 6, borderRadius: 3 }} />
                                </Box>
                                <Box sx={{ minWidth: 35 }}>
                                    <Typography variant="body2" color="text.secondary">{`${Math.round(syncProgress.total > 0 ? (syncProgress.current / syncProgress.total) * 100 : 0)}%`}</Typography>
                                </Box>
                            </Box>
                            <Typography variant="caption" sx={{ mt: 0.5, display: 'block', textAlign: 'right', fontWeight: 'bold' }}>
                                {syncProgress.current} / {syncProgress.total} 件完了
                            </Typography>
                        </Box>
                    ) : (
                        <CircularProgress size={20} />
                    )}
                </Box>
            )}

            <ShiftFormModal
                open={shiftModalOpen}
                onClose={() => setShiftModalOpen(false)}
                onSave={handleSaveShift}
                onToggleCancel={handleToggleCancel}
                onDelete={handleDeleteShift}
                clients={clients}
                staffs={staffs}
                organizationId={currentOrg.id}
                initialData={selectedShift}
            />

            <ShiftPatternModal
                key={selectedPattern?.id ?? 'new_pattern'}
                open={patternModalOpen}
                onClose={() => setPatternModalOpen(false)}
                onSave={handleSavePattern}
                clients={clients}
                staffs={staffs}
                organizationId={currentOrg.id}
                initialData={selectedPattern}
            />

            {/* 分割抽出した月次クリア確認ダイアログ */}
            <ClearMonthDialog 
                open={clearDialogOpen}
                onClose={() => setClearDialogOpen(false)}
                targetMonth={targetMonth}
                clearMode={clearMode}
                setClearMode={setClearMode}
                onConfirm={executeClearMonthShifts}
            />

            {/* 分割抽出したシフト自動展開プレビューダイアログ */}
            <ShiftPreviewDialog 
                open={previewDialogOpen}
                onClose={() => setPreviewDialogOpen(false)}
                targetMonth={targetMonth}
                previewDetails={previewDetails}
                onConfirm={executeGenerate}
            />
        </Box>
    );
}