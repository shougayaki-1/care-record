'use client';

import React, { useEffect, useState, useRef, useCallback } from 'react';
import { Box, Typography, Paper, CircularProgress, Tabs, Tab, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Button, Chip, IconButton, Tooltip } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import FullCalendar from '@fullcalendar/react';
import { EventInput } from '@fullcalendar/core';

import { useWorkspace } from '@/context/WorkspaceContext';
import { supabase } from '@/lib/supabase';
import { getShifts, createShift, updateShift, cancelShift, ShiftPayload } from '@/app/actions/shift';
import { useToast } from '@/components/ui/ToastProvider';
import { ShiftFormModal, ClientData, StaffData, ShiftData } from '@/components/shifts/ShiftFormModal';
import { FetchedShiftData, convertToCalendarEvents } from '@/utils/shiftHelper';
import { ShiftCalendarViewer } from '@/components/shifts/ShiftCalendarViewer';

export default function ShiftManagePage() {
    const { currentOrg, loading: wsLoading } = useWorkspace();
    const { showToast } = useToast();
    const calendarRef = useRef<FullCalendar>(null);

    const [loading, setLoading] = useState(true);
    const [rawShifts, setRawShifts] = useState<FetchedShiftData[]>([]);
    const [events, setEvents] = useState<EventInput[]>([]);
    const [clients, setClients] = useState<ClientData[]>([]);
    const [staffs, setStaffs] = useState<StaffData[]>([]);

    const [tabIndex, setTabIndex] = useState(0); 
    const [modalOpen, setModalOpen] = useState(false);
    const [selectedShift, setSelectedShift] = useState<ShiftData | null>(null);

    const fetchMasterData = useCallback(async () => {
        if (!currentOrg) return;
        try {
            const { data: c } = await supabase.from('clients').select('id, name').eq('organization_id', currentOrg.id);
            if (c) setClients(c);

            const { data: s } = await supabase.from('staffs').select('id, name, user_id').eq('organization_id', currentOrg.id);
            if (s) setStaffs(s.map(item => ({ id: item.id, name: item.name, type: item.user_id ? 'member' : 'ghost' })));
        } catch (e) { console.error(e); }
    }, [currentOrg]);

    const fetchShiftData = useCallback(async () => {
        if (!currentOrg) return;
        setLoading(true);
        try {
            const start = new Date(); start.setMonth(start.getMonth() - 2);
            const end = new Date(); end.setMonth(end.getMonth() + 3);
            const fetched = await getShifts(currentOrg.id, start.toISOString(), end.toISOString());
            const typedShifts = (fetched as unknown as FetchedShiftData[]) || [];
            
            setRawShifts(typedShifts);
            setEvents(convertToCalendarEvents(typedShifts, false));
        } catch (error) {
            console.error(error);
            showToast('シフトの取得に失敗しました', 'error');
        } finally { setLoading(false); }
    }, [currentOrg, showToast]);

    useEffect(() => {
        if (!wsLoading && currentOrg) {
            fetchMasterData();
            fetchShiftData();
        }
    }, [wsLoading, currentOrg, fetchMasterData, fetchShiftData]);

    const handleSaveShift = async (payload: ShiftPayload, shiftId?: string) => {
        try {
            if (shiftId) await updateShift(shiftId, payload);
            else await createShift(payload);
            showToast('保存しました');
            fetchShiftData();
        } catch(e) { showToast('保存に失敗しました', 'error'); }
    };

    const handleCancelShift = async (shiftId: string, reason: string) => {
        await cancelShift(shiftId, reason);
        showToast('キャンセルしました');
        fetchShiftData();
    };

    const formatRule = (shift: FetchedShiftData) => {
        if (!shift.is_recurring || !shift.rrule) return '単発';
        let desc = '繰り返し: ';
        if (shift.rrule.includes('FREQ=WEEKLY')) desc += '毎週 ';
        else if (shift.rrule.includes('FREQ=MONTHLY')) desc += '毎月 ';
        const daysMap: Record<string, string> = { 'MO':'月', 'TU':'火', 'WE':'水', 'TH':'木', 'FR':'金', 'SA':'土', 'SU':'日' };
        const match = shift.rrule.match(/BYDAY=([^;]+)/);
        if (match) {
            const days = match[1].split(',').map(d => {
                const num = d.replace(/[A-Z]/g, '');
                const day = d.replace(/[0-9]/g, '');
                return (num ? `第${num}` : '') + (daysMap[day] || '');
            });
            desc += days.join(', ');
        }
        return desc;
    };

    const formatTime = (dateStr: string) => {
        const d = new Date(dateStr);
        return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
    };

    if (wsLoading || !currentOrg) return null;

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
            <Box sx={{ borderBottom: 1, borderColor: 'divider', bgcolor: 'background.paper', px: 3, pt: 2, flexShrink: 0 }}>
                <Box display="flex" justifyContent="space-between" alignItems="center" mb={1}>
                    <Typography variant="h6" fontWeight="bold">全体シフト管理</Typography>
                    <Button variant="contained" startIcon={<AddIcon />} onClick={() => { setSelectedShift(null); setModalOpen(true); }} sx={{ boxShadow: 'none' }}>追加</Button>
                </Box>
                <Tabs value={tabIndex} onChange={(_, v) => setTabIndex(v)}>
                    <Tab label="一覧" /><Tab label="カレンダー" />
                </Tabs>
            </Box>
            <Box sx={{ flexGrow: 1, p: 3, bgcolor: '#f5f5f5', overflowY: 'auto' }}>
                {loading ? <Box textAlign="center" mt={5}><CircularProgress /></Box> : (
                    tabIndex === 0 ? (
                        <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 3 }}>
                            <Table>
                                <TableHead sx={{ bgcolor: '#F0F5FF' }}>
                                    <TableRow>
                                        <TableCell sx={{ fontWeight: 'bold' }}>利用者</TableCell>
                                        <TableCell sx={{ fontWeight: 'bold' }}>スタッフ</TableCell>
                                        <TableCell sx={{ fontWeight: 'bold' }}>時間</TableCell>
                                        <TableCell sx={{ fontWeight: 'bold' }}>ロジック</TableCell>
                                        <TableCell sx={{ fontWeight: 'bold' }}>状態</TableCell>
                                        <TableCell align="center" sx={{ fontWeight: 'bold' }}>編集</TableCell>
                                    </TableRow>
                                </TableHead>
                                <TableBody>
                                    {rawShifts.map((shift) => (
                                        <TableRow key={shift.id} hover sx={{ opacity: shift.status === 'cancelled' ? 0.6 : 1 }}>
                                            <TableCell sx={{ fontWeight: 'bold' }}>{shift.clients?.name}</TableCell>
                                            <TableCell>{shift.shift_staffs.map(s => s.staffs?.name).join(', ')}</TableCell>
                                            <TableCell>{formatTime(shift.start_at)} 〜 {formatTime(shift.end_at)}</TableCell>
                                            <TableCell><Chip label={formatRule(shift)} size="small" variant="outlined" /></TableCell>
                                            <TableCell><Chip label={shift.status === 'cancelled' ? '休' : '稼働'} size="small" color={shift.status === 'cancelled' ? 'default' : 'success'} /></TableCell>
                                            <TableCell align="center">
                                                <IconButton size="small" onClick={() => {
                                                    const shiftDataForModal: ShiftData = {
                                                        ...shift,
                                                        shift_staffs: shift.shift_staffs.map(s => ({ staff_id: s.staff_id }))
                                                    };
                                                    setSelectedShift(shiftDataForModal); setModalOpen(true);
                                                }}><EditIcon fontSize="small" /></IconButton>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </TableContainer>
                    ) : (
                        <ShiftCalendarViewer ref={calendarRef} events={events} initialView="dayGridMonth" headerToolbar={{ left: 'prev,next today', center: 'title', right: 'dayGridMonth,timeGridWeek' }} selectable onDateSelect={() => { setSelectedShift(null); setModalOpen(true); }} onEventClick={(i) => { setSelectedShift(i.event.extendedProps.shiftData); setModalOpen(true); }} />
                    )
                )}
            </Box>
            <ShiftFormModal open={modalOpen} onClose={() => setModalOpen(false)} onSave={handleSaveShift} onCancelShift={handleCancelShift} clients={clients} staffs={staffs} organizationId={currentOrg.id} initialData={selectedShift} />
        </Box>
    );
}