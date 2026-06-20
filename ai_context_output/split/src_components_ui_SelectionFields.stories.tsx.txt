import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { Stack } from '@mui/material';
import { useState } from 'react';
import { CheckboxGroupField, CreatableMultiSelectField, MultiSelectField, RadioGroupField } from './SelectionFields';

const people = [{ id: '1', name: '山田 太郎' }, { id: '2', name: '佐藤 花子' }, { id: '3', name: '鈴木 一郎' }];
const SelectionShowcase = () => {
  const [selected, setSelected] = useState<typeof people>([people[0]]);
  const [checked, setChecked] = useState<string[]>(['1']);
  const [radio, setRadio] = useState('1');
  const [positions, setPositions] = useState<string[]>(['常勤']);
  return <Stack spacing={3} sx={{ width: 420 }}>
    <MultiSelectField label="担当スタッフ" required options={people} value={selected} onChange={setSelected} getOptionLabel={(person) => person.name} getOptionValue={(person) => person.id} />
    <MultiSelectField label="エラー状態" options={[]} value={[]} onChange={() => undefined} getOptionLabel={(person: { name: string }) => person.name} getOptionValue={() => ''} error helperText="1名以上選択してください" />
    <CreatableMultiSelectField label="役職（自由入力可）" options={['管理者', '常勤', '非常勤']} value={positions} onChange={setPositions} helperText="候補にない役職もEnterで追加できます" />
    <CheckboxGroupField label="複数選択" options={people} value={checked} onChange={setChecked} getOptionLabel={(person) => person.name} getOptionValue={(person) => person.id} />
    <RadioGroupField label="単一選択" options={people} value={radio} onChange={setRadio} getOptionLabel={(person) => person.name} getOptionValue={(person) => person.id} />
  </Stack>;
};

const meta = { title: 'UI/Selection fields', component: SelectionShowcase, tags: ['autodocs'] } satisfies Meta<typeof SelectionShowcase>;
export default meta;
export const AllStates: StoryObj<typeof meta> = {};
