'use client';

import { useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useParams, useRouter } from 'next/navigation';
import { FormItem, ReportStatus } from '@/types';
import { COMPREHENSIVE_TEMPLATE } from '@/constants/formTemplates';
import { Workspace } from '@/context/WorkspaceContext';

export function useRecordData(
    currentOrg: Workspace | null,
    currentReportId: string | null,
    setCurrentReportId: (id: string | null) => void,
    shiftId: string | null,
    currentStatus: ReportStatus | null,
    setupTimeForPart: (part: 'part1' | 'part2', start: string, end: string) => void,
    setStartDateTime: (val: string) => void,
    setEndDateTime: (val: string) => void,
    setServiceTime: (val: string) => void,
    setSelectedHelpers: (val: string[]) => void,
    setAnswers: (val: Record<string, string | number | boolean | string[]>) => void,
    setCurrentStatus: (val: ReportStatus | null) => void,
    setIsDirty: (val: boolean) => void,
    setIsSpanningMonth: (val: boolean) => void,
    setOriginalShiftTimes: (val: { start_at: string; end_at: string } | null) => void,
    setSelectedPart: (val: 'part1' | 'part2') => void,
    setImages: (val: { id: string; url: string }[]) => void,
    showToast: (msg: string, severity?: 'success' | 'error' | 'info' | 'warning') => void
) {
    const { clientId } = useParams() as { clientId: string };
    const router = useRouter();

    const [clientName, setClientName] = useState('');
    const [template, setTemplate] = useState<FormItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [selectableStaffs, setSelectableStaffs] = useState<{ id: string; name: string }[]>([]);

    const loadExistingData = useCallback(async (targetId: string) => {
        if (!targetId) return;
        try {
            const { data: r } = await supabase.from('reports').select('*, shifts(start_at, end_at)').eq('id', targetId).single();
            const { data: v = null } = await supabase.from('report_values').select('data').eq('report_id', targetId).single();
            if (r && v) {
                const pad = (n: number) => String(n).padStart(2, '0');
                const localFormat = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

                setStartDateTime(localFormat(new Date(r.start_at)));
                setEndDateTime(localFormat(new Date(r.end_at)));
                setCurrentStatus(r.status as ReportStatus);
                const data = v.data as Record<string, string | number | boolean | string[]>;
                setServiceTime((data.service_time as string) || '');
                setAnswers(data);
                setIsDirty(false);

                if (r.shifts) {
                    const s = new Date(r.shifts.start_at);
                    const e = new Date(r.shifts.end_at);
                    const isCrossMonth = s.getMonth() !== e.getMonth();
                    setIsSpanningMonth(isCrossMonth);
                    setOriginalShiftTimes({ start_at: r.shifts.start_at, end_at: r.shifts.end_at });
                    
                    if (isCrossMonth) {
                        const isPart1 = new Date(r.start_at).getTime() === s.getTime();
                        setSelectedPart(isPart1 ? 'part1' : 'part2');
                    }
                }

                const { data: imgData } = await supabase.from('report_images').select('*').eq('report_id', targetId);
                if (imgData) {
                    setImages(imgData.map(i => ({ 
                        id: i.id, 
                        url: supabase.storage.from('report-images').getPublicUrl(i.storage_path).data.publicUrl 
                    })));
                }
            }
        } catch (e) { console.error(e); }
    }, [setStartDateTime, setEndDateTime, setCurrentStatus, setServiceTime, setAnswers, setIsDirty, setIsSpanningMonth, setOriginalShiftTimes, setSelectedPart, setImages]);

    const fetchBaseData = useCallback(async () => {
        const { data: { user } } = await supabase.auth.getUser();
        if (!currentOrg) return;

        try {
            const { data: client } = await supabase.from('clients').select('*').eq('id', clientId).single();
            if (client) {
                setClientName(client.name);
                const { data: tmpl } = await supabase.from('form_templates').select('schema').eq('client_id', clientId).maybeSingle();
                const schema = (tmpl?.schema as FormItem[]) || COMPREHENSIVE_TEMPLATE;
                setTemplate(schema.filter(i => i.id !== 'service_time' && i.id !== 'travel_time'));
            }

            const { data: staffsData } = await supabase
                .from('staffs')
                .select('id, name, user_id')
                .eq('organization_id', currentOrg.id)
                .order('name', { ascending: true });

            const allStaffs = (staffsData || []).map(s => ({ id: s.id, name: s.name, user_id: s.user_id }));
            setSelectableStaffs(allStaffs);

            if (!currentReportId && !shiftId && user) {
                const myStaffRecord = allStaffs.find(s => s.user_id === user.id);
                if (myStaffRecord) {
                    setSelectedHelpers([myStaffRecord.name]);
                }
            }
        } catch (error) { console.error('Error fetching base data:', error); }
    }, [clientId, currentOrg, currentReportId, shiftId, setSelectedHelpers]);

    const saveReport = async (
        status: ReportStatus,
        answers: Record<string, string | number | boolean | string[]>,
        selectedHelpers: string[],
        serviceTime: string,
        travelTime: string,
        startDateTime: string,
        endDateTime: string,
        validateFn: () => boolean,
        skipValidation = false
    ) => {
        if (!skipValidation && !validateFn()) { showToast('入力不備があります', 'error'); window.scrollTo({ top: 0, behavior: 'smooth' }); return false; }
        setSubmitting(true);
        try {
            const { data: { user } } = await supabase.auth.getUser();
            const finalData = { ...answers, _helpers: selectedHelpers, service_time: serviceTime, travel_time: travelTime };
            
            const basePayload = {
                client_id: clientId as string,
                start_at: new Date(startDateTime).toISOString(),
                end_at: new Date(endDateTime).toISOString(),
                status: status,
                shift_id: shiftId || null, 
                updated_at: new Date().toISOString()
            };

            let targetReportId = currentReportId;
            let payload;
            if (!currentReportId) {
                payload = { ...basePayload, helper_id: user?.id };
            } else {
                payload = basePayload;
            }

            if (currentReportId) {
                await supabase.from('reports').update(payload).eq('id', currentReportId);
                await supabase.from('report_values').update({ data: finalData }).eq('report_id', currentReportId);
            } else {
                const { data: nr } = await supabase.from('reports').insert(payload).select().single();
                if (nr) {
                    await supabase.from('report_values').insert({ report_id: nr.id, data: finalData });
                    targetReportId = nr.id;
                    setCurrentReportId(nr.id);
                }
            }
            setIsDirty(false);
            
            if (!currentReportId && targetReportId) {
                const newUrl = `/app/record/${clientId}?reportId=${targetReportId}`;
                router.replace(newUrl);
            }

            return true;
        } catch (e) { console.error(e); showToast('エラーが発生しました', 'error'); return false; } 
        finally { setSubmitting(false); }
    };

    const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!currentReportId || !e.target.files || e.target.files.length === 0) return;
        setSubmitting(true);
        try {
            const file = e.target.files[0];
            const path = `${currentReportId}/${Date.now()}_${file.name}`;
            const { error } = await supabase.storage.from('report-images').upload(path, file);
            if (error) throw error;
            
            await supabase.from('report_images').insert({ report_id: currentReportId, storage_path: path });
            await loadExistingData(currentReportId);
            showToast('画像をアップロードしました');
        } catch(e) {
            console.error(e);
            showToast('アップロード失敗', 'error');
        } finally {
            setSubmitting(false);
        }
    };

    const handleDeleteReport = async () => {
        if(!confirm('本当に削除しますか？')) return;
        if (currentStatus === 'approved') { showToast('承認済みの記録は削除できません', 'error'); return; }
        try {
            await supabase.from('reports').delete().eq('id', currentReportId);
            showToast('削除しました');
            router.back();
        } catch(e) {
            console.error(e);
            showToast('削除に失敗しました', 'error');
        }
    };

    return {
        clientName,
        template,
        loading,
        setLoading,
        submitting,
        selectableStaffs,
        fetchBaseData,
        loadExistingData,
        saveReport,
        handleImageUpload,
        handleDeleteReport
    };
}