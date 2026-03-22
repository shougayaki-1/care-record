'use client';

import React, { useEffect, useState, useRef, useCallback } from 'react';
import { Box, Typography, CircularProgress, Tabs, Tab, Stack, TextField, MenuItem, Button } from '@mui/material';
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf';
import GridOnIcon from '@mui/icons-material/GridOn'; 
import FullCalendar from '@fullcalendar/react';
import { EventInput } from '@fullcalendar/core';

import { useWorkspace } from '@/context/WorkspaceContext';
import { supabase } from '@/lib/supabase';
import { getShifts } from '@/app/actions/shift';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/ui/ToastProvider';
import { pdf } from '@react-pdf/renderer';

import { ShiftScheduleDocument, PdfShiftData } from '@/components/pdf/ShiftScheduleDocument';
import { ShiftCalendarDocument, PdfCalendarEvent, PdfCalendarDay } from '@/components/pdf/ShiftCalendarDocument';
import { ShiftMatrixDocument, MatrixStaffData } from '@/components/pdf/ShiftMatrixDocument';
import { FetchedShiftData, convertToCalendarEvents } from '@/utils/shiftHelper';
import { ShiftCalendarViewer } from '@/components/shifts/ShiftCalendarViewer';

type StaffData = { id: string; name: string; type: 'member' | 'ghost' };
type ClientData = { id: string; name: string };

