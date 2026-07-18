'use client';

import { memo, useCallback } from 'react';

import { DynamicFormField } from '@/components/ui';
import { Box, Divider, Stack, Typography } from '@/components/ui/mui';
import type { FormAnswers, FormItem } from '@/hooks/useRecordForm';

type FormFieldItemProps = {
  item: FormItem;
  value: FormAnswers[string] | undefined;
  detailValue: string;
  error?: string;
  isAiFilled: boolean;
  disabled: boolean;
  onAnswerChange: (id: string, value: FormAnswers[string]) => void;
};

const FormFieldItem = memo(function FormFieldItem({
  item,
  value,
  detailValue,
  error,
  isAiFilled,
  disabled,
  onAnswerChange,
}: FormFieldItemProps) {
  const handleChange = useCallback((nextValue: FormAnswers[string]) => {
    onAnswerChange(item.id, nextValue);
  }, [item.id, onAnswerChange]);
  const handleDetailChange = useCallback((nextValue: string) => {
    onAnswerChange(`${item.id}_detail`, nextValue);
  }, [item.id, onAnswerChange]);

  return (
    <Box sx={{ p: { xs: 2, sm: 3 }, bgcolor: error ? 'background.danger' : isAiFilled ? 'background.aiHighlight' : 'transparent' }}>
      <DynamicFormField
        item={item}
        value={value}
        detailValue={detailValue}
        error={error}
        disabled={disabled}
        onChange={handleChange}
        onDetailChange={handleDetailChange}
      />
    </Box>
  );
});

type RecordDynamicSectionsProps = {
  sections: Array<{ title: string; items: FormItem[] }>;
  answers: FormAnswers;
  errors: Record<string, string>;
  aiFilledFields: Set<string>;
  disabled: boolean;
  onAnswerChange: (id: string, value: FormAnswers[string]) => void;
};

export function RecordDynamicSections({
  sections,
  answers,
  errors,
  aiFilledFields,
  disabled,
  onAnswerChange,
}: RecordDynamicSectionsProps) {
  return sections.map((section, index) => (
    <Box key={`${section.title}-${index}`} sx={{ borderRadius: 1, overflow: 'hidden', bgcolor: 'background.paper' }}>
      <Box sx={{ bgcolor: 'background.muted', px: { xs: 2, sm: 3 }, py: { xs: 1.5, sm: 2 }, borderBottom: '1px solid', borderColor: 'divider', display: 'flex', alignItems: 'center' }}>
        <Box sx={{ width: 6, height: 28, bgcolor: 'primary.main', borderRadius: 1, mr: 2, flexShrink: 0 }} />
        <Typography variant="h6" color="text.primary" fontWeight="bold" sx={{ overflowWrap: 'anywhere', lineHeight: 1.3 }}>{section.title}</Typography>
      </Box>
      <Stack divider={<Divider />}>
        {section.items.map((item) => (
          <FormFieldItem
            key={item.id}
            item={item}
            value={answers[item.id]}
            detailValue={String(answers[`${item.id}_detail`] ?? '')}
            error={errors[item.id]}
            isAiFilled={aiFilledFields.has(item.id)}
            disabled={disabled}
            onAnswerChange={onAnswerChange}
          />
        ))}
      </Stack>
    </Box>
  ));
}
