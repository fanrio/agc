import { useState, useEffect } from 'react';
import { Autocomplete, TextField, CircularProgress, Box, Typography, Alert } from '@mui/material';
import * as api from '../api';

/**
 * Reusable Autocomplete component for searching and selecting SCIM users.
 * Handles internal debounced data fetching from the SCIM user service.
 *
 * @param {object} props
 * @param {object|null} props.value - Selected SCIM user object or null
 * @param {function} props.onChange - Event handler callback when value changes: (event, newValue) => void
 * @param {string} [props.label] - Input label string
 * @param {string} [props.placeholder] - Input placeholder string
 * @param {string} [props.size] - MUI size variant ('small' or 'medium')
 * @param {boolean} [props.fullWidth] - Should the component take full width
 */
interface UserSelectionProps {
  value: any;
  onChange: (event: any, newValue: any) => void;
  label?: string;
  placeholder?: string;
  size?: 'small' | 'medium';
  fullWidth?: boolean;
  disabled?: boolean;
}

export default function UserSelection({
  value,
  onChange,
  label = 'User',
  placeholder = 'Type username or email...',
  size = 'small',
  fullWidth = true,
  disabled = false
}: UserSelectionProps) {
  const [scimInput, setScimInput] = useState('');
  const [scimOptions, setScimOptions] = useState([]);
  const [scimLoading, setScimLoading] = useState(false);
  const [scimError, setScimError] = useState<string | null>(null);

  // SCIM debounced search calling API when input has >= 3 characters
  useEffect(() => {
    const trimmed = scimInput.trim();
    if (trimmed.length < 3) {
      setScimOptions([]);
      setScimError(null);
      return;
    }
    const t = setTimeout(() => {
      setScimLoading(true);
      setScimError(null);
      api.searchScimUsers(trimmed)
        .then(res => {
          setScimOptions(res || []);
          setScimError(null);
          setScimLoading(false);
        })
        .catch(err => {
          setScimOptions([]);
          setScimError(err.message || 'SCIM integration query failed');
          setScimLoading(false);
        });
    }, 250);
    return () => clearTimeout(t);
  }, [scimInput]);

  return (
    <Box sx={{ width: fullWidth ? '100%' : 'auto' }}>
      <Autocomplete
        value={value}
        onChange={onChange}
        inputValue={scimInput}
        onInputChange={(e, v) => {
          setScimInput(v);
          if (scimError) setScimError(null);
        }}
        options={scimOptions}
        filterOptions={(options) => options}
        loading={scimLoading}
        disabled={disabled}
        getOptionLabel={(option) => option.displayName || option.username || ''}
        isOptionEqualToValue={(option, val) => option.username === val?.username}
        renderInput={(params) => (
          <TextField
            {...params}
            label={label}
            size={size}
            placeholder={placeholder}
            error={!!scimError}
            helperText={scimError}
            InputProps={{
              ...params.InputProps,
              endAdornment: (
                <>
                  {scimLoading ? <CircularProgress color="inherit" size={20} /> : null}
                  {params.InputProps?.endAdornment}
                </>
              )
            }}
          />
        )}
        renderOption={(props, option) => {
          const { key, ...rest } = props;
          return (
            <li key={key || option.username} {...rest}>
              <Box sx={{ display: 'flex', flexDirection: 'column' }}>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {option.displayName}
                </Typography>
                {(option.email || option.department) && (
                  <Typography variant="caption" color="text.secondary">
                    {option.department}
                  </Typography>
                )}
              </Box>
            </li>
          );
        }}
        fullWidth={fullWidth}
      />
      {scimError && (
        <Alert severity="error" sx={{ mt: 1, py: 0.5, px: 1.5, fontSize: '0.8125rem' }}>
          {scimError}
        </Alert>
      )}
    </Box>
  );
}
