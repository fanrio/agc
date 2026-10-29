import { useState, useEffect, useMemo } from 'react';
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

let cachedEnvironments: any[] | null = null;

export default function EnvironmentSelection({
  value,
  onChange,
  multiple = false,
  label = 'Environment',
  size = 'small',
  fullWidth = true,
  disabled = false,
  required = false,
  sx = {}
}: EnvironmentSelectionProps) {
  const { permissions } = usePermissions();
  const [environments, setEnvironments] = useState<any[]>(cachedEnvironments || []);
  const [loading, setLoading] = useState(!cachedEnvironments);

  useEffect(() => {
    if (cachedEnvironments) {
      setEnvironments(cachedEnvironments);
      setLoading(false);
      return;
    }
    let active = true;
    api.getEnvironments()
      .then((data) => {
        const list = data || [];
        cachedEnvironments = list;
        if (active) {
          setEnvironments(list);
          setLoading(false);
        }
      })
      .catch((err) => {
        console.error('Failed to load environments:', err);
        if (active) {
          setLoading(false);
        }
      });
    return () => { active = false; };
  }, []);

  const parseEnvs = (val: any) => {
    if (!val || val === 'ALL' || val === '*') return 'ALL';
    if (Array.isArray(val)) return val;
    if (typeof val === 'string') {
      try {
        const parsed = JSON.parse(val);
        if (Array.isArray(parsed)) return parsed;
      } catch (e) {
        return val.split(',').map((s) => s.trim().toUpperCase());
      }
    }
    return [];
  };

  const envOptions = useMemo(() => {
    const allowedEnvs = permissions?.isSuperAdmin ? 'ALL' : parseEnvs(permissions?.allowedEnvironments);
    const filtered = environments.filter((env) => {
      if (allowedEnvs === 'ALL') return true;
      return allowedEnvs.includes(env.ID);
    });
    return filtered.map((env) => ({
      value: env.ID,
      label: `${env.ID} - ${env.name}`
    }));
  }, [environments, permissions?.isSuperAdmin, permissions?.allowedEnvironments]);

  const handleSelectChange = (val: any) => {
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
