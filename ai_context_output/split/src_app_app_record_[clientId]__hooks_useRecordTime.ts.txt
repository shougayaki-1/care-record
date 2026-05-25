'use client';

import { useState, useCallback } from 'react';

export function useRecordTime() {
    const [startDateTime, setStartDateTime] = useState('');
    const [endDateTime, setEndDateTime] = useState('');
    const [serviceTime, setServiceTime] = useState('');
    const [travelTime, setTravelTime] = useState('0');
    const [isSpanningMonth, setIsSpanningMonth] = useState(false);
    const [selectedPart, setSelectedPart] = useState<'part1' | 'part2'>('part1');
    const [originalShiftTimes, setOriginalShiftTimes] = useState<{ start_at: string; end_at: string } | null>(null);

    const formatDatetimeLocal = (date: Date) => {
        const pad = (n: number) => String(n).padStart(2, '0');
        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
    };

    const formatTimeForLabel = (dateStr?: string) => {
        if (!dateStr) return '';
        const d = new Date(dateStr);
        return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    };

    const setupTimeForPart = useCallback((part: 'part1' | 'part2', startIso: string, endIso: string) => {
        const s = new Date(startIso);
        const pad = (n: number) => String(n).padStart(2, '0');
        const localFormat = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
        
        if (part === 'part1') {
            setStartDateTime(localFormat(s));
            const midnight = new Date(s.getFullYear(), s.getMonth() + 1, 1, 0, 0, 0);
            setEndDateTime(localFormat(midnight));
            const diff = (midnight.getTime() - s.getTime()) / (1000 * 60 * 60);
            setServiceTime(diff.toString());
        } else {
            const midnight = new Date(s.getFullYear(), s.getMonth() + 1, 1, 0, 0, 0);
            setStartDateTime(localFormat(midnight));
            setEndDateTime(localFormat(new Date(endIso)));
            const diff = (new Date(endIso).getTime() - midnight.getTime()) / (1000 * 60 * 60);
            setServiceTime(diff.toString());
        }
    }, []);

    return {
        startDateTime,
        setStartDateTime,
        endDateTime,
        setEndDateTime,
        serviceTime,
        setServiceTime,
        travelTime,
        setTravelTime,
        isSpanningMonth,
        setIsSpanningMonth,
        selectedPart,
        setSelectedPart,
        originalShiftTimes,
        setOriginalShiftTimes,
        formatDatetimeLocal,
        formatTimeForLabel,
        setupTimeForPart
    };
}