'use client';

import { useMemo, useState } from 'react';

import { DynamicFormField } from '@/components/ui';
import { AppDialog, AppButton } from '@/components/ui';
import { Box, Divider, Stack, Typography } from '@/components/ui/mui';
import type { FormItem } from '@/constants/formTemplates';

type PreviewAnswers = Record<string, string | number | boolean | string[]>;

type Props = {
  open: boolean;
  onClose: () => void;
  formItems: FormItem[];
};

// Groups items into sections the same way useRecordForm's groupedSections
// does, so preview matches the real record screen's layout exactly.
function groupSections(items: FormItem[]) {
  const sections: { title: string; items: FormItem[] }[] = [];
  let currentSection = { title: '基本項目', items: [] as FormItem[] };
  items.forEach((item) => {
    if (item.type === 'section') {
      if (currentSection.items.length > 0) sections.push(currentSection);
      currentSection = { title: item.label, items: [] };
    } else {
      currentSection.items.push(item);
    }
  });
  if (currentSection.items.length > 0 || currentSection.title !== '基本項目') sections.push(currentSection);
  return sections;
}

export function FormPreviewDialog({ open, onClose, formItems }: Props) {
  // Local-only answers: never persisted, never touches Supabase/autosave/
  // audit events. Keyed the same way the real record form keys detail
  // values (`${item.id}_detail`), per useRecordForm.ts / RecordDynamicSections.tsx.
  const [answers, setAnswers] = useState<PreviewAnswers>({});

  const sections = useMemo(() => groupSections(formItems), [formItems]);

  const handleAnswerChange = (id: string, value: PreviewAnswers[string]) => {
    setAnswers((prev) => ({ ...prev, [id]: value }));
  };

  return (
    <AppDialog
      open={open}
      onClose={onClose}
      title="フォームプレビュー"
      maxWidth="sm"
      actions={<AppButton onClick={onClose}>閉じる</AppButton>}
    >
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        設定可能な設問部分のプレビューです。日時・担当スタッフなど記録画面固有の項目は含まれません。
      </Typography>
      <Stack spacing={2}>
        {sections.map((section, index) => (
          <Box key={`${section.title}-${index}`} sx={{ borderRadius: 1, overflow: 'hidden', bgcolor: 'background.paper' }}>
            <Box sx={{ bgcolor: 'background.muted', px: 2, py: 1.5, borderBottom: '1px solid', borderColor: 'divider', display: 'flex', alignItems: 'center' }}>
              <Box sx={{ width: 6, height: 28, bgcolor: 'primary.main', borderRadius: 1, mr: 2, flexShrink: 0 }} />
              <Typography variant="h6" color="text.primary" fontWeight="bold">{section.title}</Typography>
            </Box>
            <Stack divider={<Divider />}>
              {section.items.map((item) => (
                <Box key={item.id} sx={{ p: 2 }}>
                  <DynamicFormField
                    item={item}
                    value={answers[item.id]}
                    detailValue={String(answers[`${item.id}_detail`] ?? '')}
                    onChange={(value) => handleAnswerChange(item.id, value)}
                    onDetailChange={(value) => handleAnswerChange(`${item.id}_detail`, value)}
                  />
                </Box>
              ))}
            </Stack>
          </Box>
        ))}
        {sections.length === 0 && (
          <Typography variant="body2" color="text.secondary">項目がまだありません。</Typography>
        )}
      </Stack>
    </AppDialog>
  );
}
