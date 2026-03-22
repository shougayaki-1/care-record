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

type MemberProfileData = { user_id: string; profiles: { name: string } | null; };

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
        const { data: clientData } = await supabase.from('clients').select('id, name').eq('organization_id', currentOrg.id);
        if (clientData) setClients(clientData as ClientData[]);

        const { data: memberData } = await supabase.from('organization_members').select('user_id, profiles(name)').eq('organization_id', currentOrg.id);
        const { data: ghostData } = await supabase.from('ghost_staffs').select('id, name').eq('organization_id', currentOrg.id);
        
        const staffList: StaffData[] = [];
        (memberData as unknown as MemberProfileData[])?.forEach((m) => { 
            if (m.profiles) staffList.push({ id: m.user_id, name: m.profiles.name, type: 'member' }); 
        });
        ghostData?.forEach(g => { staffList.push({ id: g.id, name: g.name, type: 'ghost' }); });
        setStaffs(staffList);
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
            // 共通関数でEventInputを生成
            setEvents(convertToCalendarEvents(typedShifts, false));
        } catch (error) {
            console.error(error);
            showToast('シフトの取得に失敗しました', 'error');
        } finally {
            setLoading(false);
        }
    }, [currentOrg, showToast]);

    useEffect(() => {
        if (!wsLoading && currentOrg) {
            fetchMasterData();
            fetchShiftData();
        }
    }, [wsLoading, currentOrg, fetchMasterData, fetchShiftData]);

    const handleSaveShift = async (payload: ShiftPayload, shiftId?: string) => {
        if (shiftId) { await updateShift(shiftId, payload); showToast('シフトを更新しました'); } 
        else { await createShift(payload); showToast('シフトを作成しました'); }
        fetchShiftData();
    };

    const handleCancelShift = async (shiftId: string, reason: string) => {
        await cancelShift(shiftId, reason); showToast('シフトをキャンセルにしました'); fetchShiftData();
    };

    const formatRule = (shift: FetchedShiftData) => {
        if (!shift.is_recurring || !shift.rrule) return '単発';
        let desc = '繰り返し: ';
        if (shift.rrule.includes('FREQ=WEEKLY')) desc += '毎週 ';
        if (shift.rrule.includes('FREQ=MONTHLY')) desc += '毎月 ';
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
                    <Typography variant="h6" fontWeight="bold" color="text.primary">全体シフト管理</Typography>
                    <Button variant="contained" startIcon={<AddIcon />} onClick={() => { setSelectedShift(null); setModalOpen(true); }} sx={{ boxShadow: 'none' }}>
                        シフトを追加
                    </Button>
                </Box>
                <Tabs value={tabIndex} onChange={(_, v) => setTabIndex(v)}>
                    <Tab label="シフト設定一覧" />
                    <Tab label="カレンダービュー" />
                </Tabs>
            </Box>

            <Box sx={{ flexGrow: 1, p: 3, bgcolor: '#f5f5f5', overflowY: 'auto' }}>
                {loading ? (
                    <Box display="flex" justifyContent="center" alignItems="center" height="100%"><CircularProgress /></Box>
                ) : (
                    <>
                        {tabIndex === 0 && (
                            <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 3, boxShadow: 'none' }}>
                                <Table>
                                    <TableHead sx={{ bgcolor: '#F0F5FF' }}>
                                        <TableRow>
                                            <TableCell sx={{ fontWeight: 'bold' }}>利用者</TableCell>
                                            <TableCell sx={{ fontWeight: 'bold' }}>担当スタッフ</TableCell>
                                            <TableCell sx={{ fontWeight: 'bold' }}>時間</TableCell>
                                            <TableCell sx={{ fontWeight: 'bold' }}>ロジック (ルール)</TableCell>
                                            <TableCell sx={{ fontWeight: 'bold' }}>ステータス</TableCell>
                                            <TableCell align="center" sx={{ fontWeight: 'bold' }}>編集</TableCell>
                                        </TableRow>
                                    </TableHead>
                                    <TableBody>
                                        {rawShifts.length === 0 ? (
                                            <TableRow><TableCell colSpan={6} align="center" sx={{ py: 5, color: '#666' }}>登録されているシフトはありません</TableCell></TableRow>
                                        ) : (
                                            rawShifts.map((shift) => (
                                                <TableRow key={shift.id} hover sx={{ opacity: shift.status === 'cancelled' ? 0.6 : 1 }}>
                                                    <TableCell sx={{ fontWeight: 'bold' }}>{shift.clients?.name}</TableCell>
                                                    <TableCell>{shift.shift_staffs.map(s => s.profiles?.name || s.ghost_staffs?.name).filter(Boolean).join(', ')}</TableCell>
                                                    <TableCell>{formatTime(shift.start_at)} 〜 {formatTime(shift.end_at)}</TableCell>
                                                    <TableCell><Chip label={formatRule(shift)} size="small" variant="outlined" color={shift.is_recurring ? "primary" : "default"} /></TableCell>
                                                    <TableCell><Chip label={shift.status === 'cancelled' ? 'キャンセル' : '稼働中'} size="small" color={shift.status === 'cancelled' ? 'default' : 'success'} /></TableCell>
                                                    <TableCell align="center">
                                                        <Tooltip title="設定を編集">
                                                            <IconButton size="small" onClick={() => {
                                                                const shiftDataForModal: ShiftData = {
                                                                    id: shift.id, organization_id: shift.organization_id, client_id: shift.client_id,
                                                                    title: shift.title, start_at: shift.start_at, end_at: shift.end_at,
                                                                    is_recurring: shift.is_recurring, rrule: shift.rrule, status: shift.status,
                                                                    cancel_reason: shift.cancel_reason,
                                                                    shift_staffs: shift.shift_staffs.map(s => ({ user_id: s.user_id, ghost_staff_id: s.ghost_staff_id }))
                                                                };
                                                                setSelectedShift(shiftDataForModal); setModalOpen(true);
                                                            }}>
                                                                <EditIcon fontSize="small" />
                                                            </IconButton>
                                                        </Tooltip>
                                                    </TableCell>
                                                </TableRow>
                                            ))
                                        )}
                                    </TableBody>
                                </Table>
                            </TableContainer>
                        )}

                        {tabIndex === 1 && (
                            <ShiftCalendarViewer
                                ref={calendarRef}
                                events={events}
                                initialView="dayGridMonth"
                                headerToolbar={{ left: 'prev,next today', center: 'title', right: 'dayGridMonth,timeGridWeek' }}
                                selectable={true}
                                onDateSelect={() => { setSelectedShift(null); setModalOpen(true); }}
                                onEventClick={(info) => {
                                    const data = info.event.extendedProps.shiftData as ShiftData;
                                    setSelectedShift(data); setModalOpen(true);
                                }}
                            />
                        )}
                    </>
                )}
            </Box>

            <ShiftFormModal
                open={modalOpen} onClose={() => setModalOpen(false)} onSave={handleSaveShift} onCancelShift={handleCancelShift}
                clients={clients} staffs={staffs} organizationId={currentOrg.id} initialData={selectedShift}
            />
        </Box>
    );
}