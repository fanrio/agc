import React, { useState, useEffect } from 'react';
import * as api from '../api';
import { usePermissions } from '../context/PermissionsContext';
import SearchableSelect from './SearchableSelect';

interface EnvironmentSelectionProps {
  value: any;
  onChange?: (val: any) => void;
  multiple?: boolean;
  label?: string;
  size?: 'small' | 'medium';
  fullWidth?: boolean;
  disabled?: boolean;
  required?: boolean;
  sx?: any;
}

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
}: EnvironmentSelectionProps) {
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

  const envOptions = filteredEnvironments.map(env => ({
    value: env.ID,
    label: `${env.ID} - ${env.name}`
  }));

  const handleSelectChange = (val) => {
    if (onChange) {
      onChange(val);
    }
  };

  return (
    <SearchableSelect
      options={envOptions}
      value={value}
      onChange={handleSelectChange}
      label={label}
      multiple={multiple}
      disabled={disabled || loading}
      required={required}
      size={size}
      fullWidth={fullWidth}
      sx={sx}
    />
  );
}
