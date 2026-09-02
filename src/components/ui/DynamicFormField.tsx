'use client';

import { FormHelperText, Stack, Typography } from '@mui/material';
import { AppTextField, NumberField } from './Fields';
import { CheckboxGroupField, RadioGroupField, SwitchField } from './SelectionFields';
import { shouldShowDetailInput } from '@/utils/formDetail';

export type DynamicFormItem = {
  id: string;
  label: string;
  type: 'text' | 'number' | 'checkbox' | 'time' | 'select' | 'multicheckbox' | 'section';
  options?: string;
  required?: boolean;
  hasDetail?: boolean;
  detailMode?: 'conditional' | 'always';
  detailLabel?: string;
};

export type DynamicFormValue = string | number | boolean | string[];

export interface DynamicFormFieldProps {
  item: DynamicFormItem;
  value: DynamicFormValue | undefined;
  detailValue?: string;
  error?: string;
  disabled?: boolean;
  onChange: (value: DynamicFormValue) => void;
  onDetailChange?: (value: string) => void;
}

const optionsFor = (item: DynamicFormItem) => (item.options ?? '').split(',').map((option) => option.trim()).filter(Boolean);

function MainField({ item, value, error, disabled, onChange }: {
  item: DynamicFormItem;
  value: DynamicFormValue | undefined;
  error?: string;
  disabled?: boolean;
  onChange: (value: DynamicFormValue) => void;
}) {
  if (item.type === 'checkbox') {
    return (
      <>
        <SwitchField
          label={<Typography fontWeight={value ? 700 : 400}>{item.label}</Typography>}
          labelPlacement="start"
          sx={{ justifyContent: 'space-between', m: 0 }}
          checked={Boolean(value)}
          onChange={(event) => onChange(event.target.checked)}
          disabled={disabled}
        />
        {error && <FormHelperText error>{error}</FormHelperText>}
      </>
    );
  }

  if (item.type === 'multicheckbox') {
    return (
      <CheckboxGroupField
        label={item.label}
        options={optionsFor(item)}
        value={Array.isArray(value) ? value : []}
        onChange={onChange}
        getOptionLabel={(option) => option}
        getOptionValue={(option) => option}
        required={item.required}
        error={Boolean(error)}
        helperText={error}
      />
    );
  }

  if (item.type === 'select') {
    return (
      <RadioGroupField
        label={item.label}
        options={optionsFor(item)}
        value={String(value ?? '')}
        onChange={onChange}
        getOptionLabel={(option) => option}
        getOptionValue={(option) => option}
        required={item.required}
        error={Boolean(error)}
        helperText={error}
      />
    );
  }

  if (item.type === 'number') {
    return (
      <NumberField label={item.label} value={value === undefined ? '' : String(value)} onChange={(event) => onChange(event.target.value)} required={item.required} error={Boolean(error)} helperText={error} disabled={disabled} />
    );
  }

  return (
    <AppTextField
      label={item.label}
      type={item.type === 'time' ? 'time' : 'text'}
      multiline={item.type === 'text'}
      minRows={item.type === 'text' ? 3 : 1}
      value={String(value ?? '')}
      onChange={(event) => onChange(event.target.value)}
      required={item.required}
      error={Boolean(error)}
      helperText={error}
      disabled={disabled}
      slotProps={item.type === 'time' ? { inputLabel: { shrink: true } } : undefined}
    />
  );
}

export function DynamicFormField({ item, value, detailValue = '', error, disabled, onChange, onDetailChange }: DynamicFormFieldProps) {
  if (item.type === 'section') return null;

  const showDetail = shouldShowDetailInput(item, value) && Boolean(onDetailChange);

  return (
    <Stack spacing={1.5}>
      <MainField item={item} value={value} error={error} disabled={disabled} onChange={onChange} />
      {showDetail && onDetailChange && (
        <AppTextField
          label={item.detailLabel || '詳細・補足'}
          value={detailValue}
          onChange={(event) => onDetailChange(event.target.value)}
          disabled={disabled}
          placeholder="詳細を入力してください"
        />
      )}
    </Stack>
  );
}
