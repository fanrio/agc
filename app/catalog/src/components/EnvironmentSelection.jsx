import React, { useState, useEffect } from 'react';
import { FormControl, InputLabel, Select, MenuItem, Checkbox, ListItemText, Box, Chip } from '@mui/material';
import * as api from '../api';
import { usePermissions } from '../context/PermissionsContext';

export default function EnvironmentSelection({
  value,
  onChange,
  multiple = false,
  label = "Environment",
  size = "small",
  fullWidth = true,
  disabled = false,
  required = false,
  sx = {}
}) {
  const { permissions } = usePermissions();
  const [environments, setEnvironments] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    api.getEnvironments()
      .then(data => {
        if (active) {
          setEnvironments(data || []);
          setLoading(false);
        }
      })
      .catch(err => {
        console.error("Failed to load environments:", err);
        if (active) {
          setLoading(false);
        }
      });
    return () => { active = false; };
  }, []);

  const parseEnvs = (val) => {
    if (!val || val === 'ALL' || val === '*') return 'ALL';
    try {
      const parsed = JSON.parse(val);
      if (Array.isArray(parsed)) return parsed;
    } catch (e) {
      return val.split(',').map(s => s.trim().toUpperCase());
    }
    return [];
  };

  const allowedEnvs = permissions?.isSuperAdmin ? 'ALL' : parseEnvs(permissions?.allowedEnvironments);

  const filteredEnvironments = environments.filter(env => {
    if (allowedEnvs === 'ALL') return true;
    return allowedEnvs.includes(env.ID);
  });

  const handleSelectChange = (event) => {
    const val = event.target.value;
    if (onChange) {
      onChange(val);
    }
  };

  return (
    <FormControl size={size} fullWidth={fullWidth} disabled={disabled || loading} required={required} sx={sx}>
      <InputLabel>{label}</InputLabel>
      <Select
        multiple={multiple}
        value={multiple ? (Array.isArray(value) ? value : []) : (value || '')}
        label={label}
        onChange={handleSelectChange}
        renderValue={(selected) => {
          if (multiple) {
            return (
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                {selected.map((val) => {
                  const env = filteredEnvironments.find(e => e.ID === val);
                  return <Chip key={val} label={env ? `${env.ID} - ${env.name}` : val} size="small" />;
                })}
              </Box>
            );
          }
          const env = filteredEnvironments.find(e => e.ID === selected);
          return env ? `${env.ID} - ${env.name}` : selected;
        }}
      >
        {loading && multiple && Array.isArray(value) && value.map(val => (
          <MenuItem key={val} value={val} style={{ display: 'none' }}>{val}</MenuItem>
        ))}
        {loading && !multiple && value && (
          <MenuItem value={value} style={{ display: 'none' }}>{value}</MenuItem>
        )}
        {filteredEnvironments.map((env) => {
          const isSelected = multiple
            ? (Array.isArray(value) && value.includes(env.ID))
            : value === env.ID;

          return (
            <MenuItem key={env.ID} value={env.ID}>
              {multiple && <Checkbox checked={isSelected} />}
              <ListItemText primary={`${env.ID} - ${env.name}`} />
            </MenuItem>
          );
        })}
        {filteredEnvironments.length === 0 && !loading && (
          <MenuItem value="" disabled>No environments available</MenuItem>
        )}
      </Select>
    </FormControl>
  );
}
