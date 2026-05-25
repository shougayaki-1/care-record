'use client';

import { useState, useCallback } from 'react';
import { FormItem } from '@/types';

type FormAnswers = Record<string, string | number | boolean | string[]>;

export function useRecordForm() {
    const [answers, setAnswers] = useState<FormAnswers>({});
    const [selectedHelpers, setSelectedHelpers] = useState<string[]>([]);
    const [errors, setErrors] = useState<Record<string, string>>({});
    const [isDirty, setIsDirty] = useState(false);
    const [images, setImages] = useState<{id: string, url: string}[]>([]);

    const handleAnswerChange = useCallback((id: string, value: string | number | boolean | string[]) => {
        setAnswers(prev => ({ ...prev, [id]: value }));
        setIsDirty(true);
        if (errors[id]) {
            const ne = { ...errors };
            delete ne[id];
            setErrors(ne);
        }
    }, [errors]);

    const validate = useCallback((serviceTime: string, selectedHelpers: string[], currentTemplate: FormItem[]) => {
        const ne: Record<string, string> = {};
        if (!serviceTime) ne['serviceTime'] = '必須項目です';
        if (selectedHelpers.length === 0) ne['helpers'] = '担当スタッフを選択してください';
        currentTemplate.forEach(item => {
            const val = answers[item.id];
            if (item.required && (!val || (Array.isArray(val) && val.length === 0))) ne[item.id] = '必須項目です';
        });
        setErrors(ne);
        return Object.keys(ne).length === 0;
    }, [answers]);

    return {
        answers,
        setAnswers,
        selectedHelpers,
        setSelectedHelpers,
        errors,
        setErrors,
        isDirty,
        setIsDirty,
        images,
        setImages,
        handleAnswerChange,
        validate
    };
}