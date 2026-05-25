'use client';

import { useEffect, useState, useMemo } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/components/ui/ToastProvider';
import { useWorkspace } from '@/context/WorkspaceContext';
import { FormItem, ReportStatus } from '@/types';
import { useRecordForm } from './useRecordForm';
import { useRecordTime } from './useRecordTime';
import { useRecordData } from './useRecordData';

interface ShiftDataWithStaffs {
    start_at: string;
    end_at: string;
    shift_staffs: {
        staff_id: string;
        staffs: { name: string } | { name: string }[] | null;
    }[];
}

export function useRecord() {
    const router = useRouter();
    const { clientId } = useParams() as { clientId: string };
    const searchParams = useSearchParams();
    const { showToast } = useToast();
    const { currentOrg, loading: wsLoading } = useWorkspace();
    
    const paramReportId = searchParams.get('reportId');
    const shiftId = searchParams.get('shiftId');

    const [currentReportId, setCurrentReportId] = useState<string | null>(paramReportId);
    const [currentStatus, setCurrentStatus] = useState<ReportStatus | null>(null);

    const [openCloseDialog, setOpenCloseDialog] = useState(false);
    const [openApproveDialog, setOpenApproveDialog] = useState(false); 
    const [openSubmitDialog, setOpenSubmitDialog] = useState(false);   
    const [openRemandDialog, setOpenRemandDialog] = useState(false);   

    const timeModule = useRecordTime();
    const formModule = useRecordForm();
    
    const dataModule = useRecordData(
        currentOrg,
        currentReportId,
        setCurrentReportId,
        shiftId,
        currentStatus,
        timeModule.setupTimeForPart,
        timeModule.setStartDateTime,
        timeModule.setEndDateTime,
        timeModule.setServiceTime,
        formModule.setSelectedHelpers,
        formModule.setAnswers,
        setCurrentStatus,
        formModule.setIsDirty,
        timeModule.setIsSpanningMonth,
        timeModule.setOriginalShiftTimes,
        timeModule.setSelectedPart,
        formModule.setImages,
        showToast
    );

    const handlePartChange = async (part: 'part1' | 'part2') => {
        if (formModule.isDirty) {
            if (!confirm('変更内容が保存されていません。切り替えてよろしいですか？')) return;
        }
        timeModule.setSelectedPart(part);
        formModule.setIsDirty(false);
        
        if (!shiftId || !timeModule.originalShiftTimes) return;
        
        const s = new Date(timeModule.originalShiftTimes.start_at);
        let expectedStartIso: string;
        if (part === 'part1') {
            expectedStartIso = new Date(timeModule.originalShiftTimes.start_at).toISOString();
        } else {
            expectedStartIso = new Date(s.getFullYear(), s.getMonth() + 1, 1, 0, 0, 0).toISOString();
        }

        const { data: existing } = await supabase
            .from('reports')
            .select('id')
            .eq('shift_id', shiftId)
            .eq('start_at', expectedStartIso)
            .maybeSingle();

        if (existing) {
            setCurrentReportId(existing.id);
            router.replace(`/app/record/${clientId}?reportId=${existing.id}&shiftId=${shiftId}`);
            await dataModule.loadExistingData(existing.id);
        } else {
            setCurrentReportId(null);
            router.replace(`/app/record/${clientId}?shiftId=${shiftId}`);
            timeModule.setupTimeForPart(part, timeModule.originalShiftTimes.start_at, timeModule.originalShiftTimes.end_at);
            formModule.setAnswers({});
            setCurrentStatus('draft');
        }
    };

    const setupTimeForPart = timeModule.setupTimeForPart;
    const formatDatetimeLocal = timeModule.formatDatetimeLocal;
    const fetchBaseData = dataModule.fetchBaseData;
    const loadExistingData = dataModule.loadExistingData;
    const setStartDateTime = timeModule.setStartDateTime;
    const setEndDateTime = timeModule.setEndDateTime;
    const setServiceTime = timeModule.setServiceTime;
    const setTravelTime = timeModule.setTravelTime;
    const setSelectedHelpers = formModule.setSelectedHelpers;

    useEffect(() => {
        const init = async () => {
            let targetId = paramReportId;

            if (shiftId && !paramReportId) {
                const { data: existingReport } = await supabase
                    .from('reports')
                    .select('id')
                    .eq('shift_id', shiftId)
                    .maybeSingle();
                
                if (existingReport) {
                    targetId = existingReport.id;
                    setCurrentReportId(targetId);
                    router.replace(`/app/record/${clientId}?reportId=${targetId}`);
                    showToast('このシフトにはすでに記録が存在します。該当する記録を開きました。', 'info');
                } else {
                    const { data, error: shiftError } = await supabase
                        .from('shifts')
                        .select(`
                            start_at, end_at, 
                            shift_staffs (
                                staff_id, 
                                staffs (name)
                            )
                        `)
                        .eq('id', shiftId)
                        .single();
                    
                    if (!shiftError && data) {
                        const shiftData = data as unknown as ShiftDataWithStaffs;
                        const s = new Date(shiftData.start_at);
                        const e = new Date(shiftData.end_at);
                        const isCrossMonth = s.getMonth() !== e.getMonth();
                        
                        timeModule.setIsSpanningMonth(isCrossMonth);
                        timeModule.setOriginalShiftTimes({ start_at: shiftData.start_at, end_at: shiftData.end_at });

                        if (isCrossMonth) {
                            setupTimeForPart('part1', shiftData.start_at, shiftData.end_at);
                        } else {
                            setStartDateTime(formatDatetimeLocal(s));
                            setEndDateTime(formatDatetimeLocal(e));
                            const diffHours = (e.getTime() - s.getTime()) / (1000 * 60 * 60);
                            setServiceTime(diffHours.toString());
                        }

                        const staffNames: string[] = [];
                        const typedShiftStaffs = shiftData.shift_staffs || [];
                        
                        typedShiftStaffs.forEach((ss) => {
                            const name = Array.isArray(ss.staffs) ? ss.staffs[0]?.name : ss.staffs?.name;
                            if (name) staffNames.push(name);
                        });

                        setSelectedHelpers(staffNames);
                        setCurrentStatus('draft');
                    }
                }
            }

            if (!targetId && !shiftId) {
                const now = new Date();
                setStartDateTime(formatDatetimeLocal(now));
                setEndDateTime(formatDatetimeLocal(new Date(now.getTime() + 3600000)));
                setCurrentStatus('draft');
            }

            await fetchBaseData();
            if (targetId) {
                await loadExistingData(targetId);
            }
            dataModule.setLoading(false);
        };

        if (!wsLoading && currentOrg) {
            init();
        }
    }, [
        wsLoading,
        currentOrg,
        paramReportId,
        shiftId,
        clientId,
        router,
        showToast,
        fetchBaseData,
        loadExistingData,
        setupTimeForPart,
        formatDatetimeLocal,
        setStartDateTime,
        setEndDateTime,
        setServiceTime,
        setSelectedHelpers,
        dataModule,
        timeModule
    ]);

    useEffect(() => {
        const handleBeforeUnload = (e: BeforeUnloadEvent) => {
            if (formModule.isDirty) {
                e.preventDefault();
                e.returnValue = '';
            }
        };
        window.addEventListener('beforeunload', handleBeforeUnload);
        return () => window.removeEventListener('beforeunload', handleBeforeUnload);
    }, [formModule.isDirty]);

    const handleChange = (setter: (val: string) => void, val: string) => { setter(val); formModule.setIsDirty(true); };

    const saveReportFn = dataModule.saveReport;
    const answers = formModule.answers;
    const selectedHelpersValue = formModule.selectedHelpers;
    const serviceTimeValue = timeModule.serviceTime;
    const travelTimeValue = timeModule.travelTime;
    const startDateTimeValue = timeModule.startDateTime;
    const endDateTimeValue = timeModule.endDateTime;
    const validateFn = formModule.validate;
    const template = dataModule.template;

    const handleDraftSave = async () => { 
        const success = await saveReportFn('draft', answers, selectedHelpersValue, serviceTimeValue, travelTimeValue, startDateTimeValue, endDateTimeValue, () => validateFn(serviceTimeValue, selectedHelpersValue, template), true);
        if (success) { showToast('下書きを保存しました', 'success'); } 
    };
    const handleSubmit = () => setOpenSubmitDialog(true);
    const executeSubmit = async () => { 
        setOpenSubmitDialog(false); 
        const success = await saveReportFn('pending', answers, selectedHelpersValue, serviceTimeValue, travelTimeValue, startDateTimeValue, endDateTimeValue, () => validateFn(serviceTimeValue, selectedHelpersValue, template));
        if (success) { showToast('記録を送信しました', 'success'); router.push('/app/record'); } 
    };
    const handleApprove = () => setOpenApproveDialog(true);
    const executeApprove = async () => {
        setOpenApproveDialog(false);
        const success = await saveReportFn('approved', answers, selectedHelpersValue, serviceTimeValue, travelTimeValue, startDateTimeValue, endDateTimeValue, () => validateFn(serviceTimeValue, selectedHelpersValue, template));
        if (success) {
            const { data: { user } } = await supabase.auth.getUser();
            if (currentReportId && user) await supabase.from('reports').update({ approved_by: user.id, approved_at: new Date().toISOString() }).eq('id', currentReportId);
            showToast('承認しました', 'success');
            router.push('/app/reports');
        }
    };
    const handleRemand = () => setOpenRemandDialog(true);
    const executeRemand = async () => {
        setOpenRemandDialog(false);
        const success = await saveReportFn('remanded', answers, selectedHelpersValue, serviceTimeValue, travelTimeValue, startDateTimeValue, endDateTimeValue, () => validateFn(serviceTimeValue, selectedHelpersValue, template));
        if (success) {
            if (currentReportId) await supabase.from('reports').update({ approved_by: null, approved_at: null }).eq('id', currentReportId);
            showToast('記録を差し戻しました', 'info');
            router.push('/app/reports');
        }
    };

    const handleClose = () => { if (formModule.isDirty) setOpenCloseDialog(true); else router.back(); };
    const handleDialogDiscard = () => { setOpenCloseDialog(false); router.back(); };
    const handleDialogSaveDraft = async () => { 
        const success = await saveReportFn('draft', answers, selectedHelpersValue, serviceTimeValue, travelTimeValue, startDateTimeValue, endDateTimeValue, () => validateFn(serviceTimeValue, selectedHelpersValue, template), true);
        if (success) { showToast('下書き保存しました'); router.back(); } 
        setOpenCloseDialog(false); 
    };

    const groupedSections = useMemo(() => {
        const sections: { title: string; items: FormItem[] }[] = [];
        let currentSection = { title: '基本項目', items: [] as FormItem[] };
        template.forEach(item => {
            if (item.type === 'section') { if (currentSection.items.length > 0) sections.push(currentSection); currentSection = { title: item.label, items: [] }; } 
            else currentSection.items.push(item);
        });
        if (currentSection.items.length > 0 || currentSection.title !== '基本項目') sections.push(currentSection);
        return sections;
    }, [template]);

    const isAdmin = currentOrg && ['owner', 'manager'].includes(currentOrg.role);

    return {
        clientId,
        currentOrg,
        currentReportId,
        clientName: dataModule.clientName,
        template,
        answers,
        selectableStaffs: dataModule.selectableStaffs,
        selectedHelpers: selectedHelpersValue,
        setSelectedHelpers,
        startDateTime: startDateTimeValue,
        setStartDateTime,
        endDateTime: endDateTimeValue,
        setEndDateTime,
        serviceTime: serviceTimeValue,
        setServiceTime,
        travelTime: travelTimeValue,
        setTravelTime,
        currentStatus,
        isDirty: formModule.isDirty,
        images: formModule.images,
        openCloseDialog,
        setOpenCloseDialog,
        openApproveDialog,
        setOpenApproveDialog,
        openSubmitDialog,
        setOpenSubmitDialog,
        openRemandDialog,
        setOpenRemandDialog,
        loading: dataModule.loading,
        errors: formModule.errors,
        submitting: dataModule.submitting,
        isSpanningMonth: timeModule.isSpanningMonth,
        selectedPart: timeModule.selectedPart,
        originalShiftTimes: timeModule.originalShiftTimes,
        formatTimeForLabel: timeModule.formatTimeForLabel,
        handlePartChange,
        handleChange,
        handleAnswerChange: formModule.handleAnswerChange,
        handleImageUpload: dataModule.handleImageUpload,
        handleDeleteReport: dataModule.handleDeleteReport,
        handleDraftSave,
        handleSubmit,
        executeSubmit,
        handleApprove,
        executeApprove,
        handleRemand,
        executeRemand,
        handleClose,
        handleDialogDiscard,
        handleDialogSaveDraft,
        groupedSections,
        isAdmin
    };
}