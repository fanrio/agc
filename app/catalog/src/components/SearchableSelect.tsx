import React from 'react';
import { Autocomplete, TextField, Chip } from '@mui/material';

export interface SearchableSelectOption {
  value: any;
  label: string;
  sublabel?: string;
}

interface SearchableSelectProps {
  options: (SearchableSelectOption | string | number)[];
  value: any; // Can be a single value (string/number/null) or an array of values
  onChange: (value: any) => void;
  label: string;
  multiple?: boolean;
  disabled?: boolean;
  required?: boolean;
  size?: 'small' | 'medium';
  fullWidth?: boolean;
  placeholder?: string;
  error?: boolean;
  helperText?: string;
  sx?: any;
  getOptionDisabled?: (option: SearchableSelectOption) => boolean;
}

export default function SearchableSelect({
  options = [],
  value,
  onChange,
  label,
  multiple = false,
  disabled = false,
  required = false,
  size = 'small',
  fullWidth = true,
  placeholder,
  error,
  helperText,
  sx = {},
  getOptionDisabled
}: SearchableSelectProps) {
  // Normalize options to { value, label } structure
  const normalizedOptions: SearchableSelectOption[] = (options || []).map(opt => {
    if (opt === null || opt === undefined) {
      return { value: '', label: '' };
    }
    if (typeof opt === 'string' || typeof opt === 'number') {
      return { value: opt, label: String(opt) };
    }
    return opt;
  });

  // Find corresponding option object for a given value
  const findOption = (val: any) => {
    if (val === null || val === undefined) return null;
    const found = normalizedOptions.find(opt => String(opt.value) === String(val));
    if (found) return found;
    // Fallback if not found: create a dynamic one so it displays something
    return { value: val, label: String(val) };
  };

  // Convert current value (primitives/arrays) to option objects
  const autocompleteValue = multiple
    ? (Array.isArray(value) ? value : []).map(val => findOption(val)).filter(Boolean)
    : (value !== undefined && value !== null ? findOption(value) : null);

  return (
    <Autocomplete
      multiple={multiple}
      disabled={disabled}
      options={normalizedOptions}
      getOptionLabel={(option) => option?.label ?? ''}
      isOptionEqualToValue={(option, val) => String(option?.value) === String(val?.value)}
      value={autocompleteValue}
      getOptionDisabled={getOptionDisabled}
      onChange={(event, newValue) => {
        if (multiple) {
          const vals = (newValue as SearchableSelectOption[] || []).map(opt => opt.value);
          onChange(vals);
        } else {
          const val = (newValue as SearchableSelectOption | null)?.value ?? '';
          onChange(val);
        }
      }}
      renderOption={(props, option) => {
        const { key, ...rest } = props;
        return (
          <li key={key || option.value} {...rest}>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <div>{option.label}</div>
              {option.sublabel && (
                <div style={{ fontSize: '0.75rem', color: 'rgba(0,0,0,0.5)' }}>
                  {option.sublabel}
                </div>
              )}
            </div>
          </li>
        );
      }}
      renderInput={(params) => (
        <TextField
          {...params}
          label={label}
          size={size}
          placeholder={placeholder}
          required={required && (!multiple || !value || value.length === 0)}
          error={error}
          helperText={helperText}
        />
      )}
      renderTags={(tagValue, getTagProps) =>
        tagValue.map((option, index) => {
          const { key, ...tagProps } = getTagProps({ index });
          return (
            <Chip
              key={key || option.value}
              label={option.label}
              size="small"
              {...tagProps}
            />
          );
        })
      }
      sx={sx}
      fullWidth={fullWidth}
    />
  );
}
