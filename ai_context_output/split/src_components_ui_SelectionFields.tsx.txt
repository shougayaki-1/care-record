'use client';

import {
  Autocomplete,
  Checkbox,
  Chip,
  FormControl,
  FormControlLabel,
  FormGroup,
  FormHelperText,
  Radio,
  RadioGroup,
  TextField,
  Typography,
} from '@mui/material';
import CheckBoxIcon from '@mui/icons-material/CheckBox';
import CheckBoxOutlineBlankIcon from '@mui/icons-material/CheckBoxOutlineBlank';

export interface MultiSelectFieldProps<T> {
  label: string;
  options: readonly T[];
  value: readonly T[];
  onChange: (value: T[]) => void;
  getOptionLabel: (option: T) => string;
  getOptionValue: (option: T) => string | number;
  required?: boolean;
  disabled?: boolean;
  error?: boolean;
  helperText?: string;
  placeholder?: string;
  searchable?: boolean;
  noOptionsText?: string;
}

export function MultiSelectField<T>({
  label,
  options,
  value,
  onChange,
  getOptionLabel,
  getOptionValue,
  required,
  disabled,
  error,
  helperText,
  placeholder = '選択してください',
  searchable = true,
  noOptionsText = '選択肢がありません',
}: MultiSelectFieldProps<T>) {
  return (
    <Autocomplete
      multiple
      disableCloseOnSelect
      options={[...options]}
      value={[...value]}
      disabled={disabled}
      readOnly={!searchable}
      noOptionsText={noOptionsText}
      getOptionLabel={getOptionLabel}
      isOptionEqualToValue={(option, selected) => getOptionValue(option) === getOptionValue(selected)}
      onChange={(_, nextValue) => onChange(nextValue)}
      renderOption={(props, option, state) => {
        const { key, ...optionProps } = props;
        return (
          <li key={key} {...optionProps}>
            <Checkbox
              icon={<CheckBoxOutlineBlankIcon fontSize="small" />}
              checkedIcon={<CheckBoxIcon fontSize="small" />}
              checked={state.selected}
              sx={{ mr: 1 }}
            />
            {getOptionLabel(option)}
          </li>
        );
      }}
      renderValue={(selected, getItemProps) =>
        selected.map((option, index) => {
          const { key, ...itemProps } = getItemProps({ index });
          return <Chip key={key} label={getOptionLabel(option)} {...itemProps} />;
        })
      }
      renderInput={(params) => (
        <TextField
          {...params}
          label={label}
          required={required}
          error={error}
          helperText={helperText}
          placeholder={value.length === 0 ? placeholder : undefined}
        />
      )}
    />
  );
}

export interface CreatableMultiSelectFieldProps {
  label: string;
  options: readonly string[];
  value: readonly string[];
  onChange: (value: string[]) => void;
  helperText?: string;
  placeholder?: string;
  disabled?: boolean;
  maxSelections?: number;
}

export function CreatableMultiSelectField({ label, options, value, onChange, helperText, placeholder = '入力してEnter', disabled, maxSelections }: CreatableMultiSelectFieldProps) {
  return (
    <Autocomplete
      multiple
      freeSolo
      options={[...options]}
      value={[...value]}
      disabled={disabled}
      onChange={(_, nextValue) => onChange(nextValue.map((item) => item.trim()).filter(Boolean).slice(0, maxSelections))}
      renderValue={(selected, getItemProps) => selected.map((option, index) => {
        const { key, ...itemProps } = getItemProps({ index });
        return <Chip key={key} label={option} color="primary" {...itemProps} />;
      })}
      renderInput={(params) => <TextField {...params} label={label} placeholder={value.length === 0 ? placeholder : undefined} helperText={helperText} />}
    />
  );
}

export interface ChoiceGroupProps<T> {
  label?: string;
  options: readonly T[];
  getOptionLabel: (option: T) => string;
  getOptionValue: (option: T) => string;
  required?: boolean;
  error?: boolean;
  helperText?: string;
  row?: boolean;
}

export interface CheckboxGroupFieldProps<T> extends ChoiceGroupProps<T> {
  value: readonly string[];
  onChange: (value: string[]) => void;
}

export function CheckboxGroupField<T>({ label, options, value, onChange, getOptionLabel, getOptionValue, required, error, helperText, row = true }: CheckboxGroupFieldProps<T>) {
  return (
    <FormControl component="fieldset" required={required} error={error}>
      {label && <Typography component="legend" variant="subtitle2" mb={1}>{label}</Typography>}
      <FormGroup row={row}>
        {options.map((option) => {
          const optionValue = getOptionValue(option);
          return (
            <FormControlLabel
              key={optionValue}
              label={getOptionLabel(option)}
              control={<Checkbox checked={value.includes(optionValue)} onChange={(event) => onChange(event.target.checked ? [...value, optionValue] : value.filter((item) => item !== optionValue))} />}
            />
          );
        })}
      </FormGroup>
      {helperText && <FormHelperText>{helperText}</FormHelperText>}
    </FormControl>
  );
}

export interface RadioGroupFieldProps<T> extends ChoiceGroupProps<T> {
  value: string;
  onChange: (value: string) => void;
}

export function RadioGroupField<T>({ label, options, value, onChange, getOptionLabel, getOptionValue, required, error, helperText, row = true }: RadioGroupFieldProps<T>) {
  return (
    <FormControl component="fieldset" required={required} error={error}>
      {label && <Typography component="legend" variant="subtitle2" mb={1}>{label}</Typography>}
      <RadioGroup row={row} value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => <FormControlLabel key={getOptionValue(option)} value={getOptionValue(option)} control={<Radio />} label={getOptionLabel(option)} />)}
      </RadioGroup>
      {helperText && <FormHelperText>{helperText}</FormHelperText>}
    </FormControl>
  );
}
