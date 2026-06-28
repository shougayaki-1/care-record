'use client';

import { Box, FormHelperText, Stack, Typography } from '@mui/material';
import { AppTextField, NumberField } from './Fields';
import { CheckboxGroupField, RadioGroupField, SwitchField } from './SelectionFields';

export type DynamicFormItem = {
  id: string;
  label: string;
  type: 'text' | 'number' | 'checkbox' | 'time' | 'select' | 'multicheckbox' | 'section';
  options?: string;
  required?: boolean;
  hasDetail?: boolean;
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
const needsDetail = (item: DynamicFormItem, value: DynamicFormValue | undefined) =>
  Boolean(item.hasDetail) && (value === true || (Array.isArray(value) ? value : [String(value ?? '')]).some((entry) => entry.includes('他')));

export function DynamicFormField({ item, value, detailValue = '', error, disabled, onChange, onDetailChange }: DynamicFormFieldProps) {
  if (item.type === 'section') return null;
  const detailField = needsDetail(item, value) && onDetailChange && (
    <AppTextField
      label="詳細・補足"
      value={detailValue}
      onChange={(event) => onDetailChange(event.target.value)}
      disabled={disabled}
      placeholder="詳細を入力してください"
    />
  );

  if (item.type === 'checkbox') {
    return (
      <Stack spacing={1.5}>
        <SwitchField
          label={<Typography fontWeight={value ? 700 : 400}>{item.label}</Typography>}
          labelPlacement="start"
          sx={{ justifyContent: 'space-between', m: 0 }}
          checked={Boolean(value)}
          onChange={(event) => onChange(event.target.checked)}
          disabled={disabled}
        />
        {error && <FormHelperText error>{error}</FormHelperText>}
        {detailField}
      </Stack>
    );
  }

  if (item.type === 'multicheckbox') {
    return (
      <Stack spacing={1.5}>
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
        {detailField}
      </Stack>
    );
  }

  if (item.type === 'select') {
    return (
      <Stack spacing={1.5}>
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
        {detailField}
      </Stack>
    );
  }

  if (item.type === 'number') {
    return <NumberField label={item.label} value={value === undefined ? '' : String(value)} onChange={(event) => onChange(event.target.value)} required={item.required} error={Boolean(error)} helperText={error} disabled={disabled} />;
  }

  return (
    <Box>
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
    </Box>
  );
}
