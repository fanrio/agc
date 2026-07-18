import { useState, useEffect } from 'react';
import { Autocomplete, TextField, CircularProgress, Box, Typography } from '@mui/material';
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
export default function UserSelection({
  value,
  onChange,
  label = 'User',
  placeholder = 'Type username or email...',
  size = 'small',
  fullWidth = true,
  disabled = false
}) {
  const [scimInput, setScimInput] = useState('');
  const [scimOptions, setScimOptions] = useState([]);
  const [scimLoading, setScimLoading] = useState(false);

  // SCIM debounced search calling API when input has >= 3 characters
  useEffect(() => {
    const trimmed = scimInput.trim();
    if (trimmed.length < 3) {
      setScimOptions([]);
      return;
    }
    const t = setTimeout(() => {
      setScimLoading(true);
      api.searchScimUsers(trimmed)
        .then(res => {
          setScimOptions(res || []);
          setScimLoading(false);
        })
        .catch(() => {
          setScimLoading(false);
        });
    }, 250);
    return () => clearTimeout(t);
  }, [scimInput]);

  return (
    <Autocomplete
      value={value}
      onChange={onChange}
      inputValue={scimInput}
      onInputChange={(e, v) => setScimInput(v)}
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
            </Box>
          </li>
        );
      }}
      fullWidth={fullWidth}
    />
  );
}
