'use client';

import { Box, Radio, RadioGroup, Tooltip } from '@/components/ui/mui';
import CheckIcon from '@mui/icons-material/Check';
import { getContrastRatio } from '@mui/material/styles';

const PRESET_COLORS = [
  { label: 'レッド',     value: '#EF4444' },
  { label: 'オレンジ',   value: '#F97316' },
  { label: 'アンバー',   value: '#F59E0B' },
  { label: 'イエロー',   value: '#EAB308' },
  { label: 'ライム',     value: '#84CC16' },
  { label: 'グリーン',   value: '#22C55E' },
  { label: 'ティール',   value: '#14B8A6' },
  { label: 'シアン',     value: '#06B6D4' },
  { label: 'ブルー',     value: '#3B82F6' },
  { label: 'インディゴ', value: '#6366F1' },
  { label: 'パープル',   value: '#8B5CF6' },
  { label: 'ピンク',     value: '#EC4899' },
] as const;

type Props = {
  value: string;
  onChange: (color: string) => void;
};

export default function ColorPresetPicker({ value, onChange }: Props) {
  return (
    <RadioGroup row aria-label="ロールの色" value={value} onChange={(_, color) => onChange(color)} sx={{ gap: 1 }}>
      {PRESET_COLORS.map((color) => (
        <Tooltip key={color.value} title={color.label} placement="top">
          <Radio
            value={color.value}
            slotProps={{ input: { 'aria-label': color.label } }}
            icon={<Box sx={{ width: 28, height: 28, borderRadius: '50%', bgcolor: color.value, border: '1px solid', borderColor: 'text.secondary' }} />}
            checkedIcon={
              <Box sx={{ width: 28, height: 28, borderRadius: '50%', bgcolor: color.value, border: '1px solid', borderColor: 'text.secondary', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <CheckIcon sx={(theme) => ({ fontSize: 18, color: getContrastRatio(theme.palette.text.primary, color.value) >= getContrastRatio(theme.palette.common.white, color.value) ? 'text.primary' : 'common.white' })} />
              </Box>
            }
            sx={{
              p: 0.5,
              '&.Mui-checked': { outline: '2px solid', outlineColor: 'text.primary', outlineOffset: 1 },
              '&.Mui-focusVisible': { outline: '3px solid', outlineColor: 'primary.dark', outlineOffset: 2 },
            }}
          />
        </Tooltip>
      ))}
    </RadioGroup>
  );
}
