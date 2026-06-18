import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { Stack } from '@mui/material';
import { useState } from 'react';
import { AppTextField, DateTimeField, NumberField, SelectField } from './Fields';

const FieldShowcase = () => {
  const [text, setText] = useState('山田 太郎');
  const [number, setNumber] = useState('1.5');
  const [role, setRole] = useState('staff');
  return <Stack spacing={2} sx={{ width: 360 }}>
    <AppTextField label="氏名" required value={text} onChange={(event) => setText(event.target.value)} />
    <AppTextField label="エラー" error helperText="必須項目です" />
    <NumberField label="サービス時間" value={number} onChange={(event) => setNumber(event.target.value)} />
    <DateTimeField label="開始日時" value="2026-06-18T10:00" />
    <SelectField label="権限" value={role} onChange={setRole} options={[{ value: 'staff', label: 'スタッフ' }, { value: 'manager', label: '管理者' }]} />
  </Stack>;
};

const meta = { title: 'UI/Fields', component: FieldShowcase, tags: ['autodocs'] } satisfies Meta<typeof FieldShowcase>;
export default meta;
export const AllStates: StoryObj<typeof meta> = {};