export default function ShiftListPage() {
    const router = useRouter();
    const { currentOrg, loading: wsLoading } = useWorkspace();
    const { showToast } = useToast();
    const calendarRef = useRef<FullCalendar>(null);

    const [loading, setLoading] = useState(true);
    const [rawShifts, setRawShifts] = useState<FetchedShiftData[]>([]);
    const [events, setEvents] = useState<EventInput[]>([]);
    
    const [currentUserId, setCurrentUserId] = useState<string>('');
    const [currentStaffId, setCurrentStaffId] = useState<string | null>(null);

    const [tabIndex, setTabIndex] = useState(0); 
    const [selectedStaffId, setSelectedStaffId] = useState<string>('all');
    const [selectedClientId, setSelectedClientId] = useState<string>('all');
    const [pdfGenerating, setPdfGenerating] = useState(false);

    const [clients, setClients] = useState<ClientData[]>([]);
    const [staffs, setStaffs] = useState<StaffData[]>([]);

    useEffect(() => {
        const fetchUser = async () => {
            const { data: { user } } = await supabase.auth.getUser();
            if (user) setCurrentUserId(user.id);
        };
        fetchUser();
    }, []);

    const fetchMasterData = useCallback(async () => {
        if (!currentOrg) return;
        const { data: clientData } = await supabase.from('clients').select('id, name').eq('organization_id', currentOrg.id);
        if (clientData) setClients(clientData as ClientData[]);

        const { data: staffData } = await supabase.from('staffs').select('id, name, user_id').eq('organization_id', currentOrg.id);
        if (staffData) {
            const parsed = staffData.map(item => ({ id: item.id, name: item.name, type: item.user_id ? 'member' : 'ghost' } as StaffData));
            setStaffs(parsed);
            if (currentUserId) {
                const me = parsed.find(s => staffData.find(sd => sd.id === s.id)?.user_id === currentUserId);
                if (me) setCurrentStaffId(me.id);
            }
        }
    }, [currentOrg, currentUserId]);

    const fetchShiftData = useCallback(async () => {
        if (!currentOrg) return;
        setLoading(true);
        try {
            const start = new Date(); start.setMonth(start.getMonth() - 1);
            const end = new Date(); end.setMonth(end.getMonth() + 2);
            const shifts = await getShifts(currentOrg.id, start.toISOString(), end.toISOString());
            setRawShifts((shifts as unknown as FetchedShiftData[]) || []);
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

    useEffect(() => {
        if (!currentUserId || rawShifts.length === 0) {
            setEvents([]);
            return;
        }

        const filtered = rawShifts.filter(shift => {
            if (tabIndex === 0) {
                if (!currentStaffId) return false;
                return shift.shift_staffs.some(s => s.staff_id === currentStaffId);
            }
            if (tabIndex === 1) {
                if (selectedStaffId === 'all') return true;
                return shift.shift_staffs.some(s => s.staff_id === selectedStaffId);
            }
            if (tabIndex === 2) {
                if (selectedClientId === 'all') return true;
                return shift.client_id === selectedClientId;
            }
            return true;
        });

        setEvents(convertToCalendarEvents(filtered, true));
    }, [rawShifts, tabIndex, selectedStaffId, selectedClientId, currentStaffId, currentUserId]);

    const handleDownloadPdf = async () => {
        if (!calendarRef.current || !currentOrg) return;
        setPdfGenerating(true);
        try {
            const api = calendarRef.current.getApi();
            const renderedEvents = api.getEvents();
            const viewType = api.view.type; 
            const monthStr = api.view.title;

            let entityName = '私のシフト';
            if (tabIndex === 1) entityName = selectedStaffId !== 'all' ? `${staffs.find(s => s.id === selectedStaffId)?.name}様` : '全スタッフ';
            else if (tabIndex === 2) entityName = selectedClientId !== 'all' ? `${clients.find(c => c.id === selectedClientId)?.name}様` : '全利用者';
            
            const docTitle = `${entityName} シフト表`;
            const fileName = `${entityName}_シフト表_${monthStr.replace(/\s+/g, '')}.pdf`;

            let blob: Blob;

            if (viewType.includes('list')) {
                const pdfShifts: PdfShiftData[] = renderedEvents.map(ev => {
                    const start = ev.start!;
                    const end = ev.end!;
                    const days = ['日', '月', '火', '水', '木', '金', '土'];
                    return {
                        dateStr: `${start.getMonth() + 1}/${start.getDate()} (${days[start.getDay()]})`,
                        startTime: `${String(start.getHours()).padStart(2, '0')}:${String(start.getMinutes()).padStart(2, '0')}`,
                        endTime: `${String(end.getHours()).padStart(2, '0')}:${String(end.getMinutes()).padStart(2, '0')}`,
                        clientName: ev.extendedProps.clientName,
                        staffNames: ev.extendedProps.staffNames,
                        isCancelled: ev.extendedProps.isCancelled,
                        timestamp: start.getTime()
                    };
                });
                pdfShifts.sort((a, b) => a.timestamp - b.timestamp);
                blob = await pdf(<ShiftScheduleDocument title={docTitle} monthStr={monthStr} shifts={pdfShifts} orgName={currentOrg.name} />).toBlob();
            } else {
                const activeStart = api.view.activeStart;
                const activeEnd = api.view.activeEnd;
                const dayMap = new Map<string, PdfCalendarEvent[]>();
                
                renderedEvents.forEach(ev => {
                    const start = ev.start!;
                    const end = ev.end!;
                    const dateKey = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`;
                    const eventObj: PdfCalendarEvent = {
                        timeStr: `${String(start.getHours()).padStart(2, '0')}:${String(start.getMinutes()).padStart(2, '0')}-${String(end.getHours()).padStart(2, '0')}:${String(end.getMinutes()).padStart(2, '0')}`,
                        clientName: ev.extendedProps.clientName,
                        staffNames: ev.extendedProps.staffNames,
                        isCancelled: ev.extendedProps.isCancelled,
                    };
                    if (!dayMap.has(dateKey)) dayMap.set(dateKey, []);
                    dayMap.get(dateKey)!.push(eventObj);
                });

                const weeks: PdfCalendarDay[][] = [];
                let currentWeek: PdfCalendarDay[] = [];
                const d = new Date(activeStart);
                
                while (d < activeEnd) {
                    const dateKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
                    const dayEvents = dayMap.get(dateKey) || [];
                    dayEvents.sort((a, b) => a.timeStr.localeCompare(b.timeStr));
                    currentWeek.push({ date: new Date(d), dateStr: dateKey, dayNumber: d.getDate(), events: dayEvents });
                    d.setDate(d.getDate() + 1);
                    if (currentWeek.length === 7) { weeks.push(currentWeek); currentWeek = []; }
                }
                if (currentWeek.length > 0) weeks.push(currentWeek);
                blob = await pdf(<ShiftCalendarDocument title={docTitle} monthStr={monthStr} weeks={weeks} orgName={currentOrg.name} />).toBlob();
            }

            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.download = fileName;
            link.click();
        } catch (error) {
            console.error(error);
            showToast('PDFの生成に失敗しました', 'error');
        } finally {
            setPdfGenerating(false);
        }
    };

    const handleDownloadMatrixPdf = async () => {
        if (!calendarRef.current || !currentOrg) return;
        setPdfGenerating(true);

        try {
            const api = calendarRef.current.getApi();
            const currentMonthStart = api.view.currentStart; 
            const year = currentMonthStart.getFullYear();
            const month = currentMonthStart.getMonth();
            const daysInMonth = new Date(year, month + 1, 0).getDate();
            const monthStr = `${year}年 ${month + 1}月`;

            const docTitle = `全体シフト表 (スタッフ横断)`;
            const fileName = `全体シフト表_${year}${String(month+1).padStart(2,'0')}.pdf`;

            const matrixMap = new Map<string, MatrixStaffData>();
            staffs.forEach(s => matrixMap.set(s.id, { staffName: s.name, shiftsByDay: {} }));

            rawShifts.forEach(shift => {
                if (shift.status === 'cancelled') return;
                const start = new Date(shift.start_at);
                if (start.getFullYear() !== year || start.getMonth() !== month) return;
                
                const day = start.getDate();
                const end = new Date(shift.end_at);
                
                // ★修正: 時間だけでなく「利用者名」も含めたテキストを作成
                const cName = shift.clients?.name || '不明';
                const displayName = cName.endsWith('様') ? cName.replace('様', '') : cName; // セルが狭いので「様」は省く
                const timeStr = `${String(start.getHours()).padStart(2, '0')}:${String(start.getMinutes()).padStart(2, '0')}-${String(end.getHours()).padStart(2, '0')}:${String(end.getMinutes()).padStart(2, '0')}\n${displayName}`;

                shift.shift_staffs.forEach(ss => {
                    const sData = matrixMap.get(ss.staff_id);
                    if (sData) {
                        if (!sData.shiftsByDay[day]) sData.shiftsByDay[day] = [];
                        sData.shiftsByDay[day].push(timeStr);
                    }
                });
            });

            const staffDataArray = Array.from(matrixMap.values()).sort((a, b) => a.staffName.localeCompare(b.staffName));

            const blob = await pdf(
                <ShiftMatrixDocument 
                    title={docTitle} 
                    monthStr={monthStr} 
                    daysInMonth={daysInMonth} 
                    staffData={staffDataArray} 
                    orgName={currentOrg.name}
                />
            ).toBlob();

            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.download = fileName;
            link.click();

        } catch (error) {
            console.error(error);
            showToast('PDFの生成に失敗しました', 'error');
        } finally {
            setPdfGenerating(false);
        }
    };

    if (wsLoading || !currentOrg) return null;

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
            <Box sx={{ borderBottom: 1, borderColor: 'divider', bgcolor: 'background.paper', px: 3, pt: 2, flexShrink: 0 }}>
                <Typography variant="h6" fontWeight="bold" color="text.primary" mb={1}>シフト一覧</Typography>
                <Tabs value={tabIndex} onChange={(_, v) => setTabIndex(v)}>
                    <Tab label="自分のシフト" />
                    <Tab label="スタッフ別" />
                    <Tab label="利用者別" />
                </Tabs>
            </Box>

            <Box sx={{ flexGrow: 1, overflowY: 'auto', p: 3, bgcolor: '#f5f5f5' }}>
                <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems="center" mb={2} spacing={2}>
                    <Box>
                        {tabIndex === 1 && (
                            <TextField select size="small" label="スタッフを選択" value={selectedStaffId} onChange={(e) => setSelectedStaffId(e.target.value)} sx={{ minWidth: 200, bgcolor: 'white' }}>
                                <MenuItem value="all">全員を表示</MenuItem>
                                {staffs.map(s => <MenuItem key={s.id} value={s.id}>{s.name}</MenuItem>)}
                            </TextField>
                        )}
                        {tabIndex === 2 && (
                            <TextField select size="small" label="利用者を選択" value={selectedClientId} onChange={(e) => setSelectedClientId(e.target.value)} sx={{ minWidth: 200, bgcolor: 'white' }}>
                                <MenuItem value="all">全員を表示</MenuItem>
                                {clients.map(c => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>)}
                            </TextField>
                        )}
                    </Box>
                    <Stack direction="row" spacing={1}>
                        {tabIndex === 1 && selectedStaffId === 'all' && (
                            <Button variant="outlined" color="primary" startIcon={<GridOnIcon />} onClick={handleDownloadMatrixPdf} disabled={pdfGenerating || loading} sx={{ bgcolor: 'white' }}>
                                {pdfGenerating ? '作成中...' : '全体シフト表(マトリックス) PDF'}
                            </Button>
                        )}
                        <Button variant="outlined" color="secondary" startIcon={<PictureAsPdfIcon />} onClick={handleDownloadPdf} disabled={pdfGenerating || loading} sx={{ bgcolor: 'white' }}>
                            {pdfGenerating ? '作成中...' : '表示中の形式でPDF出力'}
                        </Button>
                    </Stack>
                </Stack>

                {loading ? (
                    <Box display="flex" justifyContent="center" alignItems="center" height={400}><CircularProgress /></Box>
                ) : (
                    <ShiftCalendarViewer
                        ref={calendarRef}
                        events={events}
                        initialView="listMonth"
                        headerToolbar={{ left: 'prev,next today', center: 'title', right: 'listMonth,dayGridMonth,timeGridWeek' }}
                        buttonText={{ listMonth: 'リスト', dayGridMonth: '月間', timeGridWeek: '週間' }}
                        noEventsText="表示するシフトはありません"
                        onEventClick={(info) => {
                            const { clientId, shiftId, isCancelled } = info.event.extendedProps;
                            if (isCancelled) { showToast('このシフトはキャンセルされています', 'info'); return; }
                            router.push(`/app/record/${clientId}?shiftId=${shiftId}`);
                        }}
                    />
                )}
            </Box>
        </Box>
    );
}
