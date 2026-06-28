'use client';

import { Box, Tooltip } from '@/components/ui/mui';
import CheckIcon from '@mui/icons-material/Check';

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
    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
      {PRESET_COLORS.map((color) => (
        <Tooltip key={color.value} title={color.label} placement="top">
          <Box
            onClick={() => onChange(color.value)}
            sx={{
              width: 28,
              height: 28,
              borderRadius: '50%',
              bgcolor: color.value,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              outline: value === color.value
                ? `3px solid ${color.value}`
                : '3px solid transparent',
              outlineOffset: 2,
              transition: 'outline 0.1s',
              '&:hover': { opacity: 0.85 },
            }}
          >
            {value === color.value && (
              <CheckIcon sx={{ fontSize: 16, color: '#fff' }} />
            )}
          </Box>
        </Tooltip>
      ))}
    </Box>
  );
}
